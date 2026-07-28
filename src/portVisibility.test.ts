import { describe, expect, it } from "vitest";
import { hiddenPortRecord, portViewKey } from "./portVisibility";
import type { PortBinding, ProcessPortGroup } from "./types";

const process = {
  pid: 41256,
  processName: "node.exe",
  displayName: "Meteor Panel",
  projectName: "Meteor Panel",
  projectRoot: "D:\\development\\meteor-panel",
  executablePath: "C:\\Program Files\\nodejs\\node.exe",
  workingDirectory: "D:\\development\\meteor-panel",
  technology: "Angular",
} as ProcessPortGroup;

const port = {
  protocol: "TCP",
  port: 4200,
  activity: "listener",
  remoteAddress: null,
  remotePort: null,
} as PortBinding;

describe("port visibility", () => {
  it("keeps a stable key when the process PID changes", () => {
    expect(portViewKey(process, port)).toBe(
      portViewKey({ ...process, pid: 99999 }, port),
    );
  });

  it("stores enough information to restore an offline hidden port", () => {
    expect(hiddenPortRecord(process, port)).toMatchObject({
      processName: "Meteor Panel",
      technology: "Angular",
      protocol: "TCP",
      port: 4200,
    });
  });
});
