/**
 * Tauri dışında (tarayıcı önizlemesi) çalışırken kullanılan sahte arka uç.
 * Port taraması, klasör tespiti ve süreç çalıştırıcıyı gerçekçi loglarla taklit eder.
 */
import type {
  DetectedApp,
  EnvPair,
  ProbeResult,
  LogLine,
  PortBinding,
  PortCheck,
  ProcessPortGroup,
  RunInfo,
  RunLogPayload,
  ScanResponse,
  StartRunRequest,
  StopRequest,
  StopResult,
  WorkspaceScan,
} from "../types";

/** Tarayıcı önizlemesinde yüklenebilen örnek projenin sanal yolu. */
export const DEMO_ROOT = "D:\\demo\\nebula-commerce";

export const DESKTOP_ONLY_MESSAGE =
  "Tarayıcı önizlemesinde gerçek klasörlere erişilemez. Klasör seçmek ve taramak için masaüstü uygulamasını \"npm run tauri dev\" ile başlatın.";

const ESC = "\x1b[";
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  green: `${ESC}32m`,
  cyan: `${ESC}36m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  magenta: `${ESC}35m`,
  blue: `${ESC}34m`,
  gray: `${ESC}90m`,
};

// ---------------------------------------------------------------------------
// Örnek tespit edilen proje
// ---------------------------------------------------------------------------

function app(partial: Partial<DetectedApp> & Pick<DetectedApp, "id" | "name" | "relativePath" | "framework" | "stack" | "kind">, root: string): DetectedApp {
  const separator = root.includes("\\") ? "\\" : "/";
  return {
    language: "TypeScript",
    defaultPort: null,
    portSource: "",
    portConfigurable: true,
    scripts: [],
    defaultScript: "dev",
    portEnv: [{ key: "PORT", value: "{port}" }],
    packageManager: "npm",
    installCommand: "npm install",
    needsInstall: false,
    exposedPorts: [],
    notes: [],
    upstreams: [],
    profiles: [],
    profileEnv: null,
    envFiles: [],
    healthPath: "/",
    ...partial,
    path:
      partial.relativePath === "."
        ? root
        : `${root}${separator}${partial.relativePath.split("/").join(separator)}`,
  };
}

function demoApps(root: string): DetectedApp[] {
  return [
    app(
      {
        id: "demo-compose",
        name: "nebula servisleri",
        relativePath: ".",
        framework: "Docker Compose",
        stack: "docker",
        kind: "infra",
        language: "YAML",
        defaultPort: 5432,
        portSource: "docker-compose.yml",
        portConfigurable: false,
        exposedPorts: [5432, 6379],
        portEnv: [],
        packageManager: "docker",
        installCommand: null,
        defaultScript: "up",
        scripts: [
          { name: "up", command: "docker compose up", portCommand: null, runnable: true },
          { name: "up --build", command: "docker compose up --build", portCommand: null, runnable: true },
          { name: "down", command: "docker compose down", portCommand: null, runnable: false },
        ],
        notes: ["Servisler: postgres, redis"],
        healthPath: null,
      },
      root,
    ),
    app(
      {
        id: "demo-api",
        name: "nebula-api",
        relativePath: "services/api",
        framework: "Spring Boot",
        stack: "spring",
        kind: "backend",
        language: "Java",
        defaultPort: 8080,
        portSource: "application.yml",
        portEnv: [{ key: "SERVER_PORT", value: "{port}" }],
        packageManager: "Maven",
        installCommand: null,
        defaultScript: "spring-boot:run",
        scripts: [
          { name: "spring-boot:run", command: "mvnw spring-boot:run", portCommand: null, runnable: true },
        ],
        upstreams: [
          { port: 5432, host: "localhost", scheme: "jdbc:postgresql", kind: "database", key: "spring.datasource.url", source: "src/main/resources/application-dev.yml" },
          { port: 8000, host: "localhost", scheme: "http", kind: "http", key: "app.recommender.base-url", source: "src/main/resources/application-dev.yml" },
          { port: 9200, host: "localhost", scheme: "http", kind: "database", key: "spring.elasticsearch.uris", source: "src/main/resources/application-dev.yml" },
        ],
        profiles: ["dev", "prod", "tls"],
        profileEnv: "SPRING_PROFILES_ACTIVE",
        healthPath: "/actuator/health",
      },
      root,
    ),
    app(
      {
        id: "demo-payments",
        name: "Payments.Api",
        relativePath: "services/payments",
        framework: "ASP.NET Core",
        stack: "dotnet",
        kind: "backend",
        language: "C#",
        defaultPort: 5099,
        portSource: "launchSettings.json",
        portEnv: [{ key: "ASPNETCORE_URLS", value: "http://localhost:{port}" }],
        packageManager: "dotnet",
        installCommand: null,
        defaultScript: "run",
        scripts: [
          { name: "run", command: "dotnet run", portCommand: "dotnet run --urls http://localhost:{port}", runnable: true },
          { name: "watch", command: "dotnet watch run", portCommand: "dotnet watch run --urls http://localhost:{port}", runnable: true },
        ],
        upstreams: [{ port: 5432, host: "localhost", scheme: "", kind: "database", key: "ConnectionStrings.Default", source: "appsettings.Development.json" }],
        profiles: ["Development", "Production"],
        profileEnv: "ASPNETCORE_ENVIRONMENT",
        healthPath: "/health",
      },
      root,
    ),
    app(
      {
        id: "demo-recommender",
        name: "recommender",
        relativePath: "services/recommender",
        framework: "FastAPI",
        stack: "fastapi",
        kind: "backend",
        language: "Python",
        defaultPort: 8000,
        portSource: "Uvicorn varsayılanı",
        portEnv: [],
        packageManager: "pip",
        installCommand: null,
        defaultScript: "uvicorn",
        scripts: [
          {
            name: "uvicorn",
            command: "\".venv\\Scripts\\python.exe\" -m uvicorn app.main:app --reload --port 8000",
            portCommand: "\".venv\\Scripts\\python.exe\" -m uvicorn app.main:app --reload --port {port}",
            runnable: true,
          },
        ],
        upstreams: [{ port: 6379, host: "localhost", scheme: "redis", kind: "database", key: "REDIS_URL", source: ".env" }],
        envFiles: [".env", ".env.local"],
        healthPath: "/health",
      },
      root,
    ),
    app(
      {
        id: "demo-storefront",
        name: "storefront",
        relativePath: "apps/storefront",
        framework: "Next.js",
        stack: "next",
        kind: "fullstack",
        defaultPort: 3000,
        portSource: "Next.js varsayılanı",
        packageManager: "pnpm",
        installCommand: "pnpm install",
        scripts: [
          { name: "dev", command: "pnpm run dev", portCommand: "pnpm run dev -p {port}", runnable: true },
          { name: "start", command: "pnpm run start", portCommand: "pnpm run start -p {port}", runnable: true },
          { name: "build", command: "pnpm run build", portCommand: null, runnable: false },
        ],
        upstreams: [{ port: 8080, host: "localhost", scheme: "http", kind: "http", key: "NEXT_PUBLIC_API_URL", source: ".env.local" }, { port: 5099, host: "localhost", scheme: "http", kind: "http", key: "PAYMENTS_URL", source: ".env.local" }],
        envFiles: [".env.local"],
      },
      root,
    ),
    app(
      {
        id: "demo-admin",
        name: "admin-console",
        relativePath: "apps/admin",
        framework: "Angular",
        stack: "angular",
        kind: "frontend",
        defaultPort: 4200,
        portSource: "Angular varsayılanı",
        defaultScript: "start",
        scripts: [
          { name: "start", command: "npm run start", portCommand: "npm run start -- --port {port}", runnable: true },
          { name: "watch", command: "npm run watch", portCommand: null, runnable: true },
          { name: "test", command: "npm run test", portCommand: null, runnable: false },
        ],
        upstreams: [{ port: 8080, host: "localhost", scheme: "http", kind: "http", key: "/api.target", source: "proxy.conf.json" }],
      },
      root,
    ),
    app(
      {
        id: "demo-dashboard",
        name: "ops-dashboard",
        relativePath: "apps/dashboard",
        framework: "Vite + React",
        stack: "react",
        kind: "frontend",
        defaultPort: 5173,
        portSource: "vite.config.ts",
        needsInstall: true,
        notes: ["node_modules bulunamadı; önce `npm install` çalıştırın."],
        scripts: [
          { name: "dev", command: "npm run dev", portCommand: "npm run dev -- --port {port} --strictPort", runnable: true },
          { name: "preview", command: "npm run preview", portCommand: "npm run preview -- --port {port} --strictPort", runnable: true },
          { name: "build", command: "npm run build", portCommand: null, runnable: false },
        ],
        upstreams: [{ port: 8080, host: "localhost", scheme: "http", kind: "http", key: "VITE_API_URL", source: ".env.development" }, { port: 8000, host: "localhost", scheme: "http", kind: "http", key: "VITE_RECOMMENDER_URL", source: ".env.development" }],
        envFiles: [".env.development"],
      },
      root,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Sahte çalıştırıcı
// ---------------------------------------------------------------------------

interface MockRun {
  info: RunInfo;
  logs: LogLine[];
  timers: number[];
  stack: string;
  memory: number;
}

const runs = new Map<string, MockRun>();
const crashedOnce = new Set<string>();
const envFiles = new Map<string, EnvPair[]>([
  [
    ".env",
    [
      { key: "REDIS_URL", value: "redis://localhost:6379/0" },
      { key: "MODEL_DIR", value: "./models" },
      { key: "OPENAI_API_KEY", value: "sk-demo-1234567890" },
    ],
  ],
  [".env.local", [{ key: "LOG_LEVEL", value: "debug" }]],
  [
    ".env.development",
    [
      { key: "VITE_API_URL", value: "http://localhost:8080/api" },
      { key: "VITE_RECOMMENDER_URL", value: "http://localhost:8000" },
    ],
  ],
]);
const logListeners = new Set<(payload: RunLogPayload) => void>();
const statusListeners = new Set<(info: RunInfo) => void>();
let runCounter = 0;
let pidCounter = 31000;
let knownApps: DetectedApp[] = [];
const seedApps = () => {
  if (!knownApps.length) knownApps = demoApps(DEMO_ROOT);
};

function emitLines(run: MockRun, stream: LogLine["stream"], texts: string[]) {
  const lines = texts.map((text) => {
    const seq = (run.logs[run.logs.length - 1]?.seq ?? 0) + 1;
    const line: LogLine = { seq, ts: Date.now(), stream, text };
    run.logs.push(line);
    return line;
  });
  logListeners.forEach((listener) => listener({ runId: run.info.runId, lines }));
}

function emitStatus(run: MockRun) {
  statusListeners.forEach((listener) => listener({ ...run.info }));
}

function finish(run: MockRun, status: RunInfo["status"], code: number | null) {
  if (run.info.status !== "running") return;
  run.timers.forEach((timer) => window.clearTimeout(timer));
  run.timers = [];
  run.info = { ...run.info, status, exitCode: code, endedAt: Date.now() };
  emitLines(run, "system", [
    status === "stopped"
      ? "■ Süreç kullanıcı tarafından durduruldu."
      : `■ Süreç sonlandı · çıkış kodu ${code ?? "?"}`,
  ]);
  emitStatus(run);
}

function schedule(run: MockRun, delay: number, action: () => void) {
  const timer = window.setTimeout(() => {
    if (run.info.status === "running") action();
  }, delay);
  run.timers.push(timer);
}

function every(run: MockRun, interval: number, action: () => void) {
  const tick = () => {
    if (run.info.status !== "running") return;
    action();
    schedule(run, interval + Math.random() * interval, tick);
  };
  schedule(run, interval, tick);
}

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

const routes = ["/api/products", "/api/cart", "/health", "/api/orders/42", "/api/auth/me", "/api/search?q=neon"];
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

function script(run: MockRun, port: number | null) {
  const p = port ?? 3000;
  const out = (...texts: string[]) => emitLines(run, "stdout", texts);
  const err = (...texts: string[]) => emitLines(run, "stderr", texts);
  const command = run.info.command;

  if (command.includes("install")) {
    out(`${c.dim}npm${c.reset} ${c.cyan}http${c.reset} fetch GET 200 https://registry.npmjs.org/react 41ms`);
    schedule(run, 600, () => out(`${c.dim}npm${c.reset} ${c.cyan}http${c.reset} fetch GET 200 https://registry.npmjs.org/vite 37ms`));
    schedule(run, 1400, () => out("", "added 214 packages, and audited 215 packages in 3s", "", `${c.green}found 0 vulnerabilities${c.reset}`));
    schedule(run, 1700, () => finish(run, "exited", 0));
    return;
  }

  switch (run.stack) {
    case "spring":
      out(
        "",
        `  .   ____          _            __ _ _`,
        ` /\\\\ / ___'_ __ _ _(_)_ __  __ _ \\ \\ \\ \\`,
        `( ( )\\___ | '_ | '_| | '_ \\/ _\` | \\ \\ \\ \\`,
        ` \\\\/  ___)| |_)| | | | | || (_| |  ) ) ) )`,
        `  '  |____| .__|_| |_|_| |_\\__, | / / / /`,
        ` =========|_|==============|___/=/_/_/_/`,
        `${c.green} :: Spring Boot ::${c.reset}                (v3.5.4)`,
        "",
      );
      schedule(run, 500, () => out(`${c.dim}${stamp()}${c.reset}  ${c.green}INFO${c.reset} 18244 --- [api] [           main] ${c.cyan}c.n.api.NebulaApiApplication${c.reset}     : Starting NebulaApiApplication using Java 21.0.4`));
      schedule(run, 900, () => out(`${c.dim}${stamp()}${c.reset}  ${c.green}INFO${c.reset} 18244 --- [api] [           main] ${c.cyan}o.s.b.w.embedded.tomcat.TomcatWebServer${c.reset}  : Tomcat initialized with port ${p} (http)`));
      schedule(run, 1500, () => out(`${c.dim}${stamp()}${c.reset}  ${c.yellow}WARN${c.reset} 18244 --- [api] [           main] ${c.cyan}JpaBaseConfiguration$JpaWebConfiguration${c.reset} : spring.jpa.open-in-view is enabled by default.`));
      schedule(run, 2200, () => out(`${c.dim}${stamp()}${c.reset}  ${c.green}INFO${c.reset} 18244 --- [api] [           main] ${c.cyan}o.s.b.w.embedded.tomcat.TomcatWebServer${c.reset}  : Tomcat started on port ${p} (http) with context path '/'`));
      schedule(run, 2400, () => out(`${c.dim}${stamp()}${c.reset}  ${c.green}INFO${c.reset} 18244 --- [api] [           main] ${c.cyan}c.n.api.NebulaApiApplication${c.reset}     : Started NebulaApiApplication in 2.913 seconds (process running for 3.4)`));
      every(run, 2600, () => {
        if (Math.random() < 0.12) {
          err(`${c.dim}${stamp()}${c.reset} ${c.red}ERROR${c.reset} 18244 --- [nio-${p}-exec-4] ${c.cyan}o.a.c.c.C.[.[.[/].[dispatcherServlet]${c.reset} : Servlet.service() threw exception: java.lang.IllegalStateException: Stok kaydı bulunamadı`, `\tat com.nebula.api.inventory.StockService.reserve(StockService.java:88)`);
        } else {
          out(`${c.dim}${stamp()}${c.reset}  ${c.green}INFO${c.reset} 18244 --- [nio-${p}-exec-${Math.ceil(Math.random() * 9)}] ${c.cyan}c.n.api.web.RequestLogger${c.reset}        : ${pick(["GET", "GET", "POST", "PUT"])} ${pick(routes)} → 200 (${Math.ceil(Math.random() * 40)}ms)`);
        }
      });
      break;
    case "dotnet":
      out(`${c.dim}Building...${c.reset}`);
      schedule(run, 900, () => out(`${c.green}info${c.reset}: Microsoft.Hosting.Lifetime[14]`, `      Now listening on: http://localhost:${p}`));
      schedule(run, 1000, () => out(`${c.green}info${c.reset}: Microsoft.Hosting.Lifetime[0]`, "      Application started. Press Ctrl+C to shut down.", `${c.green}info${c.reset}: Microsoft.Hosting.Lifetime[0]`, "      Hosting environment: Development"));
      every(run, 3000, () => out(`${c.green}info${c.reset}: Payments.Api.Endpoints[0]`, `      Ödeme doğrulandı · tx_${Math.random().toString(36).slice(2, 10)} · ${(Math.random() * 900 + 20).toFixed(2)} ₺`));
      break;
    case "fastapi":
      out(`${c.green}INFO${c.reset}:     Will watch for changes in these directories: ['${run.info.cwd}']`);
      // Önizlemede çökme analizini ve otomatik yeniden başlatmayı göstermek için ilk çalıştırma çöker.
      if (!crashedOnce.has(run.info.appId)) {
        crashedOnce.add(run.info.appId);
        schedule(run, 600, () =>
          err(
            "Traceback (most recent call last):",
            '  File "D:\\demo\\nebula-commerce\\services\\recommender\\app\\main.py", line 4, in <module>',
            "    from app.ranking import model",
            '  File "D:\\demo\\nebula-commerce\\services\\recommender\\app\\ranking.py", line 1, in <module>',
            "    import numpy as np",
            "ModuleNotFoundError: No module named 'numpy'",
          ),
        );
        schedule(run, 900, () => finish(run, "failed", 1));
        break;
      }
      schedule(run, 400, () => out(`${c.green}INFO${c.reset}:     Uvicorn running on ${c.bold}http://127.0.0.1:${p}${c.reset} (Press CTRL+C to quit)`, `${c.green}INFO${c.reset}:     Started reloader process [${run.info.pid}] using ${c.cyan}WatchFiles${c.reset}`));
      schedule(run, 900, () => out(`${c.green}INFO${c.reset}:     Started server process [${run.info.pid + 4}]`, `${c.green}INFO${c.reset}:     Waiting for application startup.`, `${c.green}INFO${c.reset}:     Application startup complete.`));
      every(run, 2200, () => out(`${c.green}INFO${c.reset}:     127.0.0.1:${50000 + Math.floor(Math.random() * 9000)} - "${c.bold}GET /recommendations/${Math.ceil(Math.random() * 900)} HTTP/1.1${c.reset}" ${c.green}200 OK${c.reset}`));
      break;
    case "next":
      out("", `  ${c.magenta}${c.bold}▲ Next.js 15.4.2${c.reset} (Turbopack)`, `  - Local:        http://localhost:${p}`, `  - Network:      http://192.168.1.24:${p}`, "");
      schedule(run, 700, () => out(` ${c.green}✓${c.reset} Starting...`));
      schedule(run, 1500, () => out(` ${c.green}✓${c.reset} Ready in 1312ms`));
      every(run, 3200, () => out(` ${c.dim}GET${c.reset} ${pick(["/", "/products", "/cart", "/checkout"])} ${c.green}200${c.reset} in ${Math.ceil(Math.random() * 300)}ms`));
      break;
    case "angular":
      out(`${c.dim}Component HMR has been enabled.${c.reset}`);
      schedule(run, 1600, () => out("Initial chunk files | Names         |  Raw size", `${c.cyan}main.js${c.reset}             | ${c.dim}main${c.reset}          | 312.44 kB |`, `${c.cyan}styles.css${c.reset}          | ${c.dim}styles${c.reset}        |  48.10 kB |`, "", `${c.green}Application bundle generation complete.${c.reset} [2.134 seconds]`, "", `Watch mode enabled. Watching for file changes...`, `  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}:   ${c.cyan}http://localhost:${p}/${c.reset}`));
      every(run, 5000, () => out(`${c.dim}${new Date().toLocaleTimeString("tr-TR")}${c.reset} ${c.green}[watch]${c.reset} src/app/orders/orders.component.ts değişti, yeniden derleniyor…`));
      break;
    case "docker":
      out(`${c.dim}[+] Running 3/3${c.reset}`, ` ${c.green}✔${c.reset} Network nebula_default    ${c.green}Created${c.reset}`, ` ${c.green}✔${c.reset} Container nebula-db-1     ${c.green}Started${c.reset}`, ` ${c.green}✔${c.reset} Container nebula-cache-1  ${c.green}Started${c.reset}`);
      schedule(run, 800, () => out(`${c.cyan}db-1   |${c.reset} LOG:  database system is ready to accept connections`, `${c.magenta}cache-1|${c.reset} * Ready to accept connections tcp`));
      every(run, 6000, () => out(`${c.cyan}db-1   |${c.reset} LOG:  checkpoint complete: wrote ${Math.ceil(Math.random() * 90)} buffers`));
      break;
    default:
      schedule(run, 300, () => out("", `  ${c.green}${c.bold}VITE${c.reset} ${c.green}v7.1.7${c.reset}  ${c.dim}ready in${c.reset} ${c.bold}${280 + Math.ceil(Math.random() * 200)}${c.reset} ${c.dim}ms${c.reset}`, "", `  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}:   ${c.cyan}http://localhost:${c.bold}${p}${c.reset}${c.cyan}/${c.reset}`, `  ${c.green}➜${c.reset}  ${c.dim}${c.bold}Network${c.reset}${c.dim}: use ${c.reset}${c.bold}--host${c.reset}${c.dim} to expose${c.reset}`));
      every(run, 4200, () => {
        if (Math.random() < 0.15) {
          err(`${c.yellow}${new Date().toLocaleTimeString("tr-TR")}${c.reset} ${c.yellow}[vite] warning:${c.reset} src/widgets/Chart.tsx kullanılmayan import içeriyor`);
        } else {
          out(`${c.dim}${new Date().toLocaleTimeString("tr-TR")}${c.reset} ${c.cyan}${c.bold}[vite]${c.reset} ${c.green}hmr update${c.reset} ${c.dim}/src/${pick(["App.tsx", "widgets/Chart.tsx", "pages/Orders.tsx", "styles.css"])}${c.reset}`);
        }
      });
  }
}

