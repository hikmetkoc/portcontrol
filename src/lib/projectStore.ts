import type { AppSettings, DetectedApp, Project, WorkspaceScan } from "../types";
import { PROJECT_ACCENTS } from "./stacks";

const PROJECTS_KEY = "portcontrol.projects.v2";
const PREFERENCES_KEY = "portcontrol.preferences.v1";

export interface Preferences {
  refreshInterval: number;
  includeInfrastructure: boolean;
  editorCommand: string;
  showTimestamps: boolean;
  wrapLogs: boolean;
  bootAnimation: boolean;
  notifyReady: boolean;
  /** Boşta kalınca ekran koruyucuyu açma süresi (dakika); 0 kapalı. */
  screensaverIdle: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  refreshInterval: 3000,
  includeInfrastructure: false,
  editorCommand: "code",
  showTimestamps: true,
  wrapLogs: true,
  bootAnimation: true,
  notifyReady: true,
  screensaverIdle: 10,
};

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Depolama kullanılamıyorsa veriler yalnızca bu oturumda tutulur.
  }
}

export function loadProjects(): Project[] {
  const value = readJson(PROJECTS_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter(isProject).map((project) => ({
    ...project,
    apps: project.apps.map(normalizeApp),
    settings: project.settings ?? {},
    pinned: Boolean(project.pinned),
  }));
}

/** Önceki sürümlerde kaydedilen uygulamalara yeni alanların varsayılanlarını ekler. */
function normalizeApp(app: DetectedApp): DetectedApp {
  return {
    ...app,
    upstreams: app.upstreams ?? [],
    profiles: app.profiles ?? [],
    profileEnv: app.profileEnv ?? null,
    envFiles: app.envFiles ?? [],
    healthPath: app.healthPath ?? null,
  };
}

export function saveProjects(projects: Project[]): void {
  writeJson(PROJECTS_KEY, projects);
}

export function loadPreferences(): Preferences {
  const value = readJson(PREFERENCES_KEY);
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  return { ...DEFAULT_PREFERENCES, ...(value as Partial<Preferences>) };
}

export function savePreferences(preferences: Preferences): void {
  writeJson(PREFERENCES_KEY, preferences);
}

export function createProject(
  scan: WorkspaceScan,
  name: string,
  existing: Project[],
): Project {
  return {
    id: createId(),
    name: name.trim().replace(/\s+/g, " ").slice(0, 60) || scan.name,
    path: scan.root,
    accent: PROJECT_ACCENTS[existing.length % PROJECT_ACCENTS.length],
    createdAt: Date.now(),
    lastScannedAt: Date.now(),
    apps: scan.apps,
    settings: {},
    pinned: false,
  };
}

/** Yeniden tarama sonrası kullanıcı ayarlarını korur, kaybolan uygulamalarınkini temizler. */
export function applyRescan(project: Project, scan: WorkspaceScan): Project {
  const ids = new Set(scan.apps.map((app) => app.id));
  const settings: Record<string, AppSettings> = {};
  for (const [id, value] of Object.entries(project.settings)) {
    if (ids.has(id)) settings[id] = value;
  }
  return {
    ...project,
    path: scan.root,
    apps: scan.apps,
    settings,
    lastScannedAt: Date.now(),
  };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    typeof project.path === "string" &&
    Array.isArray(project.apps)
  );
}
