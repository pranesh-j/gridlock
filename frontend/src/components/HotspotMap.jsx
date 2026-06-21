import { useEffect, useRef, useState, useCallback } from "react";
import { mappls } from "mappls-web-maps";
import { getHotspots, getHotspotsMeta } from "../lib/api";
import { severityFor } from "../lib/severity";
import { Filter, Clock, Car, MapPin, AlertTriangle, X } from "lucide-react";

const MAPPLS_KEY = import.meta.env.VITE_MAPPLS_KEY || "";

const TIME_PRESETS = [
  { label: "All Day", start: null, end: null },
  { label: "Morning (7-10)", start: 7, end: 10 },
  { label: "Afternoon (12-16)", start: 12, end: 16 },
  { label: "Evening (17-21)", start: 17, end: 21 },
  { label: "Night (21-6)", start: 21, end: 6 },
];

const mapplsObject = new mappls();

const SEV_HEX = { low: "#22c55e", moderate: "#eab308", high: "#f97316", critical: "#ef4444" };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawCanvas(canvas, pts, zoom) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const baseRadius = Math.max(18, 10 * Math.pow(2, zoom - 11));
  pts.forEach((z) => {
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

export default function HotspotMap() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const cellsRef = useRef([]);
  const projectedRef = useRef([]);
  const rafRef = useRef(null);

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selZone, setSelZone] = useState(null);

  const [violationType, setViolationType] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [policeStation, setPoliceStation] = useState("");
  const [timePreset, setTimePreset] = useState(0);

  useEffect(() => {
    getHotspotsMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    if (!MAPPLS_KEY) return;
    mapplsObject.initialize(MAPPLS_KEY, { map: true }, () => {
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = mapplsObject.Map({
        id: "mappls-map",
        properties: { center: [12.97, 77.59], zoom: 12, zoomControl: true, search: false, location: false },
      });
      mapRef.current.on("load", () => setIsMapLoaded(true));
    });
  }, []);

  const reproject = useCallback(() => {
    if (!mapRef.current || !canvasRef.current || !containerRef.current) return;
    const mapEl = document.getElementById("mappls-map");
    const w = mapEl ? mapEl.offsetWidth : containerRef.current.offsetWidth;
    const h = mapEl ? mapEl.offsetHeight : containerRef.current.offsetHeight;
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

  const fetchAndRender = useCallback(async () => {
    if (!mapRef.current) return;
    setLoading(true);
    try {
      const tp = TIME_PRESETS[timePreset];
      const filters = {};
      if (violationType) filters.violation_type = violationType;
      if (vehicleType) filters.vehicle_type = vehicleType;
      if (policeStation) filters.police_station = policeStation;
      if (tp.start != null) { filters.hour_start = tp.start; filters.hour_end = tp.end; }
      const data = await getHotspots({ ...filters, sample: 50000 });
      cellsRef.current = data.cells || [];
      reproject();
    } catch (err) {
      console.error("fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [violationType, vehicleType, policeStation, timePreset, reproject]);

  useEffect(() => {
    if (!isMapLoaded) return;
    fetchAndRender();
  }, [isMapLoaded, violationType, vehicleType, policeStation, timePreset]);

  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return;
    const onClick = (e) => {
      const clickPx = mapRef.current.project({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      if (!clickPx) return;
      let best = null, bestDist = Infinity;
      projectedRef.current.forEach((z) => {
        const d = Math.hypot(z.px - clickPx.x, z.py - clickPx.y);
        if (d < bestDist && d < 50) { bestDist = d; best = z; }
      });
      setSelZone(best || null);
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
  }, [isMapLoaded, startRaf, stopRaf]);

  const topViolations = meta?.violation_types?.slice(0, 8) || [];
  const topVehicles = meta?.vehicle_types?.slice(0, 8) || [];
  const topStations = meta?.police_stations?.slice(0, 15) || [];
  const hasActiveFilter = violationType || vehicleType || policeStation || timePreset !== 0;

  return (
    <div ref={containerRef} className="flex flex-col" style={{ height: "calc(100vh - 130px)" }}>
      <div className="relative flex-1 rounded-xl overflow-hidden border border-slate-700/50">
        {!MAPPLS_KEY && (
          <div className="absolute inset-0 z-20 bg-slate-900 flex items-center justify-center">
            <p className="text-slate-400 text-sm text-center px-8">
              Set <code className="text-emerald-400">VITE_MAPPLS_KEY</code> in <code className="text-emerald-400">.env</code>
            </p>
          </div>
        )}
        <div id="mappls-map" style={{ width: "100%", height: "100%" }} />

        {/* Canvas gradient overlay — pointer-events none so map stays interactive */}
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 4, pointerEvents: "none" }}
        />

        {/* click popup */}
        {selZone && (
          <div className="absolute z-20 bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4 min-w-[200px]"
            style={{ left: Math.min(selZone.px + 14, 400), top: Math.max(selZone.py - 80, 10) }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold" style={{ color: selZone.sev.color }}>{selZone.sev.label} Zone</span>
              <button onClick={() => setSelZone(null)} className="text-slate-500 hover:text-white ml-3"><X size={13} /></button>
            </div>
            <div className="text-2xl font-bold mb-1" style={{ color: selZone.sev.color }}>{selZone.count.toLocaleString()}</div>
            <div className="text-[11px] text-slate-400 mb-1">violations in this ~300m cell</div>
            <div className="text-[10px] text-slate-500 font-mono">{selZone.lat.toFixed(4)}, {selZone.lng.toFixed(4)}</div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 z-10 bg-slate-900/30 flex items-center justify-center pointer-events-none">
            <div className="bg-slate-900/80 px-4 py-2 rounded-lg">
              <span className="text-sm text-slate-300">Loading...</span>
            </div>
          </div>
        )}

        {/* top-left info */}
        <div className="absolute top-3 left-3 z-10">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50">
            <p className="text-xs font-medium text-white">
              <AlertTriangle size={12} className="inline text-amber-400 mr-1" />
              Parking Violation Density
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {meta ? `${meta.total.toLocaleString()} records` : "Loading..."}
              {!loading && ` · ${projectedRef.current.length} cells`}
            </p>
          </div>
        </div>

        {/* filter button */}
        <div className="absolute top-3 right-14 z-10">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={"flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium backdrop-blur-sm transition-colors border " +
              (filtersOpen || hasActiveFilter
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                : "bg-slate-900/90 text-slate-300 border-slate-700/50 hover:text-white")}
          >
            <Filter size={13} />
            Filters
            {hasActiveFilter && !filtersOpen && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          </button>
        </div>

        {/* filter panel */}
        {filtersOpen && (
          <div className="absolute top-14 right-14 z-20 w-72 bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/50 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-white">Filter Data</span>
              <button onClick={() => setFiltersOpen(false)} className="text-slate-500 hover:text-white"><X size={14} /></button>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><AlertTriangle size={10} /> Violation Type</label>
              <select value={violationType} onChange={(e) => setViolationType(e.target.value)}
                className="w-full bg-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 border border-slate-700 focus:border-emerald-500 focus:outline-none">
                <option value="">All Violations</option>
                {topViolations.map(([n, c]) => <option key={n} value={n}>{n} ({c.toLocaleString()})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><Car size={10} /> Vehicle Type</label>
              <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}
                className="w-full bg-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 border border-slate-700 focus:border-emerald-500 focus:outline-none">
                <option value="">All Vehicles</option>
                {topVehicles.map(([n, c]) => <option key={n} value={n}>{n} ({c.toLocaleString()})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><MapPin size={10} /> Police Station</label>
              <select value={policeStation} onChange={(e) => setPoliceStation(e.target.value)}
                className="w-full bg-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 border border-slate-700 focus:border-emerald-500 focus:outline-none">
                <option value="">All Stations</option>
                {topStations.map(([n, c]) => <option key={n} value={n}>{n} ({c.toLocaleString()})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 flex items-center gap-1"><Clock size={10} /> Time of Day</label>
              <div className="flex flex-wrap gap-1">
                {TIME_PRESETS.map((tp, i) => (
                  <button key={i} onClick={() => setTimePreset(i)}
                    className={"px-2 py-0.5 rounded text-[11px] border " + (timePreset === i
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                      : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white")}>
                    {tp.label}
                  </button>
                ))}
              </div>
            </div>
            {hasActiveFilter && (
              <button onClick={() => { setViolationType(""); setVehicleType(""); setPoliceStation(""); setTimePreset(0); }}
                className="text-[11px] text-slate-500 hover:text-white text-center py-1">Clear all filters</button>
            )}
          </div>
        )}

        {/* bottom stats */}
        {meta && !loading && (
          <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-slate-900/95 to-transparent pt-8 pb-3 px-3">
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Top Zone", value: topStations[0]?.[0] || "-", sub: `${topStations[0]?.[1]?.toLocaleString()} violations` },
                { label: "Primary Type", value: topViolations[0]?.[0] || "-", sub: `${((topViolations[0]?.[1] / meta.total) * 100).toFixed(0)}% of total` },
                { label: "Top Vehicle", value: topVehicles[0]?.[0] || "-", sub: `${topVehicles[0]?.[1]?.toLocaleString()} cases` },
                { label: "Data Span", value: "Nov 23 - Apr 24", sub: `${meta.total.toLocaleString()} records` },
              ].map((card) => (
                <div key={card.label} className="bg-slate-800/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/30">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{card.label}</p>
                  <p className="text-xs font-medium text-white mt-0.5 truncate">{card.value}</p>
                  <p className="text-[10px] text-slate-400">{card.sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* legend */}
        <div className="absolute bottom-20 left-3 z-10 bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50">
          <p className="text-[10px] text-slate-500 mb-1.5">Violation Density</p>
          <div className="flex items-center gap-3">
            {[
              { color: "#22c55e", label: "<20" },
              { color: "#eab308", label: "20-50" },
              { color: "#f97316", label: "50-100" },
              { color: "#ef4444", label: "100+" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[9px] text-slate-500">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
