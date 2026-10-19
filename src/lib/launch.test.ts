import { describe, expect, it } from "vitest";
import type { DetectedApp, ProcessPortGroup } from "../types";
import { parseAnsi, stripAnsi } from "./ansi";
import {
  extractLocalUrls,
  isWithin,
  matchProcessToApp,
  resolveLaunch,
} from "./launch";

const viteApp: DetectedApp = {
  id: "web",
  name: "web",
  path: "D:\\work\\shop\\web",
  relativePath: "web",
  framework: "Vite + React",
  language: "TypeScript",
  stack: "react",
  kind: "frontend",
  defaultPort: 5173,
  portSource: "Vite varsayılanı",
  portConfigurable: true,
  scripts: [
    {
      name: "dev",
      command: "npm run dev",
      portCommand: "npm run dev -- --port {port} --strictPort",
      runnable: true,
    },
    { name: "preview", command: "npm run preview", portCommand: null, runnable: true },
  ],
  defaultScript: "dev",
  portEnv: [{ key: "PORT", value: "{port}" }],
  packageManager: "npm",
  installCommand: "npm install",
  needsInstall: false,
  exposedPorts: [5173],
  notes: [],
  upstreams: [],
  profiles: [],
  profileEnv: null,
  envFiles: [],
  healthPath: "/",
};

describe("resolveLaunch", () => {
  it("uses the default script and port without extra env", () => {
    const launch = resolveLaunch(viteApp, undefined);
    expect(launch.command).toBe("npm run dev");
    expect(launch.port).toBe(5173);
    expect(launch.env).toEqual([]);
    expect(launch.customPort).toBe(false);
  });

  it("applies a custom port through the CLI template and env", () => {
    const launch = resolveLaunch(viteApp, {
      portMode: "custom",
      customPort: 6100,
      script: null,
      customCommand: null,
    });
    expect(launch.command).toBe("npm run dev -- --port 6100 --strictPort");
    expect(launch.env).toEqual([{ key: "PORT", value: "6100" }]);
    expect(launch.port).toBe(6100);
  });

  it("falls back to env-only strategy when the script has no port command", () => {
    const launch = resolveLaunch(viteApp, {
      portMode: "custom",
      customPort: 4000,
      script: "preview",
      customCommand: null,
    });
    expect(launch.command).toBe("npm run preview");
    expect(launch.env).toEqual([{ key: "PORT", value: "4000" }]);
  });

  it("honours one-off port overrides and custom commands", () => {
    const launch = resolveLaunch(
      viteApp,
      { portMode: "default", customPort: null, script: null, customCommand: "pnpm vite --port {port}" },
      7000,
    );
    expect(launch.command).toBe("pnpm vite --port 7000");
    expect(launch.port).toBe(7000);
  });

  it("ignores custom ports for fixed-port apps", () => {
    const launch = resolveLaunch({ ...viteApp, portConfigurable: false }, {
      portMode: "custom",
      customPort: 9999,
      script: null,
      customCommand: null,
    });
    expect(launch.port).toBe(5173);
    expect(launch.command).toBe("npm run dev");
  });
});

describe("log helpers", () => {
  it("extracts local urls from coloured dev server output", () => {
    expect(
      extractLocalUrls("  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m"),
    ).toEqual(["http://localhost:5173"]);
    expect(extractLocalUrls("INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)")).toEqual([
      "http://localhost:8000",
    ]);
    expect(extractLocalUrls("Tomcat started on port 8081 (http) with context path '/'")).toEqual([
      "http://localhost:8081",
    ]);
    expect(extractLocalUrls("  - Network: http://192.168.1.4:3000")).toEqual([]);
    expect(extractLocalUrls("compiled successfully")).toEqual([]);
  });

  it("parses ANSI colours into segments", () => {
    const segments = parseAnsi("\x1b[1m\x1b[32mVITE\x1b[39m\x1b[22m ready \x1b[38;5;196mred\x1b[0m");
    expect(segments.map((segment) => segment.text)).toEqual(["VITE", " ready ", "red"]);
    expect(segments[0].bold).toBe(true);
    expect(segments[0].fg).not.toBeNull();
    expect(segments[1].fg).toBeNull();
    expect(segments[2].fg).toBe("rgb(255, 0, 0)");
    expect(stripAnsi("\x1b[2K\x1b[1G\x1b[36mok\x1b[0m")).toBe("ok");
  });
});

describe("path matching", () => {
  it("matches paths case-insensitively on Windows", () => {
    expect(isWithin("d:\\Work\\Shop\\web\\src", "D:\\work\\shop\\web")).toBe(true);
    expect(isWithin("D:\\work\\shop\\website", "D:\\work\\shop\\web")).toBe(false);
    expect(isWithin("/home/dev/app", "/home/dev/App")).toBe(false);
  });

  it("assigns a process to the deepest detected app", () => {
    const root: DetectedApp = { ...viteApp, id: "root", path: "D:\\work\\shop", relativePath: "." };
    const process = {
      workingDirectory: "D:\\work\\shop\\web",
      projectRoot: "D:\\work\\shop\\web",
    } as ProcessPortGroup;
    expect(matchProcessToApp(process, [root, viteApp])?.id).toBe("web");
  });
});
