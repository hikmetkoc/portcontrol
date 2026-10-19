//! Bir çalışma klasörünü tarayıp ayağa kaldırılabilir frontend, backend ve
//! altyapı uygulamalarını tespit eder. Her uygulama için varsayılan port,
//! başlatma komutları ve özel port uygulama stratejisi üretilir.

use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::Serialize;

const MAX_DEPTH: usize = 6;
const MAX_DIRECTORIES: usize = 6000;
const SKIPPED_DIRECTORIES: &[&str] = &[
    "node_modules",
    "bower_components",
    "jspm_packages",
    "target",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    "vendor",
    "venv",
    "env",
    "__pycache__",
    "site-packages",
    "coverage",
    "tmp",
    "temp",
    "logs",
    "Pods",
    "DerivedData",
    "storybook-static",
    "src-tauri",
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchScript {
    pub name: String,
    pub command: String,
    pub port_command: Option<String>,
    pub runnable: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnvPair {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    pub id: String,
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub framework: String,
    pub language: String,
    pub stack: &'static str,
    pub kind: &'static str,
    pub default_port: Option<u16>,
    pub port_source: String,
    pub port_configurable: bool,
    pub scripts: Vec<LaunchScript>,
    pub default_script: String,
    pub port_env: Vec<EnvPair>,
    pub package_manager: Option<String>,
    pub install_command: Option<String>,
    pub needs_install: bool,
    pub exposed_ports: Vec<u16>,
    pub notes: Vec<String>,
    /// Yapılandırma dosyalarında bu uygulamanın bağlandığı yerel servisler.
    pub upstreams: Vec<Upstream>,
    /// Seçilebilir çalışma profilleri (Spring `application-dev.yml` → `dev` gibi).
    pub profiles: Vec<String>,
    /// Profilin aktarıldığı ortam değişkeni (ör. `SPRING_PROFILES_ACTIVE`).
    pub profile_env: Option<String>,
    /// Uygulama klasöründeki düzenlenebilir `.env` dosyaları.
    pub env_files: Vec<String>,
    /// Hazır olma kontrolü için HTTP yolu; yoksa yalnızca TCP bağlantısı denetlenir.
    pub health_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Upstream {
    pub port: u16,
    pub host: String,
    pub scheme: String,
    /// "http", "database" veya "tcp".
    pub kind: &'static str,
    /// Adresin bulunduğu anahtar yolu (ör. `app.mpai.base-url`, `/api.target`).
    pub key: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScan {
    root: String,
    name: String,
    apps: Vec<DetectedApp>,
    scanned_directories: usize,
    truncated: bool,
    duration_ms: u64,
}

#[tauri::command(async)]
pub fn scan_workspace(path: String) -> Result<WorkspaceScan, String> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("Klasör yolu boş olamaz.".into());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_dir() {
        return Err(format!("Klasör bulunamadı: {trimmed}"));
    }
    let root = fs::canonicalize(&root)
        .map(strip_verbatim_prefix)
        .unwrap_or(root);
    Ok(scan_directory(&root))
}

pub fn scan_directory(root: &Path) -> WorkspaceScan {
    let started = Instant::now();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0usize)]);
    let mut apps = Vec::new();
    let mut scanned_directories = 0;
    let mut truncated = false;

    while let Some((directory, depth)) = queue.pop_front() {
        if scanned_directories >= MAX_DIRECTORIES {
            truncated = true;
            break;
        }
        scanned_directories += 1;
        apps.extend(detect_in_directory(&directory, root));

        if depth >= MAX_DEPTH {
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        let mut children = entries
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.path())
            .filter(|path| {
                let name = path
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_default();
                !name.starts_with('.')
                    && !SKIPPED_DIRECTORIES
                        .iter()
                        .any(|skipped| skipped.eq_ignore_ascii_case(&name))
            })
            .collect::<Vec<_>>();
        children.sort();
        queue.extend(children.into_iter().map(|child| (child, depth + 1)));
    }

    apps.sort_by(|left, right| {
        kind_priority(left.kind)
            .cmp(&kind_priority(right.kind))
            .then(left.relative_path.cmp(&right.relative_path))
            .then(left.name.cmp(&right.name))
    });
    let mut seen = HashSet::new();
    apps.retain(|app| seen.insert(app.id.clone()));

    WorkspaceScan {
        root: root.to_string_lossy().into_owned(),
        name: root
            .file_name()
            .map(|value| humanize(&value.to_string_lossy()))
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
        apps,
        scanned_directories,
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

fn kind_priority(kind: &str) -> u8 {
    match kind {
        "infra" => 0,
        "backend" => 1,
        "fullstack" => 2,
        "frontend" => 3,
        _ => 4,
    }
}

pub fn detect_in_directory(directory: &Path, root: &Path) -> Vec<DetectedApp> {
    let mut apps = Vec::new();
    apps.extend(detect_node(directory, root));
    apps.extend(detect_jvm(directory, root));
    apps.extend(detect_dotnet(directory, root));
    apps.extend(detect_python(directory, root));
    apps.extend(detect_go(directory, root));
    apps.extend(detect_rust(directory, root));
    apps.extend(detect_php(directory, root));
    apps.extend(detect_ruby(directory, root));
    apps.extend(detect_flutter(directory, root));
    apps.extend(detect_compose(directory, root));
    apps
}

/// Ortak alanları dolduran küçük yapıcı.
struct AppDraft {
    name: String,
    framework: String,
    language: &'static str,
    stack: &'static str,
    kind: &'static str,
    default_port: Option<u16>,
    port_source: String,
    port_configurable: bool,
    scripts: Vec<LaunchScript>,
    default_script: String,
    port_env: Vec<EnvPair>,
    package_manager: Option<String>,
    install_command: Option<String>,
    needs_install: bool,
    exposed_ports: Vec<u16>,
    notes: Vec<String>,
    /// Bağımlılık taramasına eklenecek uygulamaya özgü dosyalar (ör. Angular proxy).
    upstream_files: Vec<String>,
    profiles: Vec<String>,
    profile_env: Option<String>,
    health_path: Option<String>,
}

impl AppDraft {
    fn new(name: String, framework: impl Into<String>, stack: &'static str) -> Self {
        Self {
            name,
            framework: framework.into(),
            language: "",
            stack,
            kind: "backend",
            default_port: None,
            port_source: String::new(),
            port_configurable: true,
            scripts: Vec::new(),
            default_script: String::new(),
            port_env: vec![env("PORT", "{port}")],
            package_manager: None,
            install_command: None,
            needs_install: false,
            exposed_ports: Vec::new(),
            notes: Vec::new(),
            upstream_files: Vec::new(),
            profiles: Vec::new(),
            profile_env: None,
            health_path: None,
        }
    }

    fn single_script(mut self, name: &str, command: String, port_command: Option<String>) -> Self {
        self.scripts = vec![LaunchScript {
            name: name.into(),
            command,
            port_command,
            runnable: true,
        }];
        self.default_script = name.into();
        self
    }

    fn port(mut self, port: Option<u16>, source: impl Into<String>) -> Self {
        self.default_port = port;
        self.port_source = source.into();
        self
    }

    fn finish(self, directory: &Path, root: &Path) -> DetectedApp {
        let relative_path = relative_path(directory, root);
        let id = format!(
            "{:016x}",
            fnv1a(&format!("{relative_path}|{}|{}", self.stack, self.name))
        );
        let mut exposed_ports = self.exposed_ports;
        if exposed_ports.is_empty()
            && let Some(port) = self.default_port
        {
            exposed_ports.push(port);
        }
        let upstreams = collect_upstreams(directory, &self.upstream_files, &exposed_ports);
        let env_files = list_env_files(directory);
        DetectedApp {
            id,
            name: self.name,
            path: directory.to_string_lossy().into_owned(),
            relative_path,
            framework: self.framework,
            language: self.language.into(),
            stack: self.stack,
            kind: self.kind,
            default_port: self.default_port,
            port_source: self.port_source,
            port_configurable: self.port_configurable,
            scripts: self.scripts,
            default_script: self.default_script,
            port_env: self.port_env,
            package_manager: self.package_manager,
            install_command: self.install_command,
            needs_install: self.needs_install,
            exposed_ports,
            notes: self.notes,
            upstreams,
            profiles: self.profiles,
            profile_env: self.profile_env,
            env_files,
            health_path: self.health_path,
        }
    }
}

fn env(key: &str, value: &str) -> EnvPair {
    EnvPair {
        key: key.into(),
        value: value.into(),
    }
}

// ---------------------------------------------------------------------------
// Node.js ekosistemi
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum PortArgs {
    /// CLI bayrağı ile port (`--port`, `-p`); `strict` Vite'ın `--strictPort` desteği.
    Flag(&'static str, bool),
    /// Yalnızca `PORT` ortam değişkeni.
    Env,
    /// Port dışarıdan değiştirilemez.
    Fixed,
}

struct NodeFramework {
    framework: String,
    stack: &'static str,
    kind: &'static str,
    port: Option<u16>,
    cli: &'static [&'static str],
    port_args: PortArgs,
}

const PRIMARY_NODE_SCRIPTS: &[&str] = &[
    "dev",
    "start:dev",
    "develop",
    "serve",
    "start",
    "dev:server",
    "server",
    "preview",
];

fn detect_node(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let content = read_small_text(&directory.join("package.json"), 1024 * 1024)?;
    let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    let scripts: BTreeMap<String, String> = json
        .get("scripts")
        .and_then(serde_json::Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.into())))
                .collect()
        })
        .unwrap_or_default();
    let mut dependencies = HashSet::new();
    for field in ["dependencies", "devDependencies"] {
        if let Some(map) = json.get(field).and_then(serde_json::Value::as_object) {
            dependencies.extend(map.keys().cloned());
        }
    }
    let has = |name: &str| dependencies.contains(name);
    let is_tauri = has("@tauri-apps/cli") && directory.join("src-tauri").is_dir();

    let primary_script = PRIMARY_NODE_SCRIPTS
        .iter()
        .find(|name| scripts.contains_key(**name))
        .map(|name| name.to_string());
    if primary_script.is_none() && !is_tauri {
        return None;
    }

    let framework = node_framework(directory, &has, is_tauri);
    let package_manager = detect_package_manager(directory, root);
    let mut draft = AppDraft::new(
        package_display_name(&json, directory),
        framework.framework.clone(),
        framework.stack,
    );
    draft.kind = framework.kind;
    draft.language = if has("typescript") || directory.join("tsconfig.json").is_file() {
        "TypeScript"
    } else {
        "JavaScript"
    };
    draft.package_manager = Some(package_manager.into());
    draft.install_command = Some(format!("{package_manager} install"));
    draft.needs_install = !has_node_modules(directory, root);
    if draft.needs_install {
        draft.notes.push(format!(
            "node_modules bulunamadı; önce `{package_manager} install` çalıştırın."
        ));
    }

    // Varsayılan port: betikte açıkça yazılan > yapılandırma dosyası > framework varsayılanı.
    let primary_body = primary_script
        .as_deref()
        .and_then(|name| scripts.get(name))
        .cloned()
        .unwrap_or_default();
    let (default_port, port_source) = if let Some(port) = port_in_command(&primary_body) {
        (Some(port), "package.json betiği".to_string())
    } else if let Some((port, file)) = node_config_port(directory, &framework) {
        (Some(port), file)
    } else if let Some((port, file)) = dotenv_port(directory) {
        (Some(port), file)
    } else if framework.port_args == PortArgs::Env
        && let Some((port, file)) = source_listen_port(directory)
    {
        (Some(port), file)
    } else {
        (
            framework.port,
            if framework.port.is_some() {
                format!("{} varsayılanı", framework.framework)
            } else {
                String::new()
            },
        )
    };
    draft = draft.port(default_port, port_source);

    let mut launch_scripts = Vec::new();
    if is_tauri {
        let command = node_script_command(package_manager, "tauri", Some("dev"));
        launch_scripts.push(LaunchScript {
            name: "tauri dev".into(),
            command,
            port_command: None,
            runnable: true,
        });
        draft.port_configurable = false;
        draft.port_env.clear();
        draft
            .notes
            .push("Tauri geliştirme portu tauri.conf.json içindeki devUrl ile sabittir.".into());
    }
    for (name, body) in &scripts {
        let runnable = is_runnable_script(name, body);
        let port_command = node_port_command(package_manager, name, body, &framework);
        launch_scripts.push(LaunchScript {
            name: name.clone(),
            command: node_script_command(package_manager, name, None),
            port_command,
            runnable,
        });
    }
    // Çalıştırılabilir betikler önce, birincil betik en başta.
    launch_scripts.sort_by_key(|script| {
        (
            !script.runnable,
            PRIMARY_NODE_SCRIPTS
                .iter()
                .position(|name| *name == script.name)
                .unwrap_or(usize::MAX),
        )
    });
    if is_tauri {
        // Sentetik "tauri dev" her zaman ilk sırada kalır.
        if let Some(index) = launch_scripts
            .iter()
            .position(|script| script.name == "tauri dev")
        {
            let tauri = launch_scripts.remove(index);
            launch_scripts.insert(0, tauri);
        }
    }
    draft.default_script = if is_tauri {
        "tauri dev".into()
    } else {
        primary_script.unwrap_or_default()
    };
    draft.scripts = launch_scripts;

    if framework.port_args == PortArgs::Fixed {
        draft.port_configurable = false;
    } else if framework.port_args == PortArgs::Env && !is_tauri {
        draft
            .notes
            .push("Özel port PORT ortam değişkeniyle aktarılır.".into());
    }
    if framework.framework == "Create React App" {
        draft.port_env.push(env("BROWSER", "none"));
    }

    // Angular/Webpack proxy dosyaları: betikteki `--proxy-config` ve angular.json `proxyConfig`.
    let mut proxy_files = Vec::new();
    for body in scripts.values() {
        let tokens = body.split_whitespace().collect::<Vec<_>>();
        for (index, token) in tokens.iter().enumerate() {
            if let Some(file) = token.strip_prefix("--proxy-config=") {
                proxy_files.push(file.trim_matches(['"', '\'']).to_string());
            } else if *token == "--proxy-config"
                && let Some(file) = tokens.get(index + 1)
            {
                proxy_files.push(file.trim_matches(['"', '\'']).to_string());
            }
        }
    }
    if let Some(angular) = read_small_text(&directory.join("angular.json"), 1024 * 1024) {
        let mut rest = angular.as_str();
        while let Some(found) = rest.find("\"proxyConfig\"") {
            rest = &rest[found + "\"proxyConfig\"".len()..];
            if let Some(value) = rest
                .trim_start()
                .strip_prefix(':')
                .and_then(|value| value.trim_start().strip_prefix('"'))
                .and_then(|value| value.split('"').next())
            {
                proxy_files.push(value.to_string());
            }
        }
    }
    draft.upstream_files = proxy_files;

    draft.health_path = if matches!(draft.kind, "frontend" | "fullstack" | "desktop") {
        Some("/".into())
    } else {
        find_health_route(
            directory,
            &[
                "src/main.ts",
                "src/index.ts",
                "src/server.ts",
                "src/app.ts",
                "src/app.controller.ts",
                "src/index.js",
                "src/server.js",
                "src/app.js",
                "server.ts",
                "server.js",
                "index.ts",
                "index.js",
                "app.js",
                "main.js",
            ],
        )
    };

    Some(draft.finish(directory, root))
}

