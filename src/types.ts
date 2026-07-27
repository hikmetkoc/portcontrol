export type Protocol = "TCP" | "UDP";
export type Exposure = "local" | "network" | "all";
export type SocketActivity = "listener" | "connection" | "bound";
export type SocketRole =
  | "published"
  | "toolInternal"
  | "infrastructure"
  | "system"
  | "outbound"
  | "unknown";
export type ClassificationConfidence = "high" | "medium" | "low";
export type ProcessCategory =
  | "editor"
  | "database"
  | "container"
  | "runtime"
  | "development"
  | "other"
  | "system";

export interface PortBinding {
  protocol: Protocol;
  address: string;
  port: number;
  remoteAddress: string | null;
  remotePort: number | null;
  exposure: Exposure;
  state: string;
  activity: SocketActivity;
  role: SocketRole;
  roleReason: string;
  confidence: ClassificationConfidence;
}

export interface ProcessAncestor {
  pid: number;
  name: string;
}

export interface ProcessPortGroup {
  pid: number;
  processName: string;
  displayName: string;
  executablePath: string | null;
  command: string | null;
  workingDirectory: string | null;
  parentChain: ProcessAncestor[];
  ports: PortBinding[];
  category: ProcessCategory;
  knownDeveloperTool: boolean;
  protected: boolean;
  protectionReason: string | null;
  memoryBytes: number;
  cpuUsagePercent: number;
  diskReadBytesPerSecond: number;
  diskWriteBytesPerSecond: number;
  diskTotalReadBytes: number;
  diskTotalWrittenBytes: number;
  metricsReady: boolean;
  startedAt: number;
}

export interface ScanResponse {
  processes: ProcessPortGroup[];
  scannedAt: number;
  totalSockets: number;
  hiddenSystemProcesses: number;
  inaccessibleSockets: number;
  platform: string;
  permissionNotice: string | null;
}

export interface StopRequest {
  pid: number;
  startedAt: number;
}

export interface StopResult {
  pid: number;
  processName: string;
  stopped: boolean;
  message: string;
}

export type CategoryFilter = "all" | "developer" | ProcessCategory;
export type SocketView =
  | "servers"
  | "listeners"
  | "connections"
  | "udp"
  | "all";
export type RoleFilter = "all" | SocketRole;
