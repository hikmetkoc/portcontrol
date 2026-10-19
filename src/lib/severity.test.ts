import { describe, expect, it } from "vitest";
import { runStore } from "../state/runStore";
import type { LogLine, RunInfo } from "../types";
import { classifyLine, detectProfile, isContinuation, problemKey } from "./severity";

describe("classifyLine", () => {
  it("uses the log level when present", () => {
    expect(classifyLine("2026-10-19T15:21:03.120+03:00  INFO 20820 --- [panel] [main] o.s.b.w.s.ErrorPageFilter : mapped")).toBe(
      "normal",
    );
    expect(classifyLine("2026-10-19T15:21:03.120+03:00 ERROR 20820 --- [panel] [nio-2830-exec-1] c.m.e.web.Rest : boom")).toBe(
      "error",
    );
    expect(classifyLine("2026-10-19T15:21:03.120+03:00  WARN 20820 --- [panel] [main] JpaBaseConfiguration : open-in-view")).toBe(
      "warn",
    );
    expect(classifyLine("INFO:     127.0.0.1:5000 - \"GET /errors HTTP/1.1\" 200 OK")).toBe("normal");
    expect(classifyLine("ERROR:    Exception in ASGI application")).toBe("error");
  });

  it("recognises tool specific failures without levels", () => {
    expect(classifyLine("[ERROR] Failed to execute goal org.springframework.boot:spring-boot-maven-plugin")).toBe("error");
    expect(classifyLine("[WARNING] The requested profile \"local\" could not be activated")).toBe("warn");
    expect(classifyLine("npm ERR! code ELIFECYCLE")).toBe("error");
    expect(classifyLine("error TS2304: Cannot find name 'foo'.")).toBe("error");
    expect(classifyLine("java.lang.IllegalStateException: Stok kaydı bulunamadı")).toBe("error");
    expect(classifyLine("ModuleNotFoundError: No module named 'numpy'")).toBe("error");
    expect(classifyLine("Warning: src/app/x.ts is part of the TypeScript compilation but it's unused.")).toBe("warn");
    expect(classifyLine("0 errors, 0 warnings")).toBe("normal");
    expect(classifyLine("[vite] hmr update /src/ErrorBoundary.tsx")).toBe("normal");
  });

  it("detects stack trace continuations and normalises repeated messages", () => {
    expect(isContinuation("\tat com.meteorpanel.erp.web.Rest.get(Rest.java:42)")).toBe(true);
    expect(isContinuation("Caused by: org.postgresql.util.PSQLException: refused")).toBe(true);
    expect(isContinuation("\t... 87 common frames omitted")).toBe(true);
    expect(problemKey("2026-10-19T15:21:03.120+03:00 ERROR 20820 --- [nio-2830-exec-4] x : id 12 yok")).toBe(
      problemKey("2026-10-19T15:22:44.981+03:00 ERROR 20820 --- [nio-2830-exec-9] x : id 98 yok"),
    );
  });

  it("reads the active profile from logs", () => {
    expect(detectProfile('c.m.e.PanelApp : The following 1 profile is active: "dev"')).toBe("dev");
    expect(detectProfile('The following 2 profiles are active: "dev", "swagger"')).toBe("dev, swagger");
    expect(detectProfile('No active profile set, falling back to 1 default profile: "default"')).toBe("default (varsayılan)");
    expect(detectProfile("      Hosting environment: Development")).toBe("Development");
  });
});

function info(runId: string): RunInfo {
  return {
    runId,
    appId: "panel",
    projectId: "meteor",
    label: "panel",
    command: "mvn spring-boot:run",
    cwd: "D:\\meteor\\api",
    pid: 1,
    port: 2830,
    status: "running",
    exitCode: null,
    startedAt: 1,
    endedAt: null,
  };
}

function lines(texts: string[], from = 1): LogLine[] {
  return texts.map((text, index) => ({ seq: from + index, ts: 1000 + index, stream: "stdout", text }));
}

describe("problem collection", () => {
  it("groups Java stack traces and merges repeats", () => {
    runStore.upsertRun(info("problems-1"));
    runStore.appendLogs(
      "problems-1",
      lines([
        '2026-10-19T15:21:00.000+03:00  INFO 20820 --- [panel] [main] c.m.e.PanelApp : The following 1 profile is active: "dev"',
        "2026-10-19T15:21:03.120+03:00 ERROR 20820 --- [panel] [nio-2830-exec-4] o.a.c.c.C.[dispatcherServlet] : Servlet.service() threw exception",
        "java.lang.IllegalStateException: Stok kaydı 12 bulunamadı",
        "\tat com.meteorpanel.erp.service.StockService.reserve(StockService.java:88)",
        "\tat com.meteorpanel.erp.web.StockResource.post(StockResource.java:41)",
        "2026-10-19T15:21:04.000+03:00  INFO 20820 --- [panel] [main] c.m.e.PanelApp : Started PanelApp in 9.1 seconds",
        "2026-10-19T15:22:10.000+03:00 ERROR 20820 --- [panel] [nio-2830-exec-9] o.a.c.c.C.[dispatcherServlet] : Servlet.service() threw exception",
        "2026-10-19T15:22:11.000+03:00  WARN 20820 --- [panel] [main] JpaBaseConfiguration : spring.jpa.open-in-view is enabled",
      ]),
    );
    const problems = runStore.getProblems().filter((problem) => problem.runId === "problems-1");
    expect(problems).toHaveLength(2);
    const [error, warning] = problems;
    expect(error.severity).toBe("error");
    expect(error.count).toBe(2);
    expect(error.detail).toEqual([
      "java.lang.IllegalStateException: Stok kaydı 12 bulunamadı",
      "\tat com.meteorpanel.erp.service.StockService.reserve(StockService.java:88)",
      "\tat com.meteorpanel.erp.web.StockResource.post(StockResource.java:41)",
    ]);
    expect(warning.severity).toBe("warn");
    const run = runStore.getRun("problems-1")!;
    expect(run.errorCount).toBe(1);
    expect(run.warnCount).toBe(1);
    expect(run.activeProfile).toBe("dev");
    runStore.removeRun("problems-1");
  });

  it("titles Python tracebacks with the final exception", () => {
    runStore.upsertRun({ ...info("problems-2"), appId: "mpai", label: "mpai" });
    runStore.appendLogs(
      "problems-2",
      lines([
        "Traceback (most recent call last):",
        '  File "D:\\meteor\\mpai\\app\\main.py", line 3, in <module>',
        "    import numpy",
        "ModuleNotFoundError: No module named 'numpy'",
      ]),
    );
    const [problem] = runStore.getProblems().filter((item) => item.runId === "problems-2");
    expect(problem.message).toBe("ModuleNotFoundError: No module named 'numpy'");
    expect(problem.detail[0]).toBe("Traceback (most recent call last):");
    runStore.removeRun("problems-2");
  });
});
