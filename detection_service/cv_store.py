"""Persist CV-detected violations to Supabase so the Detections review queue is
durable — rows are written once with validation_status="pending" and stay until
explicitly validated or deleted (append-only, matching the SCITA feed design).

The `cv_violations` table mirrors the SCITA `violation_record` schema, so we reuse
`emit.violation_record` to build each row (one source of truth for the mapping)
and only adapt it for the DB: the feed uses "NULL" string sentinels, but typed
Postgres columns need real nulls.

Best-effort by design: if Supabase isn't configured or a write fails, we log and
move on so a detection run never fails just because the store is unavailable. The
event shape consumed here is the internal `rules._event` dict, with two extra keys
attached by the pipeline: `_evidence_name` and `_source_frame`.
"""

import logging
import os

from emit import load_config, violation_record

log = logging.getLogger("gridlock.cv_store")

TABLE = "cv_violations"
BUCKET = "cv-evidence"

_client = None
_client_tried = False


def _supabase():
    """Lazily build a Supabase client from env. Returns None when unconfigured."""
    global _client, _client_tried
    if _client_tried:
        return _client
    _client_tried = True
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        log.info("Supabase not configured; CV violations will not be persisted")
        return None
    try:
        from supabase import create_client
        _client = create_client(url, key)
    except Exception as e:  # noqa: BLE001 - never let store setup break detection
        log.warning("could not create Supabase client: %s", e)
        _client = None
    return _client


def _ensure_bucket(client):
    """Best-effort: create the public evidence bucket if it doesn't exist yet."""
    try:
        client.storage.create_bucket(BUCKET, options={"public": True})
    except Exception:  # noqa: BLE001 - already exists / insufficient rights: ignore
        pass


def _upload_evidence(client, job_id, name, crop_path):
    """Upload one evidence crop to Supabase Storage; return its public URL or None."""
    if not name or not crop_path or not os.path.exists(crop_path):
        return None
    key = f"{job_id}/{name}"
    try:
        with open(crop_path, "rb") as f:
            data = f.read()
        client.storage.from_(BUCKET).upload(
            key, data, {"content-type": "image/jpeg", "upsert": "true"})
        return client.storage.from_(BUCKET).get_public_url(key)
    except Exception as e:  # noqa: BLE001 - evidence is optional; the row still persists
        log.warning("evidence upload failed for %s: %s", key, e)
        return None


def persist(raw_events, evidence_dir, job_id, cfg=None):
    """Insert each detected violation as a pending row (+ evidence to Storage).

    Returns the number of rows written (0 if Supabase is unavailable or empty)."""
    if not raw_events:
        return 0
    client = _supabase()
    if client is None:
        return 0
    cfg = cfg or load_config()
    _ensure_bucket(client)

    rows = []
    for seq, ev in enumerate(raw_events):
        name = ev.get("_evidence_name")
        crop_path = os.path.join(evidence_dir, name) if (name and evidence_dir) else None
        url = _upload_evidence(client, job_id, name, crop_path)
        rec = violation_record(
            ev, cfg, seq, source_frame=ev.get("_source_frame"), evidence_path=url)
        # violation_record's id is per-seq and resets each run; make it unique so
        # repeated runs append rather than collide on the primary key.
        rec["id"] = f"{cfg['id_prefix']}{job_id[:8]}{seq:04d}"
        # the CSV feed uses "NULL" string sentinels; typed columns need real nulls.
        rec = {k: (None if v == "NULL" else v) for k, v in rec.items()}
        rows.append(rec)

    try:
        client.table(TABLE).insert(rows).execute()
        log.info("persisted %d CV violations to Supabase (job %s)", len(rows), job_id)
        return len(rows)
    except Exception as e:  # noqa: BLE001 - surface as a warning, not a job failure
        log.warning("Supabase insert into %s failed (job %s): %s", TABLE, job_id, e)
        return 0
