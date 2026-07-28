import type { PortBinding, ProcessPortGroup, Protocol } from "./types";

const HIDDEN_PORTS_STORAGE_KEY = "portcontrol.hidden-ports.v1";
const COLLAPSED_PORTS_STORAGE_KEY = "portcontrol.collapsed-ports.v1";

export interface HiddenPortRecord {
  key: string;
  processName: string;
  technology: string;
  protocol: Protocol;
  port: number;
  hiddenAt: number;
}

export function portViewKey(
  process: ProcessPortGroup,
  port: PortBinding,
): string {
  const processIdentity = (
    process.projectRoot ??
    process.executablePath ??
    process.workingDirectory ??
    process.processName
  )
    .trim()
    .toLocaleLowerCase();
  const remote =
    port.activity === "connection"
      ? `${port.remoteAddress ?? ""}:${port.remotePort ?? ""}`
      : "";
  return [
    processIdentity,
    port.protocol,
    port.port,
    port.activity,
    remote,
  ].join("|");
}

export function hiddenPortRecord(
  process: ProcessPortGroup,
  port: PortBinding,
): HiddenPortRecord {
  return {
    key: portViewKey(process, port),
    processName: process.projectName ?? process.displayName,
    technology: process.technology,
    protocol: port.protocol,
    port: port.port,
    hiddenAt: Date.now(),
  };
}

export function loadHiddenPorts(): HiddenPortRecord[] {
  return readStoredArray(HIDDEN_PORTS_STORAGE_KEY).filter(isHiddenPortRecord);
}

export function saveHiddenPorts(records: HiddenPortRecord[]): void {
  writeStoredArray(HIDDEN_PORTS_STORAGE_KEY, records);
}

export function loadCollapsedPortKeys(): string[] {
  return readStoredArray(COLLAPSED_PORTS_STORAGE_KEY).filter(
    (value): value is string => typeof value === "string" && Boolean(value),
  );
}

export function saveCollapsedPortKeys(keys: string[]): void {
  writeStoredArray(COLLAPSED_PORTS_STORAGE_KEY, keys);
}

function readStoredArray(key: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredArray(key: string, value: unknown[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The live scan must continue even when storage is unavailable.
  }
}

function isHiddenPortRecord(value: unknown): value is HiddenPortRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HiddenPortRecord>;
  return (
    typeof record.key === "string" &&
    typeof record.processName === "string" &&
    typeof record.technology === "string" &&
    (record.protocol === "TCP" || record.protocol === "UDP") &&
    typeof record.port === "number" &&
    typeof record.hiddenAt === "number"
  );
}
