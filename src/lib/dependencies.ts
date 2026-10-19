import type { DetectedApp, Project, Upstream } from "../types";
import { resolveLaunch, withDefaults } from "./launch";

export interface InternalDependency {
  appId: string;
  /** Bağımlı uygulamanın beklediği port. */
  port: number;
  key: string;
  source: string;
  auto: boolean;
  /** Hedef uygulama beklenen portta değil, başka bir portta çalışacak şekilde ayarlı. */
  portMismatch: boolean;
}

export interface ExternalDependency {
  port: number;
  key: string;
  source: string;
  kind: Upstream["kind"];
  label: string;
}

export interface AppDependencies {
  internal: InternalDependency[];
  detected: InternalDependency[];
  external: ExternalDependency[];
}

export interface PortExpectation {
  port: number;
  byAppId: string;
  key: string;
  source: string;
}

export interface DependencyGraph {
  byApp: Map<string, AppDependencies>;
  /** Başka uygulamaların bu uygulamayı beklediği ama ayarlı portun farklı olduğu durumlar. */
  expectations: Map<string, PortExpectation[]>;
  /** Bu uygulamaya bağımlı olan uygulamalar. */
  dependents: Map<string, string[]>;
}

const GENERIC_TOKENS = new Set([
  "app",
  "api",
  "web",
  "server",
  "client",
  "service",
  "services",
  "backend",
  "frontend",
  "main",
  "core",
  "src",
  "url",
  "base",
]);

const SERVICE_LABELS: Record<number, string> = {
  5432: "PostgreSQL",
  3306: "MySQL",
  1433: "SQL Server",
  27017: "MongoDB",
  6379: "Redis",
  1521: "Oracle",
  5672: "RabbitMQ",
  9092: "Kafka",
  11211: "Memcached",
  9200: "Elasticsearch",
};

export function serviceLabel(upstream: Pick<Upstream, "port" | "scheme" | "kind">): string {
  const known = SERVICE_LABELS[upstream.port];
  if (known) return known;
  if (upstream.scheme.includes("postgres")) return "PostgreSQL";
  if (upstream.scheme.includes("mysql") || upstream.scheme.includes("mariadb")) return "MySQL";
  if (upstream.scheme.includes("mongo")) return "MongoDB";
  if (upstream.scheme.includes("redis")) return "Redis";
  return upstream.kind === "database" ? "Veritabanı" : "Harici servis";
}

export function effectivePort(app: DetectedApp, project: Project): number | null {
  return resolveLaunch(app, project.settings[app.id]).port;
}

function nameTokens(app: DetectedApp): string[] {
  const folder = app.relativePath.split("/").filter(Boolean).pop() ?? "";
  const raw = [app.name, folder, ...app.name.split(/[-_. ]+/)];
  return [...new Set(raw.map((token) => token.toLowerCase()))].filter(
    (token) => token.length >= 3 && !GENERIC_TOKENS.has(token),
  );
}

export function resolveDependencies(project: Project): DependencyGraph {
  const byApp = new Map<string, AppDependencies>();
  const expectations = new Map<string, PortExpectation[]>();
  const dependents = new Map<string, string[]>();
  const ports = new Map(project.apps.map((app) => [app.id, effectivePort(app, project)]));

  for (const app of project.apps) {
    const detected: InternalDependency[] = [];
    const external: ExternalDependency[] = [];
    for (const upstream of app.upstreams ?? []) {
      const others = project.apps.filter((other) => other.id !== app.id);
      const byPort = others.find(
        (other) => ports.get(other.id) === upstream.port || other.exposedPorts.includes(upstream.port),
      );
      const key = upstream.key.toLowerCase();
      const byName = byPort
        ? undefined
        : others.find((other) => nameTokens(other).some((token) => key.includes(token)));
      const target = byPort ?? byName;
      if (target) {
        if (!detected.some((item) => item.appId === target.id)) {
          detected.push({
            appId: target.id,
            port: upstream.port,
            key: upstream.key,
            source: upstream.source,
            auto: true,
            portMismatch: !byPort && ports.get(target.id) !== upstream.port,
          });
        }
      } else if (!external.some((item) => item.port === upstream.port)) {
        external.push({
          port: upstream.port,
          key: upstream.key,
          source: upstream.source,
          kind: upstream.kind,
          label: serviceLabel(upstream),
        });
      }
    }

    const settings = withDefaults(project.settings[app.id]);
    const internal =
      settings.dependsOn === null
        ? detected
        : settings.dependsOn
            .filter((id) => id !== app.id && project.apps.some((other) => other.id === id))
            .map(
              (id) =>
                detected.find((item) => item.appId === id) ?? {
                  appId: id,
                  port: ports.get(id) ?? 0,
                  key: "",
                  source: "manuel",
                  auto: false,
                  portMismatch: false,
                },
            );

    byApp.set(app.id, { internal, detected, external });
    for (const dependency of internal) {
      dependents.set(dependency.appId, [...(dependents.get(dependency.appId) ?? []), app.id]);
      if (dependency.portMismatch) {
        expectations.set(dependency.appId, [
          ...(expectations.get(dependency.appId) ?? []),
          { port: dependency.port, byAppId: app.id, key: dependency.key, source: dependency.source },
        ]);
      }
    }
  }
  return { byApp, expectations, dependents };
}

/** Hedef uygulamalarla birlikte geçişli tüm iç bağımlılıklarını döndürür. */
export function dependencyClosure(graph: DependencyGraph, targets: string[]): string[] {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    for (const dependency of graph.byApp.get(id)?.internal ?? []) visit(dependency.appId);
  };
  targets.forEach(visit);
  return [...result];
}

/** Bağımlılıklar önce gelecek şekilde sıralar; döngü varsa kalanları verilen sırayla ekler. */
export function topologicalOrder(
  graph: DependencyGraph,
  ids: string[],
  tieBreak: (a: string, b: string) => number = () => 0,
): { order: string[]; cyclic: boolean } {
  const set = new Set(ids);
  const remaining = new Map(
    ids.map((id) => [
      id,
      new Set((graph.byApp.get(id)?.internal ?? []).map((item) => item.appId).filter((dep) => set.has(dep))),
    ]),
  );
  const order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => deps.size === 0)
      .map(([id]) => id)
      .sort(tieBreak);
    if (!ready.length) {
      const rest = [...remaining.keys()].sort(tieBreak);
      return { order: [...order, ...rest], cyclic: true };
    }
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return { order, cyclic: false };
}
