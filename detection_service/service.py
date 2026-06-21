"""Gridlock detection service.

A small, self-contained HTTP API around the detector. Hand it an image, get
back structured violation events plus the raw detections. Designed to be easy
for other services to call: stable JSON contract, typed OpenAPI docs at /docs,
predictable error codes.

Run it:
    python service.py                 # serves on :8001 (override with PORT)
    uvicorn service:app --port 8001

Select the backend with the DETECTOR env var (yolo | locateanything | mock).
"""

import json
import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from PIL import UnidentifiedImageError

from detector import get_detector
from rules import build_events
from schemas import (
    CapabilitiesResponse,
    DetectResponse,
    HealthResponse,
)

VERSION = "1.0.0"

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("gridlock.detection")

# the detector holds GPU models that are not safe to call concurrently, so we
# load it once and serialize inference behind a lock (run off the event loop).
_detector = None
_detector_error = None
_infer_lock = threading.Lock()

# default no-parking rectangle so callers can omit it for a quick demo
DEFAULT_ZONE = {"x1": 100, "y1": 180, "x2": 400, "y2": 420}
DEFAULT_CONTEXT = {"corridor": "Tumkur Road", "zone": "Peenya"}

VIOLATION_TYPES = ["lane_block", "no_helmet"]
KNOWN_LABELS = [
    "car", "truck", "bus", "motorcycle_rider", "bicycle",
    "person", "helmet", "no_helmet", "license_plate",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # load the detector once at startup; capture any failure for /health
    global _detector, _detector_error
    try:
        _detector = get_detector()
        log.info("detector loaded: %s", type(_detector).__name__)
    except Exception as e:  # noqa: BLE001 - report any load failure via /health
        _detector_error = str(e)
        log.exception("detector failed to load")
    yield


app = FastAPI(
    title="Gridlock Detection Service",
    version=VERSION,
    description=(
        "Detect traffic violations in a single image. POST an image to "
        "/detect to receive violation events (lane_block, no_helmet) and the "
        "raw object detections. See /capabilities for what this instance emits."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_detector():
    if _detector is None:
        raise HTTPException(
            status_code=503,
            detail=f"detector not ready: {_detector_error or 'still loading'}",
        )
    return _detector


def _parse_json_field(name: str, value: str | None, default):
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"invalid JSON in '{name}': {e}")


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        ok=_detector is not None,
        ready=_detector is not None,
        detector=type(_detector).__name__ if _detector else None,
        version=VERSION,
        error=_detector_error,
    )


@app.get("/capabilities", response_model=CapabilitiesResponse)
def capabilities():
    return CapabilitiesResponse(
        detector=type(_detector).__name__ if _detector else None,
        violation_types=VIOLATION_TYPES,
        labels=KNOWN_LABELS,
        version=VERSION,
    )


@app.post("/detect", response_model=DetectResponse)
async def detect(
    file: UploadFile = File(..., description="Image frame to analyze"),
    no_parking_zone: str = Form(
        None, description="Optional JSON {x1,y1,x2,y2} no-parking rectangle"
    ),
    context: str = Form(
        None, description="Optional JSON of location fields attached to events"
    ),
):
    detector = _require_detector()

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=415,
            detail=f"expected an image, got content-type '{file.content_type}'",
        )

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")

    zone = _parse_json_field("no_parking_zone", no_parking_zone, DEFAULT_ZONE)
    ctx = _parse_json_field("context", context, DEFAULT_CONTEXT)

    try:
        detections = await run_in_threadpool(_run_detect, detector, image_bytes)
    except (UnidentifiedImageError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"could not decode image: {e}")
    except Exception as e:  # noqa: BLE001 - surface as a clean 500, not a stack trace
        log.exception("detection failed")
        raise HTTPException(status_code=500, detail=f"detection error: {e}")

    events = build_events(detections, no_parking_zone=zone, context=ctx)
    return {"events": events, "raw_detections": detections}


def _run_detect(detector, image_bytes):
    # serialize GPU inference; the lock keeps concurrent requests from racing
    # on a model that is not reentrant
    with _infer_lock:
        return detector.detect(image_bytes)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "service:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8001")),
    )
