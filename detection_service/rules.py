import uuid
from datetime import datetime, timezone

VEHICLE_LABELS = {"car", "truck", "bus", "lcv", "van", "auto", "vehicle"}
RIDER_LABELS = {"motorcycle_rider", "person"}


def _area(b):
    return max(0.0, b["x2"] - b["x1"]) * max(0.0, b["y2"] - b["y1"])


def _overlap(a, b):
    # fraction of a that lies inside b
    x1 = max(a["x1"], b["x1"])
    y1 = max(a["y1"], b["y1"])
    x2 = min(a["x2"], b["x2"])
    y2 = min(a["y2"], b["y2"])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    return inter / (_area(a) + 1e-6)


def _center(b):
    return (b["x1"] + b["x2"]) / 2, (b["y1"] + b["y2"]) / 2


def _point_in(box, x, y):
    return box["x1"] <= x <= box["x2"] and box["y1"] <= y <= box["y2"]


def _center_in_zone(box, zone):
    cx, cy = _center(box)
    return _point_in(zone, cx, cy)


def _extend_down(box, factor):
    # grow a box downward (and slightly sideways) to cover the area below an
    # object -- a plate sits at the bottom of / just under its vehicle
    w = box["x2"] - box["x1"]
    h = box["y2"] - box["y1"]
    return {
        "x1": box["x1"] - 0.15 * w,
        "y1": box["y1"],
        "x2": box["x2"] + 0.15 * w,
        "y2": box["y2"] + factor * h,
    }


def _extend_up(box, factor):
    # grow a box upward -- riders' heads sit above their motorcycle
    w = box["x2"] - box["x1"]
    h = box["y2"] - box["y1"]
    return {
        "x1": box["x1"] - 0.1 * w,
        "y1": box["y1"] - factor * h,
        "x2": box["x2"] + 0.1 * w,
        "y2": box["y2"],
    }


def _enclosing(inner_box, candidates):
    # the candidate whose box contains inner_box's center, with most overlap
    cx, cy = _center(inner_box)
    best, best_ov = None, 0.0
    for c in candidates:
        if _point_in(c["box"], cx, cy):
            ov = _overlap(inner_box, c["box"])
            if ov >= best_ov:
                best, best_ov = c, ov
    return best


def _plate_for(region, plates):
    # the plate whose center lies inside region, preferring the largest overlap.
    # spatial containment, not nearest-x, so a violation gets ITS vehicle's plate
    best, best_ov = None, 0.0
    for p in plates:
        cx, cy = _center(p["box"])
        if _point_in(region, cx, cy):
            ov = _overlap(p["box"], region)
            if ov >= best_ov:
                best, best_ov = p, ov
    return best


# build violation events from raw detections.
# no_parking_zone: optional dict {x1,y1,x2,y2} marking the no-parking area.
# context: location fields attached to every event.
def build_events(detections, no_parking_zone=None, context=None):
    context = context or {}
    events = []

    vehicles = [d for d in detections if d["label"] in VEHICLE_LABELS]
    riders = [d for d in detections if d["label"] in RIDER_LABELS]
    plates = [d for d in detections if d["label"] == "license_plate"]
    bare_heads = [d for d in detections if d["label"] == "no_helmet"]
    motorcycles = [d for d in detections if d["label"] == "motorcycle_rider"]
    heads = [d for d in detections if d["label"] in ("helmet", "no_helmet")]

    # lane block: a vehicle sitting inside the no-parking zone. read the plate
    # contained within that vehicle (extended down to catch a low-mounted plate).
    if no_parking_zone:
        for v in vehicles:
            if _center_in_zone(v["box"], no_parking_zone):
                plate = _plate_for(_extend_down(v["box"], 0.3), plates)
                events.append(
                    _event("lane_block", v["confidence"], v, plate, context, vehicle=v)
                )

    # no helmet: each un-helmeted head. find the rider/motorcycle that head
    # belongs to, then the plate on that vehicle -- so the event carries the
    # offending rider's own plate, not just the nearest one in the frame.
    for head in bare_heads:
        rider = _enclosing(head["box"], riders)
        if rider is not None:
            search = _extend_down(rider["box"], 0.5)
        else:
            # no rider box matched; search the column below the head
            search = _extend_down(head["box"], 4.0)
        plate = _plate_for(search, plates)
        events.append(
            _event("no_helmet", head["confidence"], head, plate, context, vehicle=rider)
        )

    # triple riding: 3+ occupants on one motorcycle. heads (helmeted or not)
    # are a reliable occupant proxy and are available in both the API and video
    # paths, so we count heads sitting in the region above each motorcycle.
    for m in motorcycles:
        region = _extend_up(m["box"], 1.5)
        occupants = [h for h in heads if _point_in(region, *_center(h["box"]))]
        if len(occupants) >= 3:
            plate = _plate_for(_extend_down(m["box"], 0.3), plates)
            ev = _event("triple_riding", m["confidence"], m, plate, context, vehicle=m)
            ev["detections"].extend(occupants)  # the heads backing the count
            events.append(ev)

    return events


def _event(vtype, conf, det, plate, context, vehicle=None):
    now = datetime.now(timezone.utc).isoformat()
    backing = [det]
    if vehicle is not None and vehicle is not det:
        backing.append(vehicle)
    if plate is not None:
        backing.append(plate)
    return {
        "event_id": str(uuid.uuid4()),
        "violation_type": vtype,
        "confidence": round(float(conf), 3),
        "created_datetime": now,
        "corridor": context.get("corridor"),
        "junction": context.get("junction"),
        "latitude": context.get("latitude"),
        "longitude": context.get("longitude"),
        "plate_text": plate["ocr_text"] if plate else None,
        "plate_confidence": round(float(plate["confidence"]), 3) if plate else None,
        "annotated_image_path": None,
        # the vehicle/rider this violation is tied to; used to derive vehicle_type
        # and the evidence crop. internal — not part of the API response schema.
        "vehicle": vehicle,
        "detections": backing,
    }
