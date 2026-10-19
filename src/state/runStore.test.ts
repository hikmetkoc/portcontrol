import { describe, expect, it } from "vitest";
import type { RunInfo } from "../types";
import { latestRunsByApp, runStore, type RunEvent } from "./runStore";

function info(partial: Partial<RunInfo>): RunInfo {
  return {
    runId: "run-1",
    appId: "web",
    projectId: "p1",
    label: "web",
    command: "npm run dev",
    cwd: "D:\\work\\web",
    pid: 10,
    port: 5173,
    status: "running",
    exitCode: null,
    startedAt: 1000,
    endedAt: null,
    ...partial,
  };
}

describe("runStore", () => {
  it("detects readiness from logs and emits exit events", () => {
    const events: RunEvent[] = [];
    const off = runStore.onEvent((event) => events.push(event));
    runStore.upsertRun(info({ runId: "store-1" }));
    runStore.appendLogs("store-1", [
      { seq: 1, ts: 1, stream: "stdout", text: "  ➜  Local:   http://localhost:5173/" },
      { seq: 2, ts: 2, stream: "stderr", text: "Error: something failed" },
    ]);
    // Aynı sıra numaralı satırlar tekrar eklenmez.
    runStore.appendLogs("store-1", [{ seq: 2, ts: 2, stream: "stderr", text: "dup" }]);

    const run = runStore.getRun("store-1")!;
    expect(run.urls).toEqual(["http://localhost:5173"]);
    expect(run.errorCount).toBe(1);
    expect(runStore.getLogs("store-1")).toHaveLength(2);

    runStore.upsertRun(info({ runId: "store-1", status: "failed", exitCode: 1 }));
    // Geç gelen "running" yanıtı durumu geri sarmamalı.
    runStore.upsertRun(info({ runId: "store-1", status: "running" }));
    expect(runStore.getRun("store-1")!.status).toBe("failed");
    expect(events.map((event) => event.type)).toEqual(["ready", "exit"]);
    off();
    runStore.removeRun("store-1");
  });

  it("prefers running runs per project/app", () => {
    const records = [
      { ...info({ runId: "a", status: "failed", startedAt: 5 }), urls: [], errorCount: 0, warnCount: 0, lastLineAt: null, crash: null, activeProfile: null, droppedLines: 0 },
      { ...info({ runId: "b", status: "running", startedAt: 3 }), urls: [], errorCount: 0, warnCount: 0, lastLineAt: null, crash: null, activeProfile: null, droppedLines: 0 },
      { ...info({ runId: "c", projectId: "p2", startedAt: 1 }), urls: [], errorCount: 0, warnCount: 0, lastLineAt: null, crash: null, activeProfile: null, droppedLines: 0 },
    ];
    const latest = latestRunsByApp(records);
    expect(latest.get("p1::web")?.runId).toBe("b");
    expect(latest.get("p2::web")?.runId).toBe("c");
  });
});
