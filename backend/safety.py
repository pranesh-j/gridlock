"""Serve the Safety tab's spatiotemporal violation-risk forecast.

For a given date it returns density cells on the same ~300 m grid the Risk Map
renders. To keep the surface dense and stable (a single day per cell is sparse),
it aggregates a rolling window (default 7 days) centred on the date — pulling
*real* counts from precomputed history where we have them and *model predictions*
where we don't, so the scrubber blends seamlessly across "now".
"""

import json
import os
from collections import defaultdict
from datetime import date, timedelta

MODELS = os.path.join(os.path.dirname(__file__), "..", "models")


class SafetyForecaster:
    def __init__(self):
        with open(os.path.join(MODELS, "safety_report.json")) as f:
            self.report = json.load(f)
        self.features = self.report["features"]
        self.max_date = date.fromisoformat(self.report["max_date"])
        self.cells = self.report["cells"]            # [[lat, lng, hist_mean], ...]
        with open(os.path.join(MODELS, "safety_history.json")) as f:
            self.history = json.load(f)              # {date: [[lat, lng, count], ...]}

        from catboost import CatBoostRegressor
        self.model = CatBoostRegressor()
        self.model.load_model(os.path.join(MODELS, "safety_forecast.cbm"))
        self._pred_cache = {}                        # date -> {(lat,lng): count}

    # ---- metadata for the scrubber ----
    def meta(self):
        return {
            "trained": True,
            "anchor_date": self.report["anchor_date"],
            "min_date": self.report["min_date"],
            "max_date": self.report["max_date"],
            "horizon_days": self.report.get("horizon_days", 14),
            "n_cells": self.report["n_cells"],
            "metrics": self.report["metrics"],
            "grid": self.report["grid"],
        }

    # ---- one day's cells: real if known, else predicted ----
    def _predict_day(self, d):
        if d in self._pred_cache:
            return self._pred_cache[d]
        dow = d.weekday()
        ctx = {"dow": dow, "month": d.month, "is_weekend": 1 if dow >= 5 else 0,
               "doy": d.timetuple().tm_yday}
        rows = [[(ctx[f] if f in ctx else
                  {"clat": la, "clng": ln, "cell_hist_mean": h}[f])
                 for f in self.features]
                for la, ln, h in self.cells]
        preds = self.model.predict(rows)
        out = {(la, ln): max(0.0, float(p))
               for (la, ln, _), p in zip(self.cells, preds)}
        self._pred_cache[d] = out
        return out

    def _day_cells(self, d):
        key = d.isoformat()
        real = self.history.get(key)
        if real is not None:
            return {(c[0], c[1]): float(c[2]) for c in real}, True
        return self._predict_day(d), False

    # ---- rolling-window aggregate for a date ----
    def window(self, target, days=7):
        half = days // 2
        agg = defaultdict(float)
        any_future = False
        for off in range(-half, half + 1):
            d = target + timedelta(days=off)
            if d > self.max_date:
                any_future = True
            day_cells, _real = self._day_cells(d)
            for k, v in day_cells.items():
                agg[k] += v
        cells = [{"lat": la, "lng": ln, "count": int(round(v))}
                 for (la, ln), v in agg.items() if round(v) > 0]
        cells.sort(key=lambda c: -c["count"])
        return {
            "date": target.isoformat(),
            "mode": "forecast" if any_future else "historical",
            "window_days": days,
            "cells": cells,
            "total": sum(c["count"] for c in cells),
            "max_count": max((c["count"] for c in cells), default=0),
        }
