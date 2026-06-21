# Gridlock — context & pipeline for contributors

Orientation for anyone (engineer or agent) working on **any** of the services.
For a one-paragraph overview see [README.md](README.md); this file is the deeper
map of how the pieces fit and how to integrate with them.

## What the system does

A traffic-camera **image or video** is analysed for violations and **congestion**.
Detections are emitted as structured records in the **SCITA police schema**, and
lane-block incidents are fed to a forecaster that predicts severity / closure /
clearance and recommends a response.

Violation types currently emitted (the `ViolationType` enum in `shared/schema.py`):
`lane_block`, `no_helmet`, `triple_riding`, `illegal_parking`, `wrong_side_driving`.

## Services (who owns what)

```
detection_service/   CV pipeline + HTTP API   (GPU; the mature, central piece)
backend/             orchestrator + CatBoost forecaster + recommender (CPU)
frontend/            React + Vite + Tailwind dashboard
shared/              cross-service violation-event contract
models/              weights & trained models  (gitignored — see models/README.md)
data/               source datasets + generated feeds (feeds gitignored)
demo-clips/          test videos (gitignored)
```

Process topology when everything runs:

```
frontend (:5173) ──HTTP──► backend (:8000) ──HTTP──► detection_service (:8001)
                              │  /analyze            │  /detect
                              ▼                       ▼
                     forecaster (CatBoost)     YOLO + helmet + plate + OCR
```

## detection_service — the pipeline in detail

One core path, two entry points. See [detection_service/README.md](detection_service/README.md)
for the full API reference.

**Core flow** (`detector.py` → `rules.py`):
1. **Detect** (`YoloDetector`): base **YOLO11m** → vehicles/people; a helmet model
   → `helmet`/`no_helmet` heads; a plate model (run full-frame **and per-vehicle
   crops** so small plates are detectable) → plates, each read by **EasyOCR**.
   All detections share one shape: `{label, confidence, box{x1,y1,x2,y2}, ocr_text}`.
