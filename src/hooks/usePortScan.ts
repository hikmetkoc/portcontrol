import { useCallback, useEffect, useRef, useState } from "react";
import { scanPorts } from "../api";
import type { ProcessPortGroup, ScanResponse } from "../types";

export interface PortEvent {
  id: string;
  at: number;
  type: "open" | "close";
  port: number;
  label: string;
  technology: string;
  managed: boolean;
}

export interface MetricSample {
  cpu: number;
  memory: number;
}

const HISTORY_LENGTH = 40;

function serviceKey(process: ProcessPortGroup, port: number): string {
  return `${process.projectRoot ?? process.workingDirectory ?? process.processName}|${port}`;
}

/** Periyodik port taraması; port açılış/kapanış olaylarını ve kaynak geçmişini tutar. */
export function usePortScan(includeInfrastructure: boolean, interval: number) {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<PortEvent[]>([]);
  const [history, setHistory] = useState<Map<string, MetricSample[]>>(new Map());
  const requestId = useRef(0);
  const previous = useRef<Map<string, { port: number; label: string; technology: string; managed: boolean }> | null>(null);

  const refresh = useCallback(
    async (silent = false) => {
      const current = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const response = await scanPorts(includeInfrastructure);
        if (current !== requestId.current) return;
        setScan(response);
        setError(null);

        const next = new Map<string, { port: number; label: string; technology: string; managed: boolean }>();
        for (const process of response.processes) {
          for (const port of new Set(process.ports.map((item) => item.port))) {
            next.set(serviceKey(process, port), {
              port,
              label: process.projectName ?? process.displayName,
              technology: process.technology,
              managed: Boolean(process.managedRunId),
            });
          }
        }
        const before = previous.current;
        if (before) {
          const created: PortEvent[] = [];
          for (const [key, value] of next) {
            if (!before.has(key)) {
              created.push({ id: `${key}|open|${response.scannedAt}`, at: response.scannedAt, type: "open", ...value });
            }
          }
          for (const [key, value] of before) {
            if (!next.has(key)) {
              created.push({ id: `${key}|close|${response.scannedAt}`, at: response.scannedAt, type: "close", ...value });
            }
          }
          if (created.length) {
            setEvents((list) => [...created, ...list].slice(0, 60));
          }
        }
        previous.current = next;

        setHistory((old) => {
          const updated = new Map<string, MetricSample[]>();
          for (const process of response.processes) {
            const key = process.managedRunId ?? `pid:${process.pid}`;
            const existing = updated.get(key) ?? old.get(key) ?? [];
            const last = updated.has(key) ? existing[existing.length - 1] : null;
            const sample = {
              cpu: process.cpuUsagePercent + (last?.cpu ?? 0),
              memory: process.memoryBytes + (last?.memory ?? 0),
            };
            const series = updated.has(key) ? [...existing.slice(0, -1), sample] : [...existing, sample];
            updated.set(key, series.slice(-HISTORY_LENGTH));
          }
          return updated;
        });
      } catch (reason) {
        if (current !== requestId.current) return;
        setError(reason instanceof Error ? reason.message : `Portlar okunamadı: ${String(reason)}`);
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    },
    [includeInfrastructure],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!interval) return;
    const timer = window.setInterval(() => void refresh(true), interval);
    return () => window.clearInterval(timer);
  }, [refresh, interval]);

  return { scan, loading, error, events, history, refresh };
}
