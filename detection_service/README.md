# Gridlock Detection Service

A small HTTP API that detects traffic violations in a single image. Hand it a
frame, get back structured violation **events** plus the **raw detections**.

## Run

```bash
pip install -r requirements.txt
python service.py            # serves on http://localhost:8001 (override with PORT)
# or: uvicorn service:app --host 0.0.0.0 --port 8001
```

Pick the backend with `DETECTOR`:

| `DETECTOR` | Backend | Notes |
|---|---|---|
| `yolo` (default) | YOLO + helmet + plate models | fast, local, CPU/GPU |
| `mock` | static stub | no models/GPU needed — handy for frontend dev |
| `locateanything` | NVIDIA LocateAnything-3B VLM | heavy, needs a GPU |

Model weights for the `yolo` backend live in `../models/` — see
[../models/README.md](../models/README.md) to download them. Missing add-on
weights are skipped gracefully (no helmet/plate detections, service still runs).

## Endpoints

Interactive docs: **`/docs`** · machine-readable schema: **`/openapi.json`**

### `GET /health`
Readiness probe. `ready` is `true` once the model is loaded; `error` is set if
loading failed.
```json
{"ok": true, "ready": true, "detector": "YoloDetector", "version": "1.0.0", "error": null}
```

### `GET /capabilities`
What this instance can emit — useful for consumers to discover labels/violations.
```json
{"detector": "YoloDetector",
 "violation_types": ["lane_block", "no_helmet"],
 "labels": ["car","truck","bus","motorcycle_rider","bicycle","person","helmet","no_helmet","license_plate"],
 "version": "1.0.0"}
```

### `POST /detect`
`multipart/form-data`:

| field | required | description |
|---|---|---|
| `file` | yes | image frame |
| `no_parking_zone` | no | JSON `{x1,y1,x2,y2}` rectangle (pixels). Defaults to a demo zone. |
| `context` | no | JSON of location fields copied onto each event (e.g. `{"corridor":"...","latitude":..}`) |

```bash
curl -X POST http://localhost:8001/detect \
  -F "file=@frame.jpg" \
  -F 'no_parking_zone={"x1":100,"y1":180,"x2":400,"y2":420}' \
  -F 'context={"corridor":"Tumkur Road","latitude":13.02,"longitude":77.55}'
```

Response (`200`):
```json
{
  "events": [
    {"event_id": "…", "violation_type": "no_helmet", "confidence": 0.79,
     "corridor": "Tumkur Road", "plate_text": "KA01AB1234",
     "latitude": null, "longitude": null, "annotated_image_path": null,
     "detections": [ /* the detection(s) backing this event */ ]}
  ],
  "raw_detections": [
    {"label": "motorcycle_rider", "confidence": 0.73,
     "box": {"x1": 564, "y1": 383, "x2": 914, "y2": 859}, "ocr_text": null}
  ]
}
```

### Error codes
| code | when |
|---|---|
| `415` | uploaded file is not an image |
| `400` | empty file, undecodable image, or malformed JSON in a form field |
| `422` | `file` field missing |
| `503` | detector model not loaded (check `/health`) |
| `500` | unexpected detection failure (message included, no stack trace) |

## Notes for integrators
- The JSON contract is defined by the Pydantic models in `schemas.py`.
- Inference is serialized behind a lock and runs off the event loop, so
  concurrent callers queue safely rather than racing on the GPU model.
- CORS is open (`*`) for easy browser/service access.
