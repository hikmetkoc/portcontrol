import { describe, expect, it } from "vitest";
import type { DetectedApp, Project, Upstream } from "../types";
import { analyzeCrash } from "./crash";
import { dependencyClosure, resolveDependencies, topologicalOrder } from "./dependencies";
import { resolveLaunch, withDefaults } from "./launch";

function upstream(port: number, key: string, kind: Upstream["kind"] = "http", scheme = "http"): Upstream {
  return { port, host: "localhost", scheme, kind, key, source: "config" };
}

function app(id: string, name: string, port: number, upstreams: Upstream[] = [], extra: Partial<DetectedApp> = {}): DetectedApp {
  return {
    id,
    name,
    path: `D:\\meteor\\${name}`,
    relativePath: name,
    framework: "x",
    language: "x",
    stack: "node",
    kind: "backend",
    defaultPort: port,
    portSource: "",
    portConfigurable: true,
    scripts: [{ name: "run", command: "run", portCommand: null, runnable: true }],
    defaultScript: "run",
    portEnv: [{ key: "PORT", value: "{port}" }],
    packageManager: null,
    installCommand: null,
    needsInstall: false,
    exposedPorts: [port],
    notes: [],
    upstreams,
    profiles: [],
    profileEnv: null,
    envFiles: [],
    healthPath: null,
    ...extra,
  };
}

// meteorpanel: client → api (proxy :2830), api → mpai (base-url :8010, mpai varsayılanı 8000), api → PostgreSQL.
const meteor: Project = {
  id: "p",
  name: "Meteor",
  path: "D:\\meteor",
  accent: "#fff",
  createdAt: 0,
  lastScannedAt: 0,
  pinned: false,
  settings: {},
  apps: [
    app("api", "api", 2830, [
      upstream(5432, "spring.datasource.url", "database", "jdbc:postgresql"),
      upstream(8010, "app.mpai.base-url"),
    ]),
    app("mpai", "mpai", 8000, [upstream(5432, "MPAI_DB_URL", "database", "postgresql")]),
    app("client", "client", 4201, [upstream(2830, "/api.target")], { kind: "frontend" }),
  ],
};

describe("resolveDependencies", () => {
  it("links services by port and by name, and reports port expectations", () => {
    const graph = resolveDependencies(meteor);
    expect(graph.byApp.get("client")!.internal.map((item) => item.appId)).toEqual(["api"]);
    const api = graph.byApp.get("api")!;
    expect(api.internal).toEqual([
      expect.objectContaining({ appId: "mpai", port: 8010, portMismatch: true, auto: true }),
    ]);
    expect(api.external).toEqual([expect.objectContaining({ port: 5432, label: "PostgreSQL", kind: "database" })]);
    expect(graph.expectations.get("mpai")).toEqual([expect.objectContaining({ port: 8010, byAppId: "api" })]);
    expect(graph.dependents.get("api")).toEqual(["client"]);
  });

  it("clears the mismatch once the target runs on the expected port", () => {
    const aligned: Project = {
      ...meteor,
      settings: { mpai: withDefaults({ portMode: "custom", customPort: 8010 }) },
    };
    expect(resolveLaunch(aligned.apps[1], aligned.settings.mpai).port).toBe(8010);
    const graph = resolveDependencies(aligned);
    expect(graph.byApp.get("api")!.internal[0].portMismatch).toBe(false);
    expect(graph.expectations.size).toBe(0);
  });

  it("honours manual dependency lists", () => {
    const manual: Project = { ...meteor, settings: { client: withDefaults({ dependsOn: ["mpai"] }) } };
    const graph = resolveDependencies(manual);
    expect(graph.byApp.get("client")!.internal).toEqual([
      expect.objectContaining({ appId: "mpai", source: "manuel", auto: false }),
    ]);
    expect(graph.byApp.get("client")!.detected.map((item) => item.appId)).toEqual(["api"]);
  });

  it("orders the launch chain with dependencies first", () => {
    const graph = resolveDependencies(meteor);
    const ids = dependencyClosure(graph, ["client"]);
    expect(new Set(ids)).toEqual(new Set(["client", "api", "mpai"]));
    expect(topologicalOrder(graph, ids)).toEqual({ order: ["mpai", "api", "client"], cyclic: false });
  });

  it("detects cycles without hanging", () => {
    const cyclic: Project = {
      ...meteor,
      apps: [app("a", "alpha", 3001, [upstream(3002, "b")]), app("b", "beta", 3002, [upstream(3001, "a")])],
    };
    const result = topologicalOrder(resolveDependencies(cyclic), ["a", "b"]);
    expect(result.cyclic).toBe(true);
    expect(result.order).toHaveLength(2);
  });
});

function logs(lines: string[]) {
  return lines.map((text, index) => ({ seq: index + 1, ts: 0, stream: "stdout" as const, text }));
}

describe("analyzeCrash", () => {
  it("summarises Spring Boot startup failures", () => {
    const report = analyzeCrash(
      logs([
        "INFO starting",
        "***************************",
        "APPLICATION FAILED TO START",
        "***************************",
        "",
        "Description:",
        "",
        "Web server failed to start. Port 2830 was already in use.",
        "",
        "Action:",
        "",
        "Identify and stop the process that's listening on port 2830.",
      ]),
    );
    expect(report?.title).toBe("Port :2830 zaten kullanımda");
  });

  it("uses Spring description and action blocks", () => {
    const report = analyzeCrash(
      logs([
        "APPLICATION FAILED TO START",
        "Description:",
        "Failed to configure a DataSource: 'url' attribute is not specified.",
        "",
        "Action:",
        "Consider defining a bean of type 'DataSource'.",
      ]),
    );
    expect(report).toEqual(
      expect.objectContaining({
        title: "Spring Boot başlatılamadı",
        detail: "Failed to configure a DataSource: 'url' attribute is not specified.",
        hint: "Consider defining a bean of type 'DataSource'.",
        seq: 1,
      }),
    );
  });

  it("finds the final Python exception and suggests installing modules", () => {
    const report = analyzeCrash(
      logs([
        "Traceback (most recent call last):",
        '  File "main.py", line 1, in <module>',
        "    import numpy",
        "ModuleNotFoundError: No module named 'numpy'",
      ]),
    );
    expect(report?.title).toBe("ModuleNotFoundError: No module named 'numpy'");
    expect(report?.hint).toContain("pip install");
    expect(report?.seq).toBe(4);
  });

  it("prefers the Java root cause and explains refused connections", () => {
    const report = analyzeCrash(
      logs([
        "org.springframework.beans.factory.BeanCreationException: Error creating bean",
        "\tat org.springframework.Foo.bar(Foo.java:1)",
        "Caused by: org.postgresql.util.PSQLException: Connection to localhost:5432 refused.",
      ]),
    );
    expect(report?.title).toContain("PSQLException");
    expect(report?.hint).toContain(":5432");
  });

  it("recognises missing commands on Windows", () => {
    const report = analyzeCrash(logs(["'mvnw' is not recognized as an internal or external command,"]));
    expect(report?.title).toBe("Komut bulunamadı: mvnw");
  });
});
