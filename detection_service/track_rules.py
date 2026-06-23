"""Temporal (track-based) violation rules.

Unlike rules.build_events (single frame), these need movement over time, so they
live in the video pipeline where the tracker provides stable IDs + history:

  * illegal_parking     vehicle stationary inside a no-parking zone for >= dwell
  * wrong_side_driving  vehicle whose travel direction opposes the lane's flow

Each fires once per track (debounced) and is built into the same event dict
shape rules._event produces, so emit.py / the feeds handle it identically.
"""

import math
from collections import defaultdict, deque

VEHICLEISH = {"car", "truck", "bus", "motorcycle_rider", "bicycle",
              "auto", "van", "lcv", "vehicle"}


def _center(b):
    return ((b["x1"] + b["x2"]) / 2, (b["y1"] + b["y2"]) / 2)


def _in_zone(b, z):
    cx, cy = _center(b)
    return z["x1"] <= cx <= z["x2"] and z["y1"] <= cy <= z["y2"]


def _mag(v):
    return math.hypot(v[0], v[1])


def _unit(v):
    m = _mag(v)
    return (v[0] / m, v[1] / m) if m else (0.0, 0.0)


class TrackMonitor:
    """Feed it per-frame tracks; it returns newly-detected temporal violations.

    event_builder(violation_type, detection, context) -> event dict
    (pass rules._event wrapped so the events match the single-frame ones).
    """

    def __init__(self, fps, event_builder, no_parking_zone=None,
                 park_dwell_s=5.0, flow_vec=None, wrong_min_disp=40.0,
                 still_px=10.0, window=20):
        self.fps = fps
        self._build = event_builder
        self.zone = no_parking_zone
        self.dwell = park_dwell_s
        self.flow = _unit(flow_vec) if flow_vec else None
        self.wrong_min_disp = wrong_min_disp
        self.still_px = still_px
        self.window = window
        self._hist = defaultdict(lambda: deque(maxlen=window))  # id -> centroids
        self._zone_since = {}   # id -> frame when stationary-in-zone began
        self._reported = set()  # (id, violation_type) already emitted

    def update(self, tracks, frame_idx, context):
        events = []
        for t in tracks:
            tid = t.get("id")
            if tid is None or t["label"] not in VEHICLEISH:
                continue
            box = t["box"]
            self._hist[tid].append(_center(box))

            # --- illegal parking: stationary in the zone for >= dwell seconds ---
            if self.zone and (tid, "illegal_parking") not in self._reported:
                if _in_zone(box, self.zone) and self._stationary(tid):
                    self._zone_since.setdefault(tid, frame_idx)
                    if (frame_idx - self._zone_since[tid]) / self.fps >= self.dwell:
                        events.append(self._emit("illegal_parking", t, context))
                else:
                    self._zone_since.pop(tid, None)

            # --- wrong-side driving: travel direction opposes the lane flow ---
            if self.flow and (tid, "wrong_side_driving") not in self._reported:
                v = self._displacement(tid)
                if v and _mag(v) >= self.wrong_min_disp:
                    # opposing if the motion unit vector points against the flow
                    if (_unit(v)[0] * self.flow[0] + _unit(v)[1] * self.flow[1]) < -0.3:
                        events.append(self._emit("wrong_side_driving", t, context))

        return events

    def _emit(self, vtype, t, context):
        self._reported.add((t["id"], vtype))
        det = {"label": t["label"], "confidence": t.get("confidence", 0.85),
               "box": t["box"], "ocr_text": None}
        return self._build(vtype, det, context)

    def _stationary(self, tid):
        h = self._hist[tid]
        if len(h) < max(3, self.window // 2):
            return False
        xs = [p[0] for p in h]
        ys = [p[1] for p in h]
        return (max(xs) - min(xs) < self.still_px) and (max(ys) - min(ys) < self.still_px)

    def _displacement(self, tid):
        h = self._hist[tid]
        if len(h) < max(3, self.window // 2):
            return None
        return (h[-1][0] - h[0][0], h[-1][1] - h[0][1])
