"""Per-camera configuration.

Each camera is one JSON file under cameras/ (keyed by camera_id). Adding a
camera = adding a file; the video pipeline loads it with `--camera <id>`.

A config captures everything scene-specific so the same code serves any feed:
location/provenance, which violations are enabled, and the geometry the
geometry-dependent violations need (no-parking zones, wrong-side lanes with a
flow direction, a congestion ROI + thresholds). See cameras/example.json.
"""

import json
import os
from copy import deepcopy

CAMERAS_DIR = os.path.join(os.path.dirname(__file__), "..", "cameras")

# defaults; a camera file overrides any subset of these
DEFAULT = {
    "camera_id": None,
    "name": None,
    "source": None,                       # video path or rtsp url
    "location": {"lat": None, "lng": None, "address": None, "junction": None},
    "center_code": None,
    "police_station": None,
    "violations": {
        # zero-config: work on any view
        "no_helmet": {"enabled": True},
        "triple_riding": {"enabled": True},
        # geometry-dependent: need per-camera regions
        "illegal_parking": {"enabled": False, "zones": [], "dwell_s": 30},
        "lane_block": {"enabled": False, "zones": []},
        "wrong_side_driving": {"enabled": False, "lanes": []},  # [{roi:[..], flow:[dx,dy]}]
    },
    "congestion": {"roi": None, "free_max": 6, "moderate_max": 14, "window_s": 5},
    "detection": {"model": None, "conf": None},
}


def _merge(base, override):
    out = deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_camera(ref):
    """Load a camera config by id (cameras/<id>.json) or by direct path."""
    path = ref if os.path.exists(ref) else os.path.join(CAMERAS_DIR, f"{ref}.json")
    if not os.path.exists(path):
        raise FileNotFoundError(f"camera config not found: {ref}")
    with open(path, encoding="utf-8") as f:
        return _merge(DEFAULT, json.load(f))


def zone_to_box(z):
    """[x1,y1,x2,y2] -> {x1,y1,x2,y2}."""
    return {"x1": z[0], "y1": z[1], "x2": z[2], "y2": z[3]}


def lanes_for(cam):
    """Wrong-side lanes as [{roi: box, flow: (dx,dy)}], if enabled."""
    ws = cam["violations"]["wrong_side_driving"]
    if not ws.get("enabled"):
        return []
    return [{"roi": zone_to_box(l["roi"]), "flow": tuple(l["flow"])}
            for l in ws.get("lanes", [])]


def zones_for(cam, violation):
    """No-parking zones (as box dicts) for a violation, if enabled."""
    v = cam["violations"].get(violation, {})
    if not v.get("enabled"):
        return []
    return [zone_to_box(z) for z in v.get("zones", [])]


def emit_config_for_camera(cam):
    """Camera metadata mapped onto the emit config (offence/vehicle maps stay
    global in emit_config.json; the camera supplies location + device)."""
    import emit
    cfg = emit.load_config()
    if cam.get("camera_id"):
        cfg["device_id"] = cam["camera_id"]
    loc = cam.get("location") or {}
    if loc.get("lat") is not None:
        cfg["latitude"] = loc["lat"]
    if loc.get("lng") is not None:
        cfg["longitude"] = loc["lng"]
    if loc.get("address"):
        cfg["location"] = loc["address"]
    if loc.get("junction"):
        cfg["junction_name"] = loc["junction"]
    if cam.get("center_code"):
        cfg["center_code"] = cam["center_code"]
    if cam.get("police_station"):
        cfg["police_station"] = cam["police_station"]
    return cfg