fn node_framework(directory: &Path, has: &dyn Fn(&str) -> bool, is_tauri: bool) -> NodeFramework {
    let frontend_flavor = || -> (&'static str, &'static str) {
        if has("react") {
            ("React", "react")
        } else if has("vue") {
            ("Vue", "vue")
        } else if has("svelte") {
            ("Svelte", "svelte")
        } else if has("solid-js") {
            ("Solid", "solid")
        } else if has("preact") {
            ("Preact", "react")
        } else if has("lit") {
            ("Lit", "vite")
        } else {
            ("", "vite")
        }
    };
    let backend = |framework: &str| NodeFramework {
        framework: framework.into(),
        stack: "node",
        kind: "backend",
        port: Some(3000),
        cli: &[],
        port_args: PortArgs::Env,
    };

    if is_tauri {
        let (flavor, _) = frontend_flavor();
        let flavor = if has("@angular/core") {
            "Angular"
        } else {
            flavor
        };
        return NodeFramework {
            framework: if flavor.is_empty() {
                "Tauri".into()
            } else {
                format!("Tauri + {flavor}")
            },
            stack: "tauri",
            kind: "desktop",
            port: has("vite").then_some(1420),
            cli: &[],
            port_args: PortArgs::Fixed,
        };
    }
    if has("next") {
        return NodeFramework {
            framework: "Next.js".into(),
            stack: "next",
            kind: "fullstack",
            port: Some(3000),
            cli: &["next dev", "next start"],
            port_args: PortArgs::Flag("-p", false),
        };
    }
    if has("nuxt") || has("nuxt3") {
        return NodeFramework {
            framework: "Nuxt".into(),
            stack: "nuxt",
            kind: "fullstack",
            port: Some(3000),
            cli: &["nuxt", "nuxi"],
            port_args: PortArgs::Flag("--port", false),
        };
    }
    if has("@remix-run/dev") || has("@react-router/dev") {
        let vite = has("vite");
        return NodeFramework {
            framework: if has("@remix-run/dev") {
                "Remix".into()
            } else {
                "React Router".into()
            },
            stack: "remix",
            kind: "fullstack",
            port: Some(if vite { 5173 } else { 3000 }),
            cli: &["remix", "react-router", "vite"],
            port_args: PortArgs::Flag("--port", vite),
        };
    }
    if has("@sveltejs/kit") {
        return NodeFramework {
            framework: "SvelteKit".into(),
            stack: "svelte",
            kind: "fullstack",
            port: Some(5173),
            cli: &["vite"],
            port_args: PortArgs::Flag("--port", true),
        };
    }
    if has("astro") {
        return NodeFramework {
            framework: "Astro".into(),
            stack: "astro",
            kind: "frontend",
            port: Some(4321),
            cli: &["astro"],
            port_args: PortArgs::Flag("--port", false),
        };
    }
    if has("@angular/core") || directory.join("angular.json").is_file() {
        return NodeFramework {
            framework: "Angular".into(),
            stack: "angular",
            kind: "frontend",
            port: Some(4200),
            cli: &["ng serve", "ng s"],
            port_args: PortArgs::Flag("--port", false),
        };
    }
    if has("gatsby") {
        return NodeFramework {
            framework: "Gatsby".into(),
            stack: "react",
            kind: "frontend",
            port: Some(8000),
            cli: &["gatsby"],
            port_args: PortArgs::Flag("-p", false),
        };
    }
    if has("react-scripts") {
        return NodeFramework {
            framework: "Create React App".into(),
            stack: "react",
            kind: "frontend",
            port: Some(3000),
            cli: &[],
            port_args: PortArgs::Env,
        };
    }
    if has("@vue/cli-service") {
        return NodeFramework {
            framework: "Vue CLI".into(),
            stack: "vue",
            kind: "frontend",
            port: Some(8080),
            cli: &["vue-cli-service"],
            port_args: PortArgs::Flag("--port", false),
        };
    }
    if has("@nestjs/core") {
        let mut nest = backend("NestJS");
        nest.stack = "nest";
        return nest;
    }
    if has("vite") {
        let (flavor, stack) = frontend_flavor();
        return NodeFramework {
            framework: if flavor.is_empty() {
                "Vite".into()
            } else {
                format!("Vite + {flavor}")
            },
            stack,
            kind: "frontend",
            port: Some(5173),
            cli: &["vite"],
            port_args: PortArgs::Flag("--port", true),
        };
    }
    // Electron yalnızca paketleme aracı olarak eklenmiş web projelerini (ör. Angular +
    // electron-builder) masaüstü saymamak için web framework'lerinden sonra denetlenir.
    if has("electron") {
        return NodeFramework {
            framework: "Electron".into(),
            stack: "electron",
            kind: "desktop",
            port: None,
            cli: &[],
            port_args: PortArgs::Env,
        };
    }
    for (package, label) in [
        ("express", "Express"),
        ("fastify", "Fastify"),
        ("koa", "Koa"),
        ("hono", "Hono"),
        ("@hapi/hapi", "Hapi"),
        ("@adonisjs/core", "AdonisJS"),
        ("restify", "Restify"),
        ("@feathersjs/feathers", "Feathers"),
        ("socket.io", "Socket.IO"),
        ("json-server", "JSON Server"),
    ] {
        if has(package) {
            return backend(label);
        }
    }
    if has("webpack-dev-server") {
        let (flavor, stack) = frontend_flavor();
        return NodeFramework {
            framework: if flavor.is_empty() {
                "Webpack".into()
            } else {
                format!("Webpack + {flavor}")
            },
            stack: if stack == "vite" { "node" } else { stack },
            kind: "frontend",
            port: Some(8080),
            cli: &["webpack"],
            port_args: PortArgs::Flag("--port", false),
        };
    }
    if has("parcel") {
        return NodeFramework {
            framework: "Parcel".into(),
            stack: "node",
            kind: "frontend",
            port: Some(1234),
            cli: &["parcel"],
            port_args: PortArgs::Flag("--port", false),
        };
    }
    let (flavor, stack) = frontend_flavor();
    if !flavor.is_empty() {
        return NodeFramework {
            framework: flavor.into(),
            stack,
            kind: "frontend",
            port: None,
            cli: &[],
            port_args: PortArgs::Env,
        };
    }
    NodeFramework {
        framework: "Node.js".into(),
        stack: "node",
        kind: "backend",
        port: None,
        cli: &[],
        port_args: PortArgs::Env,
    }
}

