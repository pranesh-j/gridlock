import { useState, useEffect, useRef } from "react";
import { ImageUp, ScanEye, ShieldAlert, DoorClosed, Clock, Users, Send, Bookmark, Radar, TriangleAlert, CircleCheck, ServerCrash, Video, FileVideo, Loader } from "lucide-react";
import { analyzeImage, startVideoJob, getVideoJob, videoJobFileUrl } from "../lib/api";
import { Card, Button, Badge } from "./ui";

function prettyType(t) {
  return (t || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

function EmptyState({ icon: Icon, title, body, tone }) {
  return (
    <Card padding={0} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "56px 30px", minHeight: 300 }}>
      <div style={{ width: 56, height: 56, marginBottom: 16, borderRadius: "50%", background: "var(--gl-surface-inset)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={26} style={{ color: tone || "var(--gl-text-3)" }} />
      </div>
      <div style={{ fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 6, fontFamily: "var(--gl-font-display)" }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--gl-text-3)", maxWidth: 320, lineHeight: 1.5 }}>{body}</div>
    </Card>
  );
}

/* ---------------- image mode ---------------- */

function ImageDropzone({ onRun, loading, previewUrl }) {
  const [over, setOver] = useState(false);
  const [file, setFile] = useState(null);
  const handleFile = (f) => { setFile(f); onRun(f); };
  const pick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); };
    inp.click();
  };
  return (
    <Card padding={0} style={{ overflow: "hidden" }}>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={pick}
        style={{ margin: 16, padding: "38px 24px", textAlign: "center", border: "2px dashed " + (over ? "var(--gl-primary)" : "var(--gl-border-strong)"), borderRadius: "var(--gl-radius-lg)", background: over ? "var(--gl-primary-soft)" : "var(--gl-surface-inset)", transition: "all var(--gl-dur-base) var(--gl-ease)", cursor: "pointer" }}>
        <div style={{ width: 52, height: 52, margin: "0 auto 14px", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-surface-3)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ImageUp size={24} style={{ color: "var(--gl-primary-hover)" }} />
        </div>
        <div style={{ fontSize: "var(--gl-text-body)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 4 }}>Drop a traffic camera frame</div>
        <div style={{ fontSize: 12.5, color: "var(--gl-text-3)", marginBottom: 18 }}>or click to browse · JPG, PNG up to 12 MB</div>
        <Button variant="primary" loading={loading} iconLeft={!loading && <ScanEye size={17} />} onClick={(e) => { e.stopPropagation(); file ? onRun(file) : pick(); }}>
          {loading ? "Analysing frame..." : previewUrl ? "Run another frame" : "Upload and analyse"}
        </Button>
      </div>
      <div style={{ position: "relative", margin: "0 16px 16px", height: 220, borderRadius: "var(--gl-radius-md)", overflow: "hidden", background: "#0e151f", boxShadow: "var(--gl-ring-strong)" }}>
        {previewUrl ? <img src={previewUrl} alt="frame" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gl-text-3)", fontSize: 12 }}>Camera feed preview</div>}
      </div>
    </Card>
  );
}

function ImageResult({ loading, error, result }) {
  if (loading) return <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 14 }}>{[0, 1, 2].map((i) => <div key={i} style={{ height: i === 0 ? 54 : 70, borderRadius: "var(--gl-radius-md)", background: "var(--gl-surface-3)", animation: "gl-pulse 1.2s infinite" }} />)}</Card>;
  if (error) return <EmptyState icon={ServerCrash} tone="var(--gl-sev-high)" title="Detection unavailable" body={error} />;
  if (!result) return <EmptyState icon={Radar} title="Awaiting a frame" body="Detected violations, their forecast impact and the recommended deployment plan appear here." />;
  if (!result.event) return <EmptyState icon={CircleCheck} tone="var(--gl-sev-low)" title="No violations detected" body="The detector found no violations in this frame." />;
  const { event: ev, forecast: fc, recommendation: rec } = result;
  return (
    <Card padding={20} glow="primary" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: "var(--gl-radius-md)", background: "var(--gl-sev-high-soft)", boxShadow: "inset 0 0 0 1px var(--gl-sev-high)", display: "flex", alignItems: "center", justifyContent: "center" }}><TriangleAlert size={19} style={{ color: "var(--gl-sev-high)" }} /></span>
          <div>
            <div style={{ fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)" }}>{prettyType(ev.violation_type)}</div>
            <div style={{ fontSize: 11.5, color: "var(--gl-text-3)", fontFamily: "var(--gl-font-mono)" }}>Plate {ev.plate_text || "not read"}</div>
          </div>
        </div>
        <Badge tone="primary" variant="solid">{Math.round((ev.confidence || 0) * 100)}% conf</Badge>
      </div>
      {fc ? (
        <>
          <div style={{ display: "flex", gap: 9 }}>
            <Metric icon={ShieldAlert} label="Severity" value={fc.severity} color="var(--gl-sev-high)" />
            <Metric icon={DoorClosed} label="Closure" value={Math.round(fc.closure_probability * 100) + "%"} />
            <Metric icon={Clock} label="Clear (min)" value={Math.round(fc.expected_clearance_minutes)} />
          </div>
          {rec && (
            <div style={{ background: "var(--gl-surface-inset)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring)", padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Users size={16} style={{ color: "var(--gl-primary-hover)" }} />
                <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-primary-hover)" }}>Deploy {rec.officers} officer{rec.officers === 1 ? "" : "s"}{rec.barricade ? " · barricade" : ""}</span>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--gl-text-2)", lineHeight: 1.55 }}>{rec.diversion_note}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
                <Button variant="primary" size="sm" iconLeft={<Send size={14} />}>Dispatch plan</Button>
                <Button variant="ghost" size="sm" iconLeft={<Bookmark size={14} />}>Log incident</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ background: "var(--gl-surface-inset)", borderRadius: "var(--gl-radius-md)", boxShadow: "var(--gl-ring)", padding: 14, fontSize: 12.5, color: "var(--gl-text-3)", lineHeight: 1.55 }}>
          Impact forecast and deployment plan apply to lane-blocking incidents. This violation is logged as evidence for enforcement.
        </div>
      )}
    </Card>
  );
}

