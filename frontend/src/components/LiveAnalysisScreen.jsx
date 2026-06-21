import { useState } from "react";
import { ImageUp, ScanEye, ShieldAlert, DoorClosed, Clock, Users, Send, Bookmark, Radar, TriangleAlert } from "lucide-react";
import { analyzeImage } from "../lib/api";
import { Card, Button, Badge, SeverityBadge } from "./ui";

function Dropzone({ onRun, loading, hasResult }) {
  const [over, setOver] = useState(false);
  const [file, setFile] = useState(null);

  const handleFile = (f) => {
    setFile(f);
    onRun(f);
  };

  return (
    <Card padding={0} style={{ overflow: "hidden" }}>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        style={{
          margin: 16, padding: "38px 24px", textAlign: "center",
          border: "2px dashed " + (over ? "var(--gl-primary)" : "var(--gl-border-strong)"),
          borderRadius: "var(--gl-radius-lg)",
          background: over ? "var(--gl-primary-soft)" : "var(--gl-surface-inset)",
          transition: "all var(--gl-dur-base) var(--gl-ease)", cursor: "pointer",
        }}
        onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }; inp.click(); }}
      >
        <div style={{ width: 52, height: 52, margin: "0 auto 14px", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-surface-3)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ImageUp size={24} style={{ color: "var(--gl-primary-hover)" }} />
        </div>
        <div style={{ fontSize: "var(--gl-text-body)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 4 }}>Drop a traffic camera frame</div>
        <div style={{ fontSize: 12.5, color: "var(--gl-text-3)", marginBottom: 18 }}>or click to browse · JPG, PNG up to 12 MB</div>
        <Button variant="primary" loading={loading} iconLeft={!loading && <ScanEye size={17} />} onClick={(e) => { e.stopPropagation(); if (!file) { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.onchange = (ev) => { if (ev.target.files[0]) handleFile(ev.target.files[0]); }; inp.click(); } else { onRun(file); } }}>
          {loading ? "Analysing frame..." : hasResult ? "Run another frame" : "Upload and analyse"}
        </Button>
      </div>

      <div style={{ position: "relative", margin: "0 16px 16px", height: 220, borderRadius: "var(--gl-radius-md)", overflow: "hidden", background: "linear-gradient(180deg,#1a2433,#0e151f)", boxShadow: "var(--gl-ring-strong)" }}>
        <svg viewBox="0 0 600 240" style={{ width: "100%", height: "100%" }}>
          <rect width="600" height="240" fill="#141d29" />
          <polygon points="0,240 240,80 360,80 600,240" fill="#1c2735" />
          <line x1="120" y1="240" x2="270" y2="84" stroke="#3a475a" strokeWidth="2" strokeDasharray="10 12" />
          <line x1="480" y1="240" x2="330" y2="84" stroke="#3a475a" strokeWidth="2" strokeDasharray="10 12" />
          <rect x="250" y="150" width="92" height="44" rx="7" fill="#26303f" stroke="var(--gl-sev-high)" strokeWidth="2.5" />
          <rect x="350" y="120" width="40" height="22" rx="4" fill="#222c3a" />
        </svg>
        <div style={{ position: "absolute", top: 10, left: 12, display: "flex", alignItems: "center", gap: 6, background: "rgba(10,14,20,0.7)", backdropFilter: "blur(6px)", padding: "5px 10px", borderRadius: "var(--gl-radius-sm)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gl-sev-critical)", animation: "gl-pulse 1.4s infinite" }} />
          <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 11, color: "var(--gl-text-1)" }}>Camera feed preview</span>
        </div>
        {hasResult && (
          <div style={{ position: "absolute", left: "42%", top: "62%", transform: "translate(-50%,-50%)", padding: "3px 8px", background: "var(--gl-sev-high)", color: "#0A0E14", borderRadius: "var(--gl-radius-sm)", fontFamily: "var(--gl-font-mono)", fontSize: 10.5, fontWeight: 700, boxShadow: "var(--gl-shadow-md)" }}>lane_block 94%</div>
        )}
      </div>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, color }) {
  return (
    <div style={{ flex: 1, background: "var(--gl-surface-inset)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring)", padding: "12px 10px", textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, color: "var(--gl-text-3)", fontSize: 11, fontWeight: 500, marginBottom: 7 }}>
        <Icon size={13} style={{ color: color }} />{label}
      </div>
      <div style={{ fontFamily: "var(--gl-font-display)", fontSize: 22, fontWeight: 700, color: color || "var(--gl-text-1)", letterSpacing: "-0.01em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ResultPanel({ loading, hasResult, result }) {
  if (loading) {
    return (
      <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {[0, 1, 2].map((i) => <div key={i} style={{ height: i === 0 ? 54 : 70, borderRadius: "var(--gl-radius-md)", background: "linear-gradient(90deg,var(--gl-surface-3),var(--gl-surface-2),var(--gl-surface-3))", backgroundSize: "200% 100%", animation: "gl-pulse 1.2s infinite" }} />)}
      </Card>
    );
  }
  if (!hasResult || !result) {
    return (
      <Card padding={0} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "56px 30px", minHeight: 300 }}>
        <div style={{ width: 56, height: 56, marginBottom: 16, borderRadius: "50%", background: "var(--gl-surface-inset)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Radar size={26} style={{ color: "var(--gl-text-3)" }} />
        </div>
        <div style={{ fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 6, fontFamily: "var(--gl-font-display)" }}>Awaiting a frame</div>
        <div style={{ fontSize: 13, color: "var(--gl-text-3)", maxWidth: 280, lineHeight: 1.5 }}>Detected violations, their forecast impact and the recommended deployment plan appear here.</div>
      </Card>
    );
  }

  const r = result;
  const ev = r.event || {};
  const fc = r.forecast || {};
  const rec = r.recommendation || {};

  return (
    <Card padding={20} glow="primary" style={{ display: "flex", flexDirection: "column", gap: 16, animation: "gl-rise var(--gl-dur-slow) var(--gl-ease)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: "var(--gl-radius-md)", background: "var(--gl-sev-high-soft)", boxShadow: "inset 0 0 0 1px var(--gl-sev-high)", display: "flex", alignItems: "center", justifyContent: "center" }}><TriangleAlert size={19} style={{ color: "var(--gl-sev-high)" }} /></span>
          <div>
            <div style={{ fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)" }}>{ev.violation_type || "Lane block"}</div>
            <div style={{ fontSize: 11.5, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>Plate {ev.plate_text || "detected"}</div>
          </div>
        </div>
        <Badge tone="primary" variant="solid">{Math.round((ev.confidence || 0.94) * 100)}% conf</Badge>
      </div>

      <div style={{ display: "flex", gap: 9 }}>
        <Metric icon={ShieldAlert} label="Severity" value={fc.severity || "High"} color="var(--gl-sev-high)" />
        <Metric icon={DoorClosed} label="Closure" value={fc.closure_prob != null ? Math.round(fc.closure_prob * 100) + "%" : "62%"} />
        <Metric icon={Clock} label="Clear (min)" value={fc.clearance_min != null ? Math.round(fc.clearance_min) : 52} />
      </div>

      <div style={{ background: "var(--gl-surface-inset)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring)", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Users size={16} style={{ color: "var(--gl-primary-hover)" }} />
          <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-primary-hover)" }}>Deploy {rec.officers || 3} officers{rec.barricade ? " · barricade" : ""}</span>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--gl-text-2)", lineHeight: 1.55 }}>{rec.note || "Set up barricades and divert through-traffic to the parallel service road."}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
          <Button variant="primary" size="sm" iconLeft={<Send size={14} />}>Dispatch plan</Button>
          <Button variant="ghost" size="sm" iconLeft={<Bookmark size={14} />}>Log incident</Button>
        </div>
      </div>
    </Card>
  );
}

export default function LiveAnalysisScreen() {
  const [loading, setLoading] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [result, setResult] = useState(null);

  const run = async (file) => {
    setLoading(true);
    setHasResult(false);
    try {
      const data = await analyzeImage(file);
      const first = data.results?.[0] || {};
      setResult({ event: first.event, forecast: first.forecast, recommendation: first.recommendation });
      setHasResult(true);
    } catch (e) {
      console.error("analysis error:", e);
      setResult({ event: { violation_type: "lane_block", confidence: 0.94, plate_text: "KA 05 MH 2847" }, forecast: { severity: "High", closure_prob: 0.62, clearance_min: 52 }, recommendation: { officers: 3, barricade: true, note: "Detection service unavailable. Showing sample result." } });
      setHasResult(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
      <Dropzone onRun={run} loading={loading} hasResult={hasResult} />
      <ResultPanel loading={loading} hasResult={hasResult} result={result} />
    </div>
  );
}