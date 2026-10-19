export type Exposure = "local" | "network" | "all";
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

// ---------------------------------------------------------------------------
// Canlı port taraması
// ---------------------------------------------------------------------------

export interface PortBinding {
  protocol: "TCP" | "UDP";
  address: string;
  port: number;
  remoteAddress: string | null;
  remotePort: number | null;
  exposure: Exposure;
  state: string;
  activity: "listener" | "connection" | "bound";
  role: SocketRole;
  roleReason: string;
  confidence: ClassificationConfidence;
  accessUrls: string[];
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
  technology: string;
  projectName: string | null;
  projectRoot: string | null;
  serviceKind: string;
  serviceDescription: string;
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
  managedRunId: string | null;
  managedAppId: string | null;
  managedProjectId: string | null;
}

export interface ScanResponse {
  processes: ProcessPortGroup[];
  scannedAt: number;
  totalSockets: number;
  filteredProcesses: number;
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

// ---------------------------------------------------------------------------
// Proje / uygulama tespiti
// ---------------------------------------------------------------------------

export type AppKind = "frontend" | "backend" | "fullstack" | "desktop" | "infra";

export interface LaunchScript {
  name: string;
  command: string;
  portCommand: string | null;
  runnable: boolean;
}

export interface EnvPair {
  key: string;
  value: string;
}

export interface Upstream {
  port: number;
  host: string;
  scheme: string;
  kind: "http" | "database" | "tcp";
  key: string;
  source: string;
}

export interface DetectedApp {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  framework: string;
  language: string;
  stack: string;
  kind: AppKind;
  defaultPort: number | null;
  portSource: string;
  portConfigurable: boolean;
  scripts: LaunchScript[];
  defaultScript: string;
  portEnv: EnvPair[];
  packageManager: string | null;
  installCommand: string | null;
  needsInstall: boolean;
  exposedPorts: number[];
  notes: string[];
  upstreams: Upstream[];
  profiles: string[];
  profileEnv: string | null;
  envFiles: string[];
  healthPath: string | null;
}

export interface WorkspaceScan {
  root: string;
  name: string;
  apps: DetectedApp[];
  scannedDirectories: number;
  truncated: boolean;
  durationMs: number;
}

export interface EnvProfile {
  id: string;
  name: string;
  vars: EnvPair[];
}

/** Kullanıcının uygulama başına seçtiği çalıştırma ayarları. */
export interface AppSettings {
  portMode: "default" | "custom";
  customPort: number | null;
  script: string | null;
  customCommand: string | null;
  /** Adlandırılmış ortam profilleri ve etkin olanı. */
  envProfiles: EnvProfile[];
  activeProfileId: string | null;
  /** Spring/.NET gibi framework profili (SPRING_PROFILES_ACTIVE vb.). */
  frameworkProfile: string | null;
  /** null: otomatik tespit; dizi: kullanıcının seçtiği bağımlı uygulama kimlikleri. */
  dependsOn: string[] | null;
  /** null: tespit edilen yol; "": yalnızca TCP; değer: HTTP sağlık yolu. */
  healthPath: string | null;
  /** Çökme durumunda sınırlı sayıda otomatik yeniden başlat. */
  autoRestart: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  accent: string;
  createdAt: number;
  lastScannedAt: number;
  apps: DetectedApp[];
  settings: Record<string, AppSettings>;
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// Süreç çalıştırıcı
// ---------------------------------------------------------------------------

export type RunStatus = "running" | "exited" | "stopped" | "failed";
export type LogStream = "stdout" | "stderr" | "system" | "input";

export interface RunInfo {
  runId: string;
  appId: string;
  projectId: string;
  label: string;
  command: string;
  cwd: string;
  pid: number;
  port: number | null;
  status: RunStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface LogLine {
  seq: number;
  ts: number;
  stream: LogStream;
  text: string;
}

export interface RunLogPayload {
  runId: string;
  lines: LogLine[];
}

export interface StartRunRequest {
  appId: string;
  projectId: string;
  label: string;
  cwd: string;
  command: string;
  env: EnvPair[];
  port: number | null;
}

export interface ProbeResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

export interface CrashReport {
  title: string;
  detail: string | null;
  hint: string | null;
  seq: number | null;
}

export interface PortCheck {
  port: number;
  free: boolean;
  pid: number | null;
  processName: string | null;
}
