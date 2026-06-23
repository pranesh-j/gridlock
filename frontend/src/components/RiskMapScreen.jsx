import { useEffect, useRef, useState, useCallback } from "react";
import { mappls } from "mappls-web-maps";
import { MapPinned, SlidersHorizontal, X, Plus, Minus, LocateFixed, TriangleAlert, Car, Clock, Hash, Navigation } from "lucide-react";
import { getHotspots, getHotspotsMeta } from "../lib/api";
import { severityFor, aqiIndex } from "../lib/severity";
import { Button, IconButton, Select, SegmentedControl, SeverityBadge } from "./ui";

const MAPPLS_KEY = import.meta.env.VITE_MAPPLS_KEY || "";
const mapplsObject = new mappls();

const TIME = [
  { value: "all", label: "All day" },
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
];
const TIME_MAP = { all: {}, morning: { hour_start: 7, hour_end: 10 }, evening: { hour_start: 17, hour_end: 21 }, night: { hour_start: 21, hour_end: 6 } };

const LEGEND_STOPS = [
  { color: "#22c55e", label: "<20",    key: "low" },
  { color: "#eab308", label: "20–50",  key: "moderate" },
  { color: "#f97316", label: "50–100", key: "high" },
  { color: "#ef4444", label: "100+",   key: "critical" },
];

