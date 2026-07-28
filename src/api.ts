import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { mockScanResponse } from "./mockData";
import type { ScanResponse, StopRequest, StopResult } from "./types";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function scanPorts(
  includeSystem: boolean,
): Promise<ScanResponse> {
  if (!isTauriRuntime()) {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return {
      ...mockScanResponse,
      scannedAt: Date.now(),
      processes: includeSystem
        ? mockScanResponse.processes
        : mockScanResponse.processes.filter((process) => !process.protected),
    };
  }

  return invoke<ScanResponse>("scan_ports", { includeSystem });
}

export async function stopProcesses(
  requests: StopRequest[],
  force = false,
): Promise<StopResult[]> {
  if (!isTauriRuntime()) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    return requests.map((request) => ({
      pid: request.pid,
      processName: "Demo süreci",
      stopped: true,
      message: "Demo görünümünde durduruldu.",
    }));
  }

  return invoke<StopResult[]>("stop_processes", { requests, force });
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
