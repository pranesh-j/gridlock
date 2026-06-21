"""Video pipeline prototype: real-time vehicle tracking + congestion, with a
throttled violation tier (helmet / plate / OCR).

Two tiers, by design:
  * FAST  (every frame)      base YOLO with tracking -> vehicle count -> congestion
  * HEAVY (every N frames)   helmet + plate + OCR on the same frame -> violations

The heavy tier reuses the tracked vehicle boxes instead of re-running the base
model, and only touches the helmet/plate models -- so it never disturbs the
tracker running on the base model.

Usage:
    python video_pipeline.py --video ../demo-clips/test-video-2.mp4
    python video_pipeline.py --video ../demo-clips/test-video-1.mp4 --every 30 --show

Writes an annotated <video>.annotated.mp4 next to the input and prints timing
(so we get real fast-tier FPS) and a violation summary.
"""

import argparse
import os
import statistics
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

import cv2
import numpy as np
from PIL import Image

from detector import YoloDetector
from rules import build_events, _event
from track_rules import TrackMonitor
from emit import (
    CONGESTION_COLUMNS,
    VIOLATION_COLUMNS,
    FeedWriter,
    congestion_record,
    load_config,
    violation_record,
)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()

# COCO ids we count as vehicles, mapped to rules.py labels
VEHICLE_CLASSES = {2: "car", 3: "motorcycle_rider", 5: "bus", 7: "truck"}


def congestion_level(smoothed, free_max, moderate_max):
    if smoothed < free_max:
        return "FREE", (0, 200, 0)
    if smoothed < moderate_max:
        return "MODERATE", (0, 180, 255)
    return "CONGESTED", (0, 0, 255)


def _clip_box(box, W, H):
    return (max(0, int(box["x1"])), max(0, int(box["y1"])),
            min(W, int(box["x2"])), min(H, int(box["y2"])))


def _union(a, b):
    return {"x1": min(a["x1"], b["x1"]), "y1": min(a["y1"], b["y1"]),
            "x2": max(a["x2"], b["x2"]), "y2": max(a["y2"], b["y2"])}


def _expand_down(box, factor, W, H):
    w = box["x2"] - box["x1"]
    h = box["y2"] - box["y1"]
    return {"x1": box["x1"] - 0.5 * w, "y1": box["y1"],
            "x2": box["x2"] + 0.5 * w, "y2": box["y2"] + factor * h}


def _rider_below(head, dets):
    # the vehicle a bare head sits on: horizontally overlapping and below it
    hcy = (head["y1"] + head["y2"]) / 2
    best, best_ox = None, 0.0
    for d in dets:
        if d["label"] not in ("motorcycle_rider", "person", "bicycle"):
            continue
        b = d["box"]
        ox = min(head["x2"], b["x2"]) - max(head["x1"], b["x1"])
        if ox <= 0 or (b["y1"] + b["y2"]) / 2 < hcy:
            continue
        if ox > best_ox:
            best, best_ox = b, ox
    return best


