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

import cv2
import numpy as np
from PIL import Image

from detector import YoloDetector
from rules import build_events

# COCO ids we count as vehicles, mapped to rules.py labels
VEHICLE_CLASSES = {2: "car", 3: "motorcycle_rider", 5: "bus", 7: "truck"}


def congestion_level(smoothed, free_max, moderate_max):
    if smoothed < free_max:
        return "FREE", (0, 200, 0)
    if smoothed < moderate_max:
        return "MODERATE", (0, 180, 255)
    return "CONGESTED", (0, 0, 255)


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
    args = ap.parse_args()

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
        if res.boxes is not None and len(res.boxes) > 0:
            ids = (res.boxes.id.int().tolist()
                   if res.boxes.id is not None else [None] * len(res.boxes))
            for xyxy, tid, cls in zip(
                res.boxes.xyxy.tolist(), ids, res.boxes.cls.int().tolist()
            ):
                x1, y1, x2, y2 = map(int, xyxy)
                vehicles.append((x1, y1, x2, y2, tid, cls))
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

            evs = build_events(dets, no_parking_zone=None,
                               context={"corridor": "demo"})
            for e in evs:
                vio_counts[e["violation_type"]] += 1
            overlay_violations = [
                x for x in dets
                if x["label"] in ("helmet", "no_helmet", "license_plate")
            ]
            heavy_times.append(time.time() - th)

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

    cap.release()
    writer.release()
    if args.show:
        cv2.destroyAllWindows()

    ft = statistics.mean(fast_times) if fast_times else 0
    print(f"\nframes processed : {fi}")
    print(f"fast tier        : {ft * 1000:.1f} ms/frame  (~{(1/ft if ft else 0):.1f} fps)")
    if heavy_times:
        print(f"heavy tier       : {statistics.mean(heavy_times):.2f} s/call "
              f"over {len(heavy_times)} calls")
    print(f"violations       : {dict(vio_counts)}")
    print(f"annotated output : {out_path}")


if __name__ == "__main__":
    main()
