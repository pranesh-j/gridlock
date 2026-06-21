import { useEffect, useRef, useState, useCallback } from "react";
import { mappls } from "mappls-web-maps";
import { getHotspots, getHotspotsMeta } from "../lib/api";
import { Filter, Clock, Car, MapPin, AlertTriangle, Loader2, X } from "lucide-react";

const MAPPLS_KEY = import.meta.env.VITE_MAPPLS_KEY || "";

const TIME_PRESETS = [
  { label: "All Day", start: null, end: null },
  { label: "Morning (7-10)", start: 7, end: 10 },
  { label: "Afternoon (12-16)", start: 12, end: 16 },
  { label: "Evening (17-21)", start: 17, end: 21 },
  { label: "Night (21-6)", start: 21, end: 6 },
];

const mapplsObject = new mappls();

export default function HotspotMap() {
  const mapRef = useRef(null);
  const heatLayerRef = useRef(null);
  const markersRef = useRef([]);
  const cellsRef = useRef([]);
  const infoRef = useRef(null);

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState({ total: 0, matched: 0, returned: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);

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
        properties: {
          center: [12.97, 77.59],
          zoom: 12,
          zoomControl: true,
          search: false,
          location: false,
        },
      });
      mapRef.current.on("load", () => {
        setIsMapLoaded(true);
        // click anywhere to see violation info
        mapRef.current.on("click", (e) => {
          const lat = e.lngLat.lat;
          const lng = e.lngLat.lng;
          if (!cellsRef.current.length) return;
          // find nearest cell
          let best = null;
          let bestDist = Infinity;
          cellsRef.current.forEach((c) => {
            const d = Math.abs(c.lat - lat) + Math.abs(c.lng - lng);
            if (d < bestDist && d < 0.005) {
              bestDist = d;
              best = c;
            }
          });
          // remove old info window
          if (infoRef.current) {
            try { mapplsObject.removeLayer({ map: mapRef.current, layer: infoRef.current }); } catch(e2) {}
            infoRef.current = null;
          }
          if (best) {
            const color = severityColor(best.count);
            const severity = severityLabel(best.count);
            try {
              infoRef.current = mapplsObject.Marker({
                map: mapRef.current,
                position: { lat: lat, lng: lng },
                popupHtml: `
                  <div style="font-family:system-ui;padding:6px;min-width:180px;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                      <span style="width:12px;height:12px;border-radius:3px;background:${color};display:inline-block;"></span>
                      <span style="font-size:14px;font-weight:700;color:#111;">${severity} Zone</span>
                    </div>
                    <div style="font-size:12px;color:#444;line-height:1.8;">
                      <div><b style="font-size:18px;color:#111;">${best.count}</b> violations in this area</div>
                      <div>Grid: ${best.lat.toFixed(3)}, ${best.lng.toFixed(3)}</div>
                    </div>
                  </div>
                `,
              });
            } catch(e3) {}
          }
        });
      });
    });
  }, []);

  const clearMarkers = () => {
    markersRef.current.forEach((m) => {
      try { mapplsObject.removeLayer({ map: mapRef.current, layer: m }); } catch(e) {}
    });
    markersRef.current = [];
  };

  const severityColor = (count) => {
    if (count >= 20) return "#ef4444";
    if (count >= 10) return "#f97316";
    if (count >= 5) return "#eab308";
    return "#22c55e";
  };

  const severityLabel = (count) => {
    if (count >= 20) return "Critical";
    if (count >= 10) return "High";
    if (count >= 5) return "Moderate";
    return "Low";
  };

  const fetchAndRender = useCallback(async () => {
    if (!mapRef.current) return;
    setLoading(true);
    try {
      const tp = TIME_PRESETS[timePreset];
      const filters = {};
      if (violationType) filters.violation_type = violationType;
      if (vehicleType) filters.vehicle_type = vehicleType;
      if (policeStation) filters.police_station = policeStation;
      if (tp.start != null) {
        filters.hour_start = tp.start;
        filters.hour_end = tp.end;
      }

      const data = await getHotspots({ ...filters, sample: 12000 });
      setStats({ total: data.total_records, matched: data.total_matched, returned: data.points_returned });

      if (heatLayerRef.current) {
        mapplsObject.removeLayer({ map: mapRef.current, layer: heatLayerRef.current });
        heatLayerRef.current = null;
      }
      clearMarkers();

      // generate weighted points from cells for smooth heatmap
      const cellsData = data.cells || [];
      cellsRef.current = cellsData;

      if (cellsData.length > 0) {
        const weightedPoints = [];
        cellsData.forEach((c) => {
          // more points = hotter area, capped to avoid explosion
          const reps = Math.min(Math.ceil(Math.sqrt(c.count) * 2), 30);
          for (let i = 0; i < reps; i++) {
            // slight jitter so points spread naturally
            weightedPoints.push({
              lat: c.lat + (Math.random() - 0.5) * 0.003,
              lng: c.lng + (Math.random() - 0.5) * 0.003,
            });
          }
        });

        heatLayerRef.current = mapplsObject.HeatmapLayer({
          map: mapRef.current,
          data: weightedPoints,
          fitbounds: false,
          opacity: 0.7,
          radius: 25,
          maxIntensity: 40,
          gradient: [
            "rgba(0, 228, 0, 0)",
            "rgba(0, 228, 0, 0.4)",
            "rgba(100, 255, 0, 0.5)",
            "rgba(200, 255, 0, 0.55)",
            "rgba(255, 255, 0, 0.6)",
            "rgba(255, 200, 0, 0.65)",
            "rgba(255, 150, 0, 0.7)",
            "rgba(255, 100, 0, 0.75)",
            "rgba(255, 50, 0, 0.8)",
            "rgba(220, 0, 0, 0.85)",
            "rgba(150, 0, 0, 0.9)",
          ],
        });
      }
    } catch (err) {
      console.error("heatmap fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [violationType, vehicleType, policeStation, timePreset]);

  useEffect(() => {
    if (!isMapLoaded) return;
    fetchAndRender();
  }, [isMapLoaded, violationType, vehicleType, policeStation, timePreset]);

  const topViolations = meta?.violation_types?.slice(0, 8) || [];
  const topVehicles = meta?.vehicle_types?.slice(0, 8) || [];
  const topStations = meta?.police_stations?.slice(0, 15) || [];
  const hasActiveFilter = violationType || vehicleType || policeStation || timePreset !== 0;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 130px)" }}>
      <div className="relative flex-1 rounded-xl overflow-hidden border border-slate-700/50">
        {!MAPPLS_KEY && (
          <div className="absolute inset-0 z-20 bg-slate-900 flex items-center justify-center">
            <p className="text-slate-400 text-sm text-center px-8">
              Set <code className="text-emerald-400">VITE_MAPPLS_KEY</code> in <code className="text-emerald-400">.env</code>
            </p>
          </div>
        )}
        <div id="mappls-map" style={{ width: "100%", height: "100%" }} />

        {loading && (
          <div className="absolute inset-0 z-10 bg-slate-900/40 flex items-center justify-center pointer-events-none">
            <div className="bg-slate-900/80 px-4 py-2 rounded-lg flex items-center gap-2">
              <Loader2 size={16} className="text-emerald-400 animate-spin" />
              <span className="text-sm text-slate-300">Loading heatmap...</span>
            </div>
          </div>
        )}

        {/* top-left info */}
        <div className="absolute top-3 left-3 z-10">
          <div className="bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50">
            <p className="text-xs font-medium text-white">
              <AlertTriangle size={12} className="inline text-amber-400 mr-1" />
              Parking Violation Heatmap
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {meta ? `${meta.total.toLocaleString()} records` : "Loading..."}
              {!loading && ` · ${stats.returned.toLocaleString()} shown`}
            </p>
          </div>
        </div>

        {/* filter button - top right */}
        <div className="absolute top-3 right-14 z-10">
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium backdrop-blur-sm transition-colors border " +
              (filtersOpen || hasActiveFilter
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                : "bg-slate-900/90 text-slate-300 border-slate-700/50 hover:text-white")
            }
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

        {/* legend - bottom left, above stats */}
        <div className="absolute bottom-20 left-3 z-10 bg-slate-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/50">
          <p className="text-[10px] text-slate-500 mb-1.5">Violation Density</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500">Low</span>
            <div className="w-24 h-2 rounded-full" style={{
              background: "linear-gradient(to right, rgba(0,228,0,0.6), rgba(255,255,0,0.7), rgba(255,150,0,0.8), rgba(220,0,0,0.9))"
            }} />
            <span className="text-[10px] text-slate-500">High</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            {[
              { color: "#22c55e", label: "<5" },
              { color: "#eab308", label: "5-10" },
              { color: "#f97316", label: "10-20" },
              { color: "#ef4444", label: "20+" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="text-[9px] text-slate-500">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}