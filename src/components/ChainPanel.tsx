import { Check, CircleDashed, Loader2, Rocket, SkipForward, X, XCircle, Zap } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { formatDuration } from "../lib/format";
import { StackBadge } from "./ui";

export type ChainStepStatus = "waiting" | "starting" | "ready" | "already" | "failed" | "skipped";

export interface ChainStep {
  appId: string;
  name: string;
  stack: string;
  status: ChainStepStatus;
  detail: string;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface ChainState {
  id: number;
  projectName: string;
  accent: string;
  steps: ChainStep[];
  done: boolean;
  startedAt: number;
}

const STATUS_LABEL: Record<ChainStepStatus, string> = {
  waiting: "SIRADA",
  starting: "BAŞLIYOR",
  ready: "HAZIR",
  already: "ZATEN AÇIK",
  failed: "BAŞARISIZ",
  skipped: "ATLANDI",
};

function StepIcon({ status }: { status: ChainStepStatus }) {
  switch (status) {
    case "starting":
      return <Loader2 size={13} className="spin" />;
    case "ready":
      return <Check size={13} />;
    case "already":
      return <Zap size={13} />;
    case "failed":
      return <XCircle size={13} />;
    case "skipped":
      return <SkipForward size={13} />;
    default:
      return <CircleDashed size={13} />;
  }
}

export function ChainPanel({ chain, onClose }: { chain: ChainState; onClose: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (chain.done) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [chain.done]);

  const finished = chain.steps.filter((step) => ["ready", "already"].includes(step.status)).length;
  const failed = chain.steps.some((step) => step.status === "failed");
  const progress = chain.steps.length ? finished / chain.steps.length : 0;

  return (
    <aside
      className={`chain-panel glass ${chain.done ? "is-done" : ""} ${failed ? "has-failure" : ""}`}
      style={{ "--accent": chain.accent } as CSSProperties}
      aria-live="polite"
    >
      <header>
        <Rocket size={15} />
        <div>
          <strong>FIRLATMA SEKANSI</strong>
          <span>
            {chain.projectName} · {finished}/{chain.steps.length}
            {chain.done ? (failed ? " · hata ile bitti" : " · tamamlandı") : ` · ${formatDuration(now - chain.startedAt)}`}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Paneli kapat">
          <X size={14} />
        </button>
      </header>
      <div className="chain-progress">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
      <ol>
        {chain.steps.map((step) => (
          <li key={step.appId} className={`chain-step chain-step--${step.status}`}>
            <span className="chain-icon">
              <StepIcon status={step.status} />
            </span>
            <StackBadge stack={step.stack} size="sm" />
            <div>
              <strong>{step.name}</strong>
              <span>{step.detail}</span>
            </div>
            <em>
              {STATUS_LABEL[step.status]}
              {step.startedAt && step.finishedAt && step.status === "ready"
                ? ` · ${formatDuration(step.finishedAt - step.startedAt)}`
                : ""}
            </em>
          </li>
        ))}
      </ol>
    </aside>
  );
}
