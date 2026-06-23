import { useState } from "react";
import { LayoutDashboard, ScanEye, Map, BrainCircuit, PanelLeft, ScanLine } from "lucide-react";
import OverviewScreen from "./components/OverviewScreen";
import LiveAnalysisScreen from "./components/LiveAnalysisScreen";
import RiskMapScreen from "./components/RiskMapScreen";
import LearningLoopScreen from "./components/LearningLoopScreen";
import DetectionsScreen from "./components/DetectionsScreen";

const NAV = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "analyze", label: "Live Analysis", Icon: ScanEye },
  { id: "detections", label: "Detections", Icon: ScanLine },
  { id: "map", label: "Risk Map", Icon: Map },
  { id: "learn", label: "Learning Loop", Icon: BrainCircuit },
];

const META = {
  overview: { title: "Overview", sub: "Bengaluru Traffic Police · live operations" },
  analyze: { title: "Live Analysis", sub: "Detect violations from a camera frame" },
  detections: { title: "Detections", sub: "Machine-detected violations with evidence" },
  map: { title: "Risk Map", sub: "Parking-violation density across the city" },
  learn: { title: "Learning Loop", sub: "Post-incident forecast accuracy" },
};

function Sidebar({ tab, setTab, collapsed }) {
  return (
    <aside style={{
      width: collapsed ? 68 : "var(--gl-rail-w)", flex: "none",
      background: "var(--gl-surface-1)", borderRight: "1px solid var(--gl-border)",
      display: "flex", flexDirection: "column",
      transition: "width var(--gl-dur-slow) var(--gl-ease)", zIndex: 5,
    }}>
      <div style={{ height: "var(--gl-header-h)", display: "flex", alignItems: "center", gap: 11, padding: "0 18px", borderBottom: "1px solid var(--gl-border)" }}>
        <span style={{ width: 34, height: 34, flex: "none", borderRadius: "var(--gl-radius-md)", background: "var(--gl-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 16, color: "#0A0E14" }}>G</span>
        {!collapsed && (
          <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <span style={{ fontFamily: "var(--gl-font-display)", fontWeight: 700, fontSize: 17, color: "var(--gl-text-1)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>Gridlock</span>
            <span style={{ fontSize: 10.5, color: "var(--gl-text-3)", letterSpacing: "0.02em" }}>Traffic Intelligence</span>
          </div>
        )}
      </div>

      <nav style={{ padding: "14px 12px", display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {!collapsed && <span style={{ fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600, padding: "6px 12px 4px" }}>Operations</span>}
        {NAV.map((n) => {
          const active = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} title={n.label}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: collapsed ? "0" : "0 12px", height: 42,
                justifyContent: collapsed ? "center" : "flex-start",
                background: active ? "var(--gl-primary-soft)" : "transparent",
                boxShadow: active ? "inset 0 0 0 1px var(--gl-primary-border)" : "none",
                color: active ? "var(--gl-primary-hover)" : "var(--gl-text-2)",
                border: "none", borderRadius: "var(--gl-radius-md)", cursor: "pointer",
                fontFamily: "var(--gl-font-sans)", fontSize: "var(--gl-text-sm)", fontWeight: active ? 600 : 500,
                letterSpacing: "var(--gl-ls-snug)", whiteSpace: "nowrap",
                transition: "background var(--gl-dur-fast) var(--gl-ease), color var(--gl-dur-fast) var(--gl-ease)",
                position: "relative",
              }}>
              {active && !collapsed && <span style={{ position: "absolute", left: -12, top: 11, bottom: 11, width: 3, borderRadius: 3, background: "var(--gl-primary)" }} />}
              <n.Icon size={19} />
              {!collapsed && n.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: 12, borderTop: "1px solid var(--gl-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: collapsed ? 0 : "8px 10px", justifyContent: collapsed ? "center" : "flex-start" }}>
          <span style={{ width: 32, height: 32, flex: "none", borderRadius: "50%", background: "linear-gradient(135deg,#1C2735,#2E3B4D)", boxShadow: "var(--gl-ring-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--gl-font-mono)", fontSize: 12, fontWeight: 600, color: "var(--gl-text-1)" }}>RB</span>
          {!collapsed && (
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <span style={{ fontSize: "var(--gl-text-sm)", fontWeight: 600, color: "var(--gl-text-1)" }}>Control Room</span>
              <span style={{ fontSize: 11, color: "var(--gl-text-3)" }}>BTP · Shift A</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function Topbar({ title, sub, onToggle }) {
  return (
    <header style={{
      height: "var(--gl-header-h)", flex: "none",
      borderBottom: "1px solid var(--gl-border)",
      background: "rgba(10,14,20,0.72)", backdropFilter: "blur(10px)",
      display: "flex", alignItems: "center", gap: 16, padding: "0 22px",
      position: "sticky", top: 0, zIndex: 4,
    }}>
      <button onClick={onToggle} title="Toggle nav" style={{ display: "inline-flex", padding: 8, background: "transparent", border: "none", color: "var(--gl-text-3)", cursor: "pointer", borderRadius: "var(--gl-radius-sm)", marginLeft: -8 }}>
        <PanelLeft size={18} />
      </button>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--gl-font-display)", fontSize: "var(--gl-text-h2)", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--gl-text-1)", lineHeight: 1.1 }}>{title}</h1>
        {sub && <span style={{ fontSize: 12, color: "var(--gl-text-3)" }}>{sub}</span>}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 12px", background: "var(--gl-primary-soft)", boxShadow: "inset 0 0 0 1px var(--gl-primary-border)", borderRadius: "var(--gl-radius-pill)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gl-primary)", boxShadow: "0 0 8px var(--gl-primary)", animation: "gl-pulse 2s var(--gl-ease-inout) infinite" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--gl-primary-hover)", letterSpacing: "0.01em" }}>Live</span>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [tab, setTab] = useState("overview");
  const [collapsed, setCollapsed] = useState(false);
  const meta = META[tab];

  let screen = null;
  if (tab === "overview") screen = <OverviewScreen onNav={setTab} />;
  else if (tab === "analyze") screen = <LiveAnalysisScreen />;
  else if (tab === "detections") screen = <DetectionsScreen />;
  else if (tab === "map") screen = <RiskMapScreen />;
  else if (tab === "learn") screen = <LearningLoopScreen />;

  const fullBleed = tab === "map";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar tab={tab} setTab={setTab} collapsed={collapsed} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar title={meta.title} sub={meta.sub} onToggle={() => setCollapsed(!collapsed)} />
        <main style={{ flex: 1, overflow: fullBleed ? "hidden" : "auto", padding: fullBleed ? 18 : "22px 24px 32px", background: "var(--gl-bg)" }}>
          <div key={tab} style={{ height: fullBleed ? "100%" : "auto", maxWidth: fullBleed ? "none" : "var(--gl-content-max)", margin: "0 auto" }}>
            {screen}
          </div>
        </main>
      </div>
    </div>
  );
}