import { useState, useEffect, useRef, useCallback } from "react";
import { mappls } from "mappls-web-maps";
import { Database, OctagonAlert, Timer, Route, MapPinned, ArrowUpRight, ChevronRight } from "lucide-react";
import { getHotspotsMeta, getHotspots } from "../lib/api";
import { severityFor } from "../lib/severity";
import { Card, StatCard, SeverityBadge, Badge, Button } from "./ui";

const MAPPLS_KEY = import.meta.env.VITE_MAPPLS_KEY || "";
const mapplsObj = new mappls();

const SEV_HEX = { low: "#22c55e", moderate: "#eab308", high: "#f97316", critical: "#ef4444" };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawCanvas(canvas, pts, zoom) {
  if (!canvas || !canvas.width || !canvas.height) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const baseRadius = Math.max(18, 10 * Math.pow(2, zoom - 11));
  pts.forEach((z) => {
    const r = Math.min(baseRadius * (1 + Math.log1p(z.count) * 0.15), baseRadius * 2.2);
    const [cr, cg, cb] = hexToRgb(SEV_HEX[z.sev.key]);
    const grad = ctx.createRadialGradient(z.px, z.py, 0, z.px, z.py, r);
    grad.addColorStop(0,   `rgba(${cr},${cg},${cb},0.5)`);
    grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.15)`);
    grad.addColorStop(0.8, `rgba(${cr},${cg},${cb},0.08)`);
    grad.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
    ctx.beginPath();
    ctx.arc(z.px, z.py, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

function MiniMap({ onOpen, prefetchedCells }) {
  const mapRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const cellsRef = useRef([]);
  const projectedRef = useRef([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!MAPPLS_KEY) return;
    mapplsObj.initialize(MAPPLS_KEY, { map: true }, () => {
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = mapplsObj.Map({
        id: "gl-mini-map",
        properties: { center: [12.97, 77.59], zoom: 12, zoomControl: false, search: false, location: false },
      });
      mapRef.current.on("load", () => {
        // Delay resize so the container has its final layout dimensions
        setTimeout(() => {
          try { mapRef.current.resize(); } catch {}
          setReady(true);
        }, 100);
      });
    });
  }, []);

  const rafRef = useRef(null);

  const reproject = useCallback(() => {
    if (!mapRef.current || !canvasRef.current || !containerRef.current) return;
    const w = containerRef.current.offsetWidth;
    const h = containerRef.current.offsetHeight + 28; // match map div which extends 28px below container
    if (!w || !h) return;
    if (canvasRef.current.width !== w || canvasRef.current.height !== h) {
      canvasRef.current.width = w;
      canvasRef.current.height = h;
    }
    const pts = cellsRef.current.map((c, i) => {
      try {
        const px = mapRef.current.project({ lat: c.lat, lng: c.lng });
        if (!px) return null;
        return { id: i, px: px.x, py: px.y, count: c.count, sev: severityFor(c.count) };
      } catch { return null; }
    }).filter(Boolean);
    projectedRef.current = pts;
    const zoom = mapRef.current.getZoom ? mapRef.current.getZoom() : 11;
    drawCanvas(canvasRef.current, pts, zoom);
  }, []);

  // RAF loop: runs every frame during pan/zoom animations
  const startRaf = useCallback(() => {
    if (rafRef.current) return;
    const loop = () => {
      reproject();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [reproject]);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    reproject(); // final reproject at rest
  }, [reproject]);

  useEffect(() => {
    if (!ready) return;
    if (prefetchedCells) {
      cellsRef.current = prefetchedCells;
      reproject();
      return;
    }
    getHotspots({ sample: 50000 }).then((data) => {
      cellsRef.current = data.cells || [];
      reproject();
    }).catch(() => {});
  }, [ready, reproject, prefetchedCells]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.on("movestart", startRaf);
    mapRef.current.on("zoomstart", startRaf);
    mapRef.current.on("moveend", stopRaf);
    mapRef.current.on("zoomend", stopRaf);
    return () => {
      try {
        mapRef.current.off("movestart", startRaf);
        mapRef.current.off("zoomstart", startRaf);
        mapRef.current.off("moveend", stopRaf);
        mapRef.current.off("zoomend", stopRaf);
      } catch {}
      stopRaf();
    };
  }, [ready, startRaf, stopRaf]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: "var(--gl-radius-lg)" }}>
      {/* bottom: -28 pushes attribution bar outside container; overflow:hidden on parent clips it */}
      <div id="gl-mini-map" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: -28 }} />
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: -28, width: "100%", height: "calc(100% + 28px)", zIndex: 3, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 14, left: 14, display: "flex", alignItems: "center", gap: 8, background: "rgba(15,21,32,0.9)", backdropFilter: "blur(8px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong)", padding: "8px 12px", zIndex: 10 }}>
        <MapPinned size={14} style={{ color: "var(--gl-primary-hover)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gl-text-1)" }}>Risk Map</span>
      </div>
      <div style={{ position: "absolute", bottom: 14, right: 14, zIndex: 10 }}>
        <Button size="sm" variant="secondary" iconRight={<ArrowUpRight size={15} />} onClick={onOpen}>Open full map</Button>
      </div>
    </div>
  );
}

function IncidentRow({ it }) {
  const s = severityFor(it.count);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 4px", borderBottom: "1px solid var(--gl-hairline)" }}>
      <span style={{ width: 9, height: 9, flex: "none", borderRadius: "50%", background: s.color, boxShadow: "0 0 8px " + s.color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--gl-text-1)" }}>{it.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--gl-text-3)" }}>{it.top} · {it.station}</div>
      </div>
      <SeverityBadge count={it.count} showCount size="sm" />
    </div>
  );
}

export default function OverviewScreen({ onNav, prefetched }) {
  const [meta, setMeta] = useState(null);
  const [topZones, setTopZones] = useState([]);

  useEffect(() => {
    if (prefetched?.meta) setMeta(prefetched.meta);
    else getHotspotsMeta().then(setMeta).catch(() => {});

    const hotspotsData = prefetched?.hotspots;
    if (hotspotsData) {
      const cells = (hotspotsData.cells || []).slice(0, 15).map((c, i) => ({
        id: i, name: "Zone " + (i + 1),
        station: c.lat.toFixed(3) + ", " + c.lng.toFixed(3),
        count: c.count, top: "violation cluster",
      }));
      setTopZones(cells);
    } else {
      getHotspots({ sample: 8000 }).then((data) => {
        const cells = (data.cells || []).slice(0, 15).map((c, i) => ({
          id: i, name: "Zone " + (i + 1),
          station: c.lat.toFixed(3) + ", " + c.lng.toFixed(3),
          count: c.count, top: "violation cluster",
        }));
        setTopZones(cells);
      }).catch(() => {});
    }
  }, []);

  const sorted = [...topZones].sort((a, b) => b.count - a.count);
  const total = meta?.total || 0;
  const criticalCount = topZones.filter((z) => z.count >= 2000).length;
  const topStation = meta?.police_stations?.[0]?.[0] || "-";
  const topViolation = meta?.violation_types?.[0]?.[0] || "-";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <StatCard label="Total violations" value={total.toLocaleString()} icon={<Database size={15} />} sub="in dataset" />
        <StatCard label="Critical zones" value={criticalCount} icon={<OctagonAlert size={15} />} accent="var(--gl-sev-critical)" sub="≥2000 in a cell" />
        <StatCard label="Violation types" value={meta?.violation_types?.length || 0} icon={<Timer size={15} />} sub={"top: " + topViolation} />
        <StatCard label="Police stations" value={meta?.police_stations?.length || 0} icon={<Route size={15} />} sub={"top: " + topStation} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18, alignItems: "stretch", height: 520 }}>
        <Card padding={0} style={{ overflow: "hidden", position: "relative", height: "100%" }}>
          <MiniMap onOpen={() => onNav && onNav("map")} prefetchedCells={prefetched?.hotspots?.cells} />
        </Card>
        <Card padding={18} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 16, fontWeight: 600, color: "var(--gl-text-1)" }}>Top zones now</span>
            <Badge tone="primary" dot>Live</Badge>
          </div>
          <div style={{ flex: 1 }}>
            {sorted.slice(0, 6).map((it) => <IncidentRow key={it.id} it={it} />)}
          </div>
          <Button variant="ghost" size="sm" full iconRight={<ChevronRight size={15} />} onClick={() => onNav && onNav("map")} style={{ marginTop: 6 }}>View all {topZones.length} zones</Button>
        </Card>
      </div>
    </div>
  );
}