def _evidence_crop(frame, event, all_dets):
    """Crop the whole offending vehicle with the offending part highlighted."""
    H, W = frame.shape[:2]
    primary = event["detections"][0]["box"]  # head for no_helmet, vehicle for lane_block
    if event["violation_type"] == "no_helmet":
        veh = event.get("vehicle")
        veh_box = veh["box"] if veh else _rider_below(primary, all_dets)
        region = _union(primary, veh_box) if veh_box else _expand_down(primary, 5.0, W, H)
        highlight = primary  # the un-helmeted head
        label = "NO HELMET"
    else:
        veh = event.get("vehicle")
        region = veh["box"] if veh else primary
        highlight = region
        label = event["violation_type"].replace("_", " ").upper()

    x1, y1, x2, y2 = _clip_box(region, W, H)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    crop = frame[y1:y2, x1:x2].copy()
    hx1, hy1 = int(highlight["x1"]) - x1, int(highlight["y1"]) - y1
    hx2, hy2 = int(highlight["x2"]) - x1, int(highlight["y2"]) - y1
    cv2.rectangle(crop, (hx1, hy1), (hx2, hy2), (0, 0, 255), 2)
    cv2.putText(crop, label, (max(0, hx1), max(12, hy1 - 4)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
    return crop


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--every", type=int, default=30,
                    help="run the violation tier every N frames")
    ap.add_argument("--free", type=float, default=6, help="count below this = FREE")
    ap.add_argument("--moderate", type=float, default=14,
                    help="count below this = MODERATE, else CONGESTED")
    ap.add_argument("--ema", type=float, default=0.2, help="smoothing factor 0..1")
    ap.add_argument("--max-frames", type=int, default=0, help="0 = whole clip")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--emit", action="store_true",
                    help="write SCITA violation + congestion CSV feeds")
    ap.add_argument("--emit-dir", default="../data/feeds")
    ap.add_argument("--window", type=float, default=5.0,
                    help="congestion aggregation window in seconds")
    ap.add_argument("--zone", default=None,
                    help="no-parking zone 'x1,y1,x2,y2' (lane_block + illegal_parking)")
    ap.add_argument("--dwell", type=float, default=5.0,
                    help="seconds stationary in zone before illegal_parking fires")
    ap.add_argument("--flow", default=None,
                    help="expected lane direction 'dx,dy' (image coords, y down) "
                         "for wrong_side_driving, e.g. '0,1' = traffic moves down")
    args = ap.parse_args()

    zone = None
    if args.zone:
        zx = [float(v) for v in args.zone.split(",")]
        zone = {"x1": zx[0], "y1": zx[1], "x2": zx[2], "y2": zx[3]}

    flow_vec = None
    if args.flow:
        fv = [float(v) for v in args.flow.split(",")]
        flow_vec = (fv[0], fv[1])

    d = YoloDetector()  # base + helmet + plate, loaded once
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"could not open {args.video}")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    out_path = args.out or os.path.splitext(args.video)[0] + ".annotated.mp4"
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

    smoothed = 0.0
    track_hist = defaultdict(lambda: deque(maxlen=15))  # id -> recent centroids
    overlay_violations = []  # violation detections to draw until next heavy pass
    fast_times, heavy_times = [], []
    vio_counts = defaultdict(int)
    fi = 0

    # --- structured SCITA feeds ---
    emit_cfg = vio_writer = cong_writer = evidence_dir = None
    vseq = cseq = 0
    win_frames = max(1, int(args.window * fps))
    win_counts, win_by_type, win_station_max, win_start = [], defaultdict(int), 0, 1
    if args.emit:
        emit_cfg = load_config()
        evidence_dir = os.path.join(args.emit_dir, "evidence")
        os.makedirs(evidence_dir, exist_ok=True)
        vio_writer = FeedWriter(
            os.path.join(args.emit_dir, "violations.csv"), VIOLATION_COLUMNS)
        cong_writer = FeedWriter(
            os.path.join(args.emit_dir, "congestion.csv"), CONGESTION_COLUMNS)

    # temporal (track-based) violations: illegal_parking + wrong_side_driving
    monitor = TrackMonitor(
        fps,
        event_builder=lambda vt, det, ctx: _event(
            vt, det["confidence"], det, None, ctx, vehicle=det),
        no_parking_zone=zone, park_dwell_s=args.dwell, flow_vec=flow_vec,
    )
    active_alerts = deque()  # (expire_frame, box, label) for the on-screen overlay

    def write_violation(ev, frame_img, all_dets, frame_idx):
        nonlocal vseq
        rec = violation_record(ev, emit_cfg, vseq, source_frame=frame_idx)
        crop = _evidence_crop(frame_img, ev, all_dets)
        if crop is not None and crop.size:
            ep = os.path.join(evidence_dir, rec["id"] + ".jpg")
            cv2.imwrite(ep, crop)
            rec["evidence_image_path"] = ep.replace(os.sep, "/")
        vio_writer.write(rec)
        vseq += 1

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        fi += 1
        if args.max_frames and fi > args.max_frames:
            break

        # ---- FAST TIER: track vehicles every frame ----
        t0 = time.time()
        res = d.model.track(
            frame, persist=True, classes=list(VEHICLE_CLASSES),
            conf=d.conf, verbose=False,
        )[0]

        vehicles = []  # (x1,y1,x2,y2,id,cls)
        tracks = []    # dicts for TrackMonitor: {id,label,box,confidence}
        if res.boxes is not None and len(res.boxes) > 0:
            ids = (res.boxes.id.int().tolist()
                   if res.boxes.id is not None else [None] * len(res.boxes))
            confs = (res.boxes.conf.tolist()
                     if res.boxes.conf is not None else [0.85] * len(res.boxes))
            for xyxy, tid, cls, cf in zip(
                res.boxes.xyxy.tolist(), ids, res.boxes.cls.int().tolist(), confs
            ):
                x1, y1, x2, y2 = map(int, xyxy)
                vehicles.append((x1, y1, x2, y2, tid, cls))
                tracks.append({
                    "id": tid, "label": VEHICLE_CLASSES.get(cls, "vehicle"),
                    "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "confidence": float(cf),
                })
                if tid is not None:
                    track_hist[tid].append(((x1 + x2) // 2, (y1 + y2) // 2))

        count = len(vehicles)
        smoothed = args.ema * count + (1 - args.ema) * smoothed

        # stationarity: tracks whose centroid barely moved over the window
        stationary = 0
        for h in track_hist.values():
            if len(h) >= 5:
                disp = np.hypot(h[-1][0] - h[0][0], h[-1][1] - h[0][1])
                if disp < 8:
                    stationary += 1
        fast_times.append(time.time() - t0)

        level, color = congestion_level(smoothed, args.free, args.moderate)
        # escalate: lots of vehicles AND most of them stalled => jam
        if count >= args.free and stationary >= max(3, count * 0.6):
            level, color = "JAM", (0, 0, 255)

        # ---- CONGESTION FEED: aggregate per window and emit ----
        if args.emit:
            win_counts.append(count)
            for (_x1, _y1, _x2, _y2, _tid, cls) in vehicles:
                win_by_type[VEHICLE_CLASSES.get(cls, "vehicle")] += 1
            win_station_max = max(win_station_max, stationary)
            if fi - win_start + 1 >= win_frames:
                n = len(win_counts)
                cong_writer.write(congestion_record({
                    "created_datetime": _now_iso(),
                    "window_seconds": args.window,
                    "count_avg": sum(win_counts) / n if n else 0,
                    "count_peak": max(win_counts) if win_counts else 0,
                    "stationary": win_station_max,
                    "level": level,
                    "by_type": {t: round(s / n) for t, s in win_by_type.items()} if n else {},
                    "frame_start": win_start, "frame_end": fi,
                }, emit_cfg, cseq))
                cseq += 1
                win_counts.clear()
                win_by_type.clear()
                win_station_max = 0
                win_start = fi + 1

        # ---- TEMPORAL VIOLATIONS (every frame, track-based) ----
        temporal = monitor.update(tracks, fi, {"corridor": "demo"})
        pil_frame = None  # built lazily, only when an event needs a plate read
        for ev in temporal:
            # enrich with the offending vehicle's plate (on demand)
            if d.plate_model is not None and not ev.get("plate_text"):
                if pil_frame is None:
                    pil_frame = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                vbox = (ev.get("vehicle") or ev["detections"][0])["box"]
                plate = d.plate_in_vehicle(pil_frame, vbox)
                if plate:
                    ev["plate_text"] = plate["ocr_text"]
                    ev["plate_confidence"] = (
                        round(float(plate["confidence"]), 3))
                    ev["detections"].append(plate)
            vio_counts[ev["violation_type"]] += 1
            active_alerts.append(
                (fi + int(fps * 3), ev["detections"][0]["box"], ev["violation_type"]))
            if args.emit:
                write_violation(ev, frame, [], fi)

        # ---- HEAVY TIER: violations every N frames ----
        if fi % args.every == 1:
            th = time.time()
            pil = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            base_dets = [
                {"label": VEHICLE_CLASSES[cls], "confidence": 0.85,
                 "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}, "ocr_text": None}
                for (x1, y1, x2, y2, _tid, cls) in vehicles if cls in VEHICLE_CLASSES
            ]
            dets = list(base_dets)
            if d.helmet_model is not None:
                for hd in d._infer(d.helmet_model, pil):
                    hd["label"] = d._normalize_helmet_label(hd["label"])
                    dets.append(hd)
            if d.plate_model is not None:
                dets.extend(d._detect_plates(pil, base_dets))

            evs = build_events(dets, no_parking_zone=zone,
                               context={"corridor": "demo"})
            for e in evs:
                vio_counts[e["violation_type"]] += 1
            overlay_violations = [
                x for x in dets
                if x["label"] in ("helmet", "no_helmet", "license_plate")
            ]
            heavy_times.append(time.time() - th)

            # ---- VIOLATION FEED: one schema row + evidence crop per event ----
            if args.emit:
                for ev in evs:
                    write_violation(ev, frame, dets, fi)

        # ---- DRAW ----
        for (x1, y1, x2, y2, tid, cls) in vehicles:
            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 180, 0), 2)
            tag = VEHICLE_CLASSES.get(cls, "veh") + (f"#{tid}" if tid is not None else "")
            cv2.putText(frame, tag, (x1, y1 - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 180, 0), 1)
        for det in overlay_violations:
            b = det["box"]
            col = ({"no_helmet": (0, 0, 255), "helmet": (0, 255, 0)}
                   .get(det["label"], (0, 255, 255)))
            cv2.rectangle(frame, (int(b["x1"]), int(b["y1"])),
                          (int(b["x2"]), int(b["y2"])), col, 2)
            tag = det["label"] + (f" {det['ocr_text']}" if det.get("ocr_text") else "")
            cv2.putText(frame, tag, (int(b["x1"]), int(b["y1"]) - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 1)

        # active temporal-violation alerts (illegal parking / wrong-side)
        while active_alerts and active_alerts[0][0] < fi:
            active_alerts.popleft()
        for _exp, b, lab in active_alerts:
            cv2.rectangle(frame, (int(b["x1"]), int(b["y1"])),
                          (int(b["x2"]), int(b["y2"])), (0, 0, 255), 3)
            cv2.putText(frame, lab.replace("_", " ").upper(),
                        (int(b["x1"]), int(b["y1"]) - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        cv2.rectangle(frame, (0, 0), (380, 78), (0, 0, 0), -1)
        cv2.putText(frame, f"Vehicles: {count}  (avg {smoothed:.1f}, still {stationary})",
                    (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(frame, f"Traffic: {level}", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        writer.write(frame)
        if args.show:
            cv2.imshow("gridlock", frame)
            if cv2.waitKey(1) & 0xFF == 27:
                break

    # flush a trailing partial congestion window
    if args.emit and win_counts:
        n = len(win_counts)
        cong_writer.write(congestion_record({
            "created_datetime": _now_iso(),
            "window_seconds": args.window,
            "count_avg": sum(win_counts) / n,
            "count_peak": max(win_counts),
            "stationary": win_station_max,
            "level": level,
            "by_type": {t: round(s / n) for t, s in win_by_type.items()},
            "frame_start": win_start, "frame_end": fi,
        }, emit_cfg, cseq))
        cseq += 1

    cap.release()
    writer.release()
    if args.show:
        cv2.destroyAllWindows()
    if args.emit:
        vio_writer.close()
        cong_writer.close()

    ft = statistics.mean(fast_times) if fast_times else 0
    print(f"\nframes processed : {fi}")
    print(f"fast tier        : {ft * 1000:.1f} ms/frame  (~{(1/ft if ft else 0):.1f} fps)")
    if heavy_times:
        print(f"heavy tier       : {statistics.mean(heavy_times):.2f} s/call "
              f"over {len(heavy_times)} calls")
    print(f"violations       : {dict(vio_counts)}")
    if args.emit:
        print(f"feeds            : {vseq} violation rows, {cseq} congestion rows "
              f"-> {args.emit_dir}")
    print(f"annotated output : {out_path}")


if __name__ == "__main__":
    main()
