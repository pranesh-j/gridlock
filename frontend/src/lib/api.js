const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
// video jobs talk to the detection service directly (heavy media shouldn't proxy
// through the backend); falls back to localhost for dev
const DET = import.meta.env.VITE_DETECTION_URL || "http://localhost:8001";

export async function startVideoJob(file, options = {}) {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(options)) {
    if (v != null && v !== "") form.append(k, v);
  }
  const r = await fetch(`${DET}/detect_video`, { method: "POST", body: form });
  if (!r.ok) throw new Error("video job start failed");
  return r.json();
}

export async function getVideoJob(jobId) {
  const r = await fetch(`${DET}/detect_video/${jobId}`);
  if (!r.ok) throw new Error("video job status failed");
  return r.json();
}

export function videoJobFileUrl(jobId) {
  return `${DET}/detect_video/${jobId}/video`;
}

export function videoJobEvidenceUrl(jobId, name) {
  return `${DET}/detect_video/${jobId}/evidence/${name}`;
}

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

export async function getSafetyMeta() {
  const r = await fetch(`${BASE}/safety/meta`);
  if (!r.ok) throw new Error("safety meta failed");
  return r.json();
}

export async function getSafetyForecast(date, window = 7) {
  const r = await fetch(`${BASE}/safety/forecast?date=${date}&window=${window}`);
  if (!r.ok) throw new Error("safety forecast failed");
  return r.json();
}

export async function getFeedbackSummary() {
  const r = await fetch(`${BASE}/feedback/summary`);
  if (!r.ok) throw new Error("feedback failed");
  return r.json();
}

export async function getCvViolations(filters = {}) {
  const params = new URLSearchParams();
  if (filters.violation_type) params.set("violation_type", filters.violation_type);
  if (filters.validation_status) params.set("validation_status", filters.validation_status);
  if (filters.limit) params.set("limit", filters.limit);
  const r = await fetch(`${BASE}/cv/violations?${params.toString()}`);
  if (!r.ok) throw new Error("cv violations failed");
  return r.json();
}

export async function submitFeedback(record) {
  const r = await fetch(`${BASE}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!r.ok) throw new Error("feedback submit failed");
  return r.json();
}

export async function validateCvViolation(id, status = "validated") {
  const r = await fetch(`${BASE}/cv/violations/${encodeURIComponent(id)}/validate?status=${status}`, {
    method: "POST",
  });
  if (!r.ok) throw new Error("validate failed");
  return r.json();
}