fn is_runnable_script(name: &str, body: &str) -> bool {
    let name = name.to_lowercase();
    let body = body.to_lowercase();
    if [
        "build",
        "test",
        "lint",
        "format",
        "prettier",
        "typecheck",
        "clean",
        "prepare",
    ]
    .iter()
    .any(|word| name.starts_with(word))
    {
        return false;
    }
    PRIMARY_NODE_SCRIPTS.contains(&name.as_str())
        || name.contains("dev")
        || name.contains("start")
        || name.contains("serve")
        || name.contains("watch")
        || body.contains("nodemon")
        || body.contains("ts-node")
        || body.contains("tsx watch")
}

fn node_script_command(package_manager: &str, script: &str, extra: Option<&str>) -> String {
    let base = format!("{package_manager} run {}", quote_if_needed(script));
    match extra {
        Some(extra) if package_manager == "npm" && extra.starts_with('-') => {
            format!("{base} -- {extra}")
        }
        Some(extra) => format!("{base} {extra}"),
        None => base,
    }
}

fn node_port_command(
    package_manager: &str,
    script: &str,
    body: &str,
    framework: &NodeFramework,
) -> Option<String> {
    let PortArgs::Flag(flag, strict) = framework.port_args else {
        return None;
    };
    let body_lower = body.to_lowercase();
    if !framework.cli.iter().any(|cli| body_lower.contains(cli)) {
        return None;
    }
    let compound = [
        "&&",
        "||",
        "|",
        ";",
        "concurrently",
        "npm-run-all",
        "run-p",
        "run-s",
    ]
    .iter()
    .any(|marker| body_lower.contains(marker));
    let port_args = if strict {
        format!("{flag} {{port}} --strictPort")
    } else {
        format!("{flag} {{port}}")
    };

    if port_in_command(body).is_some() {
        // Betikte sabit port var: aynı komutu yerel ikili ile, port değiştirilmiş hâlde çalıştır.
        if compound {
            return None;
        }
        let replaced = replace_port_in_command(body)?;
        // Betik zaten bir paket çalıştırıcısıyla başlıyorsa ("npx ng serve") ikinci kez ekleme.
        if ["npx ", "pnpm ", "yarn ", "bunx ", "bun x ", "npm exec "]
            .iter()
            .any(|prefix| body_lower.trim_start().starts_with(prefix))
        {
            return Some(replaced);
        }
        let runner = match package_manager {
            "pnpm" => "pnpm exec",
            "yarn" => "yarn",
            "bun" => "bunx",
            _ => "npx",
        };
        return Some(format!("{runner} {replaced}"));
    }
    if compound {
        return None;
    }
    Some(node_script_command(
        package_manager,
        script,
        Some(&port_args),
    ))
}

fn node_config_port(directory: &Path, framework: &NodeFramework) -> Option<(u16, String)> {
    let candidates: &[&str] = match framework.stack {
        "angular" => &["angular.json"],
        "nuxt" => &["nuxt.config.ts", "nuxt.config.js"],
        "astro" => &["astro.config.mjs", "astro.config.ts", "astro.config.js"],
        "vue" if framework.framework == "Vue CLI" => &["vue.config.js"],
        _ => &[
            "vite.config.ts",
            "vite.config.js",
            "vite.config.mts",
            "vite.config.mjs",
            "vite.config.cjs",
            "webpack.config.js",
        ],
    };
    candidates.iter().find_map(|file| {
        let content = read_small_text(&directory.join(file), 512 * 1024)?;
        let port = find_number_after(&content, &["\"port\":", "port:", "port ="])?;
        Some((port, (*file).to_string()))
    })
}

fn dotenv_port(directory: &Path) -> Option<(u16, String)> {
    [
        ".env.development.local",
        ".env.local",
        ".env.development",
        ".env",
    ]
    .iter()
    .find_map(|file| {
        let content = read_small_text(&directory.join(file), 128 * 1024)?;
        content.lines().find_map(|line| {
            let line = line.trim();
            let value = line
                .strip_prefix("PORT=")
                .or_else(|| line.strip_prefix("SERVER_PORT="))
                .or_else(|| line.strip_prefix("APP_PORT="))?;
            let port = value.trim().trim_matches(['"', '\'']).parse().ok()?;
            Some((port, (*file).to_string()))
        })
    })
}

fn source_listen_port(directory: &Path) -> Option<(u16, String)> {
    [
        "src/main.ts",
        "src/index.ts",
        "src/server.ts",
        "src/app.ts",
        "src/index.js",
        "src/server.js",
        "src/app.js",
        "server.ts",
        "server.js",
        "index.ts",
        "index.js",
        "app.js",
        "main.js",
    ]
    .iter()
    .find_map(|file| {
        let content = read_small_text(&directory.join(file), 512 * 1024)?;
        let port = find_number_after(
            &content,
            &[
                "PORT || ", "PORT ?? ", "PORT||", "PORT??", ".listen(", "listen(",
            ],
        )?;
        Some((port, (*file).to_string()))
    })
}

fn package_display_name(json: &serde_json::Value, directory: &Path) -> String {
    json.get("name")
        .and_then(serde_json::Value::as_str)
        .map(|name| name.rsplit('/').next().unwrap_or(name).to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| folder_name(directory))
}

fn detect_package_manager(directory: &Path, root: &Path) -> &'static str {
    for candidate in ancestors_within(directory, root) {
        if candidate.join("pnpm-lock.yaml").is_file() {
            return "pnpm";
        }
        if candidate.join("yarn.lock").is_file() {
            return "yarn";
        }
        if candidate.join("bun.lockb").is_file() || candidate.join("bun.lock").is_file() {
            return "bun";
        }
        if candidate.join("package-lock.json").is_file() {
            return "npm";
        }
    }
    "npm"
}

fn has_node_modules(directory: &Path, root: &Path) -> bool {
    ancestors_within(directory, root)
        .iter()
        .any(|candidate| candidate.join("node_modules").is_dir())
}

// ---------------------------------------------------------------------------
// JVM: Spring Boot, Quarkus, Micronaut
// ---------------------------------------------------------------------------

fn detect_jvm(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let pom = read_small_text(&directory.join("pom.xml"), 1024 * 1024);
    let gradle = ["build.gradle", "build.gradle.kts"]
        .iter()
        .find_map(|file| read_small_text(&directory.join(file), 1024 * 1024));

    let (content, is_maven) = match (&pom, &gradle) {
        (Some(pom), _) => (pom.to_lowercase(), true),
        (None, Some(gradle)) => (gradle.to_lowercase(), false),
        _ => return None,
    };
    if is_maven && content.contains("<packaging>pom</packaging>") {
        return None;
    }

    let flavor = if content.contains("spring-boot") || content.contains("org.springframework.boot")
    {
        "spring"
    } else if content.contains("quarkus") {
        "quarkus"
    } else if content.contains("micronaut") {
        "micronaut"
    } else {
        return None;
    };
    // Gradle'da yalnızca uygulama eklentisi olan modüller çalıştırılabilir.
    if !is_maven
        && flavor == "spring"
        && !content.contains("org.springframework.boot\"")
        && !content.contains("org.springframework.boot'")
        && !content.contains("org.springframework.boot)")
        && !content.contains("id(\"org.springframework.boot")
    {
        return None;
    }

    let name = if is_maven {
        pom.as_deref()
            .and_then(maven_artifact_id)
            .unwrap_or_else(|| folder_name(directory))
    } else {
        gradle_project_name(directory).unwrap_or_else(|| folder_name(directory))
    };
    let tool = build_tool_invocation(directory, root, is_maven);
    let language = if directory.join("src/main/kotlin").is_dir() || content.contains("kotlin") {
        "Kotlin"
    } else {
        "Java"
    };

    let (framework, goal, port_key) = match (flavor, is_maven) {
        ("spring", true) => ("Spring Boot", "spring-boot:run", "SERVER_PORT"),
        ("spring", false) => ("Spring Boot", "bootRun", "SERVER_PORT"),
        ("quarkus", true) => ("Quarkus", "quarkus:dev", "QUARKUS_HTTP_PORT"),
        ("quarkus", false) => ("Quarkus", "quarkusDev", "QUARKUS_HTTP_PORT"),
        (_, true) => ("Micronaut", "mn:run", "MICRONAUT_SERVER_PORT"),
        (_, false) => ("Micronaut", "run", "MICRONAUT_SERVER_PORT"),
    };
    let (port, source) = spring_config_port(directory)
        .map(|(port, file)| (Some(port), file))
        .unwrap_or((Some(8080), format!("{framework} varsayılanı")));

    let mut draft = AppDraft::new(
        name,
        framework,
        if flavor == "spring" { "spring" } else { "java" },
    )
    .single_script(goal, format!("{tool} {goal}"), None)
    .port(port, source);
    draft.language = language;
    draft.kind = "backend";
    draft.port_env = vec![env(port_key, "{port}")];
    draft.package_manager = Some(if is_maven { "Maven" } else { "Gradle" }.into());
    draft.profiles = spring_profiles(directory);
    draft.profile_env = Some(
        match flavor {
            "spring" => "SPRING_PROFILES_ACTIVE",
            "quarkus" => "QUARKUS_PROFILE",
            _ => "MICRONAUT_ENVIRONMENTS",
        }
        .into(),
    );
    draft.health_path = match flavor {
        "spring" => spring_health_path(directory, &content),
        "quarkus" if content.contains("smallrye-health") => Some("/q/health".into()),
        _ => None,
    };
    Some(draft.finish(directory, root))
}

fn build_tool_invocation(directory: &Path, root: &Path, is_maven: bool) -> String {
    let (wrapper, fallback) = if is_maven {
        ("mvnw", "mvn")
    } else {
        ("gradlew", "gradle")
    };
    for candidate in ancestors_within(directory, root) {
        if candidate.join(wrapper).is_file()
            || candidate.join(format!("{wrapper}.cmd")).is_file()
            || candidate.join(format!("{wrapper}.bat")).is_file()
        {
            if candidate == directory {
                return if cfg!(windows) {
                    wrapper.to_string()
                } else {
                    format!("sh ./{wrapper}")
                };
            }
            let script = if cfg!(windows) {
                let cmd = candidate.join(format!("{wrapper}.cmd"));
                if cmd.is_file() {
                    cmd
                } else {
                    candidate.join(format!("{wrapper}.bat"))
                }
            } else {
                candidate.join(wrapper)
            };
            let quoted = format!("\"{}\"", script.to_string_lossy());
            return if cfg!(windows) {
                quoted
            } else {
                format!("sh {quoted}")
            };
        }
    }
    fallback.to_string()
}

