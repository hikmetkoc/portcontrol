import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { mockBackend } from "./mock/mockBackend";
import type {
  EnvPair,
  LogLine,
  PortCheck,
  ProbeResult,
  RunInfo,
  RunLogPayload,
  ScanResponse,
  StartRunRequest,
  StopRequest,
  StopResult,
  WorkspaceScan,
} from "./types";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function scanPorts(
  includeInfrastructure: boolean,
): Promise<ScanResponse> {
  if (!isTauriRuntime()) return mockBackend.scanPorts(includeInfrastructure);
  return invoke<ScanResponse>("scan_ports", { includeInfrastructure });
}

export async function stopProcesses(
  requests: StopRequest[],
  force = false,
): Promise<StopResult[]> {
  if (!isTauriRuntime()) return mockBackend.stopProcesses(requests);
  return invoke<StopResult[]>("stop_processes", { requests, force });
}

export async function scanWorkspace(path: string): Promise<WorkspaceScan> {
  if (!isTauriRuntime()) return mockBackend.scanWorkspace(path);
  return invoke<WorkspaceScan>("scan_workspace", { path });
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauriRuntime()) return mockBackend.pickFolder();
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Proje klasörünü seçin",
  });
  return typeof selected === "string" ? selected : null;
}

export async function startRun(request: StartRunRequest): Promise<RunInfo> {
  if (!isTauriRuntime()) return mockBackend.startRun(request);
  return invoke<RunInfo>("start_run", { request });
}

export async function stopRun(runId: string): Promise<void> {
  if (!isTauriRuntime()) return mockBackend.stopRun(runId);
  return invoke("stop_run", { runId });
}

export async function listRuns(): Promise<RunInfo[]> {
  if (!isTauriRuntime()) return mockBackend.listRuns();
  return invoke<RunInfo[]>("list_runs");
}

export async function runLogs(runId: string): Promise<LogLine[]> {
  if (!isTauriRuntime()) return mockBackend.runLogs(runId);
  return invoke<LogLine[]>("run_logs", { runId });
}

export async function writeRunInput(runId: string, text: string): Promise<void> {
  if (!isTauriRuntime()) return mockBackend.writeRunInput(runId, text);
  return invoke("write_run_input", { runId, text });
}

/** Kaydetme penceresi açar ve çalıştırmanın tüm loglarını seçilen dosyaya yazar. */
export async function saveRunLogToFile(runId: string, defaultName: string): Promise<number | null> {
  const path = await saveDialog({
    title: "Logu kaydet",
    defaultPath: defaultName,
    filters: [{ name: "Log dosyası", extensions: ["log", "txt"] }],
  });
  if (!path) return null;
  return invoke<number>("save_run_log", { runId, path });
}

export async function clearRunLogs(runId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("clear_run_logs", { runId });
}

export async function removeRun(runId: string): Promise<void> {
  if (!isTauriRuntime()) return mockBackend.removeRun(runId);
  return invoke("remove_run", { runId });
}

export async function checkPort(port: number): Promise<PortCheck> {
  if (!isTauriRuntime()) return mockBackend.checkPort(port);
  return invoke<PortCheck>("check_port", { port });
}

export async function findFreePort(
  start: number,
  exclude: number[] = [],
): Promise<number | null> {
  if (!isTauriRuntime()) return mockBackend.findFreePort(start, exclude);
  return invoke<number | null>("find_free_port", { start, exclude });
}

/** Yerel servisin hazır olup olmadığını yoklar; path yoksa yalnızca TCP bağlantısı denenir. */
export async function probeService(
  port: number,
  path: string | null,
  timeoutMs = 1500,
): Promise<ProbeResult> {
  if (!isTauriRuntime()) return mockBackend.probeService(port, path);
  return invoke<ProbeResult>("probe_service", { port, path, timeoutMs });
}

export async function readEnvFile(path: string): Promise<EnvPair[]> {
  if (!isTauriRuntime()) return mockBackend.readEnvFile(path);
  return invoke<EnvPair[]>("read_env_file", { path });
}

export async function writeEnvFile(path: string, entries: EnvPair[]): Promise<void> {
  if (!isTauriRuntime()) return mockBackend.writeEnvFile(path, entries);
  return invoke("write_env_file", { path, entries });
}

export async function lanAddresses(): Promise<string[]> {
  if (!isTauriRuntime()) return ["192.168.1.24"];
  return invoke<string[]>("lan_addresses");
}

export async function openFolder(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("open_folder", { path });
}

export async function openInEditor(path: string, editor: string): Promise<void> {
  if (!isTauriRuntime()) return;
  return invoke("open_in_editor", { path, editor });
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Yalnızca HTTP ve HTTPS adresleri açılabilir.");
  }
  if (!isTauriRuntime()) {
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(parsed.href);
}

export type Unlisten = () => void;

export async function onRunLog(
  handler: (payload: RunLogPayload) => void,
): Promise<Unlisten> {
  if (!isTauriRuntime()) return mockBackend.onRunLog(handler);
  return listen<RunLogPayload>("run-log", (event) => handler(event.payload));
}

export async function onRunStatus(
  handler: (info: RunInfo) => void,
): Promise<Unlisten> {
  if (!isTauriRuntime()) return mockBackend.onRunStatus(handler);
  return listen<RunInfo>("run-status", (event) => handler(event.payload));
}

export const windowControls = {
  available: isTauriRuntime,
  isFullscreen: async () => (isTauriRuntime() ? getCurrentWindow().isFullscreen() : false),
  setFullscreen: async (value: boolean) => {
    if (isTauriRuntime()) await getCurrentWindow().setFullscreen(value);
    else if (value) await document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  },
  minimize: () => (isTauriRuntime() ? getCurrentWindow().minimize() : undefined),
  toggleMaximize: () =>
    isTauriRuntime() ? getCurrentWindow().toggleMaximize() : undefined,
  close: () => (isTauriRuntime() ? getCurrentWindow().close() : undefined),
};
