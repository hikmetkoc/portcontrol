import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkPort,
  clearRunLogs,
  findFreePort,
  lanAddresses,
  listRuns,
  onRunLog,
  onRunStatus,
  openExternalUrl,
  openFolder,
  openInEditor,
  probeService,
  removeRun,
  runLogs,
  saveRunLogToFile,
  scanWorkspace,
  startRun,
  stopProcesses,
  stopRun,
  windowControls,
  writeRunInput,
} from "./api";
import { AppConfigDialog, type ConfigTab } from "./components/AppConfigDialog";
import { ChainPanel, type ChainState, type ChainStep } from "./components/ChainPanel";
import { ActivityBar, StatusBar, TitleBar, type ViewId } from "./components/Chrome";
import { EventsView, type ActivityEntry } from "./components/EventsView";
import {
  BootSplash,
  CommandPalette,
  ConfirmStopDialog,
  NewProjectDialog,
  PortConflictDialog,
  SettingsDialog,
  Toasts,
  type PaletteCommand,
  type Toast,
} from "./components/Overlays";
import { ProblemsView } from "./components/ProblemsView";
import { ProjectView, useProjectRuntimes, type ProjectViewHandlers } from "./components/ProjectView";
import { Screensaver, isScreensaverShortcut, screensaverShortcutLabel } from "./components/Screensaver";
import { QrDialog, hostHintFor, type QrTarget } from "./components/QrDialog";
import { RadarView, identifyServices, type ServiceIdentity } from "./components/RadarView";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { Welcome } from "./components/Welcome";
import { usePortScan } from "./hooks/usePortScan";
import {
  dependencyClosure,
  resolveDependencies,
  topologicalOrder,
} from "./lib/dependencies";
import { DEFAULT_SETTINGS, effectiveHealthPath, resolveLaunch } from "./lib/launch";
import {
  applyRescan,
  createProject,
  loadPreferences,
  loadProjects,
  savePreferences,
  saveProjects,
  type Preferences,
} from "./lib/projectStore";
import { buildRuntimes, isActive, networkUrls, type AppRuntime, type HealthState } from "./lib/runtime";
import { stripAnsi } from "./lib/ansi";
import { runKey, runStore, useProblems, useRuns, type Problem, type RunRecord } from "./state/runStore";
import type { AppKind, AppSettings, EnvPair, PortCheck, ProcessPortGroup, Project } from "./types";

const LAUNCH_ORDER: AppKind[] = ["infra", "backend", "fullstack", "frontend", "desktop"];

let toastCounter = 0;

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function waitForExit(runId: string, timeout = 10000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe();
      window.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (runStore.getRun(runId)?.status !== "running") done();
    };
    const unsubscribe = runStore.subscribeStatus(check);
    const timer = window.setTimeout(done, timeout);
    check();
  });
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Çökme bekçisinin ardışık denemeler arasındaki bekleme süreleri. */
const RESTART_BACKOFF = [2000, 5000, 10000];
/** Zincirde bir uygulamanın hazır olması için beklenecek en uzun süre. */
const READY_TIMEOUT = 240_000;
let chainCounter = 0;