fn maven_artifact_id(pom: &str) -> Option<String> {
    let without_parent = match (pom.find("<parent>"), pom.find("</parent>")) {
        (Some(start), Some(end)) if end > start => {
            format!("{}{}", &pom[..start], &pom[end + "</parent>".len()..])
        }
        _ => pom.to_string(),
    };
    read_xml_tag(&without_parent, "artifactId")
}

fn gradle_project_name(directory: &Path) -> Option<String> {
    ["settings.gradle", "settings.gradle.kts"]
        .iter()
        .find_map(|file| {
            let content = read_small_text(&directory.join(file), 256 * 1024)?;
            content.lines().find_map(|line| {
                let value = line.trim().strip_prefix("rootProject.name")?;
                let value = value
                    .trim_start()
                    .strip_prefix('=')
                    .unwrap_or(value)
                    .trim()
                    .trim_matches(['"', '\'']);
                (!value.is_empty()).then(|| value.to_string())
            })
        })
}

/// Spring/Quarkus/Micronaut yapılandırmasından portu okur. Geliştirmede genellikle
/// `dev` profili çalıştığı için profil dosyaları önce, `config/` alt klasörü
/// (ör. JHipster) kökten önce denetlenir.
fn spring_config_port(directory: &Path) -> Option<(u16, String)> {
    const FILES: &[&str] = &[
        "application-dev.properties",
        "application-dev.yml",
        "application-dev.yaml",
        "application-local.properties",
        "application-local.yml",
        "application.properties",
        "application.yml",
        "application.yaml",
    ];
    for folder in ["src/main/resources/config", "src/main/resources"] {
        for file in FILES {
            let Some(content) = read_small_text(&directory.join(folder).join(file), 256 * 1024)
            else {
                continue;
            };
            let port = if file.ends_with(".properties") {
                properties_port(&content)
            } else {
                yaml_server_port(&content)
            };
            if let Some(port) = port {
                let source = if folder.ends_with("config") {
                    format!("config/{file}")
                } else {
                    (*file).to_string()
                };
                return Some((port, source));
            }
        }
    }
    None
}

fn properties_port(content: &str) -> Option<u16> {
    content.lines().find_map(|line| {
        let line = line.trim();
        let value = line
            .strip_prefix("server.port")
            .or_else(|| line.strip_prefix("quarkus.http.port"))
            .or_else(|| line.strip_prefix("micronaut.server.port"))?;
        parse_port_value(value.trim_start().trim_start_matches(['=', ':']).trim())
    })
}

/// `server:` bloğunun doğrudan altındaki `port:` değerini okur.
fn yaml_server_port(content: &str) -> Option<u16> {
    let mut in_server = false;
    let mut child_indent = None;
    for line in content.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let trimmed = line.trim();
        if indent == 0 {
            in_server = trimmed.starts_with("server:");
            child_indent = None;
            continue;
        }
        if !in_server {
            continue;
        }
        let expected = *child_indent.get_or_insert(indent);
        if indent == expected
            && let Some(value) = trimmed.strip_prefix("port:")
            && let Some(port) = parse_port_value(value.trim())
        {
            return Some(port);
        }
    }
    None
}

/// `8081`, `"8081"` veya `${PORT:8081}` biçimlerini okur.
fn parse_port_value(value: &str) -> Option<u16> {
    let value = value.trim().trim_matches(['"', '\'']);
    if let Ok(port) = value.parse::<u16>() {
        return (port > 0).then_some(port);
    }
    let inner = value.strip_prefix("${")?.strip_suffix('}')?;
    let fallback = inner.rsplit(':').next()?.trim_start_matches('-');
    fallback.parse::<u16>().ok().filter(|port| *port > 0)
}

// ---------------------------------------------------------------------------
// .NET
// ---------------------------------------------------------------------------

fn detect_dotnet(directory: &Path, root: &Path) -> Vec<DetectedApp> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let projects = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("csproj"))
        })
        .take(8)
        .collect::<Vec<_>>();
    let single = projects.len() == 1;

    projects
        .into_iter()
        .filter_map(|project| {
            let content = read_small_text(&project, 512 * 1024)?;
            let (framework, kind) = if content.contains("Microsoft.NET.Sdk.BlazorWebAssembly") {
                ("Blazor WebAssembly", "frontend")
            } else if content.contains("Microsoft.NET.Sdk.Web") {
                if content.contains("Microsoft.AspNetCore.Components") {
                    ("Blazor Server", "fullstack")
                } else {
                    ("ASP.NET Core", "backend")
                }
            } else {
                return None;
            };
            let file_name = project.file_name()?.to_string_lossy().into_owned();
            let name = read_xml_tag(&content, "AssemblyName").unwrap_or_else(|| {
                project
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default()
            });
            let target = if single {
                String::new()
            } else {
                format!(" --project \"{file_name}\"")
            };
            let (port, source) = launch_settings_port(directory)
                .map(|port| (Some(port), "launchSettings.json".to_string()))
                .unwrap_or((Some(5000), "Kestrel varsayılanı".into()));
            let mut draft = AppDraft::new(name, framework, "dotnet").port(port, source);
            draft.kind = kind;
            draft.language = if file_name.ends_with(".fsproj") {
                "F#"
            } else {
                "C#"
            };
            draft.scripts = vec![
                LaunchScript {
                    name: "run".into(),
                    command: format!("dotnet run{target}"),
                    port_command: Some(format!(
                        "dotnet run{target} --urls http://localhost:{{port}}"
                    )),
                    runnable: true,
                },
                LaunchScript {
                    name: "watch".into(),
                    command: format!("dotnet watch run{target}"),
                    port_command: Some(format!(
                        "dotnet watch run{target} --urls http://localhost:{{port}}"
                    )),
                    runnable: true,
                },
            ];
            draft.default_script = "run".into();
            draft.port_env = vec![env("ASPNETCORE_URLS", "http://localhost:{port}")];
            draft.package_manager = Some("dotnet".into());
            draft.profiles = dotnet_environments(directory);
            draft.profile_env = Some("ASPNETCORE_ENVIRONMENT".into());
            draft.health_path = read_small_text(&directory.join("Program.cs"), 512 * 1024)
                .and_then(|program| {
                    let start = program.find("MapHealthChecks(\"")? + "MapHealthChecks(\"".len();
                    let end = program[start..].find('"')? + start;
                    Some(program[start..end].to_string())
                })
                .or_else(|| (kind != "backend").then(|| "/".to_string()));
            Some(draft.finish(directory, root))
        })
        .collect()
}

/// `appsettings.<Ortam>.json` dosyalarından ASP.NET Core ortamlarını listeler.
fn dotnet_environments(directory: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut environments = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let environment = name.strip_prefix("appsettings.")?.strip_suffix(".json")?;
            (!environment.is_empty()).then(|| environment.to_string())
        })
        .collect::<Vec<_>>();
    environments.sort();
    environments
}

fn launch_settings_port(directory: &Path) -> Option<u16> {
    let content = read_small_text(
        &directory.join("Properties/launchSettings.json"),
        256 * 1024,
    )?;
    let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    let profiles = json.get("profiles")?.as_object()?;
    let mut ordered = profiles.values().collect::<Vec<_>>();
    ordered.sort_by_key(|profile| {
        profile
            .get("commandName")
            .and_then(serde_json::Value::as_str)
            != Some("Project")
    });
    ordered.into_iter().find_map(|profile| {
        let urls = profile.get("applicationUrl")?.as_str()?;
        let mut parsed = urls.split(';').filter_map(url_port).collect::<Vec<_>>();
        // HTTP adresini HTTPS'e tercih et.
        parsed.sort_by_key(|(https, _)| *https);
        parsed.first().map(|(_, port)| *port)
    })
}

