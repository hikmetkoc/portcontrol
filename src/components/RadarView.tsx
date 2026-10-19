import {
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe2,
  Laptop,
  Layers,
  MemoryStick,
  QrCode,
  RefreshCw,
  ScrollText,
  Search,
  Square,
  Timer,
  X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import type { MetricSample } from "../hooks/usePortScan";
import { formatBytes, formatCpu, formatDuration, shortenPath } from "../lib/format";
import { primaryUrl, uniquePorts } from "../lib/launch";
import type { AppRuntime } from "../lib/runtime";
import { stackFromTechnology, stackMeta } from "../lib/stacks";
import type { ProcessPortGroup, Project, ScanResponse } from "../types";
import { Sparkline, StackBadge } from "./ui";

export interface ServiceIdentity {
  process: ProcessPortGroup;
  name: string;
  stack: string;
  runtime: AppRuntime | null;
  project: Project | null;
}

export function identifyServices(
  processes: ProcessPortGroup[],
  runtimes: Map<string, AppRuntime>,
  projects: Project[],
): ServiceIdentity[] {
  const runtimeList = [...runtimes.values()];
  return processes.map((process) => {
    const runtime =
      runtimeList.find(
        (item) =>
          (process.managedRunId && item.run?.runId === process.managedRunId) ||
          item.external.some((external) => external.pid === process.pid),
      ) ?? null;
    const project =
      runtime?.project ??
      projects.find((item) => item.id === process.managedProjectId) ??
      null;
    return {
      process,
      name: runtime?.app.name ?? process.projectName ?? process.displayName,
      stack: runtime?.app.stack ?? stackFromTechnology(process.technology, process.category),
      runtime,
      project,
    };
  });
}

export function RadarView({
  scan,
  loading,
  services,
  history,
  includeInfrastructure,
  onToggleInfrastructure,
  onRefresh,
  onOpenUrl,
  onStop,
  onShowLogs,
  onOpenFolder,
  onSelectProject,
  onNewProject,
  onShowQr,
  hasProjects,
}: {
  scan: ScanResponse | null;
  loading: boolean;
  services: ServiceIdentity[];
  history: Map<string, MetricSample[]>;
  includeInfrastructure: boolean;
  onToggleInfrastructure: () => void;
  onRefresh: () => void;
  onOpenUrl: (url: string) => void;
  onStop: (service: ServiceIdentity) => void;
  onShowLogs: (runId: string) => void;
  onOpenFolder: (path: string) => void;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
  onShowQr: (service: ServiceIdentity) => void;
  hasProjects: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    if (!needle) return services;
    return services.filter(({ process, name }) =>
      [
        name,
        process.technology,
        process.processName,
        process.projectRoot ?? "",
        process.pid.toString(),
        ...process.ports.map((port) => port.port.toString()),
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR")
        .includes(needle),
    );
  }, [query, services]);

  const portCount = new Set(services.flatMap(({ process }) => uniquePorts(process))).size;
  const managedCount = services.filter(({ process }) => process.managedRunId).length;
  const totalMemory = services.reduce((sum, { process }) => sum + process.memoryBytes, 0);
  const totalCpu = services.reduce((sum, { process }) => sum + process.cpuUsagePercent, 0);
  const exposed = services.filter(({ process }) =>
    process.ports.some((port) => port.exposure !== "local"),
  ).length;

  return (
    <section className="view radar-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">// CANLI PORT RADARI</p>
          <h1 className="glitch" data-text="Port Radarı">
            Port Radarı
          </h1>
          <p className="view-subtitle">
            Yalnızca yazılım geliştirme projelerinin açtığı portlar. Sistem, güvenlik ve IDE
            iç servisleri filtrelenir{scan ? ` · ${scan.filteredProcesses} süreç gizlendi` : ""}.
          </p>
        </div>
        <div className="view-actions">
          <label className="search-field">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Port, proje, PID…"
              aria-label="Servislerde ara"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Temizle">
                <X size={13} />
              </button>
            )}
          </label>
          <button
            type="button"
            className={`toggle-chip ${includeInfrastructure ? "is-on" : ""}`}
            onClick={onToggleInfrastructure}
            title="Veritabanı ve Docker gibi altyapı servislerini de göster"
          >
            <Layers size={14} />
            Altyapı
          </button>
          <button type="button" className="neon-button neon-button--ghost" onClick={onRefresh}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            Tara
          </button>
        </div>
      </header>

      <div className="hud-grid">
        <HudTile label="AKTİF PORT" value={portCount} tone="cyan" detail="dinlenen TCP portu" />
        <HudTile label="PORTCONTROL" value={managedCount} tone="magenta" detail="buradan başlatılan servis" />
        <HudTile label="BELLEK" value={formatBytes(totalMemory)} tone="lime" detail={`CPU ${formatCpu(totalCpu)}`} />
        <HudTile
          label="AĞA AÇIK"
          value={exposed}
          tone={exposed ? "amber" : "violet"}
          detail={exposed ? "yerel ağdan erişilebilir" : "tümü yalnızca yerel"}
        />
      </div>

      <div className="radar-layout">
        <div className="radar-panel glass">
          <RadarScope services={services} hovered={hovered} onHover={setHovered} />
          <div className="radar-legend">
            <span><i className="ring-1" />&lt; 2000</span>
            <span><i className="ring-2" />2000–5999</span>
            <span><i className="ring-3" />6000–9999</span>
            <span><i className="ring-4" />10000+</span>
          </div>
        </div>

        <div className="service-list">
          {filtered.length === 0 && (
            <div className="empty-panel glass">
              <div className="empty-orb" />
              <strong>{query ? "Eşleşen servis yok" : "Radarda sinyal yok"}</strong>
              <p>
                {query
                  ? "Aramayı değiştirmeyi deneyin."
                  : "Şu anda port dinleyen bir geliştirme projesi bulunamadı. Bir projeyi buradan başlatın."}
              </p>
              {!query && !hasProjects && (
                <button type="button" className="neon-button" onClick={onNewProject}>
                  Proje ekle
                </button>
              )}
            </div>
          )}
          {filtered.map((service) => (
            <ServiceCard
              key={`${service.process.pid}`}
              service={service}
              samples={history.get(service.process.managedRunId ?? `pid:${service.process.pid}`) ?? []}
              highlighted={hovered !== null && service.process.ports.some((port) => port.port === hovered)}
              onHover={setHovered}
              onOpenUrl={onOpenUrl}
              onStop={onStop}
              onShowLogs={onShowLogs}
              onOpenFolder={onOpenFolder}
              onSelectProject={onSelectProject}
              onShowQr={onShowQr}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function HudTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "cyan" | "magenta" | "lime" | "amber" | "violet";
}) {
  return (
    <article className={`hud-tile hud-tile--${tone}`}>
      <span className="hud-corner" />
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function ServiceCard({
  service,
  samples,
  highlighted,
  onHover,
  onOpenUrl,
  onStop,
  onShowLogs,
  onOpenFolder,
  onSelectProject,
  onShowQr,
}: {
  service: ServiceIdentity;
  samples: MetricSample[];
  highlighted: boolean;
  onHover: (port: number | null) => void;
  onOpenUrl: (url: string) => void;
  onStop: (service: ServiceIdentity) => void;
  onShowLogs: (runId: string) => void;
  onOpenFolder: (path: string) => void;
  onSelectProject: (projectId: string) => void;
  onShowQr: (service: ServiceIdentity) => void;
}) {
  const { process, name, stack, project } = service;
  const meta = stackMeta(stack);
  const ports = uniquePorts(process);
  const url = primaryUrl(process) ?? service.runtime?.urls[0] ?? null;
  const managed = Boolean(process.managedRunId);
  const exposure = process.ports.some((port) => port.exposure !== "local") ? "network" : "local";
  const uptime = process.startedAt ? Date.now() - process.startedAt * 1000 : 0;
  const launcher = process.parentChain.find((parent) => !["cmd", "conhost", "powershell", "pwsh", "bash", "sh", "node", "npm"].includes(parent.name.toLowerCase()));
  const folder = process.projectRoot ?? process.workingDirectory;

  return (
    <article
      className={`service-card glass ${managed ? "is-managed" : ""} ${highlighted ? "is-highlighted" : ""}`}
      style={{ "--stack": meta.color } as CSSProperties}
      onMouseEnter={() => onHover(ports[0] ?? null)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="service-head">
        <StackBadge stack={stack} />
        <div className="service-title">
          <h3>{name}</h3>
          <p>
            {process.technology}
            {project && (
              <>
                {" · "}
                <button type="button" className="link-button" onClick={() => onSelectProject(project.id)}>
                  {project.name}
                </button>
              </>
            )}
          </p>
        </div>
        <span className={`source-tag ${managed ? "source-tag--managed" : ""}`}>
          {managed ? "PORTCONTROL" : `HARİCİ${launcher ? ` · ${launcher.name}` : ""}`}
        </span>
      </div>

      <div className="service-ports">
        {ports.map((port) => (
          <button
            type="button"
            key={port}
            className="port-pill"
            onClick={() => onOpenUrl(`http://localhost:${port}`)}
            title={`http://localhost:${port} adresini aç`}
          >
            <span>:</span>
            {port}
          </button>
        ))}
        <span className={`exposure exposure--${exposure}`}>
          {exposure === "local" ? <Laptop size={12} /> : <Globe2 size={12} />}
          {exposure === "local" ? "yalnızca yerel" : "ağa açık"}
        </span>
      </div>

      <div className="service-metrics">
        <span>
          <Cpu size={12} />
          {formatCpu(process.cpuUsagePercent)}
        </span>
        <span>
          <MemoryStick size={12} />
          {formatBytes(process.memoryBytes)}
        </span>
        <span>
          <Timer size={12} />
          {uptime > 0 ? formatDuration(uptime) : "—"}
        </span>
        <span className="pid">PID {process.pid}</span>
        <Sparkline values={samples.map((sample) => sample.cpu)} color={meta.color} width={96} height={24} />
      </div>

      {folder && <p className="service-path" title={folder}>{shortenPath(folder, 64)}</p>}

      <div className="service-actions">
        {url && (
          <button type="button" className="neon-button neon-button--small" onClick={() => onOpenUrl(url)}>
            <ExternalLink size={13} />
            Aç
          </button>
        )}
        {managed && process.managedRunId && (
          <button
            type="button"
            className="neon-button neon-button--small neon-button--ghost"
            onClick={() => onShowLogs(process.managedRunId!)}
          >
            <ScrollText size={13} />
            Loglar
          </button>
        )}
        <button
          type="button"
          className={`icon-button ${exposure === "network" ? "icon-button--live" : ""}`}
          onClick={() => onShowQr(service)}
          title={exposure === "network" ? "Telefonda aç (QR)" : "Ağ adresi / QR"}
          aria-label="QR kod"
        >
          <QrCode size={14} />
        </button>
        {folder && (
          <button
            type="button"
            className="icon-button"
            onClick={() => onOpenFolder(folder)}
            title="Klasörü aç"
            aria-label="Klasörü aç"
          >
            <FolderOpen size={14} />
          </button>
        )}
        <span className="service-spacer" />
        <button
          type="button"
          className="neon-button neon-button--small neon-button--danger"
          onClick={() => onStop(service)}
        >
          <Square size={11} />
          Durdur
        </button>
      </div>
    </article>
  );
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return Math.abs(result);
}

function RadarScope({
  services,
  hovered,
  onHover,
}: {
  services: ServiceIdentity[];
  hovered: number | null;
  onHover: (port: number | null) => void;
}) {
  const size = 320;
  const center = size / 2;
  const blips = useMemo(() => {
    const seen = new Set<number>();
    return services.flatMap(({ process, stack, name }) =>
      uniquePorts(process)
        .filter((port) => {
          if (seen.has(port)) return false;
          seen.add(port);
          return true;
        })
        .map((port) => {
          const ring = port < 2000 ? 0 : port < 6000 ? 1 : port < 10000 ? 2 : 3;
          const radius = [48, 82, 114, 144][ring] + ((hash(`${port}r`) % 14) - 7);
          const angle = ((hash(`${port}:${name}`) % 360) * Math.PI) / 180;
          return {
            port,
            name,
            managed: Boolean(process.managedRunId),
            color: stackMeta(stack).color,
            x: center + Math.cos(angle) * radius,
            y: center + Math.sin(angle) * radius,
            delay: (hash(`${port}d`) % 30) / 10,
          };
        }),
    );
  }, [services, center]);

  return (
    <svg className="radar-scope" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Port radarı">
      <defs>
        <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(41,240,255,0.10)" />
          <stop offset="100%" stopColor="rgba(41,240,255,0)" />
        </radialGradient>
        <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(41,240,255,0)" />
          <stop offset="100%" stopColor="rgba(41,240,255,0.55)" />
        </linearGradient>
      </defs>
      <circle cx={center} cy={center} r={156} fill="url(#radar-bg)" />
      {[48, 82, 114, 144].map((radius, index) => (
        <circle key={radius} className={`radar-ring radar-ring--${index + 1}`} cx={center} cy={center} r={radius} />
      ))}
      <line className="radar-axis" x1={center} y1={8} x2={center} y2={size - 8} />
      <line className="radar-axis" x1={8} y1={center} x2={size - 8} y2={center} />
      {Array.from({ length: 36 }, (_, index) => {
        const angle = (index * 10 * Math.PI) / 180;
        const inner = index % 3 === 0 ? 148 : 152;
        return (
          <line
            key={index}
            className="radar-tick"
            x1={center + Math.cos(angle) * inner}
            y1={center + Math.sin(angle) * inner}
            x2={center + Math.cos(angle) * 156}
            y2={center + Math.sin(angle) * 156}
          />
        );
      })}
      <g className="radar-sweep" style={{ transformOrigin: `${center}px ${center}px` }}>
        <path
          d={`M ${center} ${center} L ${center + 156} ${center} A 156 156 0 0 0 ${center + 156 * Math.cos(-Math.PI / 5)} ${center + 156 * Math.sin(-Math.PI / 5)} Z`}
          fill="url(#sweep-grad)"
          opacity="0.5"
        />
        <line x1={center} y1={center} x2={center + 156} y2={center} className="radar-beam" />
      </g>
      <circle cx={center} cy={center} r={4} className="radar-core" />
      {blips.map((blip) => (
        <g
          key={blip.port}
          className={`radar-blip ${hovered === blip.port ? "is-hovered" : ""} ${blip.managed ? "is-managed" : ""}`}
          style={{ "--blip": blip.color, "--delay": `${blip.delay}s` } as CSSProperties}
          onMouseEnter={() => onHover(blip.port)}
          onMouseLeave={() => onHover(null)}
        >
          <circle className="blip-pulse" cx={blip.x} cy={blip.y} r={6} />
          <circle className="blip-dot" cx={blip.x} cy={blip.y} r={hovered === blip.port ? 5 : 3.6} />
          <text x={blip.x + 8} y={blip.y - 6} className="blip-label">
            :{blip.port}
          </text>
          <title>{`${blip.name} · :${blip.port}`}</title>
        </g>
      ))}
    </svg>
  );
}
