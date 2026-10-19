import type {
  AppSettings,
  DetectedApp,
  EnvPair,
  LaunchScript,
  ProcessPortGroup,
} from "../types";
import { stripAnsi } from "./ansi";

export interface ResolvedLaunch {
  script: LaunchScript | null;
  command: string;
  env: EnvPair[];
  port: number | null;
  customPort: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  portMode: "default",
  customPort: null,
  script: null,
  customCommand: null,
  envProfiles: [],
  activeProfileId: null,
  frameworkProfile: null,
  dependsOn: null,
  healthPath: null,
  autoRestart: false,
};

/** Eski sürümlerde kaydedilmiş eksik ayarları varsayılanlarla tamamlar. */
export function withDefaults(settings: Partial<AppSettings> | undefined): AppSettings {
  return { ...DEFAULT_SETTINGS, ...settings };
}

const SECRET_PATTERN = /(pass|pwd|secret|token|api[_-]?key|private|credential|auth|cookie|session)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

export function maskValue(key: string, value: string): string {
  if (!isSecretKey(key) || !value) return value;
  return "•".repeat(Math.min(10, Math.max(4, value.length)));
}

/** Etkin profilin değişkenleri ve framework profili; port değişkenleri en son eklenir. */
export function profileEnv(app: DetectedApp, settings: AppSettings): EnvPair[] {
  const profile = settings.envProfiles.find((item) => item.id === settings.activeProfileId);
  const env = (profile?.vars ?? []).filter((pair) => pair.key.trim());
  if (settings.frameworkProfile && app.profileEnv) {
    env.push({ key: app.profileEnv, value: settings.frameworkProfile });
  }
  return env;
}

/** Sağlık kontrolünde kullanılacak HTTP yolu; null ise yalnızca TCP bağlantısı denetlenir. */
export function effectiveHealthPath(app: DetectedApp, settings: AppSettings): string | null {
  if (settings.healthPath === null) return app.healthPath;
  return settings.healthPath.trim() || null;
}

/** Uygulama ve kullanıcı ayarlarından nihai çalıştırma komutunu üretir. */
export function resolveLaunch(
  app: DetectedApp,
  settings: Partial<AppSettings> | undefined,
  portOverride?: number | null,
): ResolvedLaunch {
  const current = withDefaults(settings);
  const script =
    app.scripts.find((item) => item.name === (current.script ?? app.defaultScript)) ??
    app.scripts.find((item) => item.name === app.defaultScript) ??
    app.scripts[0] ??
    null;
  const requested =
    portOverride ??
    (current.portMode === "custom" && current.customPort ? current.customPort : null);
  const customPort =
    app.portConfigurable && requested !== null && requested !== app.defaultPort;
  const port = customPort ? requested : app.defaultPort;
  const template =
    current.customCommand?.trim() ||
    (customPort ? (script?.portCommand ?? script?.command) : script?.command) ||
    "";
  const portText = port === null ? "" : String(port);
  const command = template.split("{port}").join(portText);
  const portEnv = customPort
    ? app.portEnv.map((pair) => ({
        key: pair.key,
        value: pair.value.split("{port}").join(portText),
      }))
    : [];
  // Aynı anahtar birden fazla kaynaktan gelirse sonraki (port) kazanır.
  const merged = new Map<string, EnvPair>();
  for (const pair of [...profileEnv(app, current), ...portEnv]) merged.set(pair.key, pair);
  return { script, command, env: [...merged.values()], port, customPort };
}

/** Port komutu yoksa yalnızca ortam değişkeniyle aktarılacağını belirtir. */
export function portStrategyLabel(app: DetectedApp, script: LaunchScript | null): string {
  if (!app.portConfigurable) return "Sabit port";
  if (script?.portCommand) return "CLI parametresi";
  if (app.portEnv.length) return `${app.portEnv.map((pair) => pair.key).join(", ")} env`;
  return "Desteklenmiyor";
}

const URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+\.localhost):(\d{2,5})(\/[^\s'"<>)\]]*)?/gi;
const PORT_PHRASE_PATTERN =
  /(?:started on port(?:\(s\))?:?|listening on port|running on port|listening at port|server (?:is )?(?:running|listening|started) (?:on|at) (?:port )?)\s*:?\s*(\d{2,5})/i;

/** Log satırında yerel sunucu adresi veya port bildirimi arar. */
export function extractLocalUrls(line: string): string[] {
  const text = stripAnsi(line);
  const urls = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const port = Number(match[1]);
    if (port < 80 || port > 65535) continue;
    const host = new URL(match[0].replace("0.0.0.0", "localhost").replace("[::]", "localhost")).hostname;
    if (host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".localhost")) continue;
    const path = (match[2] ?? "").replace(/[.,;:]+$/, "");
    urls.add(`http://localhost:${port}${path === "/" ? "" : path}`);
  }
  if (!urls.size) {
    const phrase = text.match(PORT_PHRASE_PATTERN);
    if (phrase) {
      const port = Number(phrase[1]);
      if (port >= 80 && port <= 65535) urls.add(`http://localhost:${port}`);
    }
  }
  return [...urls];
}

// ---------------------------------------------------------------------------
// Yol eşleştirme
// ---------------------------------------------------------------------------

export function normalizePath(path: string): string {
  let value = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-zA-Z]:/.test(value) || path.includes("\\")) value = value.toLowerCase();
  return value;
}

export function isWithin(child: string | null | undefined, parent: string): boolean {
  if (!child) return false;
  const a = normalizePath(child);
  const b = normalizePath(parent);
  return a === b || a.startsWith(`${b}/`);
}

/** Bir sürecin hangi tespit edilmiş uygulamaya ait olduğunu en derin yol eşleşmesiyle bulur. */
export function matchProcessToApp(
  process: ProcessPortGroup,
  apps: DetectedApp[],
): DetectedApp | null {
  const candidates = [process.workingDirectory, process.projectRoot].filter(
    (value): value is string => Boolean(value),
  );
  let best: DetectedApp | null = null;
  let bestLength = -1;
  for (const app of apps) {
    const appPath = normalizePath(app.path);
    if (candidates.some((candidate) => isWithin(candidate, app.path))) {
      if (appPath.length > bestLength) {
        best = app;
        bestLength = appPath.length;
      }
    }
  }
  return best;
}

export function uniquePorts(process: ProcessPortGroup): number[] {
  return [...new Set(process.ports.map((port) => port.port))].sort((a, b) => a - b);
}

export function primaryUrl(process: ProcessPortGroup): string | null {
  for (const port of process.ports) {
    const local = port.accessUrls.find((url) => url.includes("localhost"));
    if (local) return local;
    if (port.accessUrls[0]) return port.accessUrls[0];
  }
  return null;
}