fn url_port(url: &str) -> Option<(bool, u16)> {
    let url = url.trim();
    let https = url.starts_with("https://");
    let port = url.rsplit(':').next()?.trim_end_matches('/').parse().ok()?;
    Some((https, port))
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

fn detect_python(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let manifest = [
        "requirements.txt",
        "pyproject.toml",
        "Pipfile",
        "setup.py",
        "requirements/base.txt",
    ]
    .iter()
    .filter_map(|file| read_small_text(&directory.join(file), 256 * 1024))
    .collect::<Vec<_>>()
    .join("\n")
    .to_lowercase();
    let has_manage = directory.join("manage.py").is_file();
    if manifest.is_empty() && !has_manage {
        return None;
    }
    let python = python_interpreter(directory, root);
    let name =
        read_toml_name(&directory.join("pyproject.toml")).unwrap_or_else(|| folder_name(directory));

    let draft = if has_manage {
        let mut draft = AppDraft::new(name, "Django", "django")
            .single_script(
                "runserver",
                format!("{python} manage.py runserver"),
                Some(format!("{python} manage.py runserver {{port}}")),
            )
            .port(Some(8000), "Django varsayılanı");
        draft.port_env.clear();
        draft.kind = "fullstack";
        draft
    } else if manifest.contains("fastapi") {
        let (module, variable, file_port) = find_python_app(directory, "FastAPI(")?;
        let port = file_port.unwrap_or(8000);
        let mut draft = AppDraft::new(name, "FastAPI", "fastapi")
            .single_script(
                "uvicorn",
                format!("{python} -m uvicorn {module}:{variable} --reload --port {port}"),
                Some(format!(
                    "{python} -m uvicorn {module}:{variable} --reload --port {{port}}"
                )),
            )
            .port(
                Some(port),
                if file_port.is_some() {
                    format!("{module}.py")
                } else {
                    "Uvicorn varsayılanı".into()
                },
            );
        draft.port_env.clear();
        draft
    } else if manifest.contains("flask") {
        let (module, _, file_port) = find_python_app(directory, "Flask(")?;
        let port = file_port.unwrap_or(5000);
        let mut draft = AppDraft::new(name, "Flask", "flask")
            .single_script(
                "flask run",
                format!("{python} -m flask --app {module} run --debug --port {port}"),
                Some(format!(
                    "{python} -m flask --app {module} run --debug --port {{port}}"
                )),
            )
            .port(Some(port), "Flask varsayılanı");
        draft.port_env.clear();
        draft
    } else if manifest.contains("streamlit") {
        let entry = ["app.py", "main.py", "streamlit_app.py", "Home.py"]
            .into_iter()
            .find(|file| directory.join(file).is_file())?;
        let mut draft = AppDraft::new(name, "Streamlit", "python")
            .single_script(
                "streamlit",
                format!("{python} -m streamlit run {entry} --server.headless true"),
                Some(format!(
                    "{python} -m streamlit run {entry} --server.headless true --server.port {{port}}"
                )),
            )
            .port(Some(8501), "Streamlit varsayılanı");
        draft.kind = "frontend";
        draft.port_env.clear();
        draft
    } else {
        return None;
    };

    let mut draft = draft;
    draft.language = "Python";
    if draft.kind == "backend" && draft.framework == "Django" {
        draft.kind = "fullstack";
    }
    draft.package_manager = Some("pip".into());
    let route = find_health_route(
        directory,
        &[
            "main.py",
            "app.py",
            "server.py",
            "api.py",
            "app/main.py",
            "src/main.py",
            "app/__init__.py",
            "app/routes.py",
            "app/api.py",
        ],
    );
    draft.health_path = route.or_else(|| match draft.framework.as_str() {
        "FastAPI" => Some("/docs".into()),
        _ => Some("/".into()),
    });
    if python.starts_with("python") {
        draft
            .notes
            .push("Sanal ortam (.venv) bulunamadı; sistem Python'u kullanılacak.".into());
    }
    Some(draft.finish(directory, root))
}

/// FastAPI/Flask uygulama nesnesini barındıran modülü ve değişken adını bulur.
fn find_python_app(directory: &Path, constructor: &str) -> Option<(String, String, Option<u16>)> {
    for file in [
        "main.py",
        "app.py",
        "server.py",
        "api.py",
        "wsgi.py",
        "app/main.py",
        "src/main.py",
        "app/__init__.py",
        "src/app.py",
    ] {
        let Some(content) = read_small_text(&directory.join(file), 512 * 1024) else {
            continue;
        };
        let Some(position) = content.find(constructor) else {
            continue;
        };
        let before = &content[..position];
        let line = before.rsplit('\n').next().unwrap_or_default();
        let variable = line
            .split('=')
            .next()
            .map(|value| {
                value
                    .trim()
                    .trim_end_matches(':')
                    .split(':')
                    .next()
                    .unwrap_or("")
                    .trim()
            })
            .filter(|value| {
                !value.is_empty() && value.chars().all(|c| c.is_alphanumeric() || c == '_')
            })
            .unwrap_or("app")
            .to_string();
        let module = file
            .trim_end_matches(".py")
            .trim_end_matches("/__init__")
            .replace('/', ".");
        let port = find_number_after(&content, &["port=", "port ="]);
        return Some((module, variable, port));
    }
    None
}

fn python_interpreter(directory: &Path, root: &Path) -> String {
    for candidate in ancestors_within(directory, root) {
        for venv in [".venv", "venv", "env"] {
            let path = if cfg!(windows) {
                candidate.join(venv).join("Scripts").join("python.exe")
            } else {
                candidate.join(venv).join("bin").join("python")
            };
            if path.is_file() {
                return format!("\"{}\"", path.to_string_lossy());
            }
        }
    }
    if cfg!(windows) { "python" } else { "python3" }.into()
}

// ---------------------------------------------------------------------------
// Go, Rust, PHP, Ruby, Flutter, Docker Compose
// ---------------------------------------------------------------------------

fn detect_go(directory: &Path, root: &Path) -> Vec<DetectedApp> {
    let Some(go_mod) = read_small_text(&directory.join("go.mod"), 256 * 1024) else {
        return Vec::new();
    };
    let module = go_mod
        .lines()
        .find_map(|line| line.trim().strip_prefix("module "))
        .map(|value| value.trim().rsplit('/').next().unwrap_or(value).to_string())
        .unwrap_or_else(|| folder_name(directory));
    let framework = [
        ("gin-gonic/gin", "Gin"),
        ("labstack/echo", "Echo"),
        ("gofiber/fiber", "Fiber"),
        ("go-chi/chi", "Chi"),
        ("gorilla/mux", "Gorilla"),
    ]
    .iter()
    .find(|(needle, _)| go_mod.contains(needle))
    .map(|(_, label)| *label);

    let mut entries: Vec<(String, String, PathBuf)> = Vec::new();
    if directory.join("main.go").is_file() {
        entries.push((module.clone(), "go run .".into(), directory.join("main.go")));
    }
    if let Ok(commands) = fs::read_dir(directory.join("cmd")) {
        let mut commands = commands
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.join("main.go").is_file())
            .collect::<Vec<_>>();
        commands.sort();
        for command in commands.into_iter().take(6) {
            let name = folder_name(&command);
            entries.push((
                name.clone(),
                format!("go run ./cmd/{name}"),
                command.join("main.go"),
            ));
        }
    }

    entries
        .into_iter()
        .filter_map(|(name, command, main)| {
            let source = read_small_text(&main, 512 * 1024).unwrap_or_default();
            if framework.is_none() && !source.contains("net/http") {
                return None;
            }
            let port = find_quoted_port(&source);
            let mut draft = AppDraft::new(
                name,
                framework.map_or("Go net/http".to_string(), |label| format!("Go + {label}")),
                "go",
            )
            .single_script("run", command, None)
            .port(
                Some(port.unwrap_or(8080)),
                if port.is_some() {
                    "main.go"
                } else {
                    "PortControl varsayılanı"
                },
            );
            draft.language = "Go";
            draft.health_path = health_route_in(&source);
            draft
                .notes
                .push("Özel port PORT ortam değişkeniyle aktarılır.".into());
            Some(draft.finish(directory, root))
        })
        .collect()
}

fn detect_rust(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let cargo = read_small_text(&directory.join("Cargo.toml"), 256 * 1024)?;
    if !cargo.contains("[package]") || !directory.join("src/main.rs").is_file() {
        return None;
    }
    let (framework, default_port) = [
        ("axum", "Axum", 3000),
        ("actix-web", "Actix Web", 8080),
        ("rocket", "Rocket", 8000),
        ("warp", "Warp", 3030),
        ("poem", "Poem", 3000),
        ("salvo", "Salvo", 5800),
        ("tide", "Tide", 8080),
        ("leptos", "Leptos", 3000),
    ]
    .iter()
    .find(|(krate, _, _)| {
        cargo.lines().any(|line| {
            let line = line.trim();
            line.starts_with(&format!("{krate} ")) || line.starts_with(&format!("{krate}="))
        })
    })
    .map(|(_, label, port)| (*label, *port))?;
    let source = read_small_text(&directory.join("src/main.rs"), 512 * 1024).unwrap_or_default();
    let port = find_quoted_port(&source).or_else(|| find_number_after(&source, &["], "]));
    let name =
        read_toml_name(&directory.join("Cargo.toml")).unwrap_or_else(|| folder_name(directory));
    let mut draft = AppDraft::new(name, framework, "rust")
        .single_script("cargo run", "cargo run".into(), None)
        .port(
            Some(port.unwrap_or(default_port)),
            if port.is_some() {
                "src/main.rs".to_string()
            } else {
                format!("{framework} varsayılanı")
            },
        );
    draft.language = "Rust";
    draft.package_manager = Some("cargo".into());
    draft.health_path = health_route_in(&source);
    if framework == "Rocket" {
        draft.port_env.push(env("ROCKET_PORT", "{port}"));
    }
    draft.notes.push(
        "Özel port PORT ortam değişkeniyle aktarılır; uygulama bu değişkeni okumalıdır.".into(),
    );
    Some(draft.finish(directory, root))
}

