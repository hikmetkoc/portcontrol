import {
  AlertTriangle,
  ArrowRight,
  Code2,
  Database,
  GitBranch,
  HeartPulse,
  QrCode,
  Settings2,
  ShieldCheck,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  MemoryStick,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rocket,
  ScrollText,
  Square,
  Timer,
  Trash2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { checkPort, findFreePort } from "../api";
import type { MetricSample } from "../hooks/usePortScan";
import { formatBytes, formatCpu, formatDuration, formatRelative } from "../lib/format";
import { maskValue, portStrategyLabel, resolveLaunch } from "../lib/launch";
import { isActive, type AppRuntime } from "../lib/runtime";
import { KIND_META, stackMeta } from "../lib/stacks";
import type { AppKind, AppSettings, PortCheck, ProcessPortGroup, Project } from "../types";
import { Chip, Sparkline, StackBadge, StatusLed, statusLabel } from "./ui";

const KIND_ORDER: AppKind[] = ["infra", "backend", "fullstack", "frontend", "desktop"];

export interface ProjectViewHandlers {
  onStart: (runtime: AppRuntime) => void;
  onStop: (runtime: AppRuntime) => void;
  onRestart: (runtime: AppRuntime) => void;
  onInstall: (runtime: AppRuntime) => void;
  onRunScript: (runtime: AppRuntime, script: string) => void;
  onUpdateSettings: (project: Project, appId: string, patch: Partial<AppSettings>) => void;
  onRescan: (project: Project) => void;
  onStartAll: (project: Project) => void;
  onStopAll: (project: Project) => void;
  onRemove: (project: Project) => void;
  onRename: (project: Project, name: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenEditor: (path: string) => void;
  onShowLogs: (runId: string, seq?: number | null) => void;
  onOpenUrl: (url: string) => void;
  onStopExternal: (process: ProcessPortGroup) => void;
  onStartChain: (runtime: AppRuntime) => void;
  onConfigure: (runtime: AppRuntime, tab?: "env" | "files" | "deps") => void;
  onShowQr: (runtime: AppRuntime) => void;
}

export function ProjectView({
  project,
  runtimes,
  history,
  rescanning,
  scanStamp,
  handlers,
}: {
  project: Project;
  runtimes: AppRuntime[];
  history: Map<string, MetricSample[]>;
  rescanning: boolean;
  scanStamp: number;
  handlers: ProjectViewHandlers;
}) {
  const [kindFilter, setKindFilter] = useState<AppKind | "all">("all");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setKindFilter("all");
    setRenaming(false);
    setConfirmRemove(false);
    setDraftName(project.name);
  }, [project.id, project.name]);

  const siblings = useMemo(
    () => new Map(runtimes.map((runtime) => [runtime.app.id, runtime])),
    [runtimes],
  );
  const kinds = KIND_ORDER.filter((kind) => runtimes.some((runtime) => runtime.app.kind === kind));
  const visible = kindFilter === "all" ? runtimes : runtimes.filter((runtime) => runtime.app.kind === kindFilter);
  const running = runtimes.filter((runtime) => isActive(runtime.state)).length;
  const external = runtimes.filter((runtime) => runtime.state === "external").length;
  const failed = runtimes.filter((runtime) => runtime.state === "failed").length;

  return (
    <section className="view project-view" style={{ "--accent": project.accent } as CSSProperties}>
      <header className="view-header project-header">
        <div className="project-title-block">
          <p className="eyebrow">// PROJE · {project.apps.length} UYGULAMA</p>
          {renaming ? (
            <form
              className="rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                handlers.onRename(project, draftName);
                setRenaming(false);
              }}
            >
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={() => {
                  handlers.onRename(project, draftName);
                  setRenaming(false);
                }}
                aria-label="Proje adı"
              />
            </form>
          ) : (
            <h1 onDoubleClick={() => setRenaming(true)} title="Yeniden adlandırmak için çift tıklayın">
              <span className="project-accent-dot" />
              {project.name}
              <button type="button" className="icon-button icon-button--ghost" onClick={() => setRenaming(true)} aria-label="Yeniden adlandır">
                <Pencil size={13} />
              </button>
            </h1>
          )}
          <p className="project-path">
            <code>{project.path}</code>
            <span>· {formatRelative(project.lastScannedAt)} tarandı</span>
          </p>
          <div className="project-chips">
            <Chip tone="cyan">{running} çalışıyor</Chip>
            {external > 0 && <Chip tone="amber">{external} harici</Chip>}
            {failed > 0 && <Chip tone="red">{failed} çöktü</Chip>}
            <Chip>{project.apps.length - running - external} beklemede</Chip>
          </div>
        </div>
        <div className="view-actions project-actions">
          <button type="button" className="neon-button" onClick={() => handlers.onStartAll(project)} disabled={!project.apps.length}>
            <Rocket size={15} />
            Tümünü başlat
          </button>
          <button
            type="button"
            className="neon-button neon-button--ghost"
            onClick={() => handlers.onStopAll(project)}
            disabled={!running}
          >
            <Square size={13} />
            Tümünü durdur
          </button>
          <div className="action-cluster">
            <button type="button" className="icon-button" onClick={() => handlers.onRescan(project)} title="Klasörü yeniden tara" aria-label="Yeniden tara">
              <RefreshCw size={15} className={rescanning ? "spin" : ""} />
            </button>
            <button type="button" className="icon-button" onClick={() => handlers.onOpenFolder(project.path)} title="Klasörü aç" aria-label="Klasörü aç">
              <FolderOpen size={15} />
            </button>
            <button type="button" className="icon-button" onClick={() => handlers.onOpenEditor(project.path)} title="Editörde aç" aria-label="Editörde aç">
              <Code2 size={15} />
            </button>
            {confirmRemove ? (
              <span className="confirm-inline">
                Kaldırılsın mı?
                <button type="button" className="danger-text" onClick={() => handlers.onRemove(project)}>
                  Evet
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)}>
                  Hayır
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="icon-button icon-button--danger"
                onClick={() => setConfirmRemove(true)}
                title="Projeyi listeden kaldır (dosyalar silinmez)"
                aria-label="Projeyi kaldır"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      </header>

      {runtimes.length > 0 && <TopologyMap runtimes={runtimes} />}

      {kinds.length > 1 && (
        <div className="segmented kind-tabs" role="tablist">
          <button type="button" className={kindFilter === "all" ? "is-active" : ""} onClick={() => setKindFilter("all")}>
            TÜMÜ <span>{runtimes.length}</span>
          </button>
          {kinds.map((kind) => (
            <button
              type="button"
              key={kind}
              className={kindFilter === kind ? "is-active" : ""}
              onClick={() => setKindFilter(kind)}
              style={{ "--kind": KIND_META[kind].color } as CSSProperties}
            >
              {KIND_META[kind].label}
              <span>{runtimes.filter((runtime) => runtime.app.kind === kind).length}</span>
            </button>
          ))}
        </div>
      )}

      {runtimes.length === 0 ? (
        <div className="empty-panel glass">
          <div className="empty-orb" />
          <strong>Çalıştırılabilir uygulama bulunamadı</strong>
          <p>
            Klasörde package.json, pom.xml, *.csproj, manage.py, go.mod, Cargo.toml veya docker-compose.yml gibi bir
            manifest bulunamadı. Klasörü değiştirip yeniden tarayabilirsiniz.
          </p>
          <button type="button" className="neon-button" onClick={() => handlers.onRescan(project)}>
            <RefreshCw size={14} />
            Yeniden tara
          </button>
        </div>
      ) : (
        <div className="app-grid">
          {visible.map((runtime) => (
            <AppCard
              key={runtime.key}
              runtime={runtime}
              siblings={siblings}
              settings={project.settings[runtime.app.id]}
              samples={runtime.run ? (history.get(runtime.run.runId) ?? []) : []}
              scanStamp={scanStamp}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface TopologyEdge {
  id: string;
  d: string;
  live: boolean;
  mismatch: boolean;
  external: boolean;
}

function TopologyMap({ runtimes }: { runtimes: AppRuntime[] }) {
  const lanes = KIND_ORDER.map((kind) => ({
    kind,
    items: runtimes.filter((runtime) => runtime.app.kind === kind),
  })).filter((lane) => lane.items.length);
  const externals = useMemo(() => {
    const map = new Map<number, { port: number; label: string; kind: string }>();
    for (const runtime of runtimes) {
      for (const item of runtime.dependencies.external) {
        if (!map.has(item.port)) map.set(item.port, { port: item.port, label: item.label, kind: item.kind });
      }
    }
    return [...map.values()];
  }, [runtimes]);
  const lanesRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const signature = runtimes
    .map(
      (runtime) =>
        `${runtime.app.id}:${runtime.state}:${runtime.dependencies.internal.map((item) => `${item.appId}${item.portMismatch ? "!" : ""}`).join(",")}:${runtime.dependencies.external.map((item) => item.port).join(",")}`,
    )
    .join("|");

  useLayoutEffect(() => {
    const element = lanesRef.current;
    if (!element) return;
    const compute = () => {
      const box = element.getBoundingClientRect();
      const nodes = new Map<string, DOMRect>();
      element.querySelectorAll<HTMLElement>("[data-node]").forEach((node) => {
        nodes.set(node.dataset.node!, node.getBoundingClientRect());
      });
      const curve = (from: DOMRect, to: DOMRect) => {
        const leftward = to.left + to.width / 2 < from.left + from.width / 2;
        const x1 = (leftward ? from.left : from.right) - box.left;
        const y1 = from.top + from.height / 2 - box.top;
        const x2 = (leftward ? to.right : to.left) - box.left;
        const y2 = to.top + to.height / 2 - box.top;
        const bend = Math.max(28, Math.abs(x2 - x1) / 2) * (leftward ? -1 : 1);
        return `M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + bend).toFixed(1)},${y1.toFixed(1)} ${(x2 - bend).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
      };
      const next: TopologyEdge[] = [];
      for (const runtime of runtimes) {
        const from = nodes.get(runtime.app.id);
        if (!from) continue;
        for (const dependency of runtime.dependencies.internal) {
          const to = nodes.get(dependency.appId);
          const target = runtimes.find((item) => item.app.id === dependency.appId);
          if (!to || !target) continue;
          next.push({
            id: `${runtime.app.id}->${dependency.appId}`,
            d: curve(from, to),
            live: isActive(runtime.state) && (isActive(target.state) || target.state === "external"),
            mismatch: dependency.portMismatch,
            external: false,
          });
        }
        for (const dependency of runtime.dependencies.external) {
          const to = nodes.get(`ext:${dependency.port}`);
          if (!to) continue;
          next.push({
            id: `${runtime.app.id}->ext:${dependency.port}`,
            d: curve(from, to),
            live: isActive(runtime.state),
            mismatch: false,
            external: true,
          });
        }
      }
      setEdges(next);
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(element);
    return () => observer.disconnect();
  }, [signature]);

  return (
    <div className="topology glass" aria-label="Sistem haritası">
      <span className="topology-title">
        SİSTEM HARİTASI
        <span className="topology-legend">
          <i className="legend-live" /> canlı bağlantı <i className="legend-idle" /> bağımlılık{" "}
          <i className="legend-mismatch" /> port uyuşmazlığı
        </span>
      </span>
      <div className="topology-lanes" ref={lanesRef}>
        <svg className="topology-edges" aria-hidden="true">
          <defs>
            <marker id="topology-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((edge) => (
            <path
              key={edge.id}
              d={edge.d}
              className={`topology-edge ${edge.live ? "is-live" : ""} ${edge.mismatch ? "is-mismatch" : ""} ${edge.external ? "is-external" : ""}`}
              markerEnd="url(#topology-arrow)"
            />
          ))}
        </svg>
        {externals.length > 0 && (
          <div className="topology-lane topology-lane--external" style={{ "--kind": "var(--neon-amber)" } as CSSProperties}>
            <span className="lane-label">HARİCİ</span>
            {externals.map((item) => (
              <div key={item.port} data-node={`ext:${item.port}`} className="topology-node topology-node--ext">
                <Database size={12} />
                <span className="node-name">{item.label}</span>
                <code>:{item.port}</code>
              </div>
            ))}
          </div>
        )}
        {lanes.map((lane) => (
          <div className="topology-lane" key={lane.kind} style={{ "--kind": KIND_META[lane.kind].color } as CSSProperties}>
            <span className="lane-label">{KIND_META[lane.kind].label}</span>
            {lane.items.map((runtime) => (
              <div
                key={runtime.key}
                data-node={runtime.app.id}
                className={`topology-node topology-node--${runtime.state}`}
                title={
                  runtime.dependencies.internal.length
                    ? `Bağımlı: ${runtime.dependencies.internal.map((item) => runtimes.find((other) => other.app.id === item.appId)?.app.name ?? item.appId).join(", ")}`
                    : undefined
                }
              >
                <StatusLed state={runtime.state} />
                <span className="node-name">{runtime.app.name}</span>
                {runtime.displayPort && <code>:{runtime.displayPort}</code>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AppCard({
  runtime,
  siblings,
  settings,
  samples,
  scanStamp,
  handlers,
}: {
  runtime: AppRuntime;
  siblings: Map<string, AppRuntime>;
  settings: AppSettings | undefined;
  samples: MetricSample[];
  scanStamp: number;
  handlers: ProjectViewHandlers;
}) {
  const { app, project, run, state } = runtime;
  const meta = stackMeta(app.stack);
  const kind = KIND_META[app.kind];
  const launch = resolveLaunch(app, settings);
  const active = isActive(state);
  const [editingCommand, setEditingCommand] = useState(false);
  const [commandDraft, setCommandDraft] = useState(launch.command);
  const [portDraft, setPortDraft] = useState(settings?.customPort?.toString() ?? "");
  const [portCheck, setPortCheck] = useState<PortCheck | null>(null);
  const [finding, setFinding] = useState(false);
  const [now, setNow] = useState(Date.now());
  const customMode = settings?.portMode === "custom";
  const installing = runtime.installRun?.status === "running";
  const activeProfile = runtime.settings.envProfiles.find((profile) => profile.id === runtime.settings.activeProfileId);
  const pendingDependencies = runtime.dependencies.internal
    .map((dependency) => siblings.get(dependency.appId))
    .filter((target): target is AppRuntime => Boolean(target) && !isActive(target!.state) && target!.state !== "external")
    .map((target) => target.app.name);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    setPortDraft(settings?.customPort?.toString() ?? "");
  }, [settings?.customPort]);

  // Başlatmadan önce hedef portun boş olup olmadığını kontrol et.
  useEffect(() => {
    if (active || launch.port === null) {
      setPortCheck(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkPort(launch.port!).then((result) => {
        if (!cancelled) setPortCheck(result);
      }).catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, launch.port, scanStamp]);

  const scripts = app.scripts;
  const scriptName = launch.script?.name ?? app.defaultScript;
  const uptime = run && active ? now - run.startedAt : 0;

  async function suggestPort() {
    setFinding(true);
    try {
      const port = await findFreePort((launch.port ?? app.defaultPort ?? 3000) + 1);
      if (port) {
        handlers.onUpdateSettings(project, app.id, { portMode: "custom", customPort: port });
      }
    } finally {
      setFinding(false);
    }
  }

  function commitPort(value: string) {
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      handlers.onUpdateSettings(project, app.id, { portMode: "custom", customPort: port });
    }
  }

  return (
    <article
      className={`app-card glass app-card--${state}`}
      style={{ "--stack": meta.color, "--kind": kind.color } as CSSProperties}
    >
      <div className="app-card-glow" />
      <header className="app-head">
        <StackBadge stack={app.stack} size="lg" />
        <div className="app-title">
          <h3>{app.name}</h3>
          <code>{app.relativePath === "." ? "./" : `./${app.relativePath}`}</code>
        </div>
        <div className="app-status">
          <span className="kind-tag">{kind.label}</span>
          <span className={`state-tag state-tag--${state}`}>
            <StatusLed state={state} />
            {statusLabel(state)}
          </span>
        </div>
      </header>

      <div className="app-meta">
        <span>{app.framework}</span>
        {app.language && <span>{app.language}</span>}
        {app.packageManager && <span>{app.packageManager}</span>}
        {activeProfile && (
          <button type="button" className="meta-profile" onClick={() => handlers.onConfigure(runtime, "env")} title="Ortam profili">
            profil: {activeProfile.name}
          </button>
        )}
        {runtime.settings.frameworkProfile && (
          <button type="button" className="meta-profile" onClick={() => handlers.onConfigure(runtime, "env")} title={app.profileEnv ?? ""}>
            {app.stack === "dotnet" ? "env" : "profil"}: {runtime.settings.frameworkProfile}
          </button>
        )}
        {runtime.settings.autoRestart && (
          <span className="meta-guard" title="Çökme bekçisi açık">
            <ShieldCheck size={11} /> bekçi
          </span>
        )}
      </div>

      {(runtime.dependencies.internal.length > 0 || runtime.dependencies.external.length > 0) && (
        <div className="dep-strip">
          <GitBranch size={12} />
          {runtime.dependencies.internal.map((dependency) => {
            const target = siblings.get(dependency.appId);
            const state = target?.state ?? "idle";
            return (
              <button
                type="button"
                key={dependency.appId}
                className={`dep-chip dep-chip--${state} ${dependency.portMismatch ? "is-mismatch" : ""}`}
                onClick={() => handlers.onConfigure(runtime, "deps")}
                title={`${dependency.source} · ${dependency.key} → :${dependency.port}`}
              >
                <StatusLed state={state} />
                {target?.app.name ?? dependency.appId}
                <code>:{dependency.port}</code>
              </button>
            );
          })}
          {runtime.dependencies.external.map((dependency) => (
            <button
              type="button"
              key={`ext-${dependency.port}`}
              className="dep-chip dep-chip--ext"
              onClick={() => handlers.onConfigure(runtime, "deps")}
              title={`${dependency.source} · ${dependency.key}`}
            >
              <Database size={11} />
              {dependency.label}
              <code>:{dependency.port}</code>
            </button>
          ))}
        </div>
      )}

      {runtime.expectations.length > 0 && !active && (
        <div className="callout callout--amber">
          <ArrowRight size={14} />
          <span>
            {runtime.expectations.map((item, index) => (
              <span key={`${item.byAppId}-${item.port}`}>
                {index > 0 && " · "}
                <b>{siblings.get(item.byAppId)?.app.name ?? item.byAppId}</b> bu servisi <b>:{item.port}</b> portunda
                bekliyor
              </span>
            ))}
            .
          </span>
          {app.portConfigurable && (
            <button
              type="button"
              className="link-button"
              onClick={() =>
                handlers.onUpdateSettings(project, app.id, {
                  portMode: "custom",
                  customPort: runtime.expectations[0].port,
                })
              }
            >
              portu :{runtime.expectations[0].port} yap
            </button>
          )}
        </div>
      )}

      {active ? (
        <div className="app-live">
          <div className="live-endpoints">
            {runtime.urls.length > 0 ? (
              runtime.urls.map((url) => (
                <button type="button" key={url} className="endpoint" onClick={() => handlers.onOpenUrl(url)}>
                  <Zap size={12} />
                  {url.replace(/^https?:\/\//, "")}
                  <ExternalLink size={11} />
                </button>
              ))
            ) : runtime.ports.length > 0 ? (
              runtime.ports.map((port) => (
                <span key={port} className="endpoint endpoint--port">
                  <Zap size={12} />:{port}
                </span>
              ))
            ) : (
              <span className="endpoint endpoint--pending">
                <span className="mini-spinner" />
                port bekleniyor{launch.port ? ` · :${launch.port}` : ""}
              </span>
            )}
          </div>
          <div className="live-metrics">
            <span>
              <Cpu size={12} />
              {formatCpu(runtime.cpu)}
            </span>
            <span>
              <MemoryStick size={12} />
              {formatBytes(runtime.memory)}
            </span>
            <span>
              <Timer size={12} />
              {formatDuration(uptime)}
            </span>
            {runtime.health && (
              <span
                className={`health-chip ${runtime.health.ok ? "is-ok" : "is-down"}`}
                title={`${runtime.health.path ? `GET ${runtime.health.path}` : "TCP bağlantısı"}${runtime.health.error ? ` · ${runtime.health.error}` : ""}`}
              >
                <HeartPulse size={12} />
                {runtime.health.ok
                  ? `${runtime.health.status ?? "TCP"} · ${runtime.health.latencyMs}ms`
                  : "yanıt yok"}
              </span>
            )}
            {run && run.errorCount > 0 && <Chip tone="red">{run.errorCount} hata</Chip>}
            {run && run.warnCount > 0 && <Chip tone="amber">{run.warnCount} uyarı</Chip>}
            <Sparkline values={samples.map((sample) => sample.memory)} color={meta.color} width={110} height={26} />
          </div>
        </div>
      ) : (
        <div className="port-control">
          <div className="segmented segmented--small">
            <button
              type="button"
              className={!customMode ? "is-active" : ""}
              onClick={() => handlers.onUpdateSettings(project, app.id, { portMode: "default" })}
            >
              VARSAYILAN {app.defaultPort ? `:${app.defaultPort}` : "—"}
            </button>
            <button
              type="button"
              className={customMode ? "is-active" : ""}
              disabled={!app.portConfigurable}
              title={app.portConfigurable ? "Farklı portta çalıştır" : "Bu uygulamanın portu dışarıdan değiştirilemiyor"}
              onClick={() =>
                handlers.onUpdateSettings(project, app.id, {
                  portMode: "custom",
                  customPort: settings?.customPort ?? (app.defaultPort ? app.defaultPort + 1 : 3001),
                })
              }
            >
              ÖZEL PORT
            </button>
          </div>
          {customMode && app.portConfigurable && (
            <div className="port-input">
              <span>:</span>
              <input
                inputMode="numeric"
                value={portDraft}
                onChange={(event) => setPortDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
                onBlur={(event) => commitPort(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitPort((event.target as HTMLInputElement).value);
                }}
                aria-label="Özel port"
              />
            </div>
          )}
          {app.portConfigurable && (
            <button type="button" className="icon-button" onClick={() => void suggestPort()} title="Boş port bul" aria-label="Boş port bul">
              <Wand2 size={14} className={finding ? "spin" : ""} />
            </button>
          )}
          {portCheck && (
            <span className={`port-check ${portCheck.free ? "is-free" : "is-busy"}`}>
              <i />
              {portCheck.free
                ? "port boş"
                : `dolu${portCheck.processName ? ` · ${portCheck.processName}` : ""}${portCheck.pid ? ` #${portCheck.pid}` : ""}`}
            </span>
          )}
        </div>
      )}

      {!active && (
        <p className="port-hint">
          {app.portSource && <>kaynak: {app.portSource} · </>}
          strateji: {portStrategyLabel(app, launch.script)}
          {app.exposedPorts.length > 1 && <> · portlar: {app.exposedPorts.map((port) => `:${port}`).join(" ")}</>}
        </p>
      )}

      <div className="command-block">
        {scripts.length > 1 && (
          <label className="script-select">
            <span>betik</span>
            <select
              value={scriptName}
              onChange={(event) => handlers.onUpdateSettings(project, app.id, { script: event.target.value, customCommand: null })}
              disabled={active}
            >
              {scripts.map((script) => (
                <option key={script.name} value={script.name}>
                  {script.name}
                  {script.runnable ? "" : " (görev)"}
                </option>
              ))}
            </select>
          </label>
        )}
        {editingCommand ? (
          <form
            className="command-edit"
            onSubmit={(event) => {
              event.preventDefault();
              handlers.onUpdateSettings(project, app.id, { customCommand: commandDraft.trim() || null });
              setEditingCommand(false);
            }}
          >
            <span>$</span>
            <input autoFocus value={commandDraft} onChange={(event) => setCommandDraft(event.target.value)} aria-label="Özel komut" />
            <button type="submit" className="icon-button" aria-label="Kaydet">
              ✓
            </button>
            <button type="button" className="icon-button" onClick={() => setEditingCommand(false)} aria-label="Vazgeç">
              <X size={13} />
            </button>
          </form>
        ) : (
          <div className="command-line" title={launch.command}>
            <span className="prompt">$</span>
            <code>{run && active ? run.command : launch.command}</code>
            {!active && (
              <button
                type="button"
                className="icon-button icon-button--ghost"
                onClick={() => {
                  setCommandDraft(launch.command);
                  setEditingCommand(true);
                }}
                aria-label="Komutu düzenle"
                title="Komutu düzenle"
              >
                <Pencil size={12} />
              </button>
            )}
            {settings?.customCommand && !active && (
              <button
                type="button"
                className="icon-button icon-button--ghost"
                onClick={() => handlers.onUpdateSettings(project, app.id, { customCommand: null })}
                aria-label="Varsayılan komuta dön"
                title="Varsayılan komuta dön"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        )}
        {launch.env.length > 0 && !active && (
          <div className="env-line">
            {launch.env.map((pair) => (
              <code key={pair.key}>
                {pair.key}=<b>{maskValue(pair.key, pair.value)}</b>
              </code>
            ))}
          </div>
        )}
      </div>

      {app.needsInstall && (
        <div className="callout callout--amber">
          <AlertTriangle size={14} />
          <span>Bağımlılıklar kurulu değil.</span>
          <button type="button" className="link-button" onClick={() => handlers.onInstall(runtime)} disabled={installing}>
            <Download size={12} />
            {installing ? "kuruluyor…" : app.installCommand ?? "kur"}
          </button>
        </div>
      )}

      {runtime.external.length > 0 && !active && (
        <div className="callout callout--cyan">
          <Zap size={14} />
          <span>
            Harici olarak çalışıyor:{" "}
            {runtime.external.map((process) => (
              <b key={process.pid}>
                PID {process.pid} {[...new Set(process.ports.map((port) => `:${port.port}`))].join(" ")}
              </b>
            ))}
          </span>
          <button type="button" className="link-button danger-text" onClick={() => runtime.external.forEach(handlers.onStopExternal)}>
            durdur
          </button>
        </div>
      )}

      {state === "failed" && run && (
        <div className="crash-card">
          <div className="crash-head">
            <AlertTriangle size={15} />
            <strong>{run.crash?.title ?? `Süreç ${run.exitCode ?? "?"} koduyla sonlandı`}</strong>
          </div>
          {run.crash?.detail && <p className="crash-detail">{run.crash.detail}</p>}
          {run.crash?.hint && <p className="crash-hint">↳ {run.crash.hint}</p>}
          <div className="crash-actions">
            <button type="button" className="link-button" onClick={() => handlers.onShowLogs(run.runId, run.crash?.seq ?? null)}>
              {run.crash?.seq ? "hata satırına git" : "logları incele"}
            </button>
            <span>çıkış kodu {run.exitCode ?? "?"}</span>
          </div>
        </div>
      )}

      <footer className="app-actions">
        {active ? (
          <button type="button" className="neon-button neon-button--danger" onClick={() => handlers.onStop(runtime)}>
            <Square size={12} />
            Durdur
          </button>
        ) : (
          <button type="button" className="neon-button neon-button--launch" onClick={() => handlers.onStart(runtime)}>
            <Play size={14} />
            Başlat{launch.port ? ` :${launch.port}` : ""}
          </button>
        )}
        {!active && pendingDependencies.length > 0 && (
          <button
            type="button"
            className="neon-button neon-button--ghost neon-button--chain"
            onClick={() => handlers.onStartChain(runtime)}
            title={`Önce ${pendingDependencies.join(", ")} başlatılır ve hazır olması beklenir`}
          >
            <GitBranch size={13} />
            Zinciriyle
          </button>
        )}
        {active && (
          <button type="button" className="neon-button neon-button--ghost" onClick={() => handlers.onRestart(runtime)}>
            <RotateCw size={13} />
            Yeniden
          </button>
        )}
        {run && (
          <button type="button" className="neon-button neon-button--ghost" onClick={() => handlers.onShowLogs(run.runId)}>
            <ScrollText size={13} />
            Loglar
          </button>
        )}
        <span className="service-spacer" />
        {scripts
          .filter((script) => !script.runnable && /down|clean|migrate|seed/.test(script.name))
          .slice(0, 1)
          .map((script) => (
            <button key={script.name} type="button" className="neon-button neon-button--ghost neon-button--small" onClick={() => handlers.onRunScript(runtime, script.name)}>
              {script.name}
            </button>
          ))}
        {active && (
          <button
            type="button"
            className={`icon-button ${runtime.networkUrls.length ? "icon-button--live" : ""}`}
            onClick={() => handlers.onShowQr(runtime)}
            title={runtime.networkUrls.length ? "Telefonda aç (QR)" : "Ağ adresi / QR"}
            aria-label="QR kod"
          >
            <QrCode size={14} />
          </button>
        )}
        <button
          type="button"
          className={`icon-button ${runtime.settings.autoRestart ? "icon-button--guard" : ""}`}
          onClick={() => handlers.onUpdateSettings(project, app.id, { autoRestart: !runtime.settings.autoRestart })}
          title={runtime.settings.autoRestart ? "Çökme bekçisi açık (kapat)" : "Çökme bekçisini aç"}
          aria-label="Çökme bekçisi"
          aria-pressed={runtime.settings.autoRestart}
        >
          <ShieldCheck size={14} />
        </button>
        <button type="button" className="icon-button" onClick={() => handlers.onConfigure(runtime)} title="Ortam, .env ve bağımlılıklar" aria-label="Yapılandır">
          <Settings2 size={14} />
        </button>
        <button type="button" className="icon-button" onClick={() => handlers.onOpenFolder(app.path)} title="Klasörü aç" aria-label="Klasörü aç">
          <FolderOpen size={14} />
        </button>
      </footer>
      {app.notes.filter((note) => !note.startsWith("node_modules")).length > 0 && (
        <ul className="app-notes">
          {app.notes
            .filter((note) => !note.startsWith("node_modules"))
            .map((note) => (
              <li key={note}>{note}</li>
            ))}
        </ul>
      )}
    </article>
  );
}

export function useProjectRuntimes(project: Project | null, runtimes: Map<string, AppRuntime>): AppRuntime[] {
  return useMemo(
    () =>
      project
        ? project.apps
            .map((app) => runtimes.get(`${project.id}::${app.id}`))
            .filter((runtime): runtime is AppRuntime => Boolean(runtime))
        : [],
    [project, runtimes],
  );
}