2. **Single-frame rules** (`rules.py` `build_events`): emits `lane_block`
   (vehicle centre inside a `no_parking_zone`), `no_helmet` (each bare head), and
   `triple_riding` (3+ heads above one motorcycle). Plates are tied to a violation
   by **spatial containment** (the offending vehicle's own plate, not nearest-x).
   Every event is timestamped.
3. **Temporal rules** (`track_rules.py` `TrackMonitor`, video only — needs
   tracking history): emits `illegal_parking` (vehicle stationary in the zone for
   ≥ a dwell time) and `wrong_side_driving` (travel direction opposes the lane's
   configured flow). Debounced per track; emits the **same event shape**, so emit/
   feeds/evidence are identical. These read a plate on demand via
   `YoloDetector.plate_in_vehicle()`.

**Entry point A — REST (`service.py`, per image):**
`POST /detect` (multipart image + optional `no_parking_zone`/`context`) →
`{events, raw_detections}`. Also `/health`, `/capabilities`, `/docs`.
Backend selected by `DETECTOR` env (`yolo` default, `mock`, `locateanything`).

**Entry point B — video (`video_pipeline.py`):**
A capture loop with two tiers — **fast** (every frame: tracking + vehicle count +
congestion level + temporal violations) and **heavy** (throttled: helmet/plate/OCR
→ single-frame violations). With `--emit` it writes the structured feeds (below) +
an annotated `.mp4` + per-violation evidence crops, in one pass. Key flags:
`--zone x1,y1,x2,y2` (no-parking area → `lane_block`/`illegal_parking`),
`--dwell <sec>` (parking dwell time), `--flow dx,dy` (lane direction →
`wrong_side_driving`), `--window <sec>` (congestion window), `--every <n>`
(heavy-tier cadence). `--zone` and `--flow` are **per-camera calibration**.

## Data contracts (what to integrate against)

- **API**: Pydantic models in `detection_service/schemas.py` (drive `/openapi.json`).
- **Violation feed** (`data/feeds/violations.csv`): the **24 SCITA columns** +
  additive CV columns (`detection_confidence`, `plate_confidence`,
  `evidence_image_path`, `bbox`, `source_frame`). Auto-detected rows are written
  `validation_status="pending"` — they must be reviewed before being trusted.
- **Congestion feed** (`data/feeds/congestion.csv`): per-window timeseries
  (count avg/peak, stationary, level, count_by_type) sharing location/provenance
  fields, suitable for training a congestion forecaster.
- **Deployment config** (`detection_service/emit_config.json`): `device_id`,
  `location`, lat/lng, `offence_code` map, vehicle-type map. **Currently
  placeholders — must be filled per deployment** (esp. real offence codes).
- Column definitions live in `detection_service/emit.py`
  (`VIOLATION_COLUMNS`, `CONGESTION_COLUMNS`).

## How to run

```bash
# detection service (REST)
cd detection_service && pip install -r requirements.txt
python service.py                       # :8001  (set DETECTOR, PORT as needed)

# video -> annotated clip + feeds (single pass)
python video_pipeline.py --video ../demo-clips/test-video-1.mp4 --emit \
    [--zone x1,y1,x2,y2]  [--dwell 5]  [--flow 0,1]  [--window 5]  [--every 30]

# backend + frontend (separate)
cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
cd frontend && npm install && npm run dev
```

Model weights auto-load from `models/` if present (download via
[models/README.md](models/README.md)); the base `yolo11m.pt` auto-downloads.

## How to connect a new service

- **Synchronous / per-image** → call the REST `/detect` (see `backend/main.py`
  for a working example consumer). Self-describe via `/capabilities` and `/docs`.
- **Batch / streaming** → ingest the CSV feeds (respect the `pending` gate;
  use `data_sent_to_scita` flags for the forwarding handshake).
- **Live push** is not built yet — feeds are file-based (`emit.FeedWriter`,
  append-only). To push events in real time, add a sink (HTTP/queue) alongside
  the file writer; the emit logic is already decoupled from the destination.

## Forecasting design (agreed direction)

Forecasting is a **separate consumer**, not part of the detector. Models are
**batch-retrained on a schedule (e.g. weekly)** on the accumulated, validated
feed — **not** updated per-event (that path is fragile/drift-prone). Congestion
forecasting trains on the **congestion feed** (a timeseries), not on violation
rows. `backend/forecaster.py` (CatBoost) is the home; it needs trained
`models/*.cbm` + `report.json`.

## Status & gotchas (read before changing behaviour)

- ✅ Working: vehicle/rider detection, `no_helmet`, `triple_riding`,
  `illegal_parking`, `wrong_side_driving`, congestion levels (much more realistic
  since the yolo11m upgrade), structured feeds, evidence crops.
- ⚠️ **Plate OCR is resolution-bound** — `vehicle_number` is often `NULL` on
  small/low-res plates in wide footage. Detection of the plate works; reading it
  needs decent pixels. For temporal events, `plate_confidence` may be set while
  `vehicle_number` is `NULL` — that means the plate was *found* but not *read*.
- ⚠️ `lane_block`/`illegal_parking` need a `--zone`, and `wrong_side_driving`
  needs `--flow` — **both are per-camera calibration**. A wrong `--flow` direction
  over-flags normal traffic as wrong-side.
- ⚠️ `emit_config.json` holds **placeholders** — offence codes / device / location
  must be set before the feed is production-real.
- ⚠️ `vehicle_type` has no auto-rickshaw class (COCO limitation).
- ⚠️ Feeds **append**; re-running a clip duplicates rows and the `id` counter
  restarts per process. Clear `data/feeds/` or use a fresh dir for a clean set.
- ⚠️ The `backend` forecaster boots as `None` until `models/*.cbm` exist; the
  API still serves detection without it.

## Conventions

- New detector backends implement the `Detector` ABC and register in
  `get_detector()`; keep the `{label, confidence, box, ocr_text}` output shape.
- **Single-frame** violations go in `rules.py` (`build_events`); **temporal /
  track-based** ones go in `track_rules.py` (`TrackMonitor`). Both emit the same
  event dict via `rules._event`, so downstream is uniform.
- Adding a violation type is additive: a rule (+ optional add-on model), the
  `ViolationType` enum in `shared/schema.py`, `VIOLATION_TYPES` in `service.py`,
  and a `violation_map` entry in `emit_config.json`. Never rename existing labels.
- Emit in `rules.py`'s label vocabulary; map to external schemas in `emit.py`.
- Never commit weights/feeds/clips — `*.pt`, `*.safetensors`, `data/feeds/`,
  `demo-clips/`, `*.mp4` are gitignored.
