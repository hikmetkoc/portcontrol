import { describe, expect, it } from "vitest";
import type { ProcessPortGroup } from "./types";
import { filterProcesses, formatBytes, formatRate } from "./utils";

const processFixture: ProcessPortGroup = {
  pid: 4120,
  processName: "node.exe",
  displayName: "JavaScript runtime",
  executablePath: "C:\\Program Files\\nodejs\\node.exe",
  command: "node vite --host 0.0.0.0",
  workingDirectory: "D:\\projects\\demo",
  parentChain: [{ pid: 3000, name: "Code" }],
  technology: "React",
  projectName: "Demo",
  projectRoot: "D:\\projects\\demo",
  serviceKind: "Frontend",
  serviceDescription: "Demo projesinin Frontend bileşeni.",
  ports: [
    {
      protocol: "TCP",
      address: "0.0.0.0",
      port: 5173,
      remoteAddress: null,
      remotePort: null,
      exposure: "all",
      state: "LISTEN",
      activity: "listener",
      role: "published",
      roleReason: "Vite geliştirme sunucusu.",
      confidence: "high",
      accessUrls: ["http://localhost:5173", "http://192.168.1.9:5173"],
    },
    {
      protocol: "TCP",
      address: "127.0.0.1",
      port: 51002,
      remoteAddress: "127.0.0.1",
      remotePort: 61173,
      exposure: "local",
      state: "ESTABLISHED",
      activity: "connection",
      role: "outbound",
      roleReason: "Aktif bağlantı.",
      confidence: "high",
      accessUrls: [],
    },
  ],
  category: "runtime",
  knownDeveloperTool: true,
  protected: false,
  protectionReason: null,
  memoryBytes: 48 * 1024 * 1024,
  cpuUsagePercent: 2.4,
  diskReadBytesPerSecond: 1024,
  diskWriteBytesPerSecond: 2048,
  diskTotalReadBytes: 10000,
  diskTotalWrittenBytes: 20000,
  metricsReady: true,
  startedAt: 100,
};

describe("filterProcesses", () => {
  it("finds a process by port", () => {
    expect(
      filterProcesses([processFixture], "5173", "all", "all", "all", "all"),
    ).toHaveLength(1);
  });

  it("finds a process by technology and project purpose", () => {
    expect(
      filterProcesses([processFixture], "React", "all", "all", "all", "all"),
    ).toHaveLength(1);
    expect(
      filterProcesses([processFixture], "Frontend", "all", "all", "all", "all"),
    ).toHaveLength(1);
  });

  it("shows only listeners without mutating source", () => {
    const result = filterProcesses(
      [processFixture],
      "",
      "all",
      "all",
      "listeners",
      "all",
    );
    expect(result[0].ports).toHaveLength(1);
    expect(result[0].ports[0].state).toBe("LISTEN");
    expect(processFixture.ports).toHaveLength(2);
  });

  it("filters published project ports", () => {
    const result = filterProcesses(
      [processFixture],
      "",
      "all",
      "all",
      "all",
      "published",
    );
    expect(result[0].ports).toHaveLength(1);
    expect(result[0].ports[0].port).toBe(5173);
  });

  it("filters active connections", () => {
    const result = filterProcesses(
      [processFixture],
      "",
      "all",
      "TCP",
      "connections",
      "all",
    );
    expect(result[0].ports[0].state).toBe("ESTABLISHED");
  });
});

describe("formatting", () => {
  it("formats memory values", () => {
    expect(formatBytes(48 * 1024 * 1024)).toBe("48 MB");
  });

  it("formats transfer rates", () => {
    expect(formatRate(2048)).toBe("2,0 KB/sn");
  });
});
