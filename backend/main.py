import os
import io
import csv
import uuid
import random
from collections import defaultdict
from datetime import datetime

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List

from forecaster import Forecaster
from recommender import recommend
import feedback

# Load backend/.env regardless of the working directory uvicorn was launched
# from. Without this the Supabase creds are invisible and the service silently
# falls back to the (often absent) CSV. Real shell env vars still win.
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

DETECTION_URL = os.environ.get("DETECTION_URL", "http://localhost:8001")
DATA = os.path.join(os.path.dirname(__file__), "..", "data")

# Supabase — optional, only used when env vars are set
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
VIOLATIONS_TABLE = "police_violations"

app = FastAPI(title="Gridlock Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

forecaster = None
violation_data = []
violation_meta = {}


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def parse_violation_types(raw):
    raw = raw.strip()
    if not raw or raw == "NULL":
        return []
    types = []
    for v in raw.replace("[", "").replace("]", "").replace('"', "").split(","):
        v = v.strip()
        if v:
            types.append(v)
    return types


def _row_from_record(row: dict) -> Optional[dict]:
    try:
        lat = float(row["latitude"])
        lng = float(row["longitude"])
    except (ValueError, KeyError, TypeError):
        return None
    if not (12.7 <= lat <= 13.3 and 77.3 <= lng <= 77.9):
        return None

    vtypes = parse_violation_types(row.get("violation_type", ""))
    vtype = vtypes[0] if vtypes else "UNKNOWN"
    vehicle = (row.get("vehicle_type") or "UNKNOWN").strip()
    station = (row.get("police_station") or "UNKNOWN").strip()
    junction = (row.get("junction_name") or "No Junction").strip()

    hour = -1
    dt_str = row.get("created_datetime", "")
    if dt_str:
        try:
            hour = int(str(dt_str)[11:13])
        except (ValueError, IndexError):
            pass

    return {
        "lat": lat,
        "lng": lng,
        "vtype": vtype,
        "vehicle": vehicle,
        "station": station,
        "junction": junction,
        "hour": hour,
    }


def _build_meta(rows):
    vtype_counts = defaultdict(int)
    vehicle_counts = defaultdict(int)
    station_counts = defaultdict(int)
    for r in rows:
        vtype_counts[r["vtype"]] += 1
        vehicle_counts[r["vehicle"]] += 1
        station_counts[r["station"]] += 1
    return {
        "total": len(rows),
        "violation_types": sorted(vtype_counts.items(), key=lambda x: -x[1]),
        "vehicle_types": sorted(vehicle_counts.items(), key=lambda x: -x[1]),
        "police_stations": sorted(station_counts.items(), key=lambda x: -x[1]),
    }


def load_violation_data_supabase():
    global violation_data, violation_meta
    sb = get_supabase()
    if sb is None:
        return False

    print("Loading violations from Supabase...")
    rows = []
    # Supabase REST paginates at 1000 rows; page through all records
    page_size = 1000
    offset = 0
    while True:
        resp = (
            sb.table(VIOLATIONS_TABLE)
            .select("latitude,longitude,violation_type,vehicle_type,police_station,junction_name,created_datetime")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        for rec in batch:
            r = _row_from_record(rec)
            if r:
                rows.append(r)
        if len(batch) < page_size:
            break
        offset += page_size

    violation_data = rows
    violation_meta = _build_meta(rows)
    print(f"Loaded {len(rows)} violation records from Supabase")
    return True


def load_violation_data_csv():
    global violation_data, violation_meta
    path = os.path.join(DATA, "police_violations.csv")
    if not os.path.exists(path):
        print(f"CSV not found at {path}")
        return

    rows = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            r = _row_from_record(row)
            if r:
                rows.append(r)

    violation_data = rows
    violation_meta = _build_meta(rows)
    print(f"Loaded {len(rows)} violation records from CSV")


def load_violation_data():
    if not load_violation_data_supabase():
        load_violation_data_csv()


@app.on_event("startup")
def load():
    global forecaster
    try:
        forecaster = Forecaster()
    except Exception as e:
        print("forecaster not loaded yet:", e)
    load_violation_data()


@app.get("/health")
def health():
    return {
        "ok": True,
        "forecaster_loaded": forecaster is not None,
        "violation_records": len(violation_data),
        "data_source": "supabase" if (SUPABASE_URL and SUPABASE_KEY) else "csv",
    }


@app.post("/upload/violations")
async def upload_violations(file: UploadFile = File(...)):
    """Upload a police_violations CSV and persist all rows to Supabase."""
    sb = get_supabase()
    if sb is None:
        raise HTTPException(503, "Supabase not configured — set SUPABASE_URL and SUPABASE_KEY")

    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))

    BATCH = 500
    batch = []
    inserted = 0
    skipped = 0

    for row in reader:
        try:
            lat = float(row.get("latitude", ""))
            lng = float(row.get("longitude", ""))
        except ValueError:
            skipped += 1
            continue

        record = {
            "id": row.get("id") or str(uuid.uuid4()),
            "latitude": lat,
            "longitude": lng,
            "location": row.get("location"),
            "vehicle_number": row.get("vehicle_number"),
            "vehicle_type": row.get("vehicle_type"),
            "description": row.get("description"),
            "violation_type": row.get("violation_type"),
            "offence_code": row.get("offence_code"),
            "created_datetime": row.get("created_datetime") or None,
            "closed_datetime": row.get("closed_datetime") or None,
            "police_station": row.get("police_station"),
            "junction_name": row.get("junction_name"),
            "validation_status": row.get("validation_status"),
        }
        batch.append(record)

        if len(batch) >= BATCH:
            sb.table(VIOLATIONS_TABLE).upsert(batch, on_conflict="id").execute()
            inserted += len(batch)
            batch = []

    if batch:
        sb.table(VIOLATIONS_TABLE).upsert(batch, on_conflict="id").execute()
        inserted += len(batch)

    # Reload in-memory data from the newly populated table
    load_violation_data_supabase()

    return {"inserted": inserted, "skipped": skipped, "total_in_memory": len(violation_data)}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    content = await file.read()

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            r = await client.post(
                f"{DETECTION_URL}/detect",
                files={"file": (file.filename, content, file.content_type)},
            )
            r.raise_for_status()
        except Exception as e:
            raise HTTPException(502, f"detection service error: {e}")

    events = r.json().get("events", [])
    results = []

    for ev in events:
        item = {"event": ev, "forecast": None, "recommendation": None}
        if ev["violation_type"] == "lane_block" and forecaster is not None:
            ctx = {
                "corridor": ev.get("corridor"),
                "zone": ev.get("zone"),
                "event_cause": "vehicle_breakdown",
                "event_type": "unplanned",
            }
            fc = forecaster.forecast(ev["event_id"], ctx)
            item["forecast"] = fc
            item["recommendation"] = recommend(fc)
        results.append(item)

    return {"results": results}


