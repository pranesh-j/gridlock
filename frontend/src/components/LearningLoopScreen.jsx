import { useState, useEffect, useCallback } from "react";
import { BrainCircuit, Target, TrendingUp, Activity, Check, X, Inbox, Plus } from "lucide-react";
import { getFeedbackSummary, submitFeedback } from "../lib/api";
import { Card, StatCard, Badge, SeverityBadge, Button, Select } from "./ui";

function Field({ label, children }) {
  return (
    <div>
      <span style={{ display: "block", marginBottom: 6, fontSize: "var(--gl-text-xs)", fontWeight: 500, color: "var(--gl-text-3)" }}>{label}</span>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", background: "var(--gl-surface-3)", color: "var(--gl-text-1)",
  border: "1px solid var(--gl-border-strong)", borderRadius: "var(--gl-radius-md)",
  padding: "7px 10px", fontSize: 12.5, fontFamily: "var(--gl-font-sans)", outline: "none",
};

function LogOutcomeForm({ onLogged }) {
  const [f, setF] = useState({ event_id: "", corridor: "", predicted_severity: "High", actual_severity: "High", predicted_clearance_minutes: "", actual_clearance_minutes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    setBusy(true);
    try {
      await submitFeedback({
        event_id: f.event_id || ("EVT-" + Date.now()),
        corridor: f.corridor || null,
        predicted_severity: f.predicted_severity,
        actual_severity: f.actual_severity,
        predicted_clearance_minutes: f.predicted_clearance_minutes ? Number(f.predicted_clearance_minutes) : null,
        actual_clearance_minutes: f.actual_clearance_minutes ? Number(f.actual_clearance_minutes) : null,
      });
      setF((s) => ({ ...s, event_id: "", corridor: "", predicted_clearance_minutes: "", actual_clearance_minutes: "" }));
      onLogged();
    } catch (e) {
      console.error("feedback submit error:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding={18} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 15, fontWeight: 600, color: "var(--gl-text-1)" }}>Log an incident outcome</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Field label="Event ID"><input style={inputStyle} value={f.event_id} onChange={(e) => set("event_id")(e.target.value)} placeholder="optional" /></Field>
        <Field label="Corridor"><input style={inputStyle} value={f.corridor} onChange={(e) => set("corridor")(e.target.value)} placeholder="e.g. ORR East" /></Field>
        <Field label="Predicted severity"><Select value={f.predicted_severity} onChange={set("predicted_severity")} options={[{ value: "High", label: "High" }, { value: "Low", label: "Low" }]} /></Field>
        <Field label="Actual severity"><Select value={f.actual_severity} onChange={set("actual_severity")} options={[{ value: "High", label: "High" }, { value: "Low", label: "Low" }]} /></Field>
        <Field label="Predicted clearance (min)"><input style={inputStyle} type="number" value={f.predicted_clearance_minutes} onChange={(e) => set("predicted_clearance_minutes")(e.target.value)} /></Field>
        <Field label="Actual clearance (min)"><input style={inputStyle} type="number" value={f.actual_clearance_minutes} onChange={(e) => set("actual_clearance_minutes")(e.target.value)} /></Field>
      </div>
      <div>
        <Button variant="primary" size="sm" loading={busy} iconLeft={<Plus size={14} />} onClick={submit}>Log outcome</Button>
      </div>
    </Card>
  );
}

export default function LearningLoopScreen() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    getFeedbackSummary().then(setData).catch(() => setData(null)).finally(() => setLoaded(true));
  }, []);

  useEffect(() => { load(); }, [load]);

  const count = data?.count || 0;
  const hasData = count > 0;
  const sevAcc = data?.severity_accuracy;
  const mae = data?.clearance_mae_minutes;
  const recent = data?.recent || [];

  const fmtPct = (v) => (v != null ? Math.round(v * 100) + "%" : "—");
  const fmtMae = (v) => (v != null ? v : "—");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1040 }}>
      <Card padding={20} style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ width: 44, height: 44, flex: "none", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-primary-soft)", boxShadow: "inset 0 0 0 1px var(--gl-primary-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BrainCircuit size={22} style={{ color: "var(--gl-primary-hover)" }} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--gl-font-display)", fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)" }}>Post-incident learning</span>
            <Badge tone="info">Closed-loop</Badge>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--gl-text-2)", lineHeight: 1.55, maxWidth: 720 }}>
            When an incident closes, Gridlock logs the actual outcome against what it forecast and measures the error. Models are retrained on the accumulated, validated outcomes on a schedule — so accuracy here reflects real logged incidents.
          </p>
        </div>
        <Button variant={showForm ? "primary" : "secondary"} size="sm" iconLeft={<Plus size={14} />} onClick={() => setShowForm((s) => !s)}>Log outcome</Button>
      </Card>

      {showForm && <LogOutcomeForm onLogged={load} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <StatCard label="Incidents learned from" value={count.toLocaleString()} icon={<Target size={15} />} sub="closed + logged" />
        <StatCard label="Severity accuracy" value={fmtPct(sevAcc)} icon={<TrendingUp size={15} />} sub={hasData ? "logged outcomes" : "awaiting outcomes"} accent={hasData ? "var(--gl-sev-low)" : undefined} />
        <StatCard label="Clearance error" value={fmtMae(mae)} unit={mae != null ? "min" : ""} icon={<Activity size={15} />} sub="mean abs. error" />
      </div>

      <Card padding={0}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--gl-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 16, fontWeight: 600, color: "var(--gl-text-1)" }}>Recent outcomes</span>
          <span style={{ fontSize: 12, color: "var(--gl-text-3)" }}>predicted vs actual clearance</span>
        </div>

        {recent.length > 0 ? (
          <div style={{ padding: "4px 8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr 1fr 1fr 0.7fr", gap: 8, padding: "10px 12px", fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>
              <span>Incident</span><span>Corridor</span><span>Severity</span><span>Predicted</span><span>Actual</span><span>Match</span>
            </div>
            {recent.map((r) => (
              <div key={r.event_id} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.4fr 0.9fr 1fr 1fr 0.7fr", gap: 8, padding: "13px 12px", alignItems: "center", borderTop: "1px solid var(--gl-hairline)", fontSize: 13 }}>
                <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 12, color: "var(--gl-text-2)" }}>{r.event_id}</span>
                <span style={{ color: "var(--gl-text-1)", fontWeight: 500 }}>{r.corridor || "—"}</span>
                <span><SeverityBadge level={(r.severity || "moderate").toLowerCase()} size="sm" /></span>
                <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-2)" }}>{r.predicted_clearance_minutes != null ? r.predicted_clearance_minutes + " min" : "—"}</span>
                <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-1)", fontWeight: 600 }}>{r.actual_clearance_minutes != null ? r.actual_clearance_minutes + " min" : "—"}</span>
                <span style={{ display: "inline-flex" }}>
                  {r.within_threshold ? <Check size={16} style={{ color: "var(--gl-sev-low)" }} /> : <X size={16} style={{ color: "var(--gl-sev-critical)" }} />}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "48px 30px" }}>
            <div style={{ width: 48, height: 48, marginBottom: 14, borderRadius: "50%", background: "var(--gl-surface-inset)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Inbox size={22} style={{ color: "var(--gl-text-3)" }} />
            </div>
            <div style={{ fontSize: "var(--gl-text-body)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 6 }}>
              {loaded ? "No outcomes logged yet" : "Loading outcomes…"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--gl-text-3)", maxWidth: 360, lineHeight: 1.5 }}>
              Use “Log outcome” above as incidents close. Predicted-vs-actual accuracy appears here and feeds the next retraining cycle.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}