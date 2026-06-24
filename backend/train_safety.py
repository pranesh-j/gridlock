"""Train the spatiotemporal violation-risk forecaster for the Safety tab.

What it does
------------
Reads the historical `police_violations` rows (lat/lng + timestamp) from Supabase,
buckets them into ~300 m grid cells (the same grid the Risk Map renders), and
builds a daily count per (cell, date). A CatBoost regressor then learns the
recurring pattern — day-of-week / month / weekend seasonality on top of each
cell's base rate — so we can forecast expected violation density per cell for a
future date.

Outputs (all gitignored, under models/)
---------------------------------------
- safety_forecast.cbm   the trained regressor
- safety_report.json    metadata: date range, anchor ("now"), per-cell base rates,
                        feature list, holdout metrics
- safety_history.json   precomputed real daily cells per date, so the backend can
                        serve the *historical* side of the scrubber instantly

Run:  python train_safety.py        (reads SUPABASE_URL / SUPABASE_KEY from .env)
"""

import json
import os
from datetime import timedelta

import numpy as np
import pandas as pd
import urllib.request
from catboost import CatBoostRegressor

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except Exception:
    pass

MODELS = os.path.join(os.path.dirname(__file__), "..", "models")
GRID = 0.003                 # ~300 m cells, matching /hotspots
MIN_CELL_TOTAL = 10          # ignore near-empty cells (noise)
HOLDOUT_DAYS = 21            # last 3 weeks held out to measure forecast error
HORIZON_DAYS = 14            # the scrubber reaches +/- 2 weeks
FEATURES = ["clat", "clng", "dow", "month", "is_weekend", "doy", "cell_hist_mean"]

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")


def fetch_rows():
    """Page lat/lng/created_datetime for every violation out of Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("set SUPABASE_URL / SUPABASE_KEY (backend/.env) to train")
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    rows, page, size = [], 0, 1000
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/police_violations"
               f"?select=latitude,longitude,created_datetime"
               f"&order=created_datetime.asc&offset={page * size}&limit={size}")
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
            batch = json.load(r)
        rows.extend(batch)
        if len(batch) < size:
            break
        page += 1
        if page % 20 == 0:
            print(f"  fetched {len(rows)} rows...")
    print(f"fetched {len(rows)} rows total")
    return rows


def build_frame(rows):
    df = pd.DataFrame(rows)
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    df["dt"] = pd.to_datetime(df["created_datetime"], errors="coerce", utc=True)
    df = df.dropna(subset=["latitude", "longitude", "dt"])
    # Bengaluru bounds (mirror the backend's filter)
    df = df[(df.latitude.between(12.7, 13.3)) & (df.longitude.between(77.3, 77.9))]
    df["clat"] = (np.round(df.latitude / GRID) * GRID).round(4)
    df["clng"] = (np.round(df.longitude / GRID) * GRID).round(4)
    df["date"] = df.dt.dt.tz_convert("Asia/Kolkata").dt.date
    return df


def main():
    df = build_frame(fetch_rows())
    dmin, dmax = df.date.min(), df.date.max()
    print(f"date range: {dmin} -> {dmax}")

    # keep cells with enough total activity to be meaningful
    cell_total = df.groupby(["clat", "clng"]).size()
    keep = cell_total[cell_total >= MIN_CELL_TOTAL].index
    cells = pd.DataFrame(keep.tolist(), columns=["clat", "clng"])
    print(f"active cells: {len(cells)} of {len(cell_total)}")

    # daily counts per kept cell, dense over every date (0 where no violations)
    counts = (df.groupby(["clat", "clng", "date"]).size()
              .rename("count").reset_index())
    counts = counts.merge(cells, on=["clat", "clng"], how="inner")
    all_dates = pd.date_range(dmin, dmax, freq="D").date
    grid = cells.assign(key=1).merge(
        pd.DataFrame({"date": all_dates, "key": 1}), on="key").drop(columns="key")
    panel = grid.merge(counts, on=["clat", "clng", "date"], how="left").fillna({"count": 0})
    panel["count"] = panel["count"].astype(float)
    panel["date"] = pd.to_datetime(panel["date"])

    # calendar features + per-cell base rate (computed on the train split only)
    panel["dow"] = panel.date.dt.dayofweek
    panel["month"] = panel.date.dt.month
    panel["is_weekend"] = (panel.dow >= 5).astype(int)
    panel["doy"] = panel.date.dt.dayofyear

    split = pd.Timestamp(dmax) - pd.Timedelta(days=HOLDOUT_DAYS)
    train = panel[panel.date <= split].copy()
    test = panel[panel.date > split].copy()
    hist_mean = train.groupby(["clat", "clng"])["count"].mean().rename("cell_hist_mean")
    train = train.join(hist_mean, on=["clat", "clng"])
    test = test.join(hist_mean, on=["clat", "clng"])
    test["cell_hist_mean"] = test["cell_hist_mean"].fillna(train["count"].mean())

    # Poisson loss suits non-negative counts and learns multiplicative seasonal
    # factors (day-of-week / weekend) on top of each cell's base rate, which is
    # itself a feature (cell_hist_mean). At these low daily counts the per-cell
    # mean is already a strong predictor, so the model's edge is the weekly
    # structure rather than a large MAE win.
    model = CatBoostRegressor(
        iterations=400, depth=6, learning_rate=0.05, l2_leaf_reg=6.0,
        loss_function="Poisson", random_seed=42, verbose=False)
    model.fit(train[FEATURES], train["count"])

    pred = np.clip(model.predict(test[FEATURES]), 0, None)
    mae = float(np.mean(np.abs(pred - test["count"])))
    baseline_mae = float(np.mean(np.abs(test["cell_hist_mean"] - test["count"])))
    rmse = float(np.sqrt(np.mean((pred - test["count"]) ** 2)))
    print(f"holdout MAE: {mae:.3f}  (baseline {baseline_mae:.3f})  RMSE: {rmse:.3f}")

    os.makedirs(MODELS, exist_ok=True)
    model.save_model(os.path.join(MODELS, "safety_forecast.cbm"))

    # per-cell base rate over ALL data, for forecasting future dates
    full_hist = df.groupby(["clat", "clng"]).size() / len(all_dates)
    full_hist = full_hist.reindex(keep).fillna(0.0)
    report = {
        "trained_at": pd.Timestamp.utcnow().isoformat(),
        "grid": GRID,
        "min_date": str(dmin),
        "max_date": str(dmax),
        "anchor_date": str(dmax),       # "now" for the scrubber
        "horizon_days": HORIZON_DAYS,
        "n_cells": int(len(cells)),
        "n_obs": int(len(panel)),
        "features": FEATURES,
        "metrics": {"mae": round(mae, 4), "baseline_mae": round(baseline_mae, 4),
                    "rmse": round(rmse, 4)},
        "cells": [[round(float(la), 4), round(float(ln), 4), round(float(h), 4)]
                  for (la, ln), h in full_hist.items()],
    }
    with open(os.path.join(MODELS, "safety_report.json"), "w") as f:
        json.dump(report, f)

    # real daily cells per date (non-zero only) for the historical side
    history = {}
    nz = counts[counts["count"] > 0]
    for d, grp in nz.groupby("date"):
        history[str(d)] = [[round(float(r.clat), 4), round(float(r.clng), 4), int(r["count"])]
                           for _, r in grp.iterrows()]
    with open(os.path.join(MODELS, "safety_history.json"), "w") as f:
        json.dump(history, f)

    print(f"saved model + report ({len(cells)} cells) + history ({len(history)} days)")


if __name__ == "__main__":
    main()