// ---------------------------------------------------------------------------
// Sahte port taraması
// ---------------------------------------------------------------------------

function listener(port: number, technologyUrl = true, exposure: PortBinding["exposure"] = "local"): PortBinding {
  return {
    protocol: "TCP",
    address: exposure === "all" ? "0.0.0.0" : "127.0.0.1",
    port,
    remoteAddress: null,
    remotePort: null,
    exposure,
    state: "LISTEN",
    activity: "listener",
    role: "published",
    roleReason: "Komut satırında geliştirme sunucusu işareti bulundu.",
    confidence: "high",
    accessUrls: technologyUrl
      ? exposure === "all"
        ? [`http://localhost:${port}`, `http://192.168.1.24:${port}`]
        : [`http://localhost:${port}`]
      : [],
  };
}

const baseProcess = {
  executablePath: null,
  parentChain: [],
  knownDeveloperTool: true,
  protected: false,
  protectionReason: null,
  diskReadBytesPerSecond: 0,
  diskWriteBytesPerSecond: 0,
  diskTotalReadBytes: 0,
  diskTotalWrittenBytes: 0,
  metricsReady: true,
  managedRunId: null,
  managedAppId: null,
  managedProjectId: null,
} satisfies Partial<ProcessPortGroup>;

const bootTime = Math.floor(Date.now() / 1000);

