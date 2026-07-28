import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpFromLine,
  AppWindow,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Code2,
  Container,
  Cpu,
  Database,
  ExternalLink,
  EyeOff,
  FolderPlus,
  Globe2,
  HardDrive,
  Laptop,
  Layers3,
  Link2,
  LockKeyhole,
  MemoryStick,
  Minimize2,
  Network,
  RadioTower,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { openExternalUrl } from "../api";
import {
  ProjectPortDialog,
  type AddProjectPortInput,
} from "./ProjectPortDialog";
import { memberId } from "../projectGroups";
import { portViewKey } from "../portVisibility";
import type {
  Exposure,
  PortBinding,
  ProcessPortGroup,
  ProjectGroup,
  SocketRole,
} from "../types";
import {
  categoryLabel,
  confidenceLabel,
  exposureLabel,
  formatBytes,
  formatCpu,
  formatRate,
  roleLabel,
  stateLabel,
} from "../utils";

interface ProcessCardProps {
  process: ProcessPortGroup;
  selected: boolean;
  onToggle: (pid: number) => void;
  projectGroups: ProjectGroup[];
  onAddProjectPort: (input: AddProjectPortInput) => void;
  hiddenPortKeys: ReadonlySet<string>;
  collapsedPortKeys: ReadonlySet<string>;
  onHidePort: (process: ProcessPortGroup, port: PortBinding) => void;
  onTogglePortCollapsed: (key: string) => void;
  projectGroupId?: string;
}

interface GroupedPort extends PortBinding {
  addresses: string[];
  occurrenceCount: number;
}

const categoryIcons: Record<ProcessPortGroup["category"], LucideIcon> = {
  editor: Code2,
  database: Database,
  container: Container,
  runtime: Braces,
  development: TerminalSquare,
  other: Box,
  system: ServerCog,
};

const roleIcons: Record<SocketRole, LucideIcon> = {
  published: RadioTower,
  toolInternal: Wrench,
  infrastructure: Layers3,
  system: ShieldCheck,
  outbound: ArrowRightLeft,
  unknown: CircleHelp,
};

function exposureIcon(exposure: Exposure) {
  if (exposure === "local") return Laptop;
  if (exposure === "all") return Globe2;
  return Network;
}

function strongestExposure(left: Exposure, right: Exposure): Exposure {
  const priority: Record<Exposure, number> = { local: 0, network: 1, all: 2 };
  return priority[right] > priority[left] ? right : left;
}

function groupPorts(ports: PortBinding[]): GroupedPort[] {
  const groups = new Map<string, GroupedPort>();

  ports.forEach((port) => {
    const key = [
      port.protocol,
      port.port,
      port.state,
      port.role,
      port.remoteAddress ?? "",
      port.remotePort ?? "",
    ].join("|");
    const existing = groups.get(key);
    if (existing) {
      if (!existing.addresses.includes(port.address)) {
        existing.addresses.push(port.address);
      }
      existing.occurrenceCount += 1;
      existing.exposure = strongestExposure(existing.exposure, port.exposure);
    } else {
      groups.set(key, {
        ...port,
        addresses: [port.address],
        occurrenceCount: 1,
      });
    }
  });

  return [...groups.values()];
}

function formatEndpoint(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;
}