export default function App() {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [view, setView] = useState<ViewId>("projects");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => loadProjects()[0]?.id ?? null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(310);
  const [panelMaximized, setPanelMaximized] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopTarget, setStopTarget] = useState<ProcessPortGroup | null>(null);
  const [stopping, setStopping] = useState(false);
  const [conflict, setConflict] = useState<{
    runtime: AppRuntime;
    check: PortCheck;
    suggestion: number | null;
  } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [booting, setBooting] = useState(() => loadPreferences().bootAnimation);
  const [rescanningId, setRescanningId] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [eventsSeenAt, setEventsSeenAt] = useState(() => Date.now());
  const [health, setHealth] = useState<Map<string, HealthState>>(new Map());
  const [chain, setChain] = useState<ChainState | null>(null);
  const [configTarget, setConfigTarget] = useState<{ key: string; tab: ConfigTab } | null>(null);
  const [qrTarget, setQrTarget] = useState<QrTarget | null>(null);
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [focusSeq, setFocusSeq] = useState<{ runId: string; seq: number; at: number } | null>(null);
  const [screensaver, setScreensaver] = useState(false);
  const [problemRunFilter, setProblemRunFilter] = useState<string | null>(null);
  const [problemsSeenAt, setProblemsSeenAt] = useState(() => Date.now());
  const problems = useProblems();

  const { scan, loading, error, events, history, refresh } = usePortScan(
    preferences.includeInfrastructure,
    preferences.refreshInterval,
  );
  const runs = useRuns();
  const processes = useMemo(() => scan?.processes ?? [], [scan]);
  const runtimes = useMemo(
    () => buildRuntimes(projects, runs, processes, health),
    [projects, runs, processes, health],
  );
  const services = useMemo(() => identifyServices(processes, runtimes, projects), [processes, runtimes, projects]);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeRuntimes = useProjectRuntimes(activeProject, runtimes);

  // Güncel değerleri olay dinleyicilerinden okumak için referanslar.
  const mainRef = useRef<HTMLElement>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const runtimesRef = useRef(runtimes);
  runtimesRef.current = runtimes;
  /** Çökme bekçisi: uygulama başına deneme sayısı ve ilk denemenin zamanı. */
  const restartAttempts = useRef(new Map<string, { count: number; since: number }>());

  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view, activeProjectId]);
  useEffect(() => savePreferences(preferences), [preferences]);

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++toastCounter;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismissToast(id), toast.tone === "error" ? 9000 : 5200);
    },
    [dismissToast],
  );

  const addActivity = useCallback((entry: Omit<ActivityEntry, "id" | "at">) => {
    setActivity((list) => [{ ...entry, id: `${Date.now()}-${Math.random()}`, at: Date.now() }, ...list].slice(0, 120));
  }, []);

  const rescanProject = useCallback(
    async (project: Project, silent = false) => {
      setRescanningId(project.id);
      try {
        const result = await scanWorkspace(project.path);
        const before = new Set(project.apps.map((app) => app.id));
        const added = result.apps.filter((app) => !before.has(app.id)).length;
        const removed = project.apps.filter((app) => !result.apps.some((item) => item.id === app.id)).length;
        setProjects((list) => list.map((item) => (item.id === project.id ? applyRescan(item, result) : item)));
        if (!silent) {
          pushToast({
            tone: "success",
            title: `${project.name} yeniden tarandı`,
            detail: `${result.apps.length} uygulama${added ? ` · +${added} yeni` : ""}${removed ? ` · −${removed} kaldırıldı` : ""}`,
          });
        }
      } catch (reason) {
        if (!silent) pushToast({ tone: "error", title: "Klasör taranamadı", detail: errorMessage(reason) });
      } finally {
        setRescanningId(null);
      }
    },
    [pushToast],
  );

  // Arka uç olaylarına abone ol ve sayfa yenilendiyse mevcut çalıştırmaları geri yükle.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const offLog = await onRunLog((payload) => runStore.appendLogs(payload.runId, payload.lines));
      const offStatus = await onRunStatus((info) => runStore.upsertRun(info));
      if (disposed) {
        offLog();
        offStatus();
        return;
      }
      unlisteners.push(offLog, offStatus);
      try {
        const existing = await listRuns();
        for (const info of existing) {
          runStore.upsertRun(info);
          runStore.setLogs(info.runId, await runLogs(info.runId));
        }
      } catch {
        // Çalıştırıcı henüz hazır değilse yoksay.
      }
    })();
    return () => {
      disposed = true;
      unlisteners.forEach((off) => off());
    };
  }, []);

  useEffect(
    () =>
      runStore.onEvent((event) => {
        const { run } = event;
        if (event.type === "ready") {
          addActivity({ kind: "ready", title: `${run.label} hazır`, detail: event.url });
          if (preferencesRef.current.notifyReady) {
            pushToast({
              tone: "success",
              title: `${run.label} yayında`,
              detail: event.url,
              action: { label: "Aç", run: () => void openExternalUrl(event.url) },
            });
          }
          void refresh(true);
          return;
        }
        // Süreç sonlandı.
        if (run.status === "failed") {
          const reason = run.crash?.title ?? `çıkış kodu ${run.exitCode ?? "?"}`;
          addActivity({ kind: "crash", title: `${run.label} çöktü`, detail: reason });
          const watchdog = watchdogRef.current?.(run) ?? null;
          pushToast({
            tone: "error",
            title: `${run.label} çöktü`,
            detail:
              watchdog === "exhausted"
                ? `${reason}. Çökme bekçisi 3 denemeden sonra durdu.`
                : watchdog
                  ? `${reason}. ${watchdog.delay / 1000} sn sonra yeniden başlatılıyor (${watchdog.attempt}/3).`
                  : `${reason}${run.crash?.hint ? ` — ${run.crash.hint}` : ""}`,
            action: {
              label: "Hata satırı",
              run: () => {
                setActiveRunId(run.runId);
                setPanelOpen(true);
                if (run.crash?.seq) setFocusSeq({ runId: run.runId, seq: run.crash.seq, at: Date.now() });
              },
            },
          });
        } else {
          addActivity({
            kind: run.status === "stopped" ? "stop" : "exit",
            title: `${run.label} ${run.status === "stopped" ? "durduruldu" : "tamamlandı"}`,
            detail: run.command,
          });
        }
        if (run.appId.endsWith(":install") && run.status === "exited") {
          const project = projectsRef.current.find((item) => item.id === run.projectId);
          if (project) void rescanProject(project, true);
          pushToast({ tone: "success", title: "Bağımlılıklar kuruldu", detail: run.label });
        }
        void refresh(true);
      }),
    [addActivity, pushToast, refresh, rescanProject],
  );

  // ---------------------------------------------------------------------------
  // Çalıştırma eylemleri
  // ---------------------------------------------------------------------------

  const execRun = useCallback(
    async (input: {
      runtime: AppRuntime;
      appId: string;
      label: string;
      command: string;
      env: EnvPair[];
      port: number | null;
      focus?: boolean;
    }) => {
      try {
        const info = await startRun({
          appId: input.appId,
          projectId: input.runtime.project.id,
          label: input.label,
          cwd: input.runtime.app.path,
          command: input.command,
          env: input.env,
          port: input.port,
        });
        runStore.upsertRun(info);
        if (input.focus !== false) {
          setActiveRunId(info.runId);
          setPanelOpen(true);
        }
        addActivity({ kind: "start", title: `${input.label} başlatıldı`, detail: input.command });
        return info;
      } catch (reason) {
        pushToast({ tone: "error", title: `${input.label} başlatılamadı`, detail: errorMessage(reason) });
        return null;
      }
    },
    [addActivity, pushToast],
  );

  const startApp = useCallback(
    async (
      runtime: AppRuntime,
      options: { portOverride?: number; skipCheck?: boolean; focus?: boolean; fromWatchdog?: boolean } = {},
    ) => {
      if (!options.fromWatchdog) restartAttempts.current.delete(runtime.key);
      const settings = runtime.project.settings[runtime.app.id];
      const launch = resolveLaunch(runtime.app, settings, options.portOverride);
      if (!launch.command) {
        pushToast({ tone: "error", title: "Komut bulunamadı", detail: `${runtime.app.name} için çalıştırma komutu yok.` });
        return null;
      }
      if (!options.skipCheck && launch.port) {
        const check = await checkPort(launch.port).catch(() => null);
        if (check && !check.free) {
          const suggestion = runtime.app.portConfigurable
            ? await findFreePort(launch.port + 1).catch(() => null)
            : null;
          setConflict({ runtime, check, suggestion });
          return null;
        }
      }
      return execRun({
        runtime,
        appId: runtime.app.id,
        label: runtime.app.name,
        command: launch.command,
        env: launch.env,
        port: launch.port,
        focus: options.focus,
      });
    },
    [execRun, pushToast],
  );

  const stopApp = useCallback(async (runtime: AppRuntime) => {
    if (runtime.run?.status === "running") {
      await stopRun(runtime.run.runId).catch(() => undefined);
    }
  }, []);

  const restartApp = useCallback(
    async (runtime: AppRuntime) => {
      const current = runtime.run;
      if (current?.status === "running") {
        await stopRun(current.runId).catch(() => undefined);
        await waitForExit(current.runId);
        await delay(350);
      }
      await startApp(runtime, { skipCheck: true });
    },
    [startApp],
  );

  /** Çöken uygulamayı artan beklemelerle yeniden başlatır; sonuç bildirime yazılır. */
  const watchdogRef = useRef<((run: RunRecord) => { attempt: number; delay: number } | "exhausted" | null) | null>(null);
  watchdogRef.current = (run) => {
    const baseId = run.appId.split(":")[0];
    if (baseId !== run.appId) return null;
    const runtime = runtimesRef.current.get(runKey(run.projectId, baseId));
    if (!runtime?.settings.autoRestart) return null;
    const now = Date.now();
    let entry = restartAttempts.current.get(runtime.key);
    const lived = (run.endedAt ?? now) - run.startedAt;
    if (!entry || now - entry.since > 10 * 60_000 || lived > 120_000) entry = { count: 0, since: now };
    if (entry.count >= RESTART_BACKOFF.length) {
      // Zincirin beklemeyi bırakması için tükenmiş olarak işaretle.
      entry.count = RESTART_BACKOFF.length + 1;
      restartAttempts.current.set(runtime.key, entry);
      return "exhausted";
    }
    const wait = RESTART_BACKOFF[entry.count];
    entry.count += 1;
    restartAttempts.current.set(runtime.key, entry);
    window.setTimeout(() => {
      const fresh = runtimesRef.current.get(runtime.key);
      if (!fresh || isActive(fresh.state)) return;
      addActivity({ kind: "start", title: `${fresh.app.name} bekçi tarafından yeniden başlatılıyor`, detail: `deneme ${entry!.count}/3` });
      void startApp(fresh, { skipCheck: true, focus: false, fromWatchdog: true });
    }, wait);
    return { attempt: entry.count, delay: wait };
  };

  const updateSettings = useCallback((project: Project, appId: string, patch: Partial<AppSettings>) => {
    setProjects((list) =>
      list.map((item) =>
        item.id === project.id
          ? {
              ...item,
              settings: {
                ...item.settings,
                [appId]: { ...DEFAULT_SETTINGS, ...item.settings[appId], ...patch },
              },
            }
          : item,
      ),
    );
  }, []);

  /** Port hazır olana (HTTP sağlık yolu < 500 ya da TCP bağlantısı) kadar bekler. */
  const waitUntilReady = useCallback(
    async (
      port: number,
      path: string | null,
      runId: string | null,
      timeout: number,
      watchdogKey: string | null = null,
    ) => {
      const deadline = Date.now() + timeout;
      let firstHttpAt: number | null = null;
      let watched = runId;
      while (Date.now() < deadline) {
        if (watched) {
          const status = runStore.getRun(watched)?.status;
          if (status && status !== "running") {
            // Çökme bekçisi yeniden başlatacaksa yeni süreci beklemeye devam et.
            const attempts = watchdogKey ? (restartAttempts.current.get(watchdogKey)?.count ?? 0) : Infinity;
            if (status === "failed" && attempts <= RESTART_BACKOFF.length) {
              watched = null;
            } else {
              return {
                ready: false,
                note: status === "failed" ? (watchdogKey ? "bekçi 3 denemeden sonra durdu" : "süreç çöktü") : "süreç sonlandı",
              };
            }
          }
        } else if (watchdogKey) {
          // Bekçinin başlattığı yeni çalıştırmayı takip et.
          const current = runtimesRef.current.get(watchdogKey)?.run;
          if (current && current.runId !== runId && current.status === "running") watched = current.runId;
        }
        const probe = await probeService(port, path, 1500).catch(() => null);
        if (probe?.ok) return { ready: true, note: probe.status ? `HTTP ${probe.status}` : "TCP açık" };
        // Sağlık uç noktası 5xx dönmeye devam ediyorsa servis yine de ayakta sayılır.
        if (probe?.status) {
          firstHttpAt ??= Date.now();
          if (Date.now() - firstHttpAt > 20_000) return { ready: true, note: `yanıt veriyor (sağlık ${probe.status})` };
        }
        await delay(1200);
      }
      return { ready: false, note: "zaman aşımı" };
    },
    [],
  );

  const startChain = useCallback(
    async (project: Project, targetIds: string[]) => {
      const graph = resolveDependencies(project);
      const appOf = (appId: string) => project.apps.find((app) => app.id === appId);
      const kindRank = (appId: string) => LAUNCH_ORDER.indexOf(appOf(appId)?.kind ?? "desktop");
      const ids = dependencyClosure(graph, targetIds);
      const { order, cyclic } = topologicalOrder(graph, ids, (a, b) => kindRank(a) - kindRank(b));
      if (cyclic) {
        pushToast({
          tone: "warn",
          title: "Döngüsel bağımlılık",
          detail: "Bazı uygulamalar birbirine bağımlı; döngüdekiler tür sırasına göre başlatılacak.",
        });
      }
      const chainId = ++chainCounter;
      const steps: ChainStep[] = order.map((appId) => ({
        appId,
        name: appOf(appId)?.name ?? appId,
        stack: appOf(appId)?.stack ?? "node",
        status: "waiting",
        detail: "sırada",
        startedAt: null,
        finishedAt: null,
      }));
      setChain({ id: chainId, projectName: project.name, accent: project.accent, steps, done: false, startedAt: Date.now() });
      const update = (appId: string, patch: Partial<ChainStep>) =>
        setChain((current) =>
          current && current.id === chainId
            ? { ...current, steps: current.steps.map((step) => (step.appId === appId ? { ...step, ...patch } : step)) }
            : current,
        );

      // Harici gereksinimler (veritabanı vb.) ayakta mı?
      const externals = new Map<number, string>();
      for (const appId of order) {
        for (const item of graph.byApp.get(appId)?.external ?? []) {
          if (!externals.has(item.port)) externals.set(item.port, item.label);
        }
      }
      for (const [port, label] of externals) {
        const probe = await probeService(port, null, 800).catch(() => null);
        if (!probe?.ok) {
          pushToast({
            tone: "warn",
            title: `${label} :${port} yanıt vermiyor`,
            detail: "Bu servise bağlanan uygulamalar başlasa da çalışmayabilir.",
          });
        }
      }

      const reserved: number[] = [];
      const results = new Map<string, Promise<boolean>>();
      for (const appId of order) {
        const dependencies = (graph.byApp.get(appId)?.internal ?? [])
          .map((item) => item.appId)
          .filter((dependency) => results.has(dependency));
        const task = (async () => {
          if (dependencies.length) {
            update(appId, { detail: `bekliyor: ${dependencies.map((dependency) => appOf(dependency)?.name).join(", ")}` });
            const outcomes = await Promise.all(dependencies.map((dependency) => results.get(dependency)!));
            if (outcomes.some((ok) => !ok)) {
              update(appId, { status: "skipped", detail: "bağımlılık hazır olmadı", finishedAt: Date.now() });
              return false;
            }
          }
          const runtime = runtimesRef.current.get(runKey(project.id, appId));
          if (!runtime) {
            update(appId, { status: "failed", detail: "uygulama bulunamadı", finishedAt: Date.now() });
            return false;
          }
          const launch = resolveLaunch(runtime.app, runtime.settings);
          const healthPath = effectiveHealthPath(runtime.app, runtime.settings);

          if (isActive(runtime.state) || runtime.state === "external") {
            const port = runtime.displayPort ?? launch.port;
            if (port) {
              update(appId, { status: "starting", detail: "zaten çalışıyor, hazır olması bekleniyor", startedAt: Date.now() });
              const result = await waitUntilReady(port, healthPath, runtime.run?.status === "running" ? runtime.run.runId : null, 60_000);
              update(appId, {
                status: result.ready ? "already" : "failed",
                detail: result.ready ? `zaten çalışıyor · ${result.note}` : result.note,
                finishedAt: Date.now(),
              });
              return result.ready;
            }
            update(appId, { status: "already", detail: "zaten çalışıyor", finishedAt: Date.now() });
            return true;
          }

          let port = launch.port;
          let portOverride: number | undefined;
          if (port) {
            const listening = (await probeService(port, null, 600).catch(() => null))?.ok ?? false;
            if (listening && (graph.dependents.get(appId) ?? []).length > 0) {
              // Başka bir yerde (IDE, terminal) zaten çalışıyor; bağımlılar onu kullanır.
              update(appId, { status: "already", detail: `:${port} zaten dinleniyor`, finishedAt: Date.now() });
              return true;
            }
            if ((listening || reserved.includes(port)) && runtime.app.portConfigurable) {
              const free = await findFreePort(port + 1, reserved).catch(() => null);
              if (free) {
                pushToast({ tone: "warn", title: `${runtime.app.name}: :${port} dolu`, detail: `:${free} portunda başlatılıyor.` });
                portOverride = free;
                port = free;
              }
            }
            reserved.push(port);
          }

          update(appId, { status: "starting", detail: port ? `başlatılıyor · :${port}` : "başlatılıyor", startedAt: Date.now() });
          const info = await startApp(runtime, { portOverride, skipCheck: true, focus: false });
          if (!info) {
            update(appId, { status: "failed", detail: "başlatılamadı", finishedAt: Date.now() });
            return false;
          }
          if (!port) {
            await delay(2500);
            const alive = runStore.getRun(info.runId)?.status === "running";
            update(appId, { status: alive ? "ready" : "failed", detail: alive ? "çalışıyor" : "süreç sonlandı", finishedAt: Date.now() });
            return alive;
          }
          update(appId, { detail: `hazır olması bekleniyor · ${healthPath ? `GET ${healthPath}` : `TCP :${port}`}` });
          const result = await waitUntilReady(
            port,
            healthPath,
            info.runId,
            READY_TIMEOUT,
            runtime.settings.autoRestart ? runtime.key : null,
          );
          update(appId, {
            status: result.ready ? "ready" : "failed",
            detail: result.ready ? `hazır · :${port} · ${result.note}` : result.note,
            finishedAt: Date.now(),
          });
          return result.ready;
        })();
        results.set(appId, task);
        await delay(120);
      }
      const outcomes = await Promise.all(results.values());
      setChain((current) => (current && current.id === chainId ? { ...current, done: true } : current));
      if (outcomes.every(Boolean)) {
        pushToast({ tone: "success", title: `${project.name} hazır`, detail: `${order.length} uygulama ayakta.` });
        window.setTimeout(
          () => setChain((current) => (current && current.id === chainId ? null : current)),
          8000,
        );
      }
    },
    [pushToast, startApp, waitUntilReady],
  );

  const startAll = useCallback(
    async (project: Project) => {
      const targets = project.apps
        .map((app) => runtimesRef.current.get(runKey(project.id, app.id)))
        .filter((runtime): runtime is AppRuntime => Boolean(runtime))
        .filter((runtime) => !isActive(runtime.state) && runtime.state !== "external")
        .map((runtime) => runtime.app.id);
      if (!targets.length) {
        pushToast({ tone: "info", title: "Başlatılacak uygulama yok", detail: "Tüm uygulamalar zaten çalışıyor." });
        return;
      }
      await startChain(project, targets);
    },
    [pushToast, startChain],
  );

  const stopAll = useCallback(
    async (project: Project) => {
      const active = project.apps
        .map((app) => runtimes.get(runKey(project.id, app.id)))
        .filter((runtime): runtime is AppRuntime => Boolean(runtime?.run && runtime.run.status === "running"));
      await Promise.all(active.map((runtime) => stopApp(runtime)));
    },
    [runtimes, stopApp],
  );

  const installDeps = useCallback(
    async (runtime: AppRuntime) => {
      if (!runtime.app.installCommand) return;
      await execRun({
        runtime,
        appId: `${runtime.app.id}:install`,
        label: `${runtime.app.name} · install`,
        command: runtime.app.installCommand,
        env: [],
        port: null,
      });
    },
    [execRun],
  );

  const runScript = useCallback(
    async (runtime: AppRuntime, scriptName: string) => {
      const script = runtime.app.scripts.find((item) => item.name === scriptName);
      if (!script) return;
      await execRun({
        runtime,
        appId: `${runtime.app.id}:${script.name}`,
        label: `${runtime.app.name} · ${script.name}`,
        command: script.command,
        env: [],
        port: null,
      });
    },
    [execRun],
  );

  const openUrl = useCallback(
    (url: string) => {
      void openExternalUrl(url).catch((reason) =>
        pushToast({ tone: "error", title: "Adres açılamadı", detail: errorMessage(reason) }),
      );
    },
    [pushToast],
  );

  const revealFolder = useCallback(
    (path: string) => {
      void openFolder(path).catch((reason) =>
        pushToast({ tone: "error", title: "Klasör açılamadı", detail: errorMessage(reason) }),
      );
    },
    [pushToast],
  );

  const openEditor = useCallback(
    (path: string) => {
      void openInEditor(path, preferencesRef.current.editorCommand).catch((reason) =>
        pushToast({ tone: "error", title: "Editör açılamadı", detail: errorMessage(reason) }),
      );
    },
    [pushToast],
  );

  const showLogs = useCallback((runId: string, seq?: number | null) => {
    setActiveRunId(runId);
    setPanelOpen(true);
    if (seq) setFocusSeq({ runId, seq, at: Date.now() });
  }, []);

  const saveLog = useCallback(
    async (run: RunRecord) => {
      const stamp = new Date(run.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const fileName = `${run.label.replace(/[^\w.-]+/g, "_")}-${stamp}.log`;
      try {
        if (windowControls.available()) {
          const count = await saveRunLogToFile(run.runId, fileName);
          if (count !== null) pushToast({ tone: "success", title: "Log kaydedildi", detail: `${count.toLocaleString("tr-TR")} satır · ${fileName}` });
        } else {
          const text = runStore
            .getLogs(run.runId)
            .map((line) => stripAnsi(line.text))
            .join("\n");
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(link.href);
        }
      } catch (reason) {
        pushToast({ tone: "error", title: "Log kaydedilemedi", detail: errorMessage(reason) });
      }
    },
    [pushToast],
  );

  const showProblemInConsole = useCallback((problem: Problem) => {
    setActiveRunId(problem.runId);
    setPanelOpen(true);
    setPanelMaximized(false);
    setFocusSeq({ runId: problem.runId, seq: problem.lastSeq, at: Date.now() });
  }, []);

  /** Telefon/tablet için QR penceresi: LAN adresleri yoksa ağa açma önerisi gösterilir. */
  const showQr = useCallback(
    (title: string, port: number | null, urls: string[], stack: string, framework: string) => {
      const ipv4 = lanIps.filter((ip) => !ip.includes(":"));
      setQrTarget({
        title: port ? `${title} :${port}` : title,
        port,
        urls,
        suggestedUrls: port ? ipv4.map((ip) => `http://${ip}:${port}`) : [],
        hostHint: hostHintFor(stack, framework),
      });
    },
    [lanIps],
  );

  // Açılışta projeleri sessizce yeniden tara: yeni tespit özellikleri (bağımlılıklar,
  // profiller, sağlık yolları) eski kayıtlara da yansır, silinen klasörler bozulmaz.
  useEffect(() => {
    projectsRef.current.forEach((project) => void rescanProject(project, true));
    // Yalnızca ilk açılışta.
  }, []);

  // Ekran koruyucu: tam ekrana geç, çıkınca önceki duruma dön.
  useEffect(() => {
    if (!screensaver) return;
    let wasFullscreen = false;
    void windowControls
      .isFullscreen()
      .then((value) => {
        wasFullscreen = value;
        if (!value) return windowControls.setFullscreen(true);
      })
      .catch(() => undefined);
    return () => {
      if (!wasFullscreen) void windowControls.setFullscreen(false).catch(() => undefined);
    };
  }, [screensaver]);

  // Belirlenen süre boyunca etkileşim olmazsa ekran koruyucuyu aç.
  useEffect(() => {
    const minutes = preferences.screensaverIdle;
    if (!minutes) return;
    let lastActivity = Date.now();
    const mark = () => {
      lastActivity = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, mark, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity >= minutes * 60_000) {
        lastActivity = Date.now();
        setScreensaver(true);
      }
    }, 10_000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, mark));
      window.clearInterval(timer);
    };
  }, [preferences.screensaverIdle]);

  // Bu bilgisayarın LAN adresleri (QR için).
  useEffect(() => {
    void lanAddresses()
      .then(setLanIps)
      .catch(() => setLanIps([]));
  }, []);

  // Çalışan uygulamaların sağlık durumunu periyodik olarak yokla.
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const targets = [...runtimesRef.current.values()].filter(
          (runtime) => runtime.run?.status === "running" && runtime.displayPort,
        );
        const results = await Promise.all(
          targets.map(async (runtime): Promise<[string, HealthState]> => {
            const probe = await probeService(runtime.displayPort!, runtime.healthPath, 1500).catch((reason) => ({
              ok: false,
              status: null,
              latencyMs: 0,
              error: errorMessage(reason),
            }));
            return [runtime.key, { ...probe, at: Date.now(), path: runtime.healthPath }];
          }),
        );
        if (!cancelled) {
          setHealth((previous) => (results.length === 0 && previous.size === 0 ? previous : new Map(results)));
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const stopService = useCallback((service: ServiceIdentity) => {
    if (service.process.managedRunId) {
      void stopRun(service.process.managedRunId);
    } else {
      setStopTarget(service.process);
    }
  }, []);

  async function confirmExternalStop() {
    if (!stopTarget) return;
    setStopping(true);
    try {
      const [result] = await stopProcesses([{ pid: stopTarget.pid, startedAt: stopTarget.startedAt }]);
      if (result?.stopped) {
        pushToast({ tone: "success", title: `${stopTarget.projectName ?? stopTarget.displayName} durduruldu`, detail: result.message });
      } else {
        pushToast({ tone: "error", title: "Süreç durdurulamadı", detail: result?.message ?? "Bilinmeyen hata" });
      }
      setStopTarget(null);
      window.setTimeout(() => void refresh(true), 600);
    } catch (reason) {
      pushToast({ tone: "error", title: "Süreç durdurulamadı", detail: errorMessage(reason) });
    } finally {
      setStopping(false);
    }
  }

  function findRuntimeForRun(run: RunRecord): AppRuntime | null {
    const baseAppId = run.appId.split(":")[0];
    return runtimes.get(runKey(run.projectId, baseAppId)) ?? null;
  }

  async function restartRun(run: RunRecord) {
    const runtime = findRuntimeForRun(run);
    if (!runtime) return;
    if (run.appId === runtime.app.id) {
      await restartApp({ ...runtime, run });
      return;
    }
    if (run.status === "running") {
      await stopRun(run.runId).catch(() => undefined);
      await waitForExit(run.runId);
    }
    await execRun({ runtime, appId: run.appId, label: run.label, command: run.command, env: [], port: run.port });
  }

  async function closeRun(run: RunRecord) {
    if (run.status === "running") {
      await stopRun(run.runId).catch(() => undefined);
      await waitForExit(run.runId);
    }
    await removeRun(run.runId).catch(() => undefined);
    runStore.removeRun(run.runId);
    if (activeRunId === run.runId) {
      const remaining = runStore.getRuns();
      setActiveRunId(remaining[remaining.length - 1]?.runId ?? null);
    }
  }

  function createNewProject(result: Parameters<typeof createProject>[0], name: string) {
    const project = createProject(result, name, projects);
    setProjects((list) => [...list, project]);
    setActiveProjectId(project.id);
    setView("projects");
    setNewProjectOpen(false);
    pushToast({
      tone: "success",
      title: `${project.name} oluşturuldu`,
      detail: `${project.apps.length} uygulama tespit edildi.`,
    });
  }

  function removeProject(project: Project) {
    for (const app of project.apps) {
      const runtime = runtimes.get(runKey(project.id, app.id));
      if (runtime?.run?.status === "running") void stopRun(runtime.run.runId);
    }
    const remaining = projects.filter((item) => item.id !== project.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id ?? null);
    pushToast({ tone: "info", title: `${project.name} kaldırıldı`, detail: "Dosyalarınız silinmedi." });
  }

  const handlers: ProjectViewHandlers = {
    onStart: (runtime) => void startApp(runtime),
    onStop: (runtime) => void stopApp(runtime),
    onRestart: (runtime) => void restartApp(runtime),
    onInstall: (runtime) => void installDeps(runtime),
    onRunScript: (runtime, script) => void runScript(runtime, script),
    onUpdateSettings: updateSettings,
    onRescan: (project) => void rescanProject(project),
    onStartAll: (project) => void startAll(project),
    onStopAll: (project) => void stopAll(project),
    onRemove: removeProject,
    onRename: (project, name) =>
      setProjects((list) =>
        list.map((item) =>
          item.id === project.id ? { ...item, name: name.trim().slice(0, 60) || item.name } : item,
        ),
      ),
    onOpenFolder: revealFolder,
    onOpenEditor: openEditor,
    onShowLogs: showLogs,
    onOpenUrl: openUrl,
    onStopExternal: (process) => setStopTarget(process),
    onStartChain: (runtime) => void startChain(runtime.project, [runtime.app.id]),
    onConfigure: (runtime, tab = "env") => setConfigTarget({ key: runtime.key, tab }),
    onShowQr: (runtime) =>
      showQr(
        runtime.app.name,
        runtime.displayPort,
        runtime.networkUrls,
        runtime.app.stack,
        runtime.app.framework,
      ),
  };

  // ---------------------------------------------------------------------------
  // Kısayollar ve komut paleti
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (isScreensaverShortcut(event)) {
        event.preventDefault();
        setScreensaver(true);
        return;
      }
      if (mod && event.key === "4") {
        event.preventDefault();
        setView("problems");
        return;
      }
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      } else if (mod && (event.key === "`" || event.code === "Backquote")) {
        event.preventDefault();
        setPanelOpen((value) => !value);
      } else if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setNewProjectOpen(true);
      } else if (mod && event.key === "1") {
        event.preventDefault();
        setView("radar");
      } else if (mod && event.key === "2") {
        event.preventDefault();
        setView("projects");
      } else if (mod && event.key === "3") {
        event.preventDefault();
        setView("events");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (view === "events") setEventsSeenAt(Date.now());
  }, [view, events]);

  useEffect(() => {
    if (view === "problems") setProblemsSeenAt(Date.now());
  }, [view, problems]);

  const allRuntimes = useMemo(() => [...runtimes.values()], [runtimes]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      { id: "new", group: "Genel", label: "Yeni proje ekle", hint: "Ctrl+N", keywords: "klasör oluştur", run: () => setNewProjectOpen(true) },
      { id: "radar", group: "Genel", label: "Port radarını aç", hint: "Ctrl+1", keywords: "portlar canlı", run: () => setView("radar") },
      { id: "projects", group: "Genel", label: "Projeleri göster", hint: "Ctrl+2", run: () => setView("projects") },
      { id: "events", group: "Genel", label: "Olay akışını aç", hint: "Ctrl+3", keywords: "telemetri log", run: () => setView("events") },
      { id: "panel", group: "Genel", label: panelOpen ? "Konsolu gizle" : "Konsolu aç", hint: "Ctrl+`", keywords: "terminal log", run: () => setPanelOpen((value) => !value) },
      { id: "scan", group: "Genel", label: "Portları şimdi tara", keywords: "yenile refresh", run: () => void refresh() },
      {
        id: "infra",
        group: "Genel",
        label: preferences.includeInfrastructure ? "Altyapı servislerini gizle" : "Altyapı servislerini göster",
        keywords: "docker veritabanı postgres",
        run: () => setPreferences((value) => ({ ...value, includeInfrastructure: !value.includeInfrastructure })),
      },
      { id: "settings", group: "Genel", label: "Ayarlar", run: () => setSettingsOpen(true) },
      { id: "problems", group: "Genel", label: "Sorunları göster", hint: "Ctrl+4", keywords: "hata uyarı error warning", run: () => setView("problems") },
      {
        id: "screensaver",
        group: "Genel",
        label: "Ekran koruyucuyu başlat",
        hint: screensaverShortcutLabel(),
        keywords: "matrix kilit ekran",
        run: () => setScreensaver(true),
      },
    ];
    for (const project of projects) {
      list.push(
        {
          id: `go-${project.id}`,
          group: "Projeler",
          label: `Projeye git: ${project.name}`,
          hint: `${project.apps.length} uygulama`,
          accent: project.accent,
          keywords: project.path,
          run: () => {
            setActiveProjectId(project.id);
            setView("projects");
          },
        },
        { id: `all-${project.id}`, group: "Projeler", label: `Tümünü başlat: ${project.name}`, accent: project.accent, run: () => void startAll(project) },
        { id: `stopall-${project.id}`, group: "Projeler", label: `Tümünü durdur: ${project.name}`, accent: project.accent, run: () => void stopAll(project) },
        { id: `rescan-${project.id}`, group: "Projeler", label: `Yeniden tara: ${project.name}`, accent: project.accent, run: () => void rescanProject(project) },
      );
    }
    for (const runtime of allRuntimes) {
      const port = runtime.ports[0] ?? resolveLaunch(runtime.app, runtime.project.settings[runtime.app.id]).port;
      const keywords = `${runtime.app.framework} ${runtime.app.stack} ${runtime.project.name} ${port ?? ""}`;
      if (isActive(runtime.state)) {
        list.push(
          { id: `stop-${runtime.key}`, group: "Uygulamalar", label: `Durdur: ${runtime.app.name}`, hint: runtime.project.name, keywords, accent: runtime.project.accent, run: () => void stopApp(runtime) },
          { id: `restart-${runtime.key}`, group: "Uygulamalar", label: `Yeniden başlat: ${runtime.app.name}`, hint: runtime.project.name, keywords, accent: runtime.project.accent, run: () => void restartApp(runtime) },
        );
        if (runtime.run) {
          const runId = runtime.run.runId;
          list.push({ id: `logs-${runtime.key}`, group: "Uygulamalar", label: `Loglar: ${runtime.app.name}`, hint: runtime.project.name, keywords, accent: runtime.project.accent, run: () => showLogs(runId) });
        }
      } else {
        list.push({
          id: `start-${runtime.key}`,
          group: "Uygulamalar",
          label: `Başlat: ${runtime.app.name}`,
          hint: `${runtime.project.name}${port ? ` · :${port}` : ""}`,
          keywords,
          accent: runtime.project.accent,
          run: () => void startApp(runtime),
        });
      }
    }
    for (const service of services) {
      for (const port of new Set(service.process.ports.map((item) => item.port))) {
        list.push({
          id: `open-${service.process.pid}-${port}`,
          group: "Canlı portlar",
          label: `Aç: localhost:${port}`,
          hint: service.name,
          keywords: `${service.process.technology} ${port}`,
          run: () => openUrl(`http://localhost:${port}`),
        });
      }
    }
    return list;
  }, [allRuntimes, openUrl, panelOpen, preferences.includeInfrastructure, projects, refresh, rescanProject, restartApp, services, showLogs, startAll, startApp, stopAll, stopApp]);

  // ---------------------------------------------------------------------------
  // Görünüm
  // ---------------------------------------------------------------------------

  const runningCount = runs.filter((run) => run.status === "running").length;
  const portCount = new Set(processes.flatMap((process) => process.ports.map((port) => port.port))).size;
  const unseenEvents = view === "events" ? 0 : events.filter((event) => event.at > eventsSeenAt).length;
  const unseenProblems =
    view === "problems"
      ? 0
      : problems.filter((problem) => problem.severity === "error" && problem.lastAt > problemsSeenAt).length;
  const totalErrors = runs.filter((run) => run.status === "running").reduce((sum, run) => sum + run.errorCount, 0);

  return (
    <div className={`app-shell ${booting ? "is-booting" : ""}`}>
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-aurora" aria-hidden="true" />
      <div className="bg-scanlines" aria-hidden="true" />

      <TitleBar onOpenPalette={() => setPaletteOpen(true)} scanning={loading} />

      <div className="workbench">
        <ActivityBar
          view={view}
          onView={setView}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((value) => !value)}
          onOpenSettings={() => setSettingsOpen(true)}
          runningCount={runningCount}
          eventCount={unseenEvents}
          problemCount={unseenProblems}
          onScreensaver={() => setScreensaver(true)}
        />
        <Sidebar
          projects={projects}
          runtimes={runtimes}
          activeProjectId={view === "projects" ? activeProjectId : null}
          onSelectProject={(projectId) => {
            setActiveProjectId(projectId);
            setView("projects");
          }}
          onNewProject={() => setNewProjectOpen(true)}
          onStart={(runtime) => void startApp(runtime)}
          onStop={(runtime) => void stopApp(runtime)}
        />
        <div className="main-column">
          <main ref={mainRef} className={`main-area ${panelOpen && panelMaximized ? "is-hidden" : ""}`}>
            {error && (
              <div className="callout callout--red main-error">
                <span>{error}</span>
                <button type="button" className="link-button" onClick={() => void refresh()}>
                  tekrar dene
                </button>
              </div>
            )}
            {view === "radar" && (
              <RadarView
                scan={scan}
                loading={loading}
                services={services}
                history={history}
                includeInfrastructure={preferences.includeInfrastructure}
                onToggleInfrastructure={() =>
                  setPreferences((value) => ({ ...value, includeInfrastructure: !value.includeInfrastructure }))
                }
                onRefresh={() => void refresh()}
                onOpenUrl={openUrl}
                onStop={stopService}
                onShowLogs={showLogs}
                onOpenFolder={revealFolder}
                onSelectProject={(projectId) => {
                  setActiveProjectId(projectId);
                  setView("projects");
                }}
                onNewProject={() => setNewProjectOpen(true)}
                onShowQr={(service) =>
                  showQr(
                    service.name,
                    service.process.ports[0]?.port ?? null,
                    networkUrls([service.process]),
                    service.stack,
                    service.process.technology,
                  )
                }
                hasProjects={projects.length > 0}
              />
            )}
            {view === "projects" &&
              (activeProject ? (
                <ProjectView
                  key={activeProject.id}
                  project={activeProject}
                  runtimes={activeRuntimes}
                  history={history}
                  rescanning={rescanningId === activeProject.id}
                  scanStamp={scan?.scannedAt ?? 0}
                  handlers={handlers}
                />
              ) : (
                <Welcome onNewProject={() => setNewProjectOpen(true)} onOpenRadar={() => setView("radar")} />
              ))}
            {view === "problems" && (
              <ProblemsView
                problems={problems}
                runs={runs}
                projects={projects}
                runFilter={problemRunFilter}
                onRunFilter={setProblemRunFilter}
                onShowInConsole={showProblemInConsole}
                onClear={(runId) => runStore.clearProblems(runId)}
              />
            )}
            {view === "events" && (
              <EventsView portEvents={events} activity={activity} onClear={() => setActivity([])} />
            )}
          </main>
          {panelOpen && (
            <TerminalPanel
              runs={runs}
              focus={focusSeq}
              onSaveLog={(run) => void saveLog(run)}
              onShowProblems={(run) => {
                setProblemRunFilter(run.runId);
                setView("problems");
              }}
              activeRunId={activeRunId}
              height={panelHeight}
              maximized={panelMaximized}
              showTimestamps={preferences.showTimestamps}
              wrap={preferences.wrapLogs}
              onSelect={setActiveRunId}
              onClose={(run) => void closeRun(run)}
              onStop={(run) => void stopRun(run.runId)}
              onRestart={(run) => void restartRun(run)}
              onClear={(run) => {
                void clearRunLogs(run.runId);
                runStore.clearLogs(run.runId);
              }}
              onSendInput={(run, text) =>
                void writeRunInput(run.runId, text).catch((reason) =>
                  pushToast({ tone: "error", title: "Girdi gönderilemedi", detail: errorMessage(reason) }),
                )
              }
              onOpenUrl={openUrl}
              onResize={setPanelHeight}
              onToggleMaximize={() => setPanelMaximized((value) => !value)}
              onHide={() => setPanelOpen(false)}
              onToggleTimestamps={() => setPreferences((value) => ({ ...value, showTimestamps: !value.showTimestamps }))}
              onToggleWrap={() => setPreferences((value) => ({ ...value, wrapLogs: !value.wrapLogs }))}
            />
          )}
        </div>
      </div>

      <StatusBar
        portCount={portCount}
        runningCount={runningCount}
        projectCount={projects.length}
        platform={scan?.platform ?? null}
        scannedAt={scan?.scannedAt ?? null}
        refreshInterval={preferences.refreshInterval}
        errorCount={totalErrors}
        onShowProblems={() => setView("problems")}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      {newProjectOpen && (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onCreate={createNewProject}
          existingPaths={projects.map((project) => project.path)}
        />
      )}
      {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          preferences={preferences}
          onChange={(patch) => setPreferences((value) => ({ ...value, ...patch }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {stopTarget && (
        <ConfirmStopDialog
          process={stopTarget}
          busy={stopping}
          onCancel={() => !stopping && setStopTarget(null)}
          onConfirm={() => void confirmExternalStop()}
        />
      )}
      {conflict && (
        <PortConflictDialog
          appName={conflict.runtime.app.name}
          check={conflict.check}
          suggestion={conflict.suggestion}
          onCancel={() => setConflict(null)}
          onUseSuggestion={() => {
            const { runtime, suggestion } = conflict;
            setConflict(null);
            if (!suggestion) return;
            updateSettings(runtime.project, runtime.app.id, { portMode: "custom", customPort: suggestion });
            void startApp(runtime, { portOverride: suggestion, skipCheck: true });
          }}
          onForce={() => {
            const { runtime } = conflict;
            setConflict(null);
            void startApp(runtime, { skipCheck: true });
          }}
        />
      )}
      {chain && <ChainPanel chain={chain} onClose={() => setChain(null)} />}
      {screensaver && (
        <Screensaver
          words={[
            ...new Set([
              ...processes.flatMap((process) => process.ports.map((port) => `:${port.port}`)),
              ...projects.flatMap((project) => project.apps.map((app) => app.name)),
            ]),
          ]}
          stats={{ running: runningCount, ports: portCount, errors: totalErrors, projects: projects.length }}
          onExit={() => setScreensaver(false)}
        />
      )}
      {configTarget && runtimes.get(configTarget.key) && (
        <AppConfigDialog
          key={configTarget.key}
          runtime={runtimes.get(configTarget.key)!}
          apps={runtimes.get(configTarget.key)!.project.apps}
          initialTab={configTarget.tab}
          onSave={(patch) => {
            const target = runtimes.get(configTarget.key)!;
            updateSettings(target.project, target.app.id, patch);
            pushToast({ tone: "success", title: `${target.app.name} ayarları kaydedildi`, detail: "Bir sonraki başlatmada uygulanır." });
          }}
          onClose={() => setConfigTarget(null)}
          onNotify={(tone, title, detail) => pushToast({ tone, title, detail })}
        />
      )}
      {qrTarget && <QrDialog target={qrTarget} onClose={() => setQrTarget(null)} onOpenUrl={openUrl} />}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
      {booting && <BootSplash onDone={() => setBooting(false)} />}
    </div>
  );
}
