import { useState, useEffect } from "react";
import { Database, OctagonAlert, Timer, Route, MapPinned, ArrowUpRight, ChevronRight } from "lucide-react";
import { getHotspotsMeta, getHotspots } from "../lib/api";
import { severityFor } from "../lib/severity";
import { Card, StatCard, SeverityBadge, Badge, Button } from "./ui";

function MiniMap({ zones, onOpen }) {
  return (
    <Card padding={0} style={{ overflow: "hidden", position: "relative", height: "100%", minHeight: 280 }}>
      <div style={{ position: "absolute", inset: 0, background: "var(--gl-map-land)" }}>
        <svg viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
          <ellipse cx="310" cy="210" rx="220" ry="170" fill="none" stroke="var(--gl-map-road-major)" strokeWidth="10" />
          {[[310,210,300,30],[310,210,560,150],[310,210,520,370],[310,210,80,320],[310,210,120,90]].map((l,i)=>(
            <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="var(--gl-map-road-major)" strokeWidth="6" strokeLinecap="round" />
          ))}
          <path d="M410 270 q24 -12 48 4 q16 18 -4 34 q-30 16 -52 -4 q-12 -20 8 -34z" fill="var(--gl-map-water)" />
          <ellipse cx="280" cy="180" rx="34" ry="26" fill="var(--gl-map-park)" />
        </svg>
      </div>
      {zones.slice(0, 9).map((z) => {
        const s = severityFor(z.count);
        return (
          <span key={z.id} style={{ position: "absolute", left: z.x + "%", top: (z.y * 0.9 + 4) + "%", transform: "translate(-50%,-50%)", width: 18 + Math.min(z.count, 30) * 0.7, height: 18 + Math.min(z.count, 30) * 0.7, borderRadius: "50%", background: s.fill, boxShadow: "inset 0 0 0 2px " + s.color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--gl-font-mono)", fontSize: 10, fontWeight: 600, color: "#0A0E14" }}>{z.count}</span>
        );
      })}
      <div style={{ position: "absolute", top: 14, left: 14, display: "flex", alignItems: "center", gap: 8, background: "rgba(15,21,32,0.9)", backdropFilter: "blur(8px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong)", padding: "8px 12px" }}>
        <MapPinned size={14} style={{ color: "var(--gl-primary-hover)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gl-text-1)" }}>Risk Map</span>
      </div>
      <div style={{ position: "absolute", bottom: 14, right: 14 }}>
        <Button size="sm" variant="secondary" iconRight={<ArrowUpRight size={15} />} onClick={onOpen}>Open full map</Button>
      </div>
    </Card>
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

export default function OverviewScreen({ onNav }) {
  const [meta, setMeta] = useState(null);
  const [zones, setZones] = useState([]);

  useEffect(() => {
    getHotspotsMeta().then(setMeta).catch(() => {});
    getHotspots({ sample: 8000 }).then((data) => {
      const cells = data.cells || [];
      if (!cells.length) return;
      const lats = cells.map((c) => c.lat), lngs = cells.map((c) => c.lng);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const latR = maxLat - minLat || 0.01, lngR = maxLng - minLng || 0.01;
      setZones(cells.slice(0, 15).map((c, i) => ({
        id: i, name: "Zone " + (i + 1), station: c.lat.toFixed(3) + ", " + c.lng.toFixed(3),
        count: c.count, x: ((c.lng - minLng) / lngR) * 80 + 10, y: ((maxLat - c.lat) / latR) * 80 + 10, top: "Wrong parking",
      })));
    }).catch(() => {});
  }, []);

  const sorted = [...zones].sort((a, b) => b.count - a.count);
  const total = meta?.total || 0;
  const criticalCount = zones.filter((z) => z.count >= 20).length;
  const topStation = meta?.police_stations?.[0]?.[0] || "-";
  const topViolation = meta?.violation_types?.[0]?.[0] || "-";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <StatCard label="Total violations" value={total.toLocaleString()} icon={<Database size={15} />} delta="+4.2%" deltaTone="up" sub="vs last week" />
        <StatCard label="Critical zones" value={criticalCount} icon={<OctagonAlert size={15} />} accent="var(--gl-sev-critical)" sub="need dispatch now" />
        <StatCard label="Avg clearance" value="38" unit="min" icon={<Timer size={15} />} delta="-6 min" deltaTone="up" sub="forecast model" />
        <StatCard label="Active corridors" value={meta?.police_stations?.length || 0} icon={<Route size={15} />} sub={"top: " + topViolation} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18 }}>
        <MiniMap zones={zones} onOpen={() => onNav && onNav("map")} />
        <Card padding={18} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 16, fontWeight: 600, color: "var(--gl-text-1)" }}>Top zones now</span>
            <Badge tone="primary" dot>Live</Badge>
          </div>
          <div style={{ flex: 1 }}>
            {sorted.slice(0, 6).map((it) => <IncidentRow key={it.id} it={it} />)}
          </div>
          <Button variant="ghost" size="sm" full iconRight={<ChevronRight size={15} />} onClick={() => onNav && onNav("map")} style={{ marginTop: 6 }}>View all {zones.length} zones</Button>
        </Card>
      </div>
    </div>
  );
}