export function ProcessCard({
  process,
  selected,
  onToggle,
  projectGroups,
  onAddProjectPort,
  hiddenPortKeys,
  collapsedPortKeys,
  onHidePort,
  onTogglePortCollapsed,
  projectGroupId,
}: ProcessCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [projectPort, setProjectPort] = useState<PortBinding | null>(null);
  const CategoryIcon = categoryIcons[process.category];
  const groupedPorts = useMemo(() => groupPorts(process.ports), [process.ports]);
  const availablePorts = groupedPorts.filter(
    (port) => !hiddenPortKeys.has(portViewKey(process, port)),
  );
  const visiblePorts = expanded ? availablePorts : availablePorts.slice(0, 8);
  const hiddenCount = availablePorts.length - visiblePorts.length;
  const firstParent = process.parentChain[0];

  if (!availablePorts.length) return null;

  return (
    <article
      className={`process-card ${selected ? "process-card--selected" : ""} ${
        process.protected ? "process-card--protected" : ""
      }`}
    >
      <button
        type="button"
        className="process-select"
        aria-label={`${process.displayName} sürecini seç`}
        aria-pressed={selected}
        disabled={process.protected}
        onClick={() => onToggle(process.pid)}
      >
        {process.protected ? (
          <LockKeyhole size={14} />
        ) : selected ? (
          <Check size={15} strokeWidth={3} />
        ) : null}
      </button>

      <div className={`process-avatar process-avatar--${process.category}`}>
        <CategoryIcon size={22} strokeWidth={1.7} />
      </div>

      <div className="process-main">
        <div className="process-heading">
          <div className="process-title">
            <h3>{process.displayName}</h3>
            <span className="technology-badge">
              <AppWindow size={13} />
              {process.technology}
            </span>
            <span className={`category category--${process.category}`}>
              {process.knownDeveloperTool && <ShieldCheck size={12} />}
              {categoryLabel(process.category)}
            </span>
            <span className="pid-label">PID {process.pid}</span>
          </div>

          <div
            className={`resource-strip ${
              !process.metricsReady ? "resource-strip--sampling" : ""
            }`}
            title={
              process.metricsReady
                ? `Toplam disk: ${formatBytes(process.diskTotalReadBytes)} okuma, ${formatBytes(process.diskTotalWrittenBytes)} yazma`
                : "CPU ve disk hızı ikinci taramada ölçülecek"
            }
          >
            <span>
              <Cpu size={13} />
              <b>CPU</b>
              {process.metricsReady
                ? formatCpu(process.cpuUsagePercent)
                : "ölçülüyor"}
            </span>
            <span>
              <MemoryStick size={13} />
              <b>RAM</b>
              {formatBytes(process.memoryBytes)}
            </span>
            <span className="disk-rate">
              <HardDrive size={13} />
              <b>Disk</b>
              <i>
                <ArrowDownToLine size={10} />
                {formatRate(process.diskReadBytesPerSecond)}
              </i>
              <i>
                <ArrowUpFromLine size={10} />
                {formatRate(process.diskWriteBytesPerSecond)}
              </i>
            </span>
          </div>
        </div>

        <div className="project-summary">
          <span className="service-kind">{process.serviceKind}</span>
          <p>{process.serviceDescription}</p>
        </div>

        <div className="process-context">
          <div className="process-paths">
            <p
              className="process-path"
              title={process.projectRoot ?? process.workingDirectory ?? undefined}
            >
              <strong>Proje</strong>
              {process.projectRoot ??
                process.workingDirectory ??
                "Proje dizini alınamadı"}
            </p>
            <p
              className="process-path process-path--executable"
              title={process.executablePath ?? undefined}
            >
              <strong>Süreç</strong>
              {process.executablePath ?? process.processName}
            </p>
          </div>
          {firstParent && (
            <span
              className="parent-process"
              title={process.parentChain
                .map((parent) => `${parent.name} (PID ${parent.pid})`)
                .join(" → ")}
            >
              <Link2 size={11} />
              Başlatan: {firstParent.name} · PID {firstParent.pid}
            </span>
          )}
        </div>

        <div className="socket-list">
          {visiblePorts.map((port) => {
            const ExposureIcon = exposureIcon(port.exposure);
            const RoleIcon = roleIcons[port.role];
            const addressSummary =
              port.addresses.length === 1
                ? formatEndpoint(port.addresses[0], port.port)
                : `:${port.port} · ${port.addresses.length} arayüz`;
            const socketTitle = [
              ...port.addresses.map((address) =>
                formatEndpoint(address, port.port),
              ),
              port.roleReason,
              confidenceLabel(port.confidence),
            ].join("\n");
            const assignedGroups = projectGroups.filter((group) =>
              group.members.some(
                (member) => member.id === memberId(port.protocol, port.port),
              ),
            );
            const contextualMember = projectGroupId
              ? projectGroups
                  .find((group) => group.id === projectGroupId)
                  ?.members.find(
                    (member) =>
                      member.id === memberId(port.protocol, port.port),
                  )
              : undefined;
            const viewKey = portViewKey(process, port);
            const collapsed = collapsedPortKeys.has(viewKey);

            return (
              <div
                className={`socket-row socket-row--${port.role} ${
                  collapsed ? "socket-row--collapsed" : ""
                }`}
                key={`${port.protocol}-${port.port}-${port.state}-${port.role}-${port.remoteAddress ?? ""}-${port.remotePort ?? ""}`}
                title={socketTitle}
              >
                <span
                  className={`socket-state socket-state--${port.activity}`}
                >
                  {stateLabel(port.state)}
                </span>
                <span className="socket-endpoint">
                  <small>{port.protocol}</small>
                  <strong>{addressSummary}</strong>
                  {contextualMember && (
                    <span className="project-port-label">
                      {contextualMember.label}
                    </span>
                  )}
                  {port.remoteAddress && port.remotePort !== null && (
                    <>
                      <ArrowRight size={12} />
                      <span>
                        {formatEndpoint(port.remoteAddress, port.remotePort)}
                      </span>
                    </>
                  )}
                </span>
                <span className={`socket-role socket-role--${port.role}`}>
                  <RoleIcon size={12} />
                  {roleLabel(port.role)}
                  <i
                    className={`confidence confidence--${port.confidence}`}
                    aria-label={confidenceLabel(port.confidence)}
                  />
                </span>
                <div className="socket-actions">
                  <span className="socket-exposure">
                    <ExposureIcon size={12} />
                    {exposureLabel(port.exposure)}
                  </span>
                  <div className="socket-visibility-controls">
                    <button
                      type="button"
                      onClick={() => onTogglePortCollapsed(viewKey)}
                      aria-label={`:${port.port} portunu ${
                        collapsed ? "genişlet" : "küçült"
                      }`}
                      title={collapsed ? "Portu genişlet" : "Portu küçült"}
                    >
                      {collapsed ? (
                        <ChevronDown size={14} />
                      ) : (
                        <Minimize2 size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="hide-port-button"
                      onClick={() => onHidePort(process, port)}
                      aria-label={`:${port.port} portunu gizle`}
                      title="Portu Gizlenmiş Portlar alanına taşı"
                    >
                      <EyeOff size={14} />
                    </button>
                  </div>
                  {port.activity !== "connection" && (
                    <button
                      type="button"
                      className={`add-to-project-button ${
                        assignedGroups.length ? "assigned" : ""
                      }`}
                      onClick={() => setProjectPort(port)}
                      title={
                        assignedGroups.length
                          ? `Dahil olduğu gruplar: ${assignedGroups
                              .map((group) => group.name)
                              .join(", ")}`
                          : "Portu bir proje grubuna ekle"
                      }
                    >
                      <FolderPlus size={13} />
                      {assignedGroups.length
                        ? assignedGroups.map((group) => group.name).join(", ")
                        : "Projeye ekle"}
                    </button>
                  )}
                </div>
                <span className="socket-reason">{port.roleReason}</span>
                {port.accessUrls.length > 0 && (
                  <div className="socket-access">
                    <Globe2 size={13} />
                    <span>
                      {port.exposure === "local"
                        ? "Bu bilgisayardan erişim"
                        : "Aynı ağdaki cihazlardan da erişilebilir"}
                    </span>
                    {port.accessUrls.map((url) => (
                      <a
                        href={url}
                        key={url}
                        onClick={(event) => {
                          event.preventDefault();
                          void openExternalUrl(url);
                        }}
                        title={`${url} adresini varsayılan tarayıcıda aç`}
                      >
                        <code>{url}</code>
                        <ExternalLink size={12} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {projectPort && (
          <ProjectPortDialog
            groups={projectGroups}
            processes={[process]}
            initialSelection={{ process, port: projectPort }}
            preselectedGroupId={projectGroups[0]?.id ?? null}
            onCancel={() => setProjectPort(null)}
            onAdd={(input) => {
              onAddProjectPort(input);
              setProjectPort(null);
            }}
          />
        )}

        {availablePorts.length > 8 && (
          <button
            type="button"
            className="show-more-ports"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded
              ? "Portları daralt"
              : `${hiddenCount} uç noktayı daha göster`}
          </button>
        )}

        {process.protected && (
          <p className="protection-note">
            <LockKeyhole size={13} />
            {process.protectionReason}
          </p>
        )}
      </div>
    </article>
  );
}
