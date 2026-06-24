import { useEffect, useRef, useState, useCallback } from "react";
import { mappls } from "mappls-web-maps";
import { ShieldCheck, CalendarClock, ChevronLeft, ChevronRight, Sparkles, History, Activity, TriangleAlert } from "lucide-react";
import { getSafetyMeta, getSafetyForecast } from "../lib/api";
import { severityFor } from "../lib/severity";
import { Badge, IconButton } from "./ui";

const MAPPLS_KEY = import.meta.env.VITE_MAPPLS_KEY || "";
const mapplsObject = new mappls();

const SEV_HEX = { low: "#22c55e", moderate: "#eab308", high: "#f97316", critical: "#ef4444" };
const LEGEND_STOPS = [
  { color: "#22c55e", label: "<20" },
  { color: "#eab308", label: "20–50" },
  { color: "#f97316", label: "50–100" },
  { color: "#ef4444", label: "100+" },
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawCanvas(canvas, projected, zoom) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const baseRadius = Math.max(18, 10 * Math.pow(2, zoom - 11));
  projected.forEach((z) => {
    const r = Math.min(baseRadius * (1 + Math.log1p(z.count) * 0.15), baseRadius * 2.2);
    const [cr, cg, cb] = hexToRgb(SEV_HEX[z.sev.key]);
    const grad = ctx.createRadialGradient(z.px, z.py, 0, z.px, z.py, r);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.75)`);
    grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.45)`);
    grad.addColorStop(0.8, `rgba(${cr},${cg},${cb},0.15)`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.beginPath();
    ctx.arc(z.px, z.py, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function prettyDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function SafetyScreen() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const cellsRef = useRef([]);
  const rafRef = useRef(null);
  const debounceRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [meta, setMeta] = useState(null);
  const [offset, setOffset] = useState(0);     // days from anchor ("now")
  const [data, setData] = useState(null);      // forecast response
  const [loading, setLoading] = useState(false);

  useEffect(() => { getSafetyMeta().then(setMeta).catch(() => setMeta({ trained: false })); }, []);

  // ---- map init ----
  useEffect(() => {
    if (!MAPPLS_KEY) return;
    mapplsObject.initialize(MAPPLS_KEY, { map: true }, () => {
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = mapplsObject.Map({
        id: "gl-safety-map",
        properties: { center: [12.97, 77.59], zoom: 11, zoomControl: false, search: false, location: false },
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
      canvasRef.current.width = w; canvasRef.current.height = h;
    }
    const pts = cellsRef.current.map((c) => {
      try {
        const px = mapRef.current.project({ lat: c.lat, lng: c.lng });
        if (!px) return null;
        return { px: px.x, py: px.y, count: c.count, sev: severityFor(c.count) };
      } catch { return null; }
    }).filter(Boolean);
    const zoom = mapRef.current.getZoom ? mapRef.current.getZoom() : 11;
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

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const m = mapRef.current;
    m.on("movestart", startRaf); m.on("zoomstart", startRaf);
    m.on("moveend", stopRaf); m.on("zoomend", stopRaf);
    return () => {
      try {
        m.off("movestart", startRaf); m.off("zoomstart", startRaf);
        m.off("moveend", stopRaf); m.off("zoomend", stopRaf);
      } catch { /* map gone */ }
      stopRaf();
    };
  }, [mapLoaded, startRaf, stopRaf]);

  // ---- fetch forecast for the scrubbed date (debounced) ----
  const targetDate = meta?.anchor_date ? addDays(meta.anchor_date, offset) : null;
  useEffect(() => {
    if (!meta?.trained || !targetDate) return;
    clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      getSafetyForecast(targetDate, 7)
        .then((res) => { setData(res); cellsRef.current = res.cells || []; reproject(); })
        .catch(() => { setData(null); cellsRef.current = []; reproject(); })
        .finally(() => setLoading(false));
    }, 140);
    return () => clearTimeout(debounceRef.current);
  }, [targetDate, meta, mapLoaded, reproject]);

  const horizon = meta?.horizon_days || 14;
  const isForecast = data?.mode === "forecast";
  const notTrained = meta && meta.trained === false;

  return (
    <div ref={containerRef} style={{ position: "relative", height: "100%", borderRadius: "var(--gl-radius-lg)", overflow: "hidden", boxShadow: "var(--gl-ring-strong)" }}>
      <div id="gl-safety-map" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" }} />

      {/* title */}
      <div style={{ position: "absolute", top: 14, left: 14, zIndex: 6, background: "rgba(15,21,32,0.9)", backdropFilter: "blur(8px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-md)", padding: "11px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={15} style={{ color: "var(--gl-primary-hover)" }} />
          <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-text-1)" }}>Safety Forecast</span>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)", whiteSpace: "nowrap" }}>
          7-day violation risk · ~300 m cells{meta?.metrics ? " · MAE " + meta.metrics.mae : ""}
        </span>
      </div>

      {/* mode + stats */}
      {data && (
        <div style={{ position: "absolute", top: 14, right: 14, zIndex: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: "var(--gl-radius-pill)", fontSize: 11.5, fontWeight: 700, color: "#0A0E14", background: isForecast ? "var(--gl-sev-moderate)" : "#38A0EC" }}>
            {isForecast ? <Sparkles size={12} /> : <History size={12} />}{isForecast ? "Forecast" : "Historical"}
          </span>
          <div style={{ background: "rgba(15,21,32,0.9)", backdropFilter: "blur(8px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong)", padding: "7px 12px", display: "flex", gap: 14 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--gl-text-2)" }}><Activity size={13} style={{ color: "var(--gl-primary-hover)" }} />{data.total.toLocaleString()} <span style={{ color: "var(--gl-text-3)" }}>total</span></span>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--gl-text-2)" }}><TriangleAlert size={13} style={{ color: "var(--gl-sev-high)" }} />{data.max_count} <span style={{ color: "var(--gl-text-3)" }}>peak cell</span></span>
          </div>
        </div>
      )}

      {/* legend */}
      <div style={{ position: "absolute", left: 14, bottom: 116, zIndex: 6, background: "rgba(15,21,32,0.92)", backdropFilter: "blur(10px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong)", padding: "10px 14px" }}>
        <span style={{ fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>Expected violations / week</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 7 }}>
          {LEGEND_STOPS.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* date scrubber */}
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, zIndex: 7, background: "rgba(15,21,32,0.94)", backdropFilter: "blur(12px)", borderRadius: "var(--gl-radius-lg)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-lg)", padding: "14px 18px" }}>
        {notTrained ? (
          <div style={{ fontSize: 13, color: "var(--gl-text-2)", textAlign: "center", padding: "6px 0" }}>
            Safety model not trained yet — run <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-1)" }}>python train_safety.py</span> in <span style={{ fontFamily: "var(--gl-font-mono)" }}>backend/</span>.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <CalendarClock size={16} style={{ color: "var(--gl-primary-hover)" }} />
                <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 16, fontWeight: 600, color: "var(--gl-text-1)" }}>{targetDate ? prettyDate(targetDate) : "—"}</span>
                {offset === 0 && <Badge tone="primary">now</Badge>}
                {offset !== 0 && <span style={{ fontSize: 12, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>{offset > 0 ? "+" : ""}{offset} d</span>}
                {loading && <span style={{ width: 12, height: 12, border: "2px solid var(--gl-primary)", borderTopColor: "transparent", borderRadius: "50%", animation: "gl-pulse 0.8s linear infinite" }} />}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <IconButton size="sm" variant="ghost" icon={<ChevronLeft size={16} />} label="Back a day" onClick={() => setOffset((o) => Math.max(-horizon, o - 1))} />
                <button onClick={() => setOffset(0)} style={{ background: "var(--gl-surface-3)", border: "none", color: "var(--gl-text-2)", fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: "var(--gl-radius-md)", cursor: "pointer", fontFamily: "var(--gl-font-sans)" }}>Now</button>
                <IconButton size="sm" variant="ghost" icon={<ChevronRight size={16} />} label="Forward a day" onClick={() => setOffset((o) => Math.min(horizon, o + 1))} />
              </div>
            </div>
            <input type="range" min={-horizon} max={horizon} step={1} value={offset}
              onChange={(e) => setOffset(parseInt(e.target.value, 10))}
              style={{ width: "100%", accentColor: "var(--gl-primary)", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>
              <span>−{horizon === 14 ? "2 wk" : horizon + " d"}</span>
              <span style={{ color: "var(--gl-text-2)" }}>now</span>
              <span>+{horizon === 14 ? "2 wk" : horizon + " d"} (forecast)</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
