export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toLocaleString("tr-TR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${units[index]}`;
}

export function formatCpu(value: number): string {
  if (!value || value <= 0) return "0%";
  if (value < 0.1) return "<0,1%";
  return `${value.toLocaleString("tr-TR", {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  })}%`;
}

export function formatDuration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}g ${hours}s`;
  if (hours > 0) return `${hours}s ${minutes.toString().padStart(2, "0")}dk`;
  if (minutes > 0) return `${minutes}dk ${seconds.toString().padStart(2, "0")}sn`;
  return `${seconds}sn`;
}

export function formatClock(timestamp: number, withMillis = false): string {
  const date = new Date(timestamp);
  const base = new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  return withMillis
    ? `${base}.${date.getMilliseconds().toString().padStart(3, "0")}`
    : base;
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < 10_000) return "az önce";
  if (diff < 60_000) return `${Math.floor(diff / 1000)} sn önce`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} dk önce`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} sa önce`;
  return `${Math.floor(diff / 86_400_000)} gün önce`;
}

export function shortenPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(separator);
  if (parts.length <= 3) return `…${path.slice(-max + 1)}`;
  const head = parts[0];
  let tail = parts[parts.length - 1];
  for (let index = parts.length - 2; index > 0; index -= 1) {
    const candidate = `${parts[index]}${separator}${tail}`;
    if (head.length + candidate.length + 3 > max) break;
    tail = candidate;
  }
  return `${head}${separator}…${separator}${tail}`;
}