fn detect_php(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let composer = read_small_text(&directory.join("composer.json"), 256 * 1024);
    let name = composer
        .as_deref()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
        .and_then(|json| {
            json.get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .map(|name| name.rsplit('/').next().unwrap_or(&name).to_string())
        .unwrap_or_else(|| folder_name(directory));

    let mut draft = if directory.join("artisan").is_file() {
        AppDraft::new(name, "Laravel", "php")
            .single_script(
                "artisan serve",
                "php artisan serve".into(),
                Some("php artisan serve --port={port}".into()),
            )
            .port(Some(8000), "Laravel varsayılanı")
    } else if composer.is_some() && directory.join("public/index.php").is_file() {
        AppDraft::new(name, "PHP", "php")
            .single_script(
                "php -S",
                "php -S localhost:8000 -t public".into(),
                Some("php -S localhost:{port} -t public".into()),
            )
            .port(Some(8000), "PortControl varsayılanı")
    } else if composer.is_some() && directory.join("index.php").is_file() {
        AppDraft::new(name, "PHP", "php")
            .single_script(
                "php -S",
                "php -S localhost:8000".into(),
                Some("php -S localhost:{port}".into()),
            )
            .port(Some(8000), "PortControl varsayılanı")
    } else {
        return None;
    };
    draft.kind = "fullstack";
    draft.language = "PHP";
    draft.port_env.clear();
    draft.package_manager = Some("composer".into());
    draft.health_path = Some("/".into());
    Some(draft.finish(directory, root))
}

fn detect_ruby(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let gemfile = read_small_text(&directory.join("Gemfile"), 256 * 1024)?;
    let name = folder_name(directory);
    let mut draft = if gemfile.contains("\"rails\"") || gemfile.contains("'rails'") {
        let mut draft = AppDraft::new(name, "Ruby on Rails", "ruby")
            .single_script(
                "rails server",
                "bundle exec rails server".into(),
                Some("bundle exec rails server -p {port}".into()),
            )
            .port(Some(3000), "Rails varsayılanı");
        draft.kind = "fullstack";
        draft
    } else if (gemfile.contains("sinatra") || gemfile.contains("rack"))
        && directory.join("config.ru").is_file()
    {
        AppDraft::new(name, "Rack / Sinatra", "ruby")
            .single_script(
                "rackup",
                "bundle exec rackup".into(),
                Some("bundle exec rackup -p {port}".into()),
            )
            .port(Some(9292), "Rack varsayılanı")
    } else {
        return None;
    };
    draft.language = "Ruby";
    draft.package_manager = Some("bundler".into());
    draft.health_path = Some("/".into());
    Some(draft.finish(directory, root))
}

fn detect_flutter(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let pubspec = read_small_text(&directory.join("pubspec.yaml"), 256 * 1024)?;
    if !pubspec.contains("sdk: flutter") || !directory.join("web").is_dir() {
        return None;
    }
    let name = pubspec
        .lines()
        .find_map(|line| line.strip_prefix("name:"))
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| folder_name(directory));
    let mut draft = AppDraft::new(name, "Flutter Web", "flutter")
        .single_script(
            "web-server",
            "flutter run -d web-server --web-port 8080".into(),
            Some("flutter run -d web-server --web-port {port}".into()),
        )
        .port(Some(8080), "PortControl varsayılanı");
    draft.kind = "frontend";
    draft.language = "Dart";
    draft.port_env.clear();
    draft.package_manager = Some("pub".into());
    draft.health_path = Some("/".into());
    Some(draft.finish(directory, root))
}

fn detect_compose(directory: &Path, root: &Path) -> Option<DetectedApp> {
    let (file, content) = [
        "compose.yaml",
        "compose.yml",
        "docker-compose.yml",
        "docker-compose.yaml",
    ]
    .iter()
    .find_map(|file| {
        read_small_text(&directory.join(file), 512 * 1024).map(|content| (*file, content))
    })?;
    let ports = compose_host_ports(&content);
    let services = compose_service_names(&content);
    let mut draft = AppDraft::new(
        format!("{} servisleri", folder_name(directory)),
        "Docker Compose",
        "docker",
    )
    .port(ports.first().copied(), file);
    draft.kind = "infra";
    draft.language = "YAML";
    draft.port_configurable = false;
    draft.port_env.clear();
    draft.exposed_ports = ports;
    draft.package_manager = Some("docker".into());
    draft.scripts = vec![
        LaunchScript {
            name: "up".into(),
            command: "docker compose up".into(),
            port_command: None,
            runnable: true,
        },
        LaunchScript {
            name: "up --build".into(),
            command: "docker compose up --build".into(),
            port_command: None,
            runnable: true,
        },
        LaunchScript {
            name: "down".into(),
            command: "docker compose down".into(),
            port_command: None,
            runnable: false,
        },
    ];
    draft.default_script = "up".into();
    if !services.is_empty() {
        draft
            .notes
            .push(format!("Servisler: {}", services.join(", ")));
    }
    draft
        .notes
        .push("Konteynerleri tamamen kapatmak için `down` betiğini çalıştırın.".into());
    Some(draft.finish(directory, root))
}

fn compose_host_ports(content: &str) -> Vec<u16> {
    let mut ports = Vec::new();
    let mut in_ports = false;
    let mut ports_indent = 0;
    for line in content.lines() {
        let indent = line.len() - line.trim_start().len();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed == "ports:" {
            in_ports = true;
            ports_indent = indent;
            continue;
        }
        if in_ports {
            if indent <= ports_indent && !trimmed.starts_with('-') {
                in_ports = false;
                continue;
            }
            if let Some(entry) = trimmed.strip_prefix('-') {
                let entry = entry.trim().trim_matches(['"', '\'']);
                let entry = entry.split('/').next().unwrap_or(entry);
                let parts = split_compose_port(entry);
                let host = match parts.len() {
                    2 => Some(parts[0].as_str()),
                    3 => Some(parts[1].as_str()),
                    _ => None,
                };
                if let Some(port) = host.and_then(parse_port_value).or_else(|| {
                    host.and_then(|value| value.rsplit(":-").next())
                        .and_then(parse_port_value)
                }) && !ports.contains(&port)
                {
                    ports.push(port);
                }
            }
        }
    }
    ports
}

/// `${WEB_PORT:-8080}:80` gibi değişken içeren girdileri doğru bölmek için
/// süslü parantez içindeki iki noktaları atlar.
fn split_compose_port(entry: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0;
    for character in entry.chars() {
        match character {
            '{' => {
                depth += 1;
                current.push(character);
            }
            '}' => {
                depth -= 1;
                current.push(character);
            }
            ':' if depth == 0 => parts.push(std::mem::take(&mut current)),
            _ => current.push(character),
        }
    }
    parts.push(current);
    parts
        .into_iter()
        .map(|part| {
            // ${VAR:-5432} → 5432
            if let Some(inner) = part
                .strip_prefix("${")
                .and_then(|value| value.strip_suffix('}'))
            {
                inner.rsplit(['-', ':']).next().unwrap_or(inner).to_string()
            } else {
                part
            }
        })
        .collect()
}

fn compose_service_names(content: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut in_services = false;
    let mut service_indent = None;
    for line in content.lines() {
        let indent = line.len() - line.trim_start().len();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if indent == 0 {
            in_services = trimmed == "services:";
            service_indent = None;
            continue;
        }
        if in_services && trimmed.ends_with(':') && !trimmed.starts_with('-') {
            let expected = *service_indent.get_or_insert(indent);
            if indent == expected {
                names.push(trimmed.trim_end_matches(':').to_string());
            }
        }
    }
    names.truncate(12);
    names
}

// ---------------------------------------------------------------------------
// Bağımlılıklar, profiller, .env dosyaları ve sağlık yolları
// ---------------------------------------------------------------------------

/// Her ekosistemde yerel servis adresi barındırabilecek yapılandırma dosyaları.
const UPSTREAM_FILES: &[&str] = &[
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
    ".env.dev",
    "proxy.conf.json",
    "proxy.conf.js",
    "proxy.config.json",
    "src/proxy.conf.json",
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
    "webpack.config.js",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "nuxt.config.ts",
    "src/environments/environment.ts",
    "src/environments/environment.development.ts",
    "src/environments/environment.dev.ts",
    "src/main/resources/config/application.yml",
    "src/main/resources/config/application-dev.yml",
    "src/main/resources/config/application.properties",
    "src/main/resources/config/application-dev.properties",
    "src/main/resources/application.yml",
    "src/main/resources/application.yaml",
    "src/main/resources/application-dev.yml",
    "src/main/resources/application.properties",
    "src/main/resources/application-dev.properties",
    "appsettings.json",
    "appsettings.Development.json",
    "config.py",
    "settings.py",
    "app/config.py",
    "app/settings.py",
];

/// Bu anahtarlardaki adresler bağımlılık değil; uygulamanın kendisine veya
/// istemcilerine işaret eder (CORS izinleri, e-posta bağlantı tabanı vb.).
const NON_DEPENDENCY_KEYS: &[&str] = &[
    "cors",
    "origin",
    "allowed",
    "redirect",
    "callback",
    "mail",
    "public-url",
    "public_url",
    "publicurl",
    "frontend-url",
    "frontend_url",
    "client-url",
    "client_url",
    "base-href",
    "hmr",
];

fn collect_upstreams(directory: &Path, extra_files: &[String], own_ports: &[u16]) -> Vec<Upstream> {
    let mut seen_files = HashSet::new();
    let mut upstreams: Vec<Upstream> = Vec::new();
    let files = extra_files
        .iter()
        .map(String::as_str)
        .chain(UPSTREAM_FILES.iter().copied());
    for relative in files {
        if !seen_files.insert(relative.to_string()) {
            continue;
        }
        let Some(content) = read_small_text(&directory.join(relative), 512 * 1024) else {
            continue;
        };
        for (key, value) in config_pairs(relative, &content) {
            let key_lower = key.to_lowercase();
            if NON_DEPENDENCY_KEYS
                .iter()
                .any(|marker| key_lower.contains(marker))
            {
                continue;
            }
            for (scheme, host, port) in local_endpoints(&value) {
                if own_ports.contains(&port) || upstreams.iter().any(|item| item.port == port) {
                    continue;
                }
                upstreams.push(Upstream {
                    port,
                    host,
                    kind: endpoint_kind(&scheme, port),
                    scheme,
                    key: key.clone(),
                    source: relative.replace('\\', "/"),
                });
            }
        }
    }
    upstreams.truncate(12);
    upstreams
}

/// Dosya biçimine göre (anahtar yolu, değer) çiftleri üretir.
fn config_pairs(relative: &str, content: &str) -> Vec<(String, String)> {
    let lower = relative.to_lowercase();
    let file_name = lower.rsplit(['/', '\\']).next().unwrap_or(&lower);
    if lower.ends_with(".json")
        && let Ok(json) = serde_json::from_str::<serde_json::Value>(content)
    {
        let mut pairs = Vec::new();
        json_pairs(&json, String::new(), &mut pairs);
        return pairs;
    }
    if lower.ends_with(".yml") || lower.ends_with(".yaml") {
        return yaml_pairs(content);
    }
    if lower.ends_with(".properties") || file_name.starts_with(".env") {
        return content
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                if line.starts_with('#') || line.starts_with('!') {
                    return None;
                }
                let line = line.strip_prefix("export ").unwrap_or(line);
                let (key, value) = line.split_once(['=', ':'])?;
                Some((key.trim().to_string(), value.trim().to_string()))
            })
            .collect();
    }
    // TypeScript/JavaScript/Python: satır bazlı `anahtar: değer` / `anahtar = değer`.
    content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            let key = trimmed
                .split([':', '='])
                .next()
                .unwrap_or_default()
                .trim()
                .trim_matches(['"', '\'', '`'])
                .to_string();
            let key = if key.chars().all(|character| {
                character.is_alphanumeric() || matches!(character, '_' | '-' | '.' | '/')
            }) {
                key
            } else {
                String::new()
            };
            (key, trimmed.to_string())
        })
        .collect()
}

fn json_pairs(value: &serde_json::Value, path: String, pairs: &mut Vec<(String, String)>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let next = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                json_pairs(child, next, pairs);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                json_pairs(item, path.clone(), pairs);
            }
        }
        serde_json::Value::String(text) => pairs.push((path, text.clone())),
        _ => {}
    }
}