const SEV_HEX = { low: "#22c55e", moderate: "#eab308", high: "#f97316", critical: "#ef4444" };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draw all cells onto the canvas as radial gradients
function drawCanvas(canvas, projected, zoom) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Radius grows with zoom so cells always overlap and blend
  const baseRadius = Math.max(18, 10 * Math.pow(2, zoom - 11));

  projected.forEach((z) => {
    const r = Math.min(baseRadius * (1 + Math.log1p(z.count) * 0.15), baseRadius * 2.2);
    const [cr, cg, cb] = hexToRgb(SEV_HEX[z.sev.key]);
    const grad = ctx.createRadialGradient(z.px, z.py, 0, z.px, z.py, r);
    grad.addColorStop(0,   `rgba(${cr},${cg},${cb},0.75)`);
    grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.45)`);
    grad.addColorStop(0.8, `rgba(${cr},${cg},${cb},0.15)`);
    grad.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
    ctx.beginPath();
    ctx.arc(z.px, z.py, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

function DetailRow({ icon: Icon, label, value, mono }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--gl-text-3)" }}><Icon size={13} />{label}</span>
      <span style={{ color: "var(--gl-text-1)", fontWeight: 500, fontFamily: mono ? "var(--gl-font-mono)" : "var(--gl-font-sans)", fontSize: mono ? 11.5 : 12.5 }}>{value}</span>
    </div>
  );
}

export default function RiskMapScreen() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const cellsRef = useRef([]);
  const projectedRef = useRef([]);
  const rafRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [meta, setMeta] = useState(null);
  const [selZoneData, setSelZoneData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [vtype, setVtype] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [time, setTime] = useState("all");

  useEffect(() => {
    getHotspotsMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    if (!MAPPLS_KEY) return;
    mapplsObject.initialize(MAPPLS_KEY, { map: true }, () => {
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = mapplsObject.Map({
        id: "gl-mappls-map",
        properties: { center: [12.97, 77.59], zoom: 12, zoomControl: false, search: false, location: false },
      });
      mapRef.current.on("load", () => setMapLoaded(true));
    });
  }, []);

  const reproject = useCallback(() => {
    if (!mapRef.current || !canvasRef.current || !containerRef.current) return;
    const el = containerRef.current;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    if (canvasRef.current.width !== w || canvasRef.current.height !== h) {
      canvasRef.current.width = w;
      canvasRef.current.height = h;
    }
    const pts = cellsRef.current.map((c, i) => {
      try {
        const px = mapRef.current.project({ lat: c.lat, lng: c.lng });
        if (!px) return null;
        return { id: i, px: px.x, py: px.y, count: c.count, lat: c.lat, lng: c.lng, sev: severityFor(c.count) };
      } catch { return null; }
    }).filter(Boolean);
    projectedRef.current = pts;
    const zoom = mapRef.current.getZoom ? mapRef.current.getZoom() : 12;
    drawCanvas(canvasRef.current, pts, zoom);
  }, []);

  const startRaf = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => { reproject(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
  }, [reproject]);

  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    reproject();
  }, [reproject]);

  const fetchAndProject = useCallback(async () => {
    const filters = {};
    if (vtype) filters.violation_type = vtype;
    if (vehicle) filters.vehicle_type = vehicle;
    const tm = TIME_MAP[time] || {};
    if (tm.hour_start != null) { filters.hour_start = tm.hour_start; filters.hour_end = tm.hour_end; }
    try {
      const data = await getHotspots({ ...filters, sample: 50000 });
      cellsRef.current = data.cells || [];
      reproject();
    } catch (e) {
      console.error("fetch error:", e);
    }
  }, [vtype, vehicle, time, reproject]);

  useEffect(() => {
    if (!mapLoaded) return;
    fetchAndProject();
  }, [vtype, vehicle, time, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const onClick = (e) => {
      const clickPx = mapRef.current.project({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      if (!clickPx) return;
      let best = null, bestDist = Infinity;
      projectedRef.current.forEach((z) => {
        const d = Math.hypot(z.px - clickPx.x, z.py - clickPx.y);
        if (d < bestDist && d < 50) { bestDist = d; best = z; }
      });
      setSelZoneData(best || null);
    };
    mapRef.current.on("movestart", startRaf);
    mapRef.current.on("zoomstart", startRaf);
    mapRef.current.on("moveend", stopRaf);
    mapRef.current.on("zoomend", stopRaf);
    mapRef.current.on("click", onClick);
    return () => {
      try {
        mapRef.current.off("movestart", startRaf);
        mapRef.current.off("zoomstart", startRaf);
        mapRef.current.off("moveend", stopRaf);
        mapRef.current.off("zoomend", stopRaf);
        mapRef.current.off("click", onClick);
      } catch {}
      stopRaf();
    };
  }, [mapLoaded, startRaf, stopRaf]);

  const hasFilter = vtype || vehicle || time !== "all";
  const violationTypes = meta?.violation_types?.slice(0, 8) || [];
  const vehicleTypes = meta?.vehicle_types?.slice(0, 8) || [];

  return (
    <div ref={containerRef} style={{ position: "relative", height: "100%", borderRadius: "var(--gl-radius-lg)", overflow: "hidden", boxShadow: "var(--gl-ring-strong)" }}>
      <div id="gl-mappls-map" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      {/* Canvas gradient overlay — pointer-events none so map stays interactive */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" }}
      />

      {/* title card */}
      <div style={{ position: "absolute", top: 14, left: 14, zIndex: 6, background: "rgba(15,21,32,0.9)", backdropFilter: "blur(8px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-md)", padding: "11px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MapPinned size={15} style={{ color: "var(--gl-primary-hover)" }} />
          <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-text-1)" }}>Parking Violation Density</span>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)", whiteSpace: "nowrap" }}>
          Bengaluru {meta ? " · " + meta.total.toLocaleString() + " records" : ""}
        </span>
      </div>

      {/* filters */}
      <div style={{ position: "absolute", top: 14, right: 14, zIndex: 6 }}>
        <Button size="sm" variant={filtersOpen || hasFilter ? "primary" : "secondary"} iconLeft={<SlidersHorizontal size={15} />} onClick={() => setFiltersOpen(!filtersOpen)}>Filters</Button>
      </div>
      {filtersOpen && (
        <div style={{ position: "absolute", top: 58, right: 14, zIndex: 7, width: 268, background: "rgba(15,21,32,0.96)", backdropFilter: "blur(12px)", borderRadius: "var(--gl-radius-lg)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 13, animation: "gl-rise var(--gl-dur-base) var(--gl-ease)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-text-1)" }}>Filter data</span>
            <IconButton size="sm" variant="ghost" icon={<X size={15} />} label="Close" onClick={() => setFiltersOpen(false)} />
          </div>
          <Select label="Violation type" icon={<TriangleAlert size={11} />} value={vtype} onChange={setVtype} placeholder="All violations" options={violationTypes.map(([n, c]) => ({ value: n, label: n + " · " + c.toLocaleString() }))} />
          <Select label="Vehicle type" icon={<Car size={11} />} value={vehicle} onChange={setVehicle} placeholder="All vehicles" options={vehicleTypes.map(([n, c]) => ({ value: n, label: n + " · " + c.toLocaleString() }))} />
          <div>
            <span style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, fontSize: "var(--gl-text-xs)", fontWeight: 500, color: "var(--gl-text-3)" }}><Clock size={11} /> Time of day</span>
            <SegmentedControl full size="sm" options={TIME} value={time} onChange={setTime} />
          </div>
          {hasFilter && <button onClick={() => { setVtype(""); setVehicle(""); setTime("all"); }} style={{ background: "none", border: "none", color: "var(--gl-text-3)", fontSize: 12, cursor: "pointer", padding: "2px 0", textAlign: "center", fontFamily: "var(--gl-font-sans)" }}>Clear all filters</button>}
        </div>
      )}

      {/* zoom controls */}
      <div style={{ position: "absolute", right: 14, bottom: 134, zIndex: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        <IconButton variant="glass" icon={<Plus size={17} />} label="Zoom in" onClick={() => mapRef.current && mapRef.current.zoomTo(mapRef.current.getZoom() + 1)} />
        <IconButton variant="glass" icon={<Minus size={17} />} label="Zoom out" onClick={() => mapRef.current && mapRef.current.zoomTo(mapRef.current.getZoom() - 1)} />
        <IconButton variant="glass" icon={<LocateFixed size={17} />} label="Recenter" onClick={() => mapRef.current && mapRef.current.flyTo({ center: [77.59, 12.97], zoom: 12 })} />
      </div>

      {/* legend */}
      <div style={{ position: "absolute", left: 14, right: selZoneData ? 296 : 14, bottom: 14, zIndex: 6, maxWidth: 380, background: "rgba(15,21,32,0.92)", backdropFilter: "blur(10px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-md)", padding: "12px 16px" }}>
        <span style={{ fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>Violation Density</span>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
          {LEGEND_STOPS.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: "50%", background: s.color, display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* click popup */}
      {selZoneData && (
        <div style={{ position: "absolute", right: 14, bottom: 14, zIndex: 7, width: 268, background: "rgba(15,21,32,0.97)", backdropFilter: "blur(12px)", borderRadius: "var(--gl-radius-lg)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-lg)", padding: 16, animation: "gl-rise var(--gl-dur-base) var(--gl-ease)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: "var(--gl-font-display)", fontSize: 18, fontWeight: 600, color: "var(--gl-text-1)", letterSpacing: "-0.01em" }}>
                {selZoneData.sev.label} Zone
              </div>
              <div style={{ fontSize: 11.5, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>
                {selZoneData.lat.toFixed(4)}, {selZoneData.lng.toFixed(4)}
              </div>
            </div>
            <IconButton size="sm" variant="ghost" icon={<X size={15} />} label="Close" onClick={() => setSelZoneData(null)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <SeverityBadge count={selZoneData.count} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 32, fontWeight: 700, color: selZoneData.sev.color, letterSpacing: "-0.02em", lineHeight: 1 }}>
                {aqiIndex(selZoneData.count)}
              </span>
              <span style={{ fontSize: 12, color: "var(--gl-text-3)" }}>/10 index</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 12, borderTop: "1px solid var(--gl-hairline)" }}>
            <DetailRow icon={Hash} label="Violations" value={selZoneData.count.toLocaleString() + " in this ~300m cell"} />
            <DetailRow icon={TriangleAlert} label="Severity" value={selZoneData.sev.label} />
            <DetailRow icon={Navigation} label="Coordinates" value={selZoneData.lat.toFixed(4) + ", " + selZoneData.lng.toFixed(4)} mono />
          </div>
        </div>
      )}
    </div>
  );
}