import { useSyncExternalStore } from "react";
import type { CrashReport, LogLine, RunInfo } from "../types";
import { stripAnsi } from "../lib/ansi";
import { analyzeCrash } from "../lib/crash";
import { extractLocalUrls } from "../lib/launch";
import { classifyLine, detectProfile, isContinuation, isExceptionLine, problemKey } from "../lib/severity";

/** Arka uçtaki tamponla aynı: DEBUG log basan uygulamalarda başlangıç satırları kaybolmasın. */
const MAX_LINES = 50_000;
const TRIM_SLACK = 2_000;
const MAX_PROBLEMS_PER_RUN = 1_000;
const MAX_DETAIL_LINES = 60;

export interface RunRecord extends RunInfo {
  urls: string[];
  /** Ayrı (gruplanmış) hata ve uyarı sayıları. */
  errorCount: number;
  warnCount: number;
  lastLineAt: number | null;
  /** Süreç çöktüyse loglardan çıkarılan neden özeti. */
  crash: CrashReport | null;
  /** Loglardan okunan etkin profil (Spring "profiles are active", .NET ortamı vb.). */
  activeProfile: string | null;
  /** Bellekten düşen en eski satır sayısı. */
  droppedLines: number;
}

export interface Problem {
  id: string;
  runId: string;
  appId: string;
  projectId: string;
  label: string;
  severity: "error" | "warn";
  message: string;
  /** Stack trace / traceback satırları. */
  detail: string[];
  /** Aynı mesajın kaç kez tekrarlandığı. */
  count: number;
  firstSeq: number;
  lastSeq: number;
  firstAt: number;
  lastAt: number;
}

export type RunEvent =
  | { type: "ready"; run: RunRecord; url: string }
  | { type: "exit"; run: RunRecord };

type Listener = () => void;

const EMPTY_LOGS: LogLine[] = [];
const EMPTY_PROBLEMS: Problem[] = [];

interface ProblemState {
  list: Problem[];
  byKey: Map<string, Problem>;
  last: Problem | null;
}

/**
 * Çalıştırma kayıtları, log satırları ve sorunlar için hafif bir dış durum deposu.
 * Durum, log ve sorun değişiklikleri ayrı abonelik kanallarından yayılır; log
 * dizileri yerinde büyütülür ve sürüm numarasıyla bildirilir (her partide kopyalanmaz).
 */
class RunStore {
  private runs = new Map<string, RunRecord>();
  private logs = new Map<string, LogLine[]>();
  private logVersions = new Map<string, number>();
  private problems = new Map<string, ProblemState>();
  private runList: RunRecord[] = [];
  private problemList: Problem[] = EMPTY_PROBLEMS;

  private statusListeners = new Set<Listener>();
  private logListeners = new Set<Listener>();
  private problemListeners = new Set<Listener>();
  private eventListeners = new Set<(event: RunEvent) => void>();

  subscribeStatus = (listener: Listener) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  subscribeLogs = (listener: Listener) => {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  };

  subscribeProblems = (listener: Listener) => {
    this.problemListeners.add(listener);
    return () => this.problemListeners.delete(listener);
  };