/// Basit YAML anahtar yolu izleyicisi: `server.port`, liste öğeleri ebeveyn yoluyla.
fn yaml_pairs(content: &str) -> Vec<(String, String)> {
    let mut stack: Vec<(usize, String)> = Vec::new();
    let mut pairs = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed == "---" {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if let Some(item) = trimmed.strip_prefix("- ") {
            while stack.last().is_some_and(|(level, _)| *level >= indent) {
                stack.pop();
            }
            let path = stack
                .iter()
                .map(|(_, key)| key.as_str())
                .collect::<Vec<_>>()
                .join(".");
            pairs.push((path, item.trim().to_string()));
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        while stack.last().is_some_and(|(level, _)| *level >= indent) {
            stack.pop();
        }
        let key = key.trim().trim_matches(['"', '\'']).to_string();
        // `mail: # açıklama` gibi satır sonu yorumları değer değildir.
        let value = value.trim();
        let value = if value.starts_with('#') {
            ""
        } else {
            value.split(" #").next().unwrap_or(value).trim_end()
        };
        if value.is_empty() {
            stack.push((indent, key));
        } else {
            let mut path = stack
                .iter()
                .map(|(_, key)| key.as_str())
                .collect::<Vec<_>>();
            path.push(&key);
            pairs.push((path.join("."), value.to_string()));
        }
    }
    pairs
}

/// Metindeki `localhost:PORT`, `127.0.0.1:PORT` gibi yerel uç noktaları döndürür.
fn local_endpoints(value: &str) -> Vec<(String, String, u16)> {
    let mut endpoints = Vec::new();
    for marker in [
        "localhost:",
        "127.0.0.1:",
        "0.0.0.0:",
        "[::1]:",
        "host.docker.internal:",
    ] {
        let mut from = 0;
        while let Some(found) = value[from..].find(marker) {
            let start = from + found;
            let after = start + marker.len();
            from = after;
            let digits = value[after..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>();
            let Ok(port) = digits.parse::<u16>() else {
                continue;
            };
            if port == 0 {
                continue;
            }
            let token = value[..start]
                .rsplit(|character: char| {
                    character.is_whitespace()
                        || matches!(character, '"' | '\'' | '=' | '(' | ',' | '`')
                })
                .next()
                .unwrap_or_default();
            let scheme = token
                .find("://")
                .map(|index| token[..index].to_lowercase())
                .unwrap_or_default();
            endpoints.push((scheme, "localhost".to_string(), port));
        }
    }
    endpoints
}

fn endpoint_kind(scheme: &str, port: u16) -> &'static str {
    const DATABASE_SCHEMES: &[&str] = &[
        "postgres",
        "mysql",
        "mariadb",
        "mongodb",
        "redis",
        "sqlserver",
        "oracle",
        "amqp",
        "kafka",
    ];
    if DATABASE_SCHEMES.iter().any(|name| scheme.contains(name)) {
        return "database";
    }
    if matches!(scheme, "http" | "https" | "ws" | "wss") {
        return "http";
    }
    if matches!(
        port,
        5432 | 3306 | 1433 | 27017 | 6379 | 1521 | 5672 | 9092 | 11211
    ) {
        return "database";
    }
    if scheme.is_empty() { "http" } else { "tcp" }
}

/// Uygulama klasöründeki düzenlenebilir `.env` dosyaları (örnek şablonlar hariç).
fn list_env_files(directory: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut files = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let lower = name.to_lowercase();
            (lower.starts_with(".env")
                && ![".example", ".sample", ".template", ".dist", ".bak"]
                    .iter()
                    .any(|suffix| lower.ends_with(suffix)))
            .then_some(name)
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

/// Kaynak dosyalarda tanımlı yaygın sağlık uç noktalarını arar.
fn find_health_route(directory: &Path, files: &[&str]) -> Option<String> {
    files.iter().find_map(|file| {
        read_small_text(&directory.join(file), 512 * 1024)
            .and_then(|content| health_route_in(&content))
    })
}

fn health_route_in(content: &str) -> Option<String> {
    const ROUTES: &[&str] = &["/health", "/healthz", "/api/health", "/status", "/ping"];
    ROUTES
        .iter()
        .find(|route| {
            ['"', '\'', '`']
                .iter()
                .any(|quote| content.contains(&format!("{quote}{route}{quote}")))
        })
        .map(|route| (*route).to_string())
}

/// `application-<profil>.yml|properties` dosyalarından Spring profillerini listeler.
fn spring_profiles(directory: &Path) -> Vec<String> {
    let mut profiles = Vec::new();
    for folder in ["src/main/resources/config", "src/main/resources"] {
        let Ok(entries) = fs::read_dir(directory.join(folder)) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(rest) = name.strip_prefix("application-") else {
                continue;
            };
            let profile = rest
                .strip_suffix(".yml")
                .or_else(|| rest.strip_suffix(".yaml"))
                .or_else(|| rest.strip_suffix(".properties"));
            if let Some(profile) = profile
                && !profile.is_empty()
                && !profiles.iter().any(|item| item == profile)
            {
                profiles.push(profile.to_string());
            }
        }
    }
    profiles.sort();
    profiles
}

/// Actuator varsa `management.endpoints.web.base-path` ayarına göre sağlık yolunu döndürür.
fn spring_health_path(directory: &Path, build_file: &str) -> Option<String> {
    if !build_file.contains("actuator") {
        return None;
    }
    let mut base = "/actuator".to_string();
    'search: for folder in ["src/main/resources/config", "src/main/resources"] {
        for file in [
            "application.yml",
            "application.yaml",
            "application.properties",
        ] {
            let Some(content) = read_small_text(&directory.join(folder).join(file), 512 * 1024)
            else {
                continue;
            };
            for (key, value) in config_pairs(file, &content) {
                if key == "management.endpoints.web.base-path" {
                    base = value.trim().trim_matches(['"', '\'']).to_string();
                    break 'search;
                }
            }
        }
    }
    Some(format!("{}/health", base.trim_end_matches('/')))
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

fn ancestors_within(directory: &Path, root: &Path) -> Vec<PathBuf> {
    let mut list = Vec::new();
    for ancestor in directory.ancestors() {
        list.push(ancestor.to_path_buf());
        if ancestor == root || list.len() > 12 {
            break;
        }
    }
    list
}

fn relative_path(directory: &Path, root: &Path) -> String {
    directory
        .strip_prefix(root)
        .ok()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| ".".into())
}

fn folder_name(directory: &Path) -> String {
    directory
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| directory.to_string_lossy().into_owned())
}

fn humanize(value: &str) -> String {
    value
        .split(['-', '_', ' '])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut characters = part.chars();
            match characters.next() {
                Some(first) => {
                    format!("{}{}", first.to_uppercase(), characters.collect::<String>())
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn read_small_text(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_xml_tag(content: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{tag}>");
    let end_tag = format!("</{tag}>");
    let start = content.find(&start_tag)? + start_tag.len();
    let end = content[start..].find(&end_tag)? + start;
    let value = content[start..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn read_toml_name(path: &Path) -> Option<String> {
    let content = read_small_text(path, 256 * 1024)?;
    let mut in_section = false;
    for raw in content.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            in_section = matches!(line, "[package]" | "[project]" | "[tool.poetry]");
            continue;
        }
        if in_section
            && let Some(value) = line.strip_prefix("name")
            && let Some(value) = value.trim_start().strip_prefix('=')
        {
            return Some(value.trim().trim_matches(['"', '\'']).to_string());
        }
    }
    None
}

fn quote_if_needed(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{value}\"")
    } else {
        value.to_string()
    }
}

/// Komut satırında `--port 3000`, `--port=3000`, `-p 3000`, `PORT=3000` arar.
pub fn port_in_command(command: &str) -> Option<u16> {
    let tokens = command.split_whitespace().collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        let lower = token.to_lowercase();
        if let Some(value) = lower
            .strip_prefix("--port=")
            .or_else(|| lower.strip_prefix("port="))
            .or_else(|| lower.strip_prefix("server_port="))
        {
            if let Ok(port) = value.trim_matches(['"', '\'']).parse() {
                return Some(port);
            }
        }
        if matches!(lower.as_str(), "--port" | "-p")
            && let Some(next) = tokens.get(index + 1)
            && let Ok(port) = next.parse()
        {
            return Some(port);
        }
    }
    None
}

/// Betikteki sabit port değerini `{port}` yer tutucusuyla değiştirir.
fn replace_port_in_command(command: &str) -> Option<String> {
    let tokens = command.split_whitespace().collect::<Vec<_>>();
    let mut output = Vec::with_capacity(tokens.len());
    let mut replaced = false;
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        let lower = token.to_lowercase();
        if let Some(prefix) = ["--port=", "PORT=", "port="]
            .iter()
            .find(|prefix| token.starts_with(**prefix))
        {
            output.push(format!("{prefix}{{port}}"));
            replaced = true;
        } else if matches!(lower.as_str(), "--port" | "-p")
            && tokens
                .get(index + 1)
                .is_some_and(|next| next.parse::<u16>().is_ok())
        {
            output.push(format!("{token} {{port}}"));
            index += 1;
            replaced = true;
        } else {
            output.push(token.to_string());
        }
        index += 1;
    }
    replaced.then(|| output.join(" "))
}

/// Verilen işaretlerden birinin hemen ardından gelen port numarasını bulur.
fn find_number_after(content: &str, markers: &[&str]) -> Option<u16> {
    for marker in markers {
        let mut search_from = 0;
        while let Some(found) = content[search_from..].find(marker) {
            let start = search_from + found + marker.len();
            let digits = content[start..]
                .trim_start_matches([' ', '\t', '"', '\''])
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>();
            if let Ok(port) = digits.parse::<u16>()
                && port >= 80
            {
                return Some(port);
            }
            search_from = start;
        }
    }
    None
}

