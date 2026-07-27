import type {
  CategoryFilter,
  ClassificationConfidence,
  Exposure,
  ProcessPortGroup,
  Protocol,
  RoleFilter,
  SocketRole,
  SocketView,
} from "./types";

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const fractionDigits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toLocaleString("tr-TR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ${units[index]}`;
}

export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "0 B/sn";
  return `${formatBytes(bytesPerSecond)}/sn`;
}

export function formatCpu(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.1) return "<0,1%";
  return `${value.toLocaleString("tr-TR", {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  })}%`;
}

export function formatScanTime(timestamp: number): string {
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function exposureLabel(exposure: Exposure): string {
  if (exposure === "local") return "Yalnızca yerel";
  if (exposure === "all") return "Tüm arayüzler";
  return "Yerel ağ";
}

export function categoryLabel(category: ProcessPortGroup["category"]): string {
  const labels: Record<ProcessPortGroup["category"], string> = {
    editor: "Editör",
    database: "Veritabanı",
    container: "Konteyner",
    runtime: "Çalışma zamanı",
    development: "Geliştirme",
    other: "Diğer",
    system: "Sistem",
  };
  return labels[category];
}

export function roleLabel(role: SocketRole): string {
  const labels: Record<SocketRole, string> = {
    published: "Yayındaki proje",
    toolInternal: "Araç içi servis",
    infrastructure: "Altyapı servisi",
    system: "Sistem / güvenlik",
    outbound: "Aktif bağlantı",
    unknown: "Belirsiz",
  };
  return labels[role];
}

export function confidenceLabel(
  confidence: ClassificationConfidence,
): string {
  if (confidence === "high") return "Yüksek güven";
  if (confidence === "medium") return "Orta güven";
  return "Düşük güven";
}

export function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    LISTEN: "LISTEN",
    ESTABLISHED: "ESTABLISHED",
    BOUND: "UDP BOUND",
    SYN_SENT: "SYN SENT",
    SYN_RCVD: "SYN RECEIVED",
    FIN_WAIT_1: "FIN WAIT",
    FIN_WAIT_2: "FIN WAIT",
    CLOSE_WAIT: "CLOSE WAIT",
    CLOSING: "CLOSING",
    LAST_ACK: "LAST ACK",
    __UNKNOWN: "BİLİNMİYOR",
  };
  return labels[state] ?? state;
}

function matchesSocketView(
  activity: ProcessPortGroup["ports"][number]["activity"],
  view: SocketView,
): boolean {
  if (view === "all") return true;
  if (view === "servers") return activity === "listener" || activity === "bound";
  if (view === "listeners") return activity === "listener";
  if (view === "connections") return activity === "connection";
  return activity === "bound";
}

export function filterProcesses(
  processes: ProcessPortGroup[],
  search: string,
  category: CategoryFilter,
  protocol: "all" | Protocol,
  socketView: SocketView,
  role: RoleFilter,
): ProcessPortGroup[] {
  const needle = search.trim().toLocaleLowerCase("tr-TR");

  return processes
    .filter((process) => {
      if (category === "developer" && !process.knownDeveloperTool) return false;
      if (
        category !== "all" &&
        category !== "developer" &&
        process.category !== category
      ) {
        return false;
      }

      if (!needle) return true;
      const searchable = [
        process.displayName,
        process.processName,
        process.pid.toString(),
        process.executablePath ?? "",
        process.command ?? "",
        process.workingDirectory ?? "",
        ...process.parentChain.flatMap((parent) => [
          parent.name,
          parent.pid.toString(),
        ]),
        ...process.ports.flatMap((port) => [
          port.port.toString(),
          port.address,
          port.remoteAddress ?? "",
          port.remotePort?.toString() ?? "",
          port.protocol,
          port.state,
          roleLabel(port.role),
          port.roleReason,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase("tr-TR");
      return searchable.includes(needle);
    })
    .map((process) => ({
      ...process,
      ports: process.ports.filter(
        (port) =>
          (protocol === "all" || port.protocol === protocol) &&
          matchesSocketView(port.activity, socketView) &&
          (role === "all" || port.role === role),
      ),
    }))
    .filter((process) => process.ports.length > 0);
}
