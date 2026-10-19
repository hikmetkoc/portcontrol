import type { CSSProperties, ReactNode } from "react";
import { stackMeta } from "../lib/stacks";
import type { RunStatus } from "../types";

export function StackBadge({
  stack,
  size = "md",
}: {
  stack: string;
  size?: "sm" | "md" | "lg";
}) {
  const meta = stackMeta(stack);
  return (
    <span
      className={`stack-badge stack-badge--${size}`}
      style={{ "--stack": meta.color } as CSSProperties}
      title={meta.label}
      aria-hidden="true"
    >
      <span>{meta.glyph}</span>
    </span>
  );
}

export type LedState = RunStatus | "idle" | "external" | "starting";

export function StatusLed({ state, title }: { state: LedState; title?: string }) {
  return <span className={`led led--${state}`} title={title} aria-hidden="true" />;
}

export function statusLabel(state: LedState): string {
  switch (state) {
    case "running":
      return "ÇALIŞIYOR";
    case "starting":
      return "BAŞLIYOR";
    case "failed":
      return "ÇÖKTÜ";
    case "stopped":
      return "DURDURULDU";
    case "exited":
      return "TAMAMLANDI";
    case "external":
      return "HARİCİ";
    default:
      return "BEKLEMEDE";
  }
}

export function Sparkline({
  values,
  color = "var(--neon-cyan)",
  width = 120,
  height = 30,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <svg className="sparkline sparkline--empty" width={width} height={height} />;
  }
  const max = Math.max(...values, 1e-6);
  const min = Math.min(...values);
  const range = max - min || max || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 3 - ((value - min) / range) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const id = `spark-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={`url(#${id})`} />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.6" />
      <circle
        cx={points[points.length - 1].split(",")[0]}
        cy={points[points.length - 1].split(",")[1]}
        r="2.4"
        fill={color}
      />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Chip({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "cyan" | "magenta" | "lime" | "amber" | "red" | "violet";
  title?: string;
}) {
  return (
    <span className={`chip chip--${tone}`} title={title}>
      {children}
    </span>
  );
}
