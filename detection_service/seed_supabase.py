"""Push generated CV feeds into Supabase so the hosted dashboards show real
detections with no GPU on the server.

Flow: run the detector once (video_pipeline.py --emit) to produce
  data/feeds/violations.csv, congestion.csv, evidence/*.jpg
then run this to upload evidence to Supabase Storage and upsert the rows into
the cv_violations / cv_congestion tables (see db/cv_schema.sql).

    python seed_supabase.py --feeds ../data/feeds --bucket evidence

Idempotent: upserts on id, so re-running updates rather than duplicates.
Requires SUPABASE_URL + SUPABASE_KEY in the environment (or detection_service/.env).
"""

import argparse
import csv
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# columns that must be coerced from the feed's "NULL"/"" sentinels to real None
_FLOAT_COLS = {
    "latitude", "longitude", "detection_confidence", "plate_confidence",
    "window_seconds", "vehicle_count_avg",
}
_INT_COLS = {
    "source_frame", "vehicle_count_peak", "stationary_count",
    "source_frame_start", "source_frame_end",
}
_TS_COLS = {
    "created_datetime", "closed_datetime", "modified_datetime",
    "action_taken_timestamp", "data_sent_to_scita_timestamp",
    "validation_timestamp",
}


def _clean(v):
    if v is None or v in ("", "NULL"):
        return None
    return v


def _coerce(col, v):
    v = _clean(v)
    if v is None:
        return None
    try:
        if col in _FLOAT_COLS:
            return float(v)
        if col in _INT_COLS:
            return int(float(v))
    except (TypeError, ValueError):
        return None
    return v  # text / timestamp passthrough (ISO strings are valid for timestamptz)


def _rows(path):
    if not os.path.exists(path):
        return [], []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return reader.fieldnames or [], list(reader)


def _get_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("set SUPABASE_URL and SUPABASE_KEY (env or detection_service/.env)")
    from supabase import create_client
    return create_client(url, key)


def _upload_evidence(sb, bucket, local_path):
    """Upload one crop, return its public URL (or None on failure)."""
    if not local_path or not os.path.exists(local_path):
        return None
    name = os.path.basename(local_path)
    with open(local_path, "rb") as f:
        data = f.read()
    try:
        sb.storage.from_(bucket).upload(
            path=name, file=data,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
    except Exception as e:
        # already-exists or transient; still try to return the public URL
        print(f"  evidence upload note for {name}: {e}")
    try:
        return sb.storage.from_(bucket).get_public_url(name)
    except Exception:
        return None


def seed_violations(sb, feeds_dir, bucket, batch=500):
    cols, rows = _rows(os.path.join(feeds_dir, "violations.csv"))
    if not rows:
        print("no violations.csv rows to seed")
        return 0
    out, n = [], 0
    for r in rows:
        rec = {c: _coerce(c, r.get(c)) for c in cols}
        # swap the local evidence path for a hosted Storage URL
        rec["evidence_image_path"] = _upload_evidence(
            sb, bucket, _clean(r.get("evidence_image_path")))
        out.append(rec)
        if len(out) >= batch:
            sb.table("cv_violations").upsert(out, on_conflict="id").execute()
            n += len(out)
            out = []
    if out:
        sb.table("cv_violations").upsert(out, on_conflict="id").execute()
        n += len(out)
    print(f"seeded {n} cv_violations rows")
    return n


def seed_congestion(sb, feeds_dir, batch=500):
    cols, rows = _rows(os.path.join(feeds_dir, "congestion.csv"))
    if not rows:
        print("no congestion.csv rows to seed")
        return 0
    out, n = [], 0
    for r in rows:
        out.append({c: _coerce(c, r.get(c)) for c in cols})
        if len(out) >= batch:
            sb.table("cv_congestion").upsert(out, on_conflict="id").execute()
            n += len(out)
            out = []
    if out:
        sb.table("cv_congestion").upsert(out, on_conflict="id").execute()
        n += len(out)
    print(f"seeded {n} cv_congestion rows")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--feeds", default="../data/feeds", help="dir with violations.csv / congestion.csv")
    ap.add_argument("--bucket", default="evidence", help="Supabase Storage bucket for evidence crops")
    args = ap.parse_args()

    sb = _get_client()
    seed_violations(sb, args.feeds, args.bucket)
    seed_congestion(sb, args.feeds)
    print("done.")


if __name__ == "__main__":
    main()