function externalProcesses(includeInfra: boolean): ProcessPortGroup[] {
  const list: ProcessPortGroup[] = [
    {
      ...baseProcess,
      pid: 41256,
      processName: "node.exe",
      displayName: "Meteor Panel",
      command: "node.exe @angular\\cli\\bin\\ng.js serve --host 0.0.0.0 --port 4200",
      workingDirectory: "D:\\development\\meteor-panel\\frontend",
      parentChain: [
        { pid: 25700, name: "Code" },
        { pid: 14320, name: "explorer" },
      ],
      ports: [listener(4200, true, "all")],
      technology: "Angular",
      projectName: "Meteor Panel",
      projectRoot: "D:\\development\\meteor-panel\\frontend",
      serviceKind: "Frontend",
      serviceDescription: "Meteor Panel projesinin Frontend bileşeni · Angular olarak algılandı.",
      category: "development",
      memoryBytes: 182_000_000 + Math.random() * 6_000_000,
      cpuUsagePercent: 1 + Math.random() * 4,
      startedAt: bootTime - 3_920,
    },
    {
      ...baseProcess,
      pid: 18820,
      processName: "java.exe",
      displayName: "Ledger Service",
      command: "java.exe -Dspring.profiles.active=dev org.springframework.boot.loader.launch.JarLauncher",
      workingDirectory: "D:\\development\\ledger-service",
      parentChain: [
        { pid: 9920, name: "idea64" },
        { pid: 14320, name: "explorer" },
      ],
      ports: [listener(8081)],
      technology: "Spring Boot",
      projectName: "Ledger Service",
      projectRoot: "D:\\development\\ledger-service",
      serviceKind: "Backend / API",
      serviceDescription: "Ledger Service projesinin Backend / API bileşeni.",
      category: "development",
      memoryBytes: 512_000_000 + Math.random() * 20_000_000,
      cpuUsagePercent: 0.4 + Math.random() * 2,
      startedAt: bootTime - 12_400,
    },
    {
      ...baseProcess,
      pid: 22410,
      processName: "node.exe",
      displayName: "Portcontrol",
      command: "node.exe node_modules\\vite\\bin\\vite.js",
      workingDirectory: "D:\\development\\my-projects\\portcontrol",
      parentChain: [
        { pid: 22398, name: "cmd" },
        { pid: 22102, name: "node" },
      ],
      ports: [listener(1420)],
      technology: "Tauri + React",
      projectName: "Portcontrol",
      projectRoot: "D:\\development\\my-projects\\portcontrol",
      serviceKind: "Masaüstü uygulaması",
      serviceDescription: "Portcontrol projesinin Masaüstü uygulaması bileşeni.",
      category: "development",
      memoryBytes: 96_000_000 + Math.random() * 3_000_000,
      cpuUsagePercent: Math.random() * 1.5,
      startedAt: bootTime - 640,
    },
  ];
  if (includeInfra) {
    list.push({
      ...baseProcess,
      pid: 5212,
      processName: "postgres.exe",
      displayName: "PostgreSQL",
      command: "\"C:\\Program Files\\PostgreSQL\\17\\bin\\postgres.exe\" -D data",
      workingDirectory: "C:\\Program Files\\PostgreSQL\\17",
      ports: [{ ...listener(5432, false), role: "infrastructure" }],
      technology: "PostgreSQL",
      projectName: null,
      projectRoot: null,
      serviceKind: "Veritabanı",
      serviceDescription: "PostgreSQL veritabanı sunucusu.",
      category: "database",
      memoryBytes: 64_000_000,
      cpuUsagePercent: 0.1,
      startedAt: bootTime - 86_000,
    });
  }
  return list;
}