/// Kaynak kodda `":8080"`, `"0.0.0.0:3000"` benzeri adresleri bulur.
fn find_quoted_port(content: &str) -> Option<u16> {
    let mut search_from = 0;
    while let Some(found) = content[search_from..].find(':') {
        let start = search_from + found + 1;
        let digits = content[start..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>();
        let after = content[start + digits.len()..].chars().next();
        let before = content[..start - 1].chars().last();
        let quoted_end = matches!(after, Some('"') | Some('`'));
        let host_like = matches!(
            before,
            Some('"') | Some('t') | Some('0') | Some('1') | Some('`')
        );
        if quoted_end
            && host_like
            && (2..=5).contains(&digits.len())
            && let Ok(port) = digits.parse::<u16>()
            && port >= 80
        {
            return Some(port);
        }
        search_from = start;
    }
    None
}

fn fnv1a(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "portcontrol-test-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn write(&self, relative: &str, content: &str) -> &Self {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
            self
        }

        fn dir(&self, relative: &str) -> &Self {
            fs::create_dir_all(self.root.join(relative)).unwrap();
            self
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn find<'a>(apps: &'a [DetectedApp], framework: &str) -> &'a DetectedApp {
        apps.iter()
            .find(|app| app.framework == framework)
            .unwrap_or_else(|| panic!("{framework} bulunamadı: {apps:#?}"))
    }

    #[test]
    fn detects_full_stack_monorepo() {
        let tree = TempTree::new("monorepo");
        tree.write(
            "web/package.json",
            r#"{"name":"@acme/web","scripts":{"dev":"vite","build":"vite build"},
                "dependencies":{"react":"19"},"devDependencies":{"vite":"7","typescript":"5"}}"#,
        )
        .write("web/vite.config.ts", "export default { server: { port: 5180 } }")
        .write("web/package-lock.json", "{}")
        .dir("web/node_modules")
        .write(
            "api/pom.xml",
            "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent>\
             <artifactId>acme-api</artifactId><dependencies>spring-boot-starter-web</dependencies></project>",
        )
        .write("api/mvnw.cmd", "")
        .write("api/mvnw", "")
        .write("api/src/main/resources/application.yml", "spring:\n  application:\n    name: api\nserver:\n  port: 8081\n")
        .write(
            "docker-compose.yml",
            "services:\n  db:\n    image: postgres\n    ports:\n      - \"5432:5432\"\n  cache:\n    image: redis\n    ports:\n      - 127.0.0.1:6379:6379\n",
        )
        .write("web/node_modules/vite/package.json", r#"{"name":"vite","scripts":{"dev":"x"}}"#);

        let scan = scan_directory(&tree.root);
        assert_eq!(scan.apps.len(), 3, "{:#?}", scan.apps);

        let web = find(&scan.apps, "Vite + React");
        assert_eq!(web.name, "web");
        assert_eq!(web.relative_path, "web");
        assert_eq!(web.kind, "frontend");
        assert_eq!(web.default_port, Some(5180));
        assert_eq!(web.port_source, "vite.config.ts");
        assert_eq!(web.default_script, "dev");
        assert_eq!(web.language, "TypeScript");
        assert!(!web.needs_install);
        let dev = web
            .scripts
            .iter()
            .find(|script| script.name == "dev")
            .unwrap();
        assert_eq!(dev.command, "npm run dev");
        assert_eq!(
            dev.port_command.as_deref(),
            Some("npm run dev -- --port {port} --strictPort")
        );
        assert!(
            !web.scripts
                .iter()
                .find(|script| script.name == "build")
                .unwrap()
                .runnable
        );

        let api = find(&scan.apps, "Spring Boot");
        assert_eq!(api.name, "acme-api");
        assert_eq!(api.default_port, Some(8081));
        assert_eq!(api.port_env, vec![env("SERVER_PORT", "{port}")]);
        assert!(api.scripts[0].command.ends_with("spring-boot:run"));

        let compose = find(&scan.apps, "Docker Compose");
        assert_eq!(compose.kind, "infra");
        assert_eq!(compose.exposed_ports, vec![5432, 6379]);
        assert!(!compose.port_configurable);
        assert_eq!(scan.apps[0].kind, "infra");
    }

    #[test]
    fn detects_python_and_dotnet_apps() {
        let tree = TempTree::new("polyglot");
        tree.write("svc/requirements.txt", "fastapi\nuvicorn\n")
            .write("svc/app/main.py", "from fastapi import FastAPI\n\napi = FastAPI()\n")
            .write("admin/manage.py", "")
            .write("admin/requirements.txt", "django\n")
            .write(
                "gateway/Gateway.csproj",
                r#"<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup></PropertyGroup></Project>"#,
            )
            .write(
                "gateway/Properties/launchSettings.json",
                r#"{"profiles":{"https":{"commandName":"Project","applicationUrl":"https://localhost:7001;http://localhost:5099"}}}"#,
            );

        let scan = scan_directory(&tree.root);
        let fastapi = find(&scan.apps, "FastAPI");
        assert!(
            fastapi.scripts[0]
                .command
                .contains("-m uvicorn app.main:api --reload --port 8000")
        );
        assert_eq!(
            fastapi.scripts[0]
                .port_command
                .as_deref()
                .map(|cmd| cmd.ends_with("--port {port}")),
            Some(true)
        );

        let django = find(&scan.apps, "Django");
        assert_eq!(django.default_port, Some(8000));

        let dotnet = find(&scan.apps, "ASP.NET Core");
        assert_eq!(dotnet.name, "Gateway");
        assert_eq!(dotnet.default_port, Some(5099));
        assert_eq!(dotnet.scripts[0].command, "dotnet run");
    }

    #[test]
    fn handles_tauri_next_and_explicit_script_ports() {
        let tree = TempTree::new("node-variants");
        tree.write(
            "desk/package.json",
            r#"{"name":"desk","scripts":{"dev":"vite","tauri":"tauri"},
               "dependencies":{"react":"19"},"devDependencies":{"vite":"7","@tauri-apps/cli":"2"}}"#,
        )
        .dir("desk/src-tauri")
        .write("desk/src-tauri/Cargo.toml", "[package]\nname=\"desk\"\n[dependencies]\naxum = \"1\"\n")
        .write("desk/src-tauri/src/main.rs", "fn main(){}")
        .write(
            "site/package.json",
            r#"{"name":"site","scripts":{"dev":"next dev -p 3005","start":"next start"},"dependencies":{"next":"15","react":"19"}}"#,
        )
        .write("site/pnpm-lock.yaml", "");

        let scan = scan_directory(&tree.root);
        assert_eq!(scan.apps.len(), 2, "{:#?}", scan.apps);

        let desk = find(&scan.apps, "Tauri + React");
        assert_eq!(desk.kind, "desktop");
        assert_eq!(desk.default_script, "tauri dev");
        assert_eq!(desk.scripts[0].command, "npm run tauri dev");
        assert!(!desk.port_configurable);
        assert!(desk.needs_install);

        let site = find(&scan.apps, "Next.js");
        assert_eq!(site.default_port, Some(3005));
        assert_eq!(site.package_manager.as_deref(), Some("pnpm"));
        let dev = site
            .scripts
            .iter()
            .find(|script| script.name == "dev")
            .unwrap();
        assert_eq!(dev.command, "pnpm run dev");
        assert_eq!(
            dev.port_command.as_deref(),
            Some("pnpm exec next dev -p {port}")
        );
        let start = site
            .scripts
            .iter()
            .find(|script| script.name == "start")
            .unwrap();
        assert_eq!(
            start.port_command.as_deref(),
            Some("pnpm run start -p {port}")
        );
    }

    #[test]
    fn handles_angular_with_electron_and_jhipster_config() {
        let tree = TempTree::new("meteor");
        tree.write(
            "client/package.json",
            r#"{"name":"metronic-angular","scripts":{"ng":"ng",
                "start":"npx ng serve --proxy-config=proxy.conf.json --host=0.0.0.0 --port=4201",
                "build":"ng build","electron:run":"electron ."},
               "dependencies":{"@angular/core":"19"},
               "devDependencies":{"@angular/cli":"19","electron":"30","typescript":"5"}}"#,
        )
        .write("client/angular.json", "{}")
        .write("client/package-lock.json", "{}")
        .write(
            "client/proxy.conf.json",
            r#"{"/api":{"target":"http://localhost:2830","secure":false}}"#,
        )
        .dir("client/node_modules")
        .write(
            "api/package.json",
            r#"{"name":"crm","devDependencies":{"generator-jhipster":"6.2.0"}}"#,
        )
        .write(
            "api/pom.xml",
            "<project><artifactId>panel</artifactId><packaging>jar</packaging>\
             <properties><spring-boot.version>3.5.0</spring-boot.version></properties>\
             <dependency><artifactId>spring-boot-starter-actuator</artifactId></dependency></project>",
        )
        .write("api/mvnw", "")
        .write(
            "api/src/main/resources/config/application.yml",
            "management:\n  endpoints:\n    web:\n      base-path: /management\nserver:\n  servlet:\n    session:\n      timeout: 15m\n",
        )
        .write(
            "api/src/main/resources/config/application-dev.yml",
            "spring:\n  datasource:\n    url: jdbc:postgresql://localhost:5432/meteorpanel\n  mail:\n    port: 587\n\
             server:\n  port: 2830\n\
             jhipster:\n  cors:\n    allowed-origins:\n      - http://localhost:4200\n      - http://127.0.0.1:4201\n\
             \x20 mail: # specific JHipster mail property\n    base-url: http://127.0.0.1:8080\n\
             \x20 metrics: # Reports metrics\n    logs:\n      port: 5000\n\
             app:\n  mpai:\n    base-url: http://127.0.0.1:8010\n",
        )
        .write("api/src/main/resources/config/application-prod.yml", "server:\n  port: 2830\n")
        .write("api/src/main/resources/config/application-tls.yml", "server:\n  ssl: {}\n")
        .write("mpai/requirements.txt", "fastapi==0.116.1\nuvicorn==0.35.0\n")
        .write("mpai/.env", "MPAI_DB_URL=postgresql://u:p@localhost:5432/meteorpanel\n")
        .write("mpai/.env.example", "MPAI_DB_URL=\n")
        .write(
            "mpai/app/main.py",
            "from fastapi import FastAPI\napp = FastAPI(title=settings.app_name)\n\n@app.get(\"/health\")\ndef health():\n    return {}\n",
        );

        let scan = scan_directory(&tree.root);
        assert_eq!(scan.apps.len(), 3, "{:#?}", scan.apps);

        // Electron bağımlılığı Angular uygulamasını masaüstü yapmamalı.
        let client = find(&scan.apps, "Angular");
        assert_eq!(client.kind, "frontend");
        assert_eq!(client.default_port, Some(4201));
        assert_eq!(client.default_script, "start");
        let start = client
            .scripts
            .iter()
            .find(|script| script.name == "start")
            .unwrap();
        assert_eq!(start.command, "npm run start");
        assert_eq!(
            start.port_command.as_deref(),
            Some("npx ng serve --proxy-config=proxy.conf.json --host=0.0.0.0 --port={port}")
        );

        // Angular proxy hedefi bağımlılık olarak bulunur.
        assert_eq!(client.upstreams.len(), 1, "{:#?}", client.upstreams);
        assert_eq!(client.upstreams[0].port, 2830);
        assert_eq!(client.upstreams[0].key, "/api.target");
        assert_eq!(client.upstreams[0].source, "proxy.conf.json");
        assert_eq!(client.health_path.as_deref(), Some("/"));

        let api = find(&scan.apps, "Spring Boot");
        assert_eq!(api.name, "panel");
        assert_eq!(api.default_port, Some(2830));
        assert_eq!(api.port_source, "config/application-dev.yml");
        assert_eq!(api.profiles, vec!["dev", "prod", "tls"]);
        assert_eq!(api.profile_env.as_deref(), Some("SPRING_PROFILES_ACTIVE"));
        assert_eq!(api.health_path.as_deref(), Some("/management/health"));
        // CORS kaynakları ve e-posta bağlantı tabanı bağımlılık sayılmaz.
        let api_ports = api
            .upstreams
            .iter()
            .map(|item| (item.port, item.kind, item.key.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            api_ports,
            vec![
                (5432, "database", "spring.datasource.url"),
                (8010, "http", "app.mpai.base-url"),
            ]
        );

        let mpai = find(&scan.apps, "FastAPI");
        assert!(
            mpai.scripts[0]
                .command
                .contains("-m uvicorn app.main:app --reload --port 8000")
        );
        assert_eq!(mpai.health_path.as_deref(), Some("/health"));
        assert_eq!(mpai.env_files, vec![".env"]);
        assert_eq!(mpai.upstreams[0].port, 5432);
        assert_eq!(mpai.upstreams[0].kind, "database");
    }

    #[test]
    fn parses_port_helpers() {
        assert_eq!(port_in_command("vite --port 4000"), Some(4000));
        assert_eq!(
            port_in_command("cross-env PORT=4100 node server.js"),
            Some(4100)
        );
        assert_eq!(port_in_command("ng serve --port=4300"), Some(4300));
        assert_eq!(port_in_command("vite"), None);
        assert_eq!(parse_port_value("${PORT:8082}"), Some(8082));
        assert_eq!(parse_port_value("\"9090\""), Some(9090));
        assert_eq!(
            replace_port_in_command("next dev -p 3005 --turbo").as_deref(),
            Some("next dev -p {port} --turbo")
        );
        assert_eq!(find_quoted_port("r.Run(\":9000\")"), Some(9000));
        assert_eq!(find_quoted_port("bind(\"0.0.0.0:3001\")"), Some(3001));
        assert_eq!(
            compose_host_ports(
                "services:\n  web:\n    ports:\n      - \"${WEB_PORT:-8088}:80\"\n      - 9000:9000/tcp\n"
            ),
            vec![8088, 9000]
        );
    }
}
