import { useState, useEffect } from "react";
import { ScanLine, Inbox, ShieldQuestion, Image as ImageIcon } from "lucide-react";
import { getCvViolations } from "../lib/api";
import { Card, Badge, Select } from "./ui";

// violation_type is stored as a JSON array string, e.g. ["RIDING WITHOUT HELMET"]
function parseType(v) {
  if (!v || v === "NULL") return "—";
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.join(", ") : String(v);
  } catch {
    return String(v);
  }
}

function val(v) {
  return v && v !== "NULL" ? v : null;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString();
}

function StatusBadge({ status }) {
  const s = (status || "pending").toLowerCase();
  const tone = s === "validated" ? "primary" : "info";
  return <Badge tone={tone}>{s}</Badge>;
}

export default function DetectionsScreen() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setLoaded(false);
    getCvViolations({ status: status || undefined, validation_status: status || undefined, limit: 200 })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoaded(true));
  }, [status]);

  const rows = data?.violations || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1100 }}>
      <Card padding={20} style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ width: 44, height: 44, flex: "none", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-primary-soft)", boxShadow: "inset 0 0 0 1px var(--gl-primary-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ScanLine size={22} style={{ color: "var(--gl-primary-hover)" }} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--gl-font-display)", fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)" }}>Detected violations</span>
            <Badge tone="info">CV feed</Badge>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--gl-text-2)", lineHeight: 1.55, maxWidth: 760 }}>
            Violations the computer-vision pipeline detected from camera frames, each with annotated evidence and a confidence score. Auto-detected rows are <strong>pending review</strong> until an officer validates them.
          </p>
        </div>
        <div style={{ width: 170 }}>
          <Select label="Status" icon={<ShieldQuestion size={11} />} value={status} onChange={setStatus} placeholder="All statuses"
            options={[{ value: "pending", label: "Pending" }, { value: "validated", label: "Validated" }]} />
        </div>
      </Card>

      <Card padding={0}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--gl-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 16, fontWeight: 600, color: "var(--gl-text-1)" }}>Evidence records</span>
          <span style={{ fontSize: 12, color: "var(--gl-text-3)" }}>{rows.length ? rows.length + " shown" : ""}</span>
        </div>

        {rows.length > 0 ? (
          <div style={{ padding: "4px 8px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "64px 1.4fr 1fr 0.8fr 1.2fr 1.4fr 0.9fr", gap: 10, padding: "10px 12px", fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>
              <span>Evidence</span><span>Violation</span><span>Plate</span><span>Conf.</span><span>Station</span><span>Time</span><span>Status</span>
            </div>
            {rows.map((r) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: "64px 1.4fr 1fr 0.8fr 1.2fr 1.4fr 0.9fr", gap: 10, padding: "10px 12px", alignItems: "center", borderTop: "1px solid var(--gl-hairline)", fontSize: 13 }}>
                <span>
                  {val(r.evidence_image_path) ? (
                    <a href={r.evidence_image_path} target="_blank" rel="noreferrer">
                      <img src={r.evidence_image_path} alt="evidence" style={{ width: 56, height: 42, objectFit: "cover", borderRadius: "var(--gl-radius-sm)", boxShadow: "var(--gl-ring)" }} />
                    </a>
                  ) : (
                    <span style={{ width: 56, height: 42, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--gl-radius-sm)", background: "var(--gl-surface-inset)", color: "var(--gl-text-3)" }}><ImageIcon size={16} /></span>
                  )}
                </span>
                <span style={{ color: "var(--gl-text-1)", fontWeight: 500 }}>{parseType(r.violation_type)}</span>
                <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 12, color: "var(--gl-text-2)" }}>{val(r.vehicle_number) || "not read"}</span>
                <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-2)" }}>{r.detection_confidence != null ? Math.round(r.detection_confidence * 100) + "%" : "—"}</span>
                <span style={{ color: "var(--gl-text-2)" }}>{val(r.police_station) || "—"}</span>
                <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 11.5, color: "var(--gl-text-3)" }}>{fmtTime(val(r.created_datetime))}</span>
                <span><StatusBadge status={r.validation_status} /></span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "52px 30px" }}>
            <div style={{ width: 48, height: 48, marginBottom: 14, borderRadius: "50%", background: "var(--gl-surface-inset)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Inbox size={22} style={{ color: "var(--gl-text-3)" }} />
            </div>
            <div style={{ fontSize: "var(--gl-text-body)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 6 }}>
              {loaded ? "No detections yet" : "Loading detections…"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--gl-text-3)", maxWidth: 380, lineHeight: 1.5 }}>
              Run the detector on a clip (video_pipeline.py --emit) and seed Supabase (seed_supabase.py). Detected violations with evidence appear here.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}