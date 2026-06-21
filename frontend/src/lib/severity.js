export function severityFor(count) {
  if (count >= 20) return { key: "critical", label: "Critical", color: "var(--gl-sev-critical)", fill: "var(--gl-sev-critical-fill)" };
  if (count >= 10) return { key: "high", label: "High", color: "var(--gl-sev-high)", fill: "var(--gl-sev-high-fill)" };
  if (count >= 5) return { key: "moderate", label: "Moderate", color: "var(--gl-sev-moderate)", fill: "var(--gl-sev-moderate-fill)" };
  return { key: "low", label: "Low", color: "var(--gl-sev-low)", fill: "var(--gl-sev-low-fill)" };
}

export const AQI_STOPS = [
  [0.00, [46, 139, 64]],
  [0.22, [124, 198, 50]],
  [0.42, [214, 222, 40]],
  [0.60, [245, 199, 41]],
  [0.78, [236, 120, 44]],
  [1.00, [197, 42, 45]],
];

export function aqiColor(t, a = 1) {
  t = Math.max(0, Math.min(1, t));
  let lo = AQI_STOPS[0], hi = AQI_STOPS[AQI_STOPS.length - 1];
  for (let i = 0; i < AQI_STOPS.length - 1; i++) {
    if (t >= AQI_STOPS[i][0] && t <= AQI_STOPS[i + 1][0]) { lo = AQI_STOPS[i]; hi = AQI_STOPS[i + 1]; break; }
  }
  const f = hi[0] === lo[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
  const c = [0, 1, 2].map((k) => Math.round(lo[1][k] + (hi[1][k] - lo[1][k]) * f));
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}

export const intensity = (count) => Math.min(1, Math.sqrt(count) / Math.sqrt(45));
export const aqiIndex = (count) => Math.max(1, Math.min(10, Math.round(intensity(count) * 9 + 1)));
export const LEGEND = "linear-gradient(90deg," + Array.from({ length: 11 }, (_, i) => aqiColor(i / 10)).join(",") + ")";