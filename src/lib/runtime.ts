import type { LedState } from "../components/ui";
import { latestRunsByApp, runKey, type RunRecord } from "../state/runStore";
import type { AppSettings, DetectedApp, ProbeResult, ProcessPortGroup, Project } from "../types";
import {
  resolveDependencies,
  type AppDependencies,
  type DependencyGraph,
  type PortExpectation,
} from "./dependencies";
import { effectiveHealthPath, matchProcessToApp, resolveLaunch, uniquePorts, withDefaults } from "./launch";

export interface HealthState extends ProbeResult {
  at: number;
  path: string | null;
}

export interface AppRuntime {
  key: string;
  app: DetectedApp;
  project: Project;
  settings: AppSettings;
  run: RunRecord | null;
  installRun: RunRecord | null;
  state: LedState;
  /** PortControl'ün başlattığı süreç ağacına ait canlı portlar. */
  ports: number[];
  urls: string[];
  /** Yerel ağdan (telefon vb.) erişilebilen adresler. */
  networkUrls: string[];
  /** Kartlarda gösterilecek port: canlıysa dinlenen, değilse sıradaki başlatmada kullanılacak port. */
  displayPort: number | null;
  /** Bu uygulamanın klasöründe PortControl dışından çalışan süreçler. */
  external: ProcessPortGroup[];
  processes: ProcessPortGroup[];
  cpu: number;
  memory: number;
  dependencies: AppDependencies;
  /** Diğer uygulamaların bu uygulamayı beklediği ama ayarlı portun farklı olduğu durumlar. */
  expectations: PortExpectation[];
  /** Bu uygulamaya bağımlı uygulama kimlikleri. */
  dependents: string[];
  healthPath: string | null;
  health: HealthState | null;
}

const EMPTY_DEPENDENCIES: AppDependencies = { internal: [], detected: [], external: [] };

export function buildRuntimes(
  projects: Project[],
  runs: RunRecord[],
  processes: ProcessPortGroup[],
  health: Map<string, HealthState> = new Map(),
): Map<string, AppRuntime> {
  const latest = latestRunsByApp(runs);
  const managedByRun = new Map<string, ProcessPortGroup[]>();
  const externalByApp = new Map<string, ProcessPortGroup[]>();

  for (const process of processes) {
    if (process.managedRunId) {
      const list = managedByRun.get(process.managedRunId) ?? [];
      list.push(process);
      managedByRun.set(process.managedRunId, list);
      continue;
    }
    for (const project of projects) {
      const app = matchProcessToApp(process, project.apps);
      if (app) {
        const key = runKey(project.id, app.id);
        const list = externalByApp.get(key) ?? [];
        list.push(process);
        externalByApp.set(key, list);
      }
    }
  }

  const map = new Map<string, AppRuntime>();
  for (const project of projects) {
    const graph: DependencyGraph = resolveDependencies(project);
    for (const app of project.apps) {
      const key = runKey(project.id, app.id);
      const settings = withDefaults(project.settings[app.id]);
      const run = latest.get(key) ?? null;
      const installRun = latest.get(runKey(project.id, `${app.id}:install`)) ?? null;
      const managed = run?.status === "running" ? (managedByRun.get(run.runId) ?? []) : [];
      const external = externalByApp.get(key) ?? [];
      const ports = [...new Set(managed.flatMap(uniquePorts))].sort((a, b) => a - b);
      const urls = run?.status === "running" ? mergeUrls(run.urls, managed) : [];
      let state: LedState = "idle";
      if (run?.status === "running") {
        state = ports.length || urls.length ? "running" : "starting";
      } else if (run && run.status !== "exited") {
        state = external.length ? "external" : run.status;
      } else if (external.length) {
        state = "external";
      }
      const displayPort =
        ports[0] ?? (run?.status === "running" ? run.port : null) ?? resolveLaunch(app, settings).port;
      map.set(key, {
        key,
        displayPort,
        app,
        project,
        settings,
        run,
        installRun,
        state,
        ports,
        urls,
        networkUrls: networkUrls([...managed, ...(run?.status === "running" ? [] : external)]),
        external,
        processes: managed,
        cpu: managed.reduce((total, item) => total + item.cpuUsagePercent, 0),
        memory: managed.reduce((total, item) => total + item.memoryBytes, 0),
        dependencies: graph.byApp.get(app.id) ?? EMPTY_DEPENDENCIES,
        expectations: graph.expectations.get(app.id) ?? [],
        dependents: graph.dependents.get(app.id) ?? [],
        healthPath: effectiveHealthPath(app, settings),
        health: health.get(key) ?? null,
      });
    }
  }
  return map;
}

function mergeUrls(fromLogs: string[], processes: ProcessPortGroup[]): string[] {
  const urls = new Set(fromLogs);
  for (const process of processes) {
    for (const port of process.ports) {
      const local = port.accessUrls.find((url) => url.includes("localhost"));
      if (local) urls.add(local);
    }
  }
  // Aynı portu gösteren adreslerden en kısa olanı tut.
  const byPort = new Map<string, string>();
  for (const url of urls) {
    const port = url.match(/:(\d+)/)?.[1] ?? url;
    const existing = byPort.get(port);
    if (!existing || url.length < existing.length) byPort.set(port, url);
  }
  return [...byPort.values()];
}

/** Süreçlerin erişim adreslerinden localhost dışındakiler (LAN IP'leri). */
export function networkUrls(processes: ProcessPortGroup[]): string[] {
  const urls = new Set<string>();
  for (const process of processes) {
    for (const port of process.ports) {
      for (const url of port.accessUrls) {
        if (!/\/\/(localhost|127\.|\[::1\])/.test(url)) urls.add(url);
      }
    }
  }
  return [...urls];
}

export function isActive(state: LedState): boolean {
  return state === "running" || state === "starting";
}
