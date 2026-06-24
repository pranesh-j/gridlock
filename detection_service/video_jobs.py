"""Async video jobs for the detection service.

Long video processing can't be a blocking HTTP call, so we run it as a job:
submit -> job_id -> poll -> result. The actual CV work reuses video_pipeline.py
unchanged (run as a worker subprocess), so the proven pipeline isn't duplicated.

On completion the job parses the violation feed for a UI-friendly event list and,
when Supabase is configured, seeds the detections + evidence so they also appear
on the Detections screen / hotspots.
"""

import csv
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid

_HERE = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.environ.get("VIDEO_WORK_DIR", os.path.join(tempfile.gettempdir(), "gridlock_jobs"))
os.makedirs(WORK_DIR, exist_ok=True)

JOBS = {}
_LOCK = threading.Lock()


def _set(job_id, **kw):
    with _LOCK:
        JOBS.setdefault(job_id, {}).update(kw)


def get(job_id):
    with _LOCK:
        j = JOBS.get(job_id)
        return dict(j) if j else None


def create_job(video_bytes, filename, options=None):
    options = options or {}
    job_id = uuid.uuid4().hex
    job_dir = os.path.join(WORK_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    ext = os.path.splitext(filename or "")[1] or ".mp4"
    in_path = os.path.join(job_dir, "input" + ext)
    with open(in_path, "wb") as f:
        f.write(video_bytes)
    _set(job_id, status="queued", processed=0, total=0, violations=0, result=None, error=None)
    threading.Thread(target=_run, args=(job_id, job_dir, in_path, options), daemon=True).start()
    return job_id


def _run(job_id, job_dir, in_path, options):
    out_path = os.path.join(job_dir, "annotated.mp4")
    progress = os.path.join(job_dir, "progress.json")
    cmd = [
        sys.executable, os.path.join(_HERE, "video_pipeline.py"),
        "--video", in_path, "--out", out_path,
        "--emit", "--emit-dir", job_dir,
        "--progress-file", progress,
    ]
    for flag in ("zone", "flow", "stop_line", "signal_box"):
        if options.get(flag):
            cmd += ["--" + flag.replace("_", "-"), str(options[flag])]
    if options.get("dwell"):
        cmd += ["--dwell", str(options["dwell"])]
    if options.get("max_frames"):
        cmd += ["--max-frames", str(options["max_frames"])]

    _set(job_id, status="running")
    try:
        proc = subprocess.Popen(cmd, cwd=_HERE, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
    except Exception as e:
        _set(job_id, status="error", error=f"could not start worker: {e}")
        return

    # poll the progress file while the worker runs
    import time
    out_tail = []
    while proc.poll() is None:
        if os.path.exists(progress):
            try:
                with open(progress) as pf:
                    p = json.load(pf)
                _set(job_id, processed=p.get("processed", 0),
                     total=p.get("total", 0), violations=p.get("violations", 0))
            except Exception:
                pass
        time.sleep(0.5)

    # drain any worker output for diagnostics
    try:
        out_tail = (proc.stdout.read() or "").splitlines()[-15:]
    except Exception:
        out_tail = []

    if proc.returncode != 0:
        _set(job_id, status="error", error="\n".join(out_tail) or "worker failed")
        return

    events, counts = _parse_violations(os.path.join(job_dir, "violations.csv"))
    seeded = _maybe_seed(job_dir)
    _set(job_id, status="done",
         result={"events": events, "counts": counts,
                 "video_url": f"/detect_video/{job_id}/video",
                 "seeded": seeded})


def _parse_violations(path):
    if not os.path.exists(path):
        return [], {}
    events, counts = [], {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            vt = r.get("violation_type") or ""
            try:
                vt = ", ".join(json.loads(vt)) if vt.startswith("[") else vt
            except Exception:
                pass
            conf = r.get("detection_confidence")
            plate = r.get("vehicle_number")
            events.append({
                "id": r.get("id"),
                "violation_type": vt,
                "confidence": float(conf) if conf not in (None, "", "NULL") else None,
                "plate": None if plate in (None, "", "NULL") else plate,
                "source_frame": r.get("source_frame"),
            })
            counts[vt] = counts.get(vt, 0) + 1
    return events, counts


def _maybe_seed(job_dir):
    # push detections + evidence to Supabase if configured; never fail the job over it
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY")):
        return False
    try:
        import seed_supabase
        sb = seed_supabase._get_client()
        seed_supabase.seed_violations(sb, job_dir, os.environ.get("EVIDENCE_BUCKET", "evidence"))
        seed_supabase.seed_congestion(sb, job_dir)
        return True
    except Exception as e:
        print(f"video job seed skipped: {e}")
        return False


def video_path(job_id):
    p = os.path.join(WORK_DIR, job_id, "annotated.mp4")
    return p if os.path.exists(p) else None