@app.post("/forecast")
def forecast_only(ctx: dict):
    if forecaster is None:
        raise HTTPException(503, "forecaster not loaded")
    eid = ctx.get("event_id", str(uuid.uuid4()))
    fc = forecaster.forecast(eid, ctx)
    rec = recommend(fc)
    return {"forecast": fc, "recommendation": rec}


@app.post("/feedback")
def add_feedback(record: dict):
    return feedback.log_outcome(record)


@app.get("/feedback/summary")
def feedback_summary():
    return feedback.summary()


@app.get("/hotspots/meta")
def hotspots_meta():
    return violation_meta


@app.get("/hotspots")
def hotspots(
    violation_type: Optional[str] = None,
    vehicle_type: Optional[str] = None,
    police_station: Optional[str] = None,
    hour_start: Optional[int] = None,
    hour_end: Optional[int] = None,
    sample: int = Query(default=12000, le=300000),
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lng_min: Optional[float] = None,
    lng_max: Optional[float] = None,
):
    filtered = violation_data

    if violation_type:
        filtered = [r for r in filtered if r["vtype"] == violation_type]
    if vehicle_type:
        filtered = [r for r in filtered if r["vehicle"] == vehicle_type]
    if police_station:
        filtered = [r for r in filtered if r["station"] == police_station]
    if hour_start is not None and hour_end is not None:
        if hour_start <= hour_end:
            filtered = [r for r in filtered if hour_start <= r["hour"] <= hour_end]
        else:
            filtered = [r for r in filtered if r["hour"] >= hour_start or r["hour"] <= hour_end]

    if lat_min is not None and lat_max is not None and lng_min is not None and lng_max is not None:
        filtered = [r for r in filtered if lat_min <= r["lat"] <= lat_max and lng_min <= r["lng"] <= lng_max]

    if len(filtered) > sample:
        filtered = random.sample(filtered, sample)

    points = [{"lat": r["lat"], "lng": r["lng"]} for r in filtered]

    grid = defaultdict(int)
    for r in filtered:
        key = (round(r["lat"] / 0.003) * 0.003, round(r["lng"] / 0.003) * 0.003)
        grid[key] += 1

    cells = [
        {"lat": round(k[0], 4), "lng": round(k[1], 4), "count": v}
        for k, v in grid.items()
    ]
    cells.sort(key=lambda x: -x["count"])

    has_filter = any([violation_type, vehicle_type, police_station, hour_start is not None])

    return {
        "total_matched": len(filtered) if has_filter else len(violation_data),
        "total_records": len(violation_data),
        "points_returned": len(points),
        "points": points,
        "cells": cells,
    }
