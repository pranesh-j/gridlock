const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function analyzeImage(file) {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${BASE}/analyze`, { method: "POST", body: form });
  if (!r.ok) throw new Error("analyze failed");
  return r.json();
}

export async function forecastScenario(ctx) {
  const r = await fetch(`${BASE}/forecast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ctx),
  });
  if (!r.ok) throw new Error("forecast failed");
  return r.json();
}

export async function getHotspots(filters = {}) {
  const params = new URLSearchParams();
  if (filters.violation_type) params.set("violation_type", filters.violation_type);
  if (filters.vehicle_type) params.set("vehicle_type", filters.vehicle_type);
  if (filters.police_station) params.set("police_station", filters.police_station);
  if (filters.hour_start != null) params.set("hour_start", filters.hour_start);
  if (filters.hour_end != null) params.set("hour_end", filters.hour_end);
  if (filters.sample) params.set("sample", filters.sample);
  if (filters.lat_min != null) params.set("lat_min", filters.lat_min);
  if (filters.lat_max != null) params.set("lat_max", filters.lat_max);
  if (filters.lng_min != null) params.set("lng_min", filters.lng_min);
  if (filters.lng_max != null) params.set("lng_max", filters.lng_max);
  const r = await fetch(`${BASE}/hotspots?${params.toString()}`);
  if (!r.ok) throw new Error("hotspots failed");
  return r.json();
}

export async function getHotspotsMeta() {
  const r = await fetch(`${BASE}/hotspots/meta`);
  if (!r.ok) throw new Error("meta failed");
  return r.json();
}

export async function getFeedbackSummary() {
  const r = await fetch(`${BASE}/feedback/summary`);
  if (!r.ok) throw new Error("feedback failed");
  return r.json();
}