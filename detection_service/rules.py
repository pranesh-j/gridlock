import uuid

VEHICLE_LABELS = {"car", "truck", "bus", "lcv", "van", "auto", "vehicle"}


def _area(b):
    return max(0.0, b["x2"] - b["x1"]) * max(0.0, b["y2"] - b["y1"])


def _overlap(a, b):
    x1 = max(a["x1"], b["x1"])
    y1 = max(a["y1"], b["y1"])
    x2 = min(a["x2"], b["x2"])
    y2 = min(a["y2"], b["y2"])
    if x2 <= x1 or y2 <= y1:
        return 0.0
    inter = (x2 - x1) * (y2 - y1)
    return inter / (_area(a) + 1e-6)


def _center_in_zone(box, zone):
    cx = (box["x1"] + box["x2"]) / 2
    cy = (box["y1"] + box["y2"]) / 2
    return zone["x1"] <= cx <= zone["x2"] and zone["y1"] <= cy <= zone["y2"]


# build violation events from raw detections.
# no_parking_zone: optional dict {x1,y1,x2,y2} marking the no-parking area.
# context: location fields attached to every event.
def build_events(detections, no_parking_zone=None, context=None):
    context = context or {}
    events = []

    vehicles = [d for d in detections if d["label"] in VEHICLE_LABELS]
    plates = [d for d in detections if d["label"] == "license_plate"]

    # lane block: a vehicle sitting inside the no-parking zone
    if no_parking_zone:
        for v in vehicles:
            if _center_in_zone(v["box"], no_parking_zone):
                plate = _nearest_plate(v, plates)
                events.append(_event("lane_block", v["confidence"], v, plate, context))

    # no helmet: a dedicated helmet model classifies each rider's head, emitting
    # a "no_helmet" box for un-helmeted heads. each such box is a violation.
    # if no helmet model is loaded there are no "no_helmet" detections, so we
    # raise nothing rather than falsely flagging every rider.
    bare_heads = [d for d in detections if d["label"] == "no_helmet"]
    for head in bare_heads:
        plate = _nearest_plate(head, plates)
        events.append(_event("no_helmet", head["confidence"], head, plate, context))

    return events


def _nearest_plate(obj, plates):
    if not plates:
        return None
    ocx = (obj["box"]["x1"] + obj["box"]["x2"]) / 2
    best = None
    best_d = 1e9
    for p in plates:
        pcx = (p["box"]["x1"] + p["box"]["x2"]) / 2
        d = abs(pcx - ocx)
        if d < best_d:
            best_d = d
            best = p
    return best


def _event(vtype, conf, det, plate, context):
    return {
        "event_id": str(uuid.uuid4()),
        "violation_type": vtype,
        "confidence": round(float(conf), 3),
        "corridor": context.get("corridor"),
        "junction": context.get("junction"),
        "latitude": context.get("latitude"),
        "longitude": context.get("longitude"),
        "plate_text": plate["ocr_text"] if plate else None,
        "annotated_image_path": None,
        "detections": [det] + ([plate] if plate else []),
    }
