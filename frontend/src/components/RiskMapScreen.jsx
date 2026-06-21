import { useEffect, useRef, useState, useCallback } from "react";
import { mappls } from "mappls-web-maps";
import { MapPinned, SlidersHorizontal, X, Plus, Minus, LocateFixed, TriangleAlert, Car, Clock, Hash, Navigation } from "lucide-react";
import { getHotspots, getHotspotsMeta } from "../lib/api";
import { severityFor, aqiColor, intensity, aqiIndex, LEGEND } from "../lib/severity";
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

function AqiField({ zones }) {
  if (!zones.length) return null;
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 2 }}>
      <div style={{ position: "absolute", inset: "-16%", filter: "blur(40px)", opacity: 0.75 }}>
        <div style={{ position: "absolute", inset: 0, background: aqiColor(0.36, 0.5) }} />
        {zones.map((z, i) => {
          const t = intensity(z.count);
          const d = 18 + Math.min(z.count, 42) * 0.55;
          return (
            <div key={i} style={{
              position: "absolute", left: z.x + "%", top: z.y + "%",
              width: d + "%", height: d + "%", transform: "translate(-50%,-50%)",
              borderRadius: "50%",
              background: "radial-gradient(circle, " + aqiColor(t, 0.88) + " 0%, " + aqiColor(t, 0.5) + " 38%, " + aqiColor(t, 0) + " 70%)",
            }} />
          );
        })}
      </div>
    </div>
  );
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
  const [mapLoaded, setMapLoaded] = useState(false);
  const [meta, setMeta] = useState(null);
  const [zones, setZones] = useState([]);
  const [sel, setSel] = useState(null);
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

  const fetchZones = useCallback(async () => {
    const filters = {};
    if (vtype) filters.violation_type = vtype;
    if (vehicle) filters.vehicle_type = vehicle;
    const tm = TIME_MAP[time] || {};
    if (tm.hour_start != null) { filters.hour_start = tm.hour_start; filters.hour_end = tm.hour_end; }

    try {
      const data = await getHotspots({ ...filters, sample: 8000 });
      const cells = data.cells || [];
      if (!cells.length) { setZones([]); return; }
      const lats = cells.map((c) => c.lat);
      const lngs = cells.map((c) => c.lng);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const latRange = maxLat - minLat || 0.01;
      const lngRange = maxLng - minLng || 0.01;

      const mapped = cells.slice(0, 40).map((c, i) => ({
        id: i,
        name: "Zone " + (i + 1),
        station: c.lat.toFixed(3) + ", " + c.lng.toFixed(3),
        count: c.count,
        lat: c.lat,
        lng: c.lng,
        x: ((c.lng - minLng) / lngRange) * 80 + 10,
        y: ((maxLat - c.lat) / latRange) * 80 + 10,
        top: vtype || "Wrong parking",
      }));
      setZones(mapped);
    } catch (e) {
      console.error("fetch zones error:", e);
    }
  }, [vtype, vehicle, time]);

  useEffect(() => { fetchZones(); }, [vtype, vehicle, time, mapLoaded]);

  const selZone = zones.find((z) => z.id === sel);
  const hasFilter = vtype || vehicle || time !== "all";
  const violationTypes = meta?.violation_types?.slice(0, 8) || [];
  const vehicleTypes = meta?.vehicle_types?.slice(0, 8) || [];

  return (
    <div style={{ position: "relative", height: "100%", borderRadius: "var(--gl-radius-lg)", overflow: "hidden", boxShadow: "var(--gl-ring-strong)" }}>
      <div id="gl-mappls-map" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />

      <AqiField zones={zones} />

      {zones.map((z) => {
        const active = sel === z.id;
        const col = severityFor(z.count).color;
        return (
          <button key={z.id} onClick={() => setSel(active ? null : z.id)} title={z.name}
            style={{
              position: "absolute", left: z.x + "%", top: z.y + "%", transform: "translate(-50%,-50%)",
              zIndex: active ? 4 : 3, width: active ? 18 : 13, height: active ? 18 : 13,
              borderRadius: "50%", cursor: "pointer", padding: 0,
              background: "rgba(255,255,255,0.92)",
              border: (active ? 4 : 3) + "px solid " + col,
              boxShadow: active ? "0 0 0 4px " + col + "55, var(--gl-shadow-md)" : "0 1px 4px rgba(0,0,0,0.35)",
              transition: "all var(--gl-dur-fast) var(--gl-ease)",
            }} />
        );
      })}

      {/* title card */}
      <div style={{ position: "absolute", top: 14, left: 14, zIndex: 6, background: "rgba(15,21,32,0.9)", backdropFilter: "blur(8px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-md)", padding: "11px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MapPinned size={15} style={{ color: "var(--gl-primary-hover)" }} />
          <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-text-1)" }}>Parking Violation Density</span>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)", whiteSpace: "nowrap" }}>
          Bengaluru {meta ? " · " + meta.total.toLocaleString() + " records" : ""} · tap a zone
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

      {/* AQI legend */}
      <div style={{ position: "absolute", left: 14, right: selZone ? 296 : 14, bottom: 14, zIndex: 6, maxWidth: 460, background: "rgba(15,21,32,0.92)", backdropFilter: "blur(10px)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-md)", padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
          <span style={{ fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>Violation Density Index</span>
          <span style={{ fontSize: 11, color: "var(--gl-text-3)" }}>Low → High</span>
        </div>
        <div style={{ height: 12, borderRadius: 6, background: LEGEND, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          {[1,2,3,4,5,6,7,8,9,10].map((n) => <span key={n} style={{ fontFamily: "var(--gl-font-mono)", fontSize: 10, color: "var(--gl-text-3)" }}>{n}</span>)}
        </div>
      </div>

      {/* zone detail popup */}
      {selZone && (
        <div style={{ position: "absolute", right: 14, bottom: 14, zIndex: 7, width: 268, background: "rgba(15,21,32,0.97)", backdropFilter: "blur(12px)", borderRadius: "var(--gl-radius-lg)", boxShadow: "var(--gl-ring-strong), var(--gl-shadow-lg)", padding: 16, animation: "gl-rise var(--gl-dur-base) var(--gl-ease)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: "var(--gl-font-display)", fontSize: 18, fontWeight: 600, color: "var(--gl-text-1)", letterSpacing: "-0.01em" }}>{selZone.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--gl-text-3)" }}>{selZone.station}</div>
            </div>
            <IconButton size="sm" variant="ghost" icon={<X size={15} />} label="Close" onClick={() => setSel(null)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <SeverityBadge count={selZone.count} />
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 32, fontWeight: 700, color: severityFor(selZone.count).color, letterSpacing: "-0.02em", lineHeight: 1 }}>{aqiIndex(selZone.count)}</span>
              <span style={{ fontSize: 12, color: "var(--gl-text-3)" }}>/10 index</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingTop: 12, borderTop: "1px solid var(--gl-hairline)" }}>
            <DetailRow icon={Hash} label="Violations" value={selZone.count + " this zone"} />
            <DetailRow icon={TriangleAlert} label="Top violation" value={selZone.top} />
            <DetailRow icon={Navigation} label="Grid" value={selZone.lat.toFixed(3) + ", " + selZone.lng.toFixed(3)} mono />
          </div>
        </div>
      )}
    </div>
  );
}