function ImageMode() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const run = async (file) => {
    setLoading(true); setError(null); setResult(null);
    setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    try {
      const data = await analyzeImage(file);
      const first = data.results?.[0];
      setResult(first ? { event: first.event, forecast: first.forecast, recommendation: first.recommendation } : { event: null });
    } catch (e) {
      console.error("analysis error:", e);
      setError("Could not reach the detection service. Start it locally or point DETECTION_URL at a running instance, then try again.");
    } finally { setLoading(false); }
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
      <ImageDropzone onRun={run} loading={loading} previewUrl={previewUrl} />
      <ImageResult loading={loading} error={error} result={result} />
    </div>
  );
}

/* ---------------- video mode ---------------- */

function VideoMode() {
  const [job, setJob] = useState(null);     // {job_id, status, percent, processed, total, violations, result, error}
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const start = async (file) => {
    setError(null); setStarting(true); setJob(null);
    try {
      const { job_id } = await startVideoJob(file, {});
      setJob({ job_id, status: "queued", percent: 0 });
      pollRef.current = setInterval(async () => {
        try {
          const s = await getVideoJob(job_id);
          setJob({ job_id, ...s });
          if (s.status === "done" || s.status === "error") clearInterval(pollRef.current);
        } catch (e) {
          clearInterval(pollRef.current);
          setError("Lost contact with the detection service during processing.");
        }
      }, 1000);
    } catch (e) {
      console.error("video start error:", e);
      setError("Could not start video analysis. Is the detection service running?");
    } finally { setStarting(false); }
  };

  const pick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "video/*";
    inp.onchange = (e) => { if (e.target.files[0]) start(e.target.files[0]); };
    inp.click();
  };

  const running = job && (job.status === "queued" || job.status === "running");
  const done = job && job.status === "done";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
      <Card padding={0} style={{ overflow: "hidden" }}>
        <div onClick={!running ? pick : undefined}
          style={{ margin: 16, padding: "38px 24px", textAlign: "center", border: "2px dashed var(--gl-border-strong)", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-surface-inset)", cursor: running ? "default" : "pointer" }}>
          <div style={{ width: 52, height: 52, margin: "0 auto 14px", borderRadius: "var(--gl-radius-lg)", background: "var(--gl-surface-3)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileVideo size={24} style={{ color: "var(--gl-primary-hover)" }} />
          </div>
          <div style={{ fontSize: "var(--gl-text-body)", fontWeight: 600, color: "var(--gl-text-1)", marginBottom: 4 }}>Drop a traffic video clip</div>
          <div style={{ fontSize: 12.5, color: "var(--gl-text-3)", marginBottom: 18 }}>MP4 / MOV · processed on the GPU detector</div>
          <Button variant="primary" loading={starting || running} iconLeft={!(starting || running) && <Video size={17} />} onClick={(e) => { e.stopPropagation(); if (!running) pick(); }}>
            {running ? "Processing…" : "Upload and analyse video"}
          </Button>
        </div>

        {running && (
          <div style={{ padding: "0 16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--gl-text-3)", marginBottom: 6 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Loader size={13} className="gl-spin" /> {job.status === "queued" ? "Queued…" : "Analysing frames"}</span>
              <span>{job.percent || 0}% · {job.violations || 0} found</span>
            </div>
            <div style={{ height: 8, borderRadius: 99, background: "var(--gl-surface-3)", overflow: "hidden" }}>
              <div style={{ width: (job.percent || 0) + "%", height: "100%", background: "var(--gl-primary)", transition: "width var(--gl-dur-base) var(--gl-ease)" }} />
            </div>
          </div>
        )}

        {done && (
          <div style={{ margin: "0 16px 16px", borderRadius: "var(--gl-radius-md)", overflow: "hidden", boxShadow: "var(--gl-ring-strong)", background: "#0e151f" }}>
            <video src={videoJobFileUrl(job.job_id)} controls style={{ width: "100%", display: "block" }} />
          </div>
        )}
      </Card>

      <VideoResult job={job} error={error} done={done} running={running} />
    </div>
  );
}

function VideoResult({ job, error, done, running }) {
  if (error) return <EmptyState icon={ServerCrash} tone="var(--gl-sev-high)" title="Video analysis failed" body={error} />;
  if (job && job.status === "error") return <EmptyState icon={ServerCrash} tone="var(--gl-sev-high)" title="Processing error" body={(job.error || "").slice(0, 240) || "The worker failed."} />;
  if (running) return <EmptyState icon={Loader} title="Processing video" body="Detecting violations frame by frame. Results and the annotated video appear here when done." />;
  if (!done) return <EmptyState icon={Radar} title="Awaiting a clip" body="Upload a traffic video. Gridlock annotates it and lists every violation it detects." />;

  const events = job.result?.events || [];
  const counts = job.result?.counts || {};
  return (
    <Card padding={20} glow="primary" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "var(--gl-text-h3)", fontWeight: 600, color: "var(--gl-text-1)", fontFamily: "var(--gl-font-display)" }}>{events.length} violation{events.length === 1 ? "" : "s"} detected</span>
        {job.result?.seeded && <Badge tone="primary">pushed to feed</Badge>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {Object.entries(counts).map(([k, v]) => <Badge key={k} tone="info">{prettyType(k)} · {v}</Badge>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
        {events.map((e) => (
          <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.7fr 0.7fr", gap: 8, alignItems: "center", padding: "9px 11px", borderRadius: "var(--gl-radius-sm)", background: "var(--gl-surface-inset)", fontSize: 12.5 }}>
            <span style={{ color: "var(--gl-text-1)", fontWeight: 500 }}>{prettyType(e.violation_type)}</span>
            <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 11.5, color: "var(--gl-text-2)" }}>{e.plate || "not read"}</span>
            <span style={{ fontFamily: "var(--gl-font-mono)", color: "var(--gl-text-2)" }}>{e.confidence != null ? Math.round(e.confidence * 100) + "%" : "—"}</span>
            <span style={{ fontFamily: "var(--gl-font-mono)", fontSize: 11, color: "var(--gl-text-3)" }}>f{e.source_frame}</span>
          </div>
        ))}
        {events.length === 0 && <div style={{ fontSize: 12.5, color: "var(--gl-text-3)", padding: "8px 2px" }}>No violations detected in this clip.</div>}
      </div>
    </Card>
  );
}

/* ---------------- shell with mode toggle ---------------- */

export default function LiveAnalysisScreen() {
  const [mode, setMode] = useState("image");
  const Tab = ({ id, icon: Icon, label }) => (
    <button onClick={() => setMode(id)}
      style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: "var(--gl-radius-md)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--gl-font-sans)", background: mode === id ? "var(--gl-primary)" : "var(--gl-surface-3)", color: mode === id ? "#fff" : "var(--gl-text-2)" }}>
      <Icon size={15} /> {label}
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Tab id="image" icon={ScanEye} label="Image" />
        <Tab id="video" icon={Video} label="Video" />
      </div>
      {mode === "image" ? <ImageMode /> : <VideoMode />}
    </div>
  );
}