  onEvent(listener: (event: RunEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getRuns = () => this.runList;

  getProblems = () => this.problemList;

  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getLogs(runId: string | null): LogLine[] {
    if (!runId) return EMPTY_LOGS;
    return this.logs.get(runId) ?? EMPTY_LOGS;
  }

  getLogVersion(runId: string | null): number {
    return runId ? (this.logVersions.get(runId) ?? 0) : 0;
  }

  upsertRun(info: RunInfo): void {
    const previous = this.runs.get(info.runId);
    // Hızlı sonlanan süreçlerde çıkış olayı başlatma yanıtından önce gelebilir; geri sarma.
    if (previous && previous.status !== "running" && info.status === "running") return;
    const record: RunRecord = {
      urls: [],
      errorCount: 0,
      warnCount: 0,
      lastLineAt: null,
      crash: null,
      activeProfile: null,
      droppedLines: 0,
      ...previous,
      ...info,
    };
    if (info.status === "failed" && !record.crash) {
      record.crash = analyzeCrash(this.logs.get(info.runId) ?? EMPTY_LOGS);
    }
    this.runs.set(info.runId, record);
    this.publishStatus();
    if (previous?.status === "running" && info.status !== "running") {
      this.emit({ type: "exit", run: record });
    }
  }

  setLogs(runId: string, lines: LogLine[]): void {
    this.logs.set(runId, []);
    this.problems.delete(runId);
    this.appendLogs(runId, lines);
  }

  appendLogs(runId: string, lines: LogLine[]): void {
    if (!lines.length) return;
    let current = this.logs.get(runId);
    if (!current) {
      current = [];
      this.logs.set(runId, current);
    }
    const lastSeq = current.length ? current[current.length - 1].seq : 0;
    const fresh = lines.filter((line) => line.seq > lastSeq);
    if (!fresh.length) return;
    for (const line of fresh) current.push(line);
    let dropped = 0;
    if (current.length > MAX_LINES + TRIM_SLACK) {
      dropped = current.length - MAX_LINES;
      current.splice(0, dropped);
    }
    this.logVersions.set(runId, (this.logVersions.get(runId) ?? 0) + 1);

    const run = this.runs.get(runId);
    if (run) {
      let urls = run.urls;
      let activeProfile = run.activeProfile;
      let firstUrl: string | null = null;
      const problemsChanged = this.collectProblems(run, fresh);
      for (const line of fresh) {
        if (line.stream !== "stdout" && line.stream !== "stderr") continue;
        for (const url of extractLocalUrls(line.text)) {
          if (!urls.includes(url)) {
            if (!urls.length) firstUrl = url;
            urls = [...urls, url];
          }
        }
        if (line.text.includes("profile") || line.text.includes("Hosting environment") || line.text.includes("activated")) {
          activeProfile = detectProfile(stripAnsi(line.text)) ?? activeProfile;
        }
      }
      const state = this.problems.get(runId);
      const errorCount = state?.list.filter((problem) => problem.severity === "error").length ?? 0;
      const warnCount = (state?.list.length ?? 0) - errorCount;
      const changed =
        urls !== run.urls ||
        errorCount !== run.errorCount ||
        warnCount !== run.warnCount ||
        activeProfile !== run.activeProfile ||
        dropped > 0;
      const updated: RunRecord = {
        ...run,
        urls,
        errorCount,
        warnCount,
        activeProfile,
        droppedLines: run.droppedLines + dropped,
        lastLineAt: Date.now(),
      };
      this.runs.set(runId, updated);
      if (changed) this.publishStatus();
      if (problemsChanged) this.publishProblems();
      if (firstUrl && updated.status === "running") {
        this.emit({ type: "ready", run: updated, url: firstUrl });
      }
    }
    this.logListeners.forEach((listener) => listener());
  }

  /** Hata/uyarı satırlarını sorunlara dönüştürür; stack trace satırlarını öncekine ekler. */
  private collectProblems(run: RunRecord, lines: LogLine[]): boolean {
    let state = this.problems.get(run.runId);
    if (!state) {
      state = { list: [], byKey: new Map(), last: null };
      this.problems.set(run.runId, state);
    }
    let changed = false;
    for (const line of lines) {
      if (line.stream !== "stdout" && line.stream !== "stderr") continue;
      const text = stripAnsi(line.text);
      if (!text.trim()) continue;
      const last = state.last;
      const near = last !== null && line.seq - last.lastSeq <= 3;

      // Python traceback: asıl istisna son satırdadır; başlığı onunla değiştir.
      if (last && near && last.message.startsWith("Traceback") && !isContinuation(text) && classifyLine(text) === "error") {
        last.detail.unshift(last.message);
        last.message = text.trim();
        last.lastSeq = line.seq;
        changed = true;
        continue;
      }

      // Stack trace devamı ya da ERROR satırının hemen ardından gelen istisna satırı.
      if (last && near && (isContinuation(text) || (isExceptionLine(text) && line.seq - last.lastSeq === 1))) {
        if (last.detail.length < MAX_DETAIL_LINES) last.detail.push(text.replace(/\s+$/, ""));
        last.lastSeq = line.seq;
        changed = true;
        continue;
      }

      const severity = classifyLine(text);
      if (severity === "normal") {
        state.last = null;
        continue;
      }

      const key = `${severity}|${problemKey(text)}`;
      const existing = state.byKey.get(key);
      if (existing) {
        existing.count += 1;
        existing.lastSeq = line.seq;
        existing.lastAt = line.ts;
        state.last = existing;
      } else {
        const problem: Problem = {
          id: `${run.runId}:${line.seq}`,
          runId: run.runId,
          appId: run.appId,
          projectId: run.projectId,
          label: run.label,
          severity,
          message: text.trim(),
          detail: [],
          count: 1,
          firstSeq: line.seq,
          lastSeq: line.seq,
          firstAt: line.ts,
          lastAt: line.ts,
        };
        state.list.push(problem);
        state.byKey.set(key, problem);
        state.last = problem;
        if (state.list.length > MAX_PROBLEMS_PER_RUN) {
          const removed = state.list.shift()!;
          for (const [mapKey, value] of state.byKey) {
            if (value === removed) state.byKey.delete(mapKey);
          }
        }
      }
      changed = true;
    }
    return changed;
  }

  clearLogs(runId: string): void {
    this.logs.set(runId, []);
    this.logVersions.set(runId, (this.logVersions.get(runId) ?? 0) + 1);
    this.problems.delete(runId);
    const run = this.runs.get(runId);
    if (run) {
      this.runs.set(runId, { ...run, errorCount: 0, warnCount: 0, droppedLines: 0 });
      this.publishStatus();
    }
    this.publishProblems();
    this.logListeners.forEach((listener) => listener());
  }

  /** Sorun listesini temizler; loglar korunur. */
  clearProblems(runId?: string): void {
    const ids = runId ? [runId] : [...this.problems.keys()];
    for (const id of ids) {
      this.problems.delete(id);
      const run = this.runs.get(id);
      if (run) this.runs.set(id, { ...run, errorCount: 0, warnCount: 0 });
    }
    this.publishStatus();
    this.publishProblems();
  }

  removeRun(runId: string): void {
    this.runs.delete(runId);
    this.logs.delete(runId);
    this.logVersions.delete(runId);
    this.problems.delete(runId);
    this.publishStatus();
    this.publishProblems();
    this.logListeners.forEach((listener) => listener());
  }

  private publishStatus() {
    this.runList = [...this.runs.values()].sort((a, b) => a.startedAt - b.startedAt);
    this.statusListeners.forEach((listener) => listener());
  }

  private publishProblems() {

    this.problemList = [...this.problems.values()].flatMap((state) => state.list.map((problem) => ({ ...problem })));
    this.problemListeners.forEach((listener) => listener());
  }


  private emit(event: RunEvent) {
    this.eventListeners.forEach((listener) => listener(event));
  }
}

export const runStore = new RunStore();

export function useRuns(): RunRecord[] {
  return useSyncExternalStore(runStore.subscribeStatus, runStore.getRuns);
}

/** Log dizisi yerinde büyür; değişiklik sürüm numarasıyla izlenir. */
export function useRunLogs(runId: string | null): { lines: LogLine[]; version: number } {
  const version = useSyncExternalStore(runStore.subscribeLogs, () => runStore.getLogVersion(runId));
  return { lines: runStore.getLogs(runId), version };
}

export function useProblems(): Problem[] {
  return useSyncExternalStore(runStore.subscribeProblems, runStore.getProblems);
}

export function runKey(projectId: string, appId: string): string {
  return `${projectId}::${appId}`;
}

/** Her uygulama için öncelikle çalışan, yoksa en son çalıştırma kaydını seçer. */
export function latestRunsByApp(runs: RunRecord[]): Map<string, RunRecord> {
  const map = new Map<string, RunRecord>();
  for (const run of runs) {
    const key = runKey(run.projectId, run.appId);
    const existing = map.get(key);
    if (
      !existing ||
      (run.status === "running" && existing.status !== "running") ||
      (run.status === existing.status && run.startedAt > existing.startedAt) ||
      (existing.status !== "running" && run.startedAt > existing.startedAt)
    ) {
      map.set(key, run);
    }
  }
  return map;
}
