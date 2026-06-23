"""Map detector violation events + congestion metrics to the SCITA feed schemas
and append them to CSV feeds.

Two feeds:
  * violations  -- matches the police_violations.csv layout (24 cols) PLUS a few
                   CV-specific columns (confidence, evidence image, bbox, frame).
                   Auto-detected rows are written with validation_status="pending".
  * congestion  -- a timeseries of vehicle counts / congestion level per window,
                   sharing the location/provenance fields for clean joins.

Deployment-specific values (device_id, location, lat/lng, offence codes, ...)
come from emit_config.json; see DEFAULTS below for the keys.
"""

import csv
import json
import os

# --- the original 24 columns, in order, then additive CV columns ---
SCHEMA_COLUMNS = [
    "id", "latitude", "longitude", "location", "vehicle_number", "vehicle_type",
    "description", "violation_type", "offence_code", "created_datetime",
    "closed_datetime", "modified_datetime", "device_id", "created_by_id",
    "center_code", "police_station", "data_sent_to_scita", "junction_name",
    "action_taken_timestamp", "data_sent_to_scita_timestamp",
    "updated_vehicle_number", "updated_vehicle_type", "validation_status",
    "validation_timestamp",
]
CV_COLUMNS = [
    "detection_confidence", "plate_confidence", "evidence_image_path",
    "bbox", "source_frame",
]
VIOLATION_COLUMNS = SCHEMA_COLUMNS + CV_COLUMNS

CONGESTION_COLUMNS = [
    "id", "created_datetime", "latitude", "longitude", "location",
    "junction_name", "device_id", "center_code", "window_seconds",
    "vehicle_count_avg", "vehicle_count_peak", "stationary_count",
    "congestion_level", "count_by_type", "source_frame_start",
    "source_frame_end", "data_sent_to_scita", "data_sent_to_scita_timestamp",
]

# placeholder deployment config; override via emit_config.json
DEFAULTS = {
    "id_prefix": "FKID",
    "congestion_id_prefix": "CGID",
    "device_id": "FKDEV00000",
    "created_by_id": "FKUSR00000",
    "center_code": "9",
    "police_station": "Madiwala",
    "latitude": 12.9255567,
    "longitude": 77.618665,
    "location": "18th Main Road, Block 2, Koramangala, Bengaluru, Karnataka. "
                "Pin-560068 (India)",
    "junction_name": "No Junction",
    # map our internal violation type -> SCITA label + legal offence code.
    # FILL IN real offence codes per your jurisdiction.
    "violation_map": {
        "no_helmet": {"label": "RIDING WITHOUT HELMET", "offence_code": None},
        "lane_block": {"label": "WRONG PARKING", "offence_code": 112},
    },
    # detected class -> SCITA vehicle_type vocabulary
    "vehicle_type_map": {
        "car": "CAR", "truck": "TRUCK", "bus": "BUS",
        "motorcycle_rider": "MOTORCYCLE", "bicycle": "BICYCLE",
        "person": "MOTORCYCLE",
    },
}


def load_config(path=None):
    cfg = dict(DEFAULTS)
    path = path or os.environ.get(
        "EMIT_CONFIG", os.path.join(os.path.dirname(__file__), "emit_config.json")
    )
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg.update(json.load(f))
    return cfg


def _null(v):
    return "NULL" if v is None else v


def violation_record(event, cfg, seq, source_frame=None, evidence_path=None):
    vio = cfg["violation_map"].get(
        event["violation_type"],
        {"label": event["violation_type"].upper().replace("_", " "), "offence_code": None},
    )
    veh = event.get("vehicle")
    veh_label = veh["label"] if veh else None
    vehicle_type = cfg["vehicle_type_map"].get(veh_label) if veh_label else None
    if vehicle_type is None:
        vehicle_type = "MOTORCYCLE" if event["violation_type"] == "no_helmet" else "NULL"

    box = (veh or (event["detections"][0] if event["detections"] else None))
    box = box["box"] if box else None

    return {
        "id": f"{cfg['id_prefix']}{seq:06d}",
        "latitude": event.get("latitude") if event.get("latitude") is not None else cfg["latitude"],
        "longitude": event.get("longitude") if event.get("longitude") is not None else cfg["longitude"],
        "location": cfg["location"],
        "vehicle_number": event.get("plate_text") or "NULL",
        "vehicle_type": vehicle_type,
        "description": "NULL",
        "violation_type": json.dumps([vio["label"]]),
        "offence_code": json.dumps(
            [vio["offence_code"]] if vio.get("offence_code") is not None else []
        ),
        "created_datetime": event["created_datetime"],
        "closed_datetime": "NULL",
        "modified_datetime": event["created_datetime"],
        "device_id": cfg["device_id"],
        "created_by_id": cfg["created_by_id"],
        "center_code": cfg["center_code"],
        "police_station": cfg["police_station"],
        "data_sent_to_scita": "FALSE",
        "junction_name": event.get("junction") or cfg["junction_name"],
        "action_taken_timestamp": "NULL",
        "data_sent_to_scita_timestamp": "NULL",
        "updated_vehicle_number": "NULL",
        "updated_vehicle_type": "NULL",
        "validation_status": "pending",  # auto-detected -> awaits human review
        "validation_timestamp": "NULL",
        # additive CV columns
        "detection_confidence": event["confidence"],
        "plate_confidence": _null(event.get("plate_confidence")),
        "evidence_image_path": _null(evidence_path),
        "bbox": json.dumps(
            [round(box["x1"]), round(box["y1"]), round(box["x2"]), round(box["y2"])]
        ) if box else "NULL",
        "source_frame": _null(source_frame),
    }


def congestion_record(metrics, cfg, seq):
    return {
        "id": f"{cfg['congestion_id_prefix']}{seq:06d}",
        "created_datetime": metrics["created_datetime"],
        "latitude": cfg["latitude"],
        "longitude": cfg["longitude"],
        "location": cfg["location"],
        "junction_name": cfg["junction_name"],
        "device_id": cfg["device_id"],
        "center_code": cfg["center_code"],
        "window_seconds": metrics["window_seconds"],
        "vehicle_count_avg": round(metrics["count_avg"], 2),
        "vehicle_count_peak": metrics["count_peak"],
        "stationary_count": metrics["stationary"],
        "congestion_level": metrics["level"],
        "count_by_type": json.dumps(metrics["by_type"]),
        "source_frame_start": _null(metrics.get("frame_start")),
        "source_frame_end": _null(metrics.get("frame_end")),
        "data_sent_to_scita": "FALSE",
        "data_sent_to_scita_timestamp": "NULL",
    }


class FeedWriter:
    """Append-only CSV writer; writes a header when the file is new."""

    def __init__(self, path, columns):
        self.columns = columns
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        new = (not os.path.exists(path)) or os.path.getsize(path) == 0
        self._f = open(path, "a", newline="", encoding="utf-8")
        self._w = csv.DictWriter(self._f, fieldnames=columns, extrasaction="ignore")
        if new:
            self._w.writeheader()

    def write(self, rec):
        self._w.writerow({k: _null(rec.get(k)) for k in self.columns})
        self._f.flush()

    def close(self):
        self._f.close()
