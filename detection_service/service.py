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
import shutil
import threading
import uuid
from contextlib import asynccontextmanager

# Load detection_service/.env (Supabase creds for durable CV-violation storage)
# regardless of where the service was launched from. Real shell env vars win.
# Resilient: if python-dotenv isn't installed, the service still runs — it just
# won't auto-load .env (persistence stays off unless the vars are set elsewhere).
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:  # noqa: BLE001 - optional convenience, never block startup
    pass

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from PIL import UnidentifiedImageError

from detector import get_detector
from rules import build_events
from video_pipeline import process_video
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

# Video jobs run async: POST kicks off a background thread, the client polls.
# Heavy GPU work is serialized behind _infer_lock so a video job and /detect
# (or a second video job) never touch the models concurrently. State lives in
# memory only — jobs and their output dirs do not survive a restart.
_VIDEO_JOBS = {}            # job_id -> status dict
_VIDEO_JOBS_LOCK = threading.Lock()
# Job inputs/outputs land here. Default to a dir beside the service (same drive
# as the project) rather than the system temp — the system temp may be on a
# near-full system drive, and annotated clips are large. Override with
# VIDEO_JOBS_DIR. The directory is gitignored.
_VIDEO_DIR = os.environ.get("VIDEO_JOBS_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "_video_jobs")

# default no-parking rectangle so callers can omit it for a quick demo
DEFAULT_ZONE = {"x1": 100, "y1": 180, "x2": 400, "y2": 420}
DEFAULT_CONTEXT = {"corridor": "Tumkur Road", "zone": "Peenya"}

VIOLATION_TYPES = [
    "lane_block", "no_helmet", "triple_riding",
    "illegal_parking", "wrong_side_driving",
]
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


# ----------------------------- video jobs -----------------------------------

def _update_job(job_id, **fields):
    with _VIDEO_JOBS_LOCK:
        job = _VIDEO_JOBS.get(job_id)
        if job is not None:
            job.update(fields)


def _process_video_job(job_id, in_path, out_path, options):
    """Background worker: run the pipeline, stream progress into the job dict."""
    detector = _require_detector()

    def on_progress(processed, total, violations):
        percent = int(processed * 100 / total) if total else 0
        _update_job(
            job_id, status="running",
            percent=min(percent, 99), processed=processed, total=total,
            violations=violations,
        )

    evidence_dir = os.path.join(os.path.dirname(out_path), "evidence")

    # one GPU consumer at a time (shared with /detect and other video jobs)
    with _infer_lock:
        try:
            result = process_video(
                in_path, out_path=out_path, detector=detector,
                every=options.get("every", 30),
                zone=options.get("zone"), flow=options.get("flow"),
                dwell=options.get("dwell", 5.0),
                emit=options.get("emit", False),
                evidence_dir=evidence_dir,
                progress_cb=on_progress,
            )
        except Exception as e:  # noqa: BLE001 - report failure back to the client
            log.exception("video job %s failed", job_id)
            _update_job(job_id, status="error", error=str(e))
            return
        finally:
            # reclaim the (large) uploaded copy; the annotated output is kept
            try:
                if os.path.exists(in_path):
                    os.remove(in_path)
            except OSError:
                pass

    # durably persist the detected violations (best-effort; never fails the job)
    persisted = 0
    try:
        import cv_store
        persisted = cv_store.persist(
            result.get("raw_events", []), evidence_dir, job_id)
    except Exception:  # noqa: BLE001 - store problems must not break a successful run
        log.exception("persisting CV violations failed for job %s", job_id)

    _update_job(
        job_id, status="done", percent=100,
        violations=len(result["events"]),
        result={
            "events": result["events"],
            "counts": result["counts"],
            "frames": result["frames"],
            "persisted": persisted,
            "seeded": persisted > 0,
        },
    )


@app.post("/detect_video")
async def detect_video(
    file: UploadFile = File(..., description="Traffic video clip to analyse"),
    zone: str = Form(None, description="no-parking zone 'x1,y1,x2,y2'"),
    flow: str = Form(None, description="lane direction 'dx,dy' for wrong-side"),
    dwell: float = Form(5.0, description="seconds parked before illegal_parking"),
    every: int = Form(30, description="run the heavy violation tier every N frames"),
    emit: bool = Form(False, description="also write the SCITA CSV feeds"),
):
    _require_detector()

    if file.content_type and not file.content_type.startswith("video/"):
        raise HTTPException(
            status_code=415,
            detail=f"expected a video, got content-type '{file.content_type}'",
        )

    job_id = uuid.uuid4().hex
    job_dir = os.path.join(_VIDEO_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1] or ".mp4"
    in_path = os.path.join(job_dir, "input" + ext)
    out_path = os.path.join(job_dir, "annotated.mp4")

    with open(in_path, "wb") as fh:
        shutil.copyfileobj(file.file, fh)
    if os.path.getsize(in_path) == 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="empty file")

    with _VIDEO_JOBS_LOCK:
        _VIDEO_JOBS[job_id] = {
            "job_id": job_id, "status": "queued", "percent": 0,
            "processed": 0, "total": 0, "violations": 0,
            "result": None, "error": None, "out_path": out_path,
        }

    options = {"zone": zone, "flow": flow, "dwell": dwell, "every": every, "emit": emit}
    threading.Thread(
        target=_process_video_job, args=(job_id, in_path, out_path, options),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/detect_video/{job_id}")
def video_job_status(job_id: str):
    with _VIDEO_JOBS_LOCK:
        job = _VIDEO_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="unknown job id")
        # don't leak the server-side path to the client
        return {k: v for k, v in job.items() if k != "out_path"}


@app.get("/detect_video/{job_id}/video")
def video_job_file(job_id: str):
    with _VIDEO_JOBS_LOCK:
        job = _VIDEO_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job id")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail=f"job not done (status={job['status']})")
    out_path = job.get("out_path")
    if not out_path or not os.path.exists(out_path):
        raise HTTPException(status_code=404, detail="annotated video not found")
    return FileResponse(out_path, media_type="video/mp4", filename="annotated.mp4")


@app.get("/detect_video/{job_id}/evidence/{name}")
def video_job_evidence(job_id: str, name: str):
    with _VIDEO_JOBS_LOCK:
        job = _VIDEO_JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job id")
    # confine to the job's evidence dir; basename() blocks path traversal
    evidence_dir = os.path.join(os.path.dirname(job["out_path"]), "evidence")
    path = os.path.join(evidence_dir, os.path.basename(name))
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="evidence image not found")
    return FileResponse(path, media_type="image/jpeg")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "service:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8001")),
    )
