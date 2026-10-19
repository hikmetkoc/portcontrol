import { AlertTriangle, ChevronRight, Copy, Eraser, ScrollText, Search, X, XCircle } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatClock, formatRelative } from "../lib/format";
import { stackMeta } from "../lib/stacks";
import type { Problem, RunRecord } from "../state/runStore";
import { splitLogLine } from "../lib/severity";
import type { Project } from "../types";
import { StackBadge, StatusLed } from "./ui";

type SeverityFilter = "all" | "error" | "warn";

export function ProblemsView({
  problems,
  runs,
  projects,
  runFilter,
  onRunFilter,
  onShowInConsole,
  onClear,
}: {
  problems: Problem[];
  runs: RunRecord[];
  projects: Project[];
  runFilter: string | null;
  onRunFilter: (runId: string | null) => void;
  onShowInConsole: (problem: Problem) => void;
  onClear: (runId?: string) => void;
}) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  const runById = useMemo(() => new Map(runs.map((run) => [run.runId, run])), [runs]);
  const appStack = (problem: Problem) => {
    const project = projects.find((item) => item.id === problem.projectId);
    const appId = problem.appId.split(":")[0];
    return project?.apps.find((app) => app.id === appId)?.stack ?? "node";
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    return problems
      .filter((problem) => (runFilter ? problem.runId === runFilter : true))
      .filter((problem) => (severity === "all" ? true : problem.severity === severity))
      .filter((problem) =>
        needle
          ? `${problem.message} ${problem.detail.join(" ")} ${problem.label}`.toLocaleLowerCase("tr-TR").includes(needle)
          : true,
      )
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [problems, runFilter, severity, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Problem[]>();
    for (const problem of filtered) {
      const list = map.get(problem.runId) ?? [];
      list.push(problem);
      map.set(problem.runId, list);
    }
    return [...map.entries()].sort(
      (a, b) => (runById.get(b[0])?.startedAt ?? 0) - (runById.get(a[0])?.startedAt ?? 0),
    );
  }, [filtered, runById]);

  const errorTotal = problems.filter((problem) => problem.severity === "error").length;
  const warnTotal = problems.length - errorTotal;
  const filterRun = runFilter ? runById.get(runFilter) : null;

  async function copy(problem: Problem) {
    try {
      await navigator.clipboard.writeText([problem.message, ...problem.detail].join("\n"));
      setCopied(problem.id);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      // Pano erişimi yoksa yoksay.
    }
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="view problems-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">// TANILAMA</p>
          <h1 className="glitch" data-text="Sorunlar">
            Sorunlar
          </h1>
          <p className="view-subtitle">
            Konsoldaki hata ve uyarı satırları uygulama bazında toplanır; tekrarlar birleştirilir, stack trace'ler
            sorunun altında saklanır.
          </p>
        </div>
        <div className="view-actions">
          <span className="chip chip--red">{errorTotal} hata</span>
          <span className="chip chip--amber">{warnTotal} uyarı</span>
          <button
            type="button"
            className="neon-button neon-button--ghost neon-button--small"
            onClick={() => onClear(runFilter ?? undefined)}
            disabled={!filtered.length}
          >
            <Eraser size={13} />
            Temizle
          </button>
        </div>
      </header>

      <div className="problems-toolbar">
        <div className="segmented segmented--small">
          {(
            [
              ["all", "TÜMÜ"],
              ["error", "HATALAR"],
              ["warn", "UYARILAR"],
            ] as Array<[SeverityFilter, string]>
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={severity === value ? "is-active" : ""}
              onClick={() => setSeverity(value)}
              style={
                value === "error"
                  ? ({ "--kind": "var(--neon-red)" } as CSSProperties)
                  : value === "warn"
                    ? ({ "--kind": "var(--neon-amber)" } as CSSProperties)
                    : undefined
              }
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="problems-run-select"
          value={runFilter ?? ""}
          onChange={(event) => onRunFilter(event.target.value || null)}
          aria-label="Çalıştırma filtresi"
        >
          <option value="">Tüm çalıştırmalar</option>
          {runs
            .slice()
            .reverse()
            .map((run) => (
              <option key={run.runId} value={run.runId}>
                {run.label} · {formatClock(run.startedAt)} · {run.errorCount}/{run.warnCount}
              </option>
            ))}
        </select>
        {filterRun && (
          <button type="button" className="toggle-chip is-on" onClick={() => onRunFilter(null)}>
            {filterRun.label}
            <X size={12} />
          </button>
        )}
        <label className="search-field">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mesajda ara…" aria-label="Sorunlarda ara" />
        </label>
      </div>

      {groups.length === 0 ? (
        <div className="empty-panel glass">
          <div className="empty-orb" />
          <strong>{problems.length ? "Filtreye uyan sorun yok" : "Temiz sinyal"}</strong>
          <p>
            {problems.length
              ? "Filtreleri değiştirmeyi deneyin."
              : "Çalışan uygulamaların loglarında hata veya uyarı yakalandığında burada listelenir."}
          </p>
        </div>
      ) : (
        <div className="problem-groups">
          {groups.map(([runId, list]) => {
            const run = runById.get(runId);
            const stack = appStack(list[0]);
            return (
              <section
                key={runId}
                className="problem-group glass"
                style={{ "--stack": stackMeta(stack).color } as CSSProperties}
              >
                <header>
                  <StackBadge stack={stack} size="sm" />
                  <strong>{list[0].label}</strong>
                  {run && (
                    <>
                      <StatusLed state={run.status} />
                      <span>
                        {formatClock(run.startedAt)} başlatıldı · {formatRelative(run.startedAt)}
                        {run.activeProfile ? ` · profil: ${run.activeProfile}` : ""}
                      </span>
                    </>
                  )}
                  <span className="problem-group-count">
                    {list.filter((item) => item.severity === "error").length} hata ·{" "}
                    {list.filter((item) => item.severity === "warn").length} uyarı
                  </span>
                </header>
                <ul>
                  {list.map((problem) => {
                    const open = expanded.has(problem.id);
                    return (
                      <li key={problem.id} className={`problem problem--${problem.severity} ${open ? "is-open" : ""}`}>
                        <div className="problem-row">
                          <button
                            type="button"
                            className="problem-toggle"
                            onClick={() => toggle(problem.id)}
                            aria-label={open ? "Ayrıntıyı gizle" : "Ayrıntıyı göster"}
                          >
                            <ChevronRight size={13} />
                          </button>
                          {problem.severity === "error" ? <XCircle size={14} /> : <AlertTriangle size={14} />}
                          <code className="problem-message" title={problem.message}>
                            {splitLogLine(problem.message).message}
                            {splitLogLine(problem.message).logger && (
                              <span className="problem-logger"> · {splitLogLine(problem.message).logger}</span>
                            )}
                          </code>
                          {problem.count > 1 && <span className="problem-count">×{problem.count}</span>}
                          {problem.detail.length > 0 && <span className="problem-trace">{problem.detail.length} satır iz</span>}
                          <time>{formatClock(problem.lastAt)}</time>
                          <button
                            type="button"
                            className="icon-button icon-button--ghost"
                            onClick={() => void copy(problem)}
                            title="Kopyala"
                            aria-label="Kopyala"
                          >
                            {copied === problem.id ? "✓" : <Copy size={12} />}
                          </button>
                          <button
                            type="button"
                            className="neon-button neon-button--small neon-button--ghost"
                            onClick={() => onShowInConsole(problem)}
                          >
                            <ScrollText size={12} />
                            konsolda
                          </button>
                        </div>
                        {open && (
                          <pre className="problem-detail">{[problem.message, ...problem.detail].join("\n")}</pre>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
