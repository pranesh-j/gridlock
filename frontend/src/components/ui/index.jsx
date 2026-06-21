import React from "react";
import { severityFor } from "../../lib/severity";

export function Card({ children, padding = 16, glow, style, ...rest }) {
  return (
    <div style={{
      background: "var(--gl-surface-1)",
      borderRadius: "var(--gl-radius-lg)",
      boxShadow: glow ? `var(--gl-ring-strong), 0 0 20px ${glow === "primary" ? "rgba(16,185,129,0.08)" : "transparent"}` : "var(--gl-ring-strong)",
      padding: padding,
      ...style,
    }} {...rest}>{children}</div>
  );
}

export function Button({ children, variant = "primary", size = "md", loading, full, iconLeft, iconRight, onClick, style, ...rest }) {
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    fontFamily: "var(--gl-font-sans)", fontWeight: 600, cursor: loading ? "wait" : "pointer",
    borderRadius: "var(--gl-radius-md)", border: "none",
    transition: "all var(--gl-dur-fast) var(--gl-ease)",
    width: full ? "100%" : "auto",
    fontSize: size === "sm" ? 12.5 : 13.5,
    height: size === "sm" ? 34 : 40,
    padding: size === "sm" ? "0 14px" : "0 18px",
  };
  const variants = {
    primary: { background: "var(--gl-primary)", color: "#0A0E14" },
    secondary: { background: "var(--gl-surface-3)", color: "var(--gl-text-1)", boxShadow: "var(--gl-ring-strong)" },
    ghost: { background: "transparent", color: "var(--gl-text-2)" },
  };
  return (
    <button onClick={onClick} style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {loading && <span style={{ width: 14, height: 14, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "gl-pulse 0.8s linear infinite" }} />}
      {!loading && iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

export function IconButton({ icon, label, variant = "ghost", size = "md", onClick }) {
  const s = size === "sm" ? 30 : 36;
  const variants = {
    ghost: { background: "transparent", color: "var(--gl-text-3)", border: "none" },
    glass: { background: "rgba(15,21,32,0.85)", backdropFilter: "blur(8px)", color: "var(--gl-text-1)", border: "none", boxShadow: "var(--gl-ring-strong)" },
  };
  return (
    <button onClick={onClick} title={label} style={{
      width: s, height: s, display: "inline-flex", alignItems: "center", justifyContent: "center",
      borderRadius: "var(--gl-radius-md)", cursor: "pointer",
      transition: "all var(--gl-dur-fast) var(--gl-ease)",
      ...variants[variant],
    }}>{icon}</button>
  );
}

export function Badge({ children, tone = "primary", variant, dot }) {
  const tones = {
    primary: { bg: "var(--gl-primary-soft)", color: "var(--gl-primary-hover)", border: "var(--gl-primary-border)" },
    info: { bg: "rgba(56,152,236,0.12)", color: "#38A0EC", border: "rgba(56,152,236,0.22)" },
  };
  const t = tones[tone] || tones.primary;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: "var(--gl-radius-pill)",
      fontSize: 11.5, fontWeight: 600, letterSpacing: "0.01em",
      background: variant === "solid" ? t.color : t.bg,
      color: variant === "solid" ? "#0A0E14" : t.color,
      boxShadow: variant === "solid" ? "none" : "inset 0 0 0 1px " + t.border,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.color, boxShadow: "0 0 6px " + t.color }} />}
      {children}
    </span>
  );
}

export function SeverityBadge({ count, level, showCount, size = "md" }) {
  const s = level ? { key: level, label: level.charAt(0).toUpperCase() + level.slice(1), color: "var(--gl-sev-" + level + ")", fill: "var(--gl-sev-" + level + "-fill)" } : severityFor(count);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: size === "sm" ? "2px 8px" : "3px 10px",
      borderRadius: "var(--gl-radius-pill)",
      fontSize: size === "sm" ? 11 : 12,
      fontWeight: 600,
      background: s.fill,
      color: s.color,
      boxShadow: "inset 0 0 0 1px " + s.color + "33",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
      {showCount ? count : s.label}
    </span>
  );
}

export function StatCard({ label, value, unit, icon, delta, deltaTone, sub, accent, style }) {
  return (
    <Card style={{ padding: "16px 18px", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: "var(--gl-text-micro)", letterSpacing: "var(--gl-ls-eyebrow)", textTransform: "uppercase", color: "var(--gl-text-3)", fontWeight: 600 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: "var(--gl-radius-md)", background: "var(--gl-surface-inset)", boxShadow: "var(--gl-ring)", display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--gl-font-display)", fontSize: 28, fontWeight: 700, color: accent || "var(--gl-text-1)", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "var(--gl-text-3)" }}>{unit}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gl-text-3)" }}>
        {delta && <span style={{ color: deltaTone === "up" ? "var(--gl-sev-low)" : "var(--gl-sev-critical)", fontWeight: 600 }}>{delta}</span>}
        {sub}
      </div>
    </Card>
  );
}

export function Select({ label, icon, value, onChange, placeholder, options }) {
  return (
    <div>
      {label && (
        <span style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, fontSize: "var(--gl-text-xs)", fontWeight: 500, color: "var(--gl-text-3)" }}>
          {icon}{label}
        </span>
      )}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        width: "100%", background: "var(--gl-surface-3)", color: "var(--gl-text-1)",
        border: "1px solid var(--gl-border-strong)", borderRadius: "var(--gl-radius-md)",
        padding: "7px 10px", fontSize: 12.5, fontFamily: "var(--gl-font-sans)",
        cursor: "pointer", outline: "none",
      }}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function SegmentedControl({ options, value, onChange, full, size = "md" }) {
  return (
    <div style={{
      display: "flex", gap: 2, padding: 3,
      background: "var(--gl-surface-inset)", borderRadius: "var(--gl-radius-md)",
      boxShadow: "var(--gl-ring)", width: full ? "100%" : "auto",
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            flex: full ? 1 : "none",
            padding: size === "sm" ? "4px 10px" : "6px 14px",
            fontSize: size === "sm" ? 11.5 : 13,
            fontWeight: active ? 600 : 500,
            color: active ? "var(--gl-text-1)" : "var(--gl-text-3)",
            background: active ? "var(--gl-surface-3)" : "transparent",
            border: "none", borderRadius: "var(--gl-radius-sm)",
            cursor: "pointer", fontFamily: "var(--gl-font-sans)",
            boxShadow: active ? "var(--gl-ring-strong)" : "none",
            transition: "all var(--gl-dur-fast) var(--gl-ease)",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}