function managedProcesses(): ProcessPortGroup[] {
  return [...runs.values()]
    .filter((run) => run.info.status === "running" && !run.info.command.includes("install") && !run.info.command.includes("down"))
    .filter((run) => Date.now() - run.info.startedAt > 1400)
    .map((run) => {
      const app = knownApps.find((item) => item.id === run.info.appId);
      const ports =
        run.stack === "docker"
          ? (app?.exposedPorts ?? [5432])
          : [run.info.port ?? app?.defaultPort ?? 3000];
      run.memory = Math.max(60_000_000, run.memory + (Math.random() - 0.45) * 8_000_000);
      return {
        ...baseProcess,
        pid: run.info.pid + 3,
        processName: run.stack === "spring" ? "java.exe" : run.stack === "dotnet" ? "Payments.Api.exe" : run.stack === "fastapi" ? "python.exe" : "node.exe",
        displayName: app?.name ?? run.info.label,
        command: run.info.command,
        workingDirectory: run.info.cwd,
        parentChain: [{ pid: run.info.pid, name: "cmd" }],
        ports: ports.map((port) => listener(port, run.stack !== "docker")),
        technology: app?.framework ?? "Node.js",
        projectName: app?.name ?? null,
        projectRoot: run.info.cwd,
        serviceKind: app?.kind ?? "Servis",
        serviceDescription: `${app?.framework ?? "Servis"} · PortControl tarafından başlatıldı.`,
        category: run.stack === "docker" ? "container" : "development",
        memoryBytes: run.memory,
        cpuUsagePercent: 0.5 + Math.random() * (run.stack === "spring" ? 9 : 4),
        startedAt: Math.floor(run.info.startedAt / 1000),
        managedRunId: run.info.runId,
        managedAppId: run.info.appId,
        managedProjectId: run.info.projectId,
      } satisfies ProcessPortGroup;
    });
}

