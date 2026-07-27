import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpFromLine,
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
  Globe2,
  HardDrive,
  Laptop,
  Layers3,
  Link2,
  LockKeyhole,
  MemoryStick,
  Network,
  RadioTower,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  Exposure,
  PortBinding,
  ProcessPortGroup,
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
}: ProcessCardProps) {
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = categoryIcons[process.category];
  const groupedPorts = useMemo(() => groupPorts(process.ports), [process.ports]);
  const visiblePorts = expanded ? groupedPorts : groupedPorts.slice(0, 8);
  const hiddenCount = groupedPorts.length - visiblePorts.length;
  const firstParent = process.parentChain[0];

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
              {process.metricsReady
                ? formatCpu(process.cpuUsagePercent)
                : "ölçülüyor"}
            </span>
            <span>
              <MemoryStick size={13} />
              {formatBytes(process.memoryBytes)}
            </span>
            <span className="disk-rate">
              <HardDrive size={13} />
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

        <div className="process-context">
          <p className="process-path" title={process.executablePath ?? undefined}>
            {process.executablePath ?? process.processName}
          </p>
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

            return (
              <div
                className={`socket-row socket-row--${port.role}`}
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
                <span className="socket-exposure">
                  <ExposureIcon size={12} />
                  {exposureLabel(port.exposure)}
                </span>
                <span className="socket-reason">{port.roleReason}</span>
              </div>
            );
          })}
        </div>

        {groupedPorts.length > 8 && (
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
