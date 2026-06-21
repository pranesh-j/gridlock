import { useState, useEffect } from "react";
import { BrainCircuit, Target, TrendingUp, Activity, Check, X } from "lucide-react";
import { getFeedbackSummary } from "../lib/api";
import { Card, StatCard, Badge, SeverityBadge } from "./ui";

export default function LearningLoopScreen() {
  const [data, setData] = useState(null);

  useEffect(() => {
    getFeedbackSummary().then(setData).catch(() => {});
  }, []);

  const L = data || {
    total_outcomes: 1284,
    severity_accuracy: 0.87,
    clearance_mae: 6.4,
    recent: [
      { event_id: "FK-20489", corridor: "ORR East 1", predicted_clearance: 52, actual_clearance: 47, severity: "High", within_threshold: true },
      { event_id: "FK-20488", corridor: "Tumkur Road", predicted_clearance: 34, actual_clearance: 41, severity: "Moderate", within_threshold: true },
      { event_id: "FK-20487", corridor: "Hosur Road", predicted_clearance: 61, actual_clearance: 58, severity: "High", within_threshold: true },
      { event_id: "FK-20486", corridor: "Sarjapur Road", predicted_clearance: 28, actual_clearance: 44, severity: "Moderate", within_threshold: false },
      { event_id: "FK-20485", corridor: "ORR West 2", predicted_clearance: 45, actual_clearance: 43, severity: "High", within_threshold: true },
    ],
  };

  const incidents = L.total_outcomes || 1284;
  const sevAcc = L.severity_accuracy || 0.87;
  const mae = L.clearance_mae || 6.4;
  const recent = L.recent || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
      <Card padding={20} style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ width: 44, height: 44, flex: "none", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-primary-soft)", boxShadow: "inset 0 0 0 1px var(--gl-primary-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BrainCircuit size={22} style={{ color: "var(--gl-primary-hover)" }} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--gl-font-display)", fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)" }}>Post-incident learning</span>
            <Badge tone="info">Forward-looking</Badge>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--gl-text-2)", lineHeight: 1.55, maxWidth: 720 }}>
            After every incident closes, Gridlock compares what it predicted against what actually happened and folds the error back into the forecast models. This panel previews that loop with sample outcomes.
          </p>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <StatCard label="Incidents learned from" value={incidents.toLocaleString()} icon={<Target size={15} />} sub="closed + logged" />
        <StatCard label="Severity accuracy" value={Math.round(sevAcc * 100) + "%"} icon={<TrendingUp size={15} />} delta="+3 pts" deltaTone="up" sub="last 200 incidents" accent="var(--gl-sev-low)" />
        <StatCard label="Clearance error" value={mae} unit="min" icon={<Activity size={15} />} delta="-1.2 min" deltaTone="up" sub="mean abs. error" />
      </div>

      <Card padding={0}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--gl-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 16, fontWeight: 600, color: "var(--gl-text-1)" }}>Recent outcomes</span>
          <span style={{ fontSize: 12, color: "var(--gl-text-3)" }}>predicted vs actual clearance</span>
        </div>
        <div style={{ padding: "4px 8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr 1fr 1fr 0.7fr", gap: 8, padding: "10px 12px", fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>
            <span>Incident</span><span>Corridor</span><span>Severity</span><span>Predicted</span><span>Actual</span><span>Match</span>
          </div>
          {recent.map((r) => (
            <div key={r.event_id || r.id} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr 1fr 1fr 0.7fr", gap: 8, padding: "13px 12px", alignItems: "center", borderTop: "1px solid var(--gl-hairline)", fontSize: 13 }}>
              <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 12, color: "var(--gl-text-2)" }}>{r.event_id || r.id}</span>
              <span style={{ color: "var(--gl-text-1)", fontWeight: 500 }}>{r.corridor}</span>
              <span><SeverityBadge level={(r.severity || r.sev || "moderate").toLowerCase()} size="sm" /></span>
              <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-2)" }}>{r.predicted_clearance || r.pred} min</span>
              <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-1)", fontWeight: 600 }}>{r.actual_clearance || r.actual} min</span>
              <span style={{ display: "inline-flex" }}>
                {(r.within_threshold ?? r.ok) ? <Check size={16} style={{ color: "var(--gl-sev-low)" }} /> : <X size={16} style={{ color: "var(--gl-sev-critical)" }} />}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}