function busyPorts(): Map<number, { pid: number; name: string }> {
  const map = new Map<number, { pid: number; name: string }>();
  for (const process of [...externalProcesses(true), ...managedProcesses()]) {
    for (const port of process.ports) map.set(port.port, { pid: process.pid, name: process.processName });
  }
  return map;
}

/** Port çakışma kontrolü için başlatılmakta olan süreçlerin hedef portlarını da dolu say. */
function reservedPorts(): Map<number, { pid: number; name: string }> {
  const map = busyPorts();
  for (const run of runs.values()) {
    if (run.info.status === "running" && run.info.port && !map.has(run.info.port)) {
      map.set(run.info.port, { pid: run.info.pid, name: "node.exe" });
    }
  }
  return map;
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const mockBackend = {
  async scanPorts(includeInfra: boolean): Promise<ScanResponse> {
    await delay(120);
    const processes = [...managedProcesses(), ...externalProcesses(includeInfra)];
    return {
      processes,
      scannedAt: Date.now(),
      totalSockets: 214,
      filteredProcesses: 37,
      inaccessibleSockets: 0,
      platform: "windows",
      permissionNotice: null,
    };
  },

  async stopProcesses(requests: StopRequest[]): Promise<StopResult[]> {
    await delay(300);
    return requests.map((request) => ({
      pid: request.pid,
      processName: "Demo süreci",
      stopped: true,
      message: "Demo görünümünde durduruldu.",
    }));
  },

  async scanWorkspace(path: string): Promise<WorkspaceScan> {
    await delay(650);
    // Gerçek dosya sistemi yok: yalnızca örnek proje taranır, başka yollar için sonuç uydurulmaz.
    if (path.trim().toLowerCase() !== DEMO_ROOT.toLowerCase()) {
      throw new Error(DESKTOP_ONLY_MESSAGE);
    }
    const root = DEMO_ROOT;
    const apps = demoApps(root);
    knownApps = [...knownApps.filter((app) => !apps.some((item) => item.id === app.id)), ...apps];
    const folder = root.split(/[\\/]/).filter(Boolean).pop() ?? "proje";
    return {
      root,
      name: folder
        .split(/[-_ ]/)
        .filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" "),
      apps,
      scannedDirectories: 1284,
      truncated: false,
      durationMs: 212,
    };
  },

  async pickFolder(): Promise<string | null> {
    throw new Error(DESKTOP_ONLY_MESSAGE);
  },

  async startRun(request: StartRunRequest): Promise<RunInfo> {
    seedApps();
    await delay(90);
    const app = knownApps.find((item) => item.id === request.appId.replace(/:install$/, ""));
    runCounter += 1;
    pidCounter += 7;
    const info: RunInfo = {
      runId: `mock-run-${runCounter}`,
      appId: request.appId,
      projectId: request.projectId,
      label: request.label,
      command: request.command,
      cwd: request.cwd,
      pid: pidCounter,
      port: request.port,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
    };
    const run: MockRun = {
      info,
      logs: [],
      timers: [],
      stack: app?.stack ?? "node",
      memory: 120_000_000 + Math.random() * 80_000_000,
    };
    runs.set(info.runId, run);
    window.setTimeout(() => {
      emitStatus(run);
      const intro = [`$ ${request.command}`];
      if (request.env.length) intro.push(`env ${request.env.map((pair) => `${pair.key}=${pair.value}`).join(" ")}`);
      intro.push(`PID ${info.pid} · ${info.cwd}`);
      emitLines(run, "system", intro);
      script(run, request.port ?? app?.defaultPort ?? null);
    }, 0);
    return { ...info };
  },

  async stopRun(runId: string): Promise<void> {
    const run = runs.get(runId);
    if (!run) return;
    window.setTimeout(() => finish(run, "stopped", 1), 350);
  },

  async listRuns(): Promise<RunInfo[]> {
    return [...runs.values()].map((run) => ({ ...run.info }));
  },

  async runLogs(runId: string): Promise<LogLine[]> {
    return [...(runs.get(runId)?.logs ?? [])];
  },

  async probeService(port: number, path: string | null): Promise<ProbeResult> {
    await delay(40);
    const listening = busyPorts().has(port);
    return listening
      ? { ok: true, status: path ? 200 : null, latencyMs: 8 + Math.round(Math.random() * 30), error: null }
      : { ok: false, status: null, latencyMs: 3, error: "Bağlantı reddedildi (demo)" };
  },

  async readEnvFile(path: string): Promise<EnvPair[]> {
    await delay(60);
    const name = path.split(/[\\/]/).pop() ?? path;
    return [...(envFiles.get(name) ?? [])];
  },

  async writeEnvFile(path: string, entries: EnvPair[]): Promise<void> {
    await delay(80);
    const name = path.split(/[\\/]/).pop() ?? path;
    envFiles.set(name, entries.map((entry) => ({ ...entry })));
  },

  async writeRunInput(runId: string, text: string): Promise<void> {
    const run = runs.get(runId);
    if (!run) return;
    emitLines(run, "input", [`› ${text}`]);
    window.setTimeout(() => emitLines(run, "stdout", [`${c.dim}(demo) girdi alındı: ${text}${c.reset}`]), 200);
  },

  async removeRun(runId: string): Promise<void> {
    runs.delete(runId);
  },

  async checkPort(port: number): Promise<PortCheck> {
    await delay(60);
    const owner = reservedPorts().get(port);
    return { port, free: !owner, pid: owner?.pid ?? null, processName: owner?.name ?? null };
  },

  async findFreePort(start: number, exclude: number[]): Promise<number | null> {
    const busy = reservedPorts();
    for (let port = Math.max(1024, start); port < start + 400; port += 1) {
      if (!busy.has(port) && !exclude.includes(port)) return port;
    }
    return null;
  },

  async onRunLog(handler: (payload: RunLogPayload) => void) {
    logListeners.add(handler);
    return () => {
      logListeners.delete(handler);
    };
  },

  async onRunStatus(handler: (info: RunInfo) => void) {
    statusListeners.add(handler);
    return () => {
      statusListeners.delete(handler);
    };
  },
};
