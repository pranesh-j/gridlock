import os
import io
import csv
import uuid
import random
from collections import defaultdict
from datetime import datetime

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List

from forecaster import Forecaster
from recommender import recommend
import feedback

DETECTION_URL = os.environ.get("DETECTION_URL", "http://localhost:8001")
DATA = os.path.join(os.path.dirname(__file__), "..", "data")

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


def load_violation_data():
    global violation_data, violation_meta
    path = os.path.join(DATA, "police_violations.csv")
    if not os.path.exists(path):
        print(f"PS1 data not found at {path}")
        return

    rows = []
    vtype_counts = defaultdict(int)
    vehicle_counts = defaultdict(int)
    station_counts = defaultdict(int)

    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row["latitude"])
                lng = float(row["longitude"])
            except (ValueError, KeyError):
                continue
            if not (12.7 <= lat <= 13.3 and 77.3 <= lng <= 77.9):
                continue

            vtypes = parse_violation_types(row.get("violation_type", ""))
            vtype = vtypes[0] if vtypes else "UNKNOWN"
            vehicle = row.get("vehicle_type", "UNKNOWN").strip()
            station = row.get("police_station", "UNKNOWN").strip()
            junction = row.get("junction_name", "No Junction").strip()

            hour = -1
            dt_str = row.get("created_datetime", "")
            if dt_str:
                try:
                    hour = int(dt_str[11:13])
                except (ValueError, IndexError):
                    pass

            rows.append({
                "lat": lat,
                "lng": lng,
                "vtype": vtype,
                "vehicle": vehicle,
                "station": station,
                "junction": junction,
                "hour": hour,
            })
            vtype_counts[vtype] += 1
            vehicle_counts[vehicle] += 1
            station_counts[station] += 1

    violation_data = rows
    violation_meta = {
        "total": len(rows),
        "violation_types": sorted(vtype_counts.items(), key=lambda x: -x[1]),
        "vehicle_types": sorted(vehicle_counts.items(), key=lambda x: -x[1]),
        "police_stations": sorted(station_counts.items(), key=lambda x: -x[1]),
    }
    print(f"loaded {len(rows)} violation records for heatmap")


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
    }


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
        # ~300m grid cells for smooth coverage
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