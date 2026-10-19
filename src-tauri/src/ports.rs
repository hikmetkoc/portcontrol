use std::{
    collections::{HashMap, HashSet},
    fs,
    net::{IpAddr, UdpSocket},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use netstat2::{AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState, get_sockets_info};
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, Signal, System};
use thiserror::Error;

use crate::runner::{ManagedProcess, runner};

static PROCESS_SAMPLER: OnceLock<Mutex<ProcessSampler>> = OnceLock::new();

#[derive(Debug, Error)]
pub enum PortControlError {
    #[error("Ağ soketleri okunamadı: {0}")]
    SocketScan(String),
    #[error("Süreç ölçüm servisine erişilemedi")]
    SamplerUnavailable,
}

impl serde::Serialize for PortControlError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

struct ProcessSampler {
    system: System,
    last_refresh: Instant,
}

impl ProcessSampler {
    fn new() -> Self {
        Self {
            system: System::new_all(),
            last_refresh: Instant::now(),
        }
    }

    fn refresh(&mut self) -> Duration {
        let elapsed = self.last_refresh.elapsed();
        self.system.refresh_processes(ProcessesToUpdate::All, true);
        self.last_refresh = Instant::now();
        elapsed
    }
}

#[derive(Debug, Clone)]
struct RawBinding {
    protocol: &'static str,
    address: String,
    port: u16,
    remote_address: Option<String>,
    remote_port: Option<u16>,
    exposure: &'static str,
    state: String,
    activity: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortBinding {
    protocol: &'static str,
    address: String,
    port: u16,
    remote_address: Option<String>,
    remote_port: Option<u16>,
    exposure: &'static str,
    state: String,
    activity: &'static str,
    role: &'static str,
    role_reason: String,
    confidence: &'static str,
    access_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessAncestor {
    pid: u32,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPortGroup {
    pid: u32,
    process_name: String,
    display_name: String,
    executable_path: Option<String>,
    command: Option<String>,
    working_directory: Option<String>,
    parent_chain: Vec<ProcessAncestor>,
    ports: Vec<PortBinding>,
    technology: String,
    project_name: Option<String>,
    project_root: Option<String>,
    service_kind: String,
    service_description: String,
    category: &'static str,
    known_developer_tool: bool,
    protected: bool,
    protection_reason: Option<String>,
    memory_bytes: u64,
    cpu_usage_percent: f32,
    disk_read_bytes_per_second: f64,
    disk_write_bytes_per_second: f64,
    disk_total_read_bytes: u64,
    disk_total_written_bytes: u64,
    metrics_ready: bool,
    started_at: u64,
    managed_run_id: Option<String>,
    managed_app_id: Option<String>,
    managed_project_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResponse {
    processes: Vec<ProcessPortGroup>,
    scanned_at: u128,
    total_sockets: usize,
    filtered_processes: usize,
    inaccessible_sockets: usize,
    platform: &'static str,
    permission_notice: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRequest {
    pid: u32,
    started_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    pid: u32,
    process_name: String,
    stopped: bool,
    message: String,
}

#[derive(Default)]
struct SocketGroup {
    bindings: Vec<RawBinding>,
    binding_keys: HashSet<String>,
}

/// Yalnızca yazılım geliştirme projelerine ait dinleme portlarını döndürür.
/// Sistem, güvenlik ve IDE iç servisleri listeye hiç alınmaz; PortControl'ün
/// başlattığı süreçler ise her zaman gösterilir ve çalıştırma kaydıyla eşlenir.
#[tauri::command(async)]
pub fn scan_ports(include_infrastructure: bool) -> Result<ScanResponse, PortControlError> {
    let address_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let protocol_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let socket_infos = get_sockets_info(address_flags, protocol_flags)
        .map_err(|error| PortControlError::SocketScan(error.to_string()))?;

    let mut grouped: HashMap<u32, SocketGroup> = HashMap::new();
    let mut total_sockets = 0;
    let mut inaccessible_sockets = 0;

    for socket in socket_infos {
        let binding = match socket.protocol_socket_info {
            ProtocolSocketInfo::Tcp(tcp) if should_include_tcp_state(tcp.state) => {
                let is_listener = tcp.state == TcpState::Listen;
                RawBinding {
                    protocol: "TCP",
                    address: tcp.local_addr.to_string(),
                    port: tcp.local_port,
                    remote_address: (!is_listener).then(|| tcp.remote_addr.to_string()),
                    remote_port: (!is_listener).then_some(tcp.remote_port),
                    exposure: exposure_for(tcp.local_addr),
                    state: tcp.state.to_string(),
                    activity: if is_listener {
                        "listener"
                    } else {
                        "connection"
                    },
                }
            }
            ProtocolSocketInfo::Udp(udp) if udp.local_port > 0 => RawBinding {
                protocol: "UDP",
                address: udp.local_addr.to_string(),
                port: udp.local_port,
                remote_address: None,
                remote_port: None,
                exposure: exposure_for(udp.local_addr),
                state: "BOUND".into(),
                activity: "bound",
            },
            _ => continue,
        };

        total_sockets += 1;
        if socket.associated_pids.is_empty() {
            inaccessible_sockets += 1;
            continue;
        }

        for pid in socket.associated_pids {
            let key = format!(
                "{}:{}:{}:{}:{}:{}",
                binding.protocol,
                binding.address,
                binding.port,
                binding.state,
                binding.remote_address.as_deref().unwrap_or_default(),
                binding.remote_port.unwrap_or_default()
            );
            let group = grouped.entry(pid).or_default();
            if group.binding_keys.insert(key) {
                group.bindings.push(binding.clone());
            }
        }
    }

    let sampler_mutex = PROCESS_SAMPLER.get_or_init(|| Mutex::new(ProcessSampler::new()));
    let mut sampler = sampler_mutex
        .lock()
        .map_err(|_| PortControlError::SamplerUnavailable)?;
    let sample_duration = sampler.refresh();
    let metrics_ready = sample_duration >= Duration::from_millis(350);
    let sample_seconds = sample_duration.as_secs_f64().max(0.001);
    let system = &sampler.system;
    let current_user_id = system
        .process(Pid::from_u32(std::process::id()))
        .and_then(|process| process.user_id())
        .cloned();
    let local_addresses = discover_local_addresses();
    let managed_roots = runner().managed_roots();

    let mut processes = Vec::with_capacity(grouped.len());
    let mut filtered_processes = 0;

    for (pid_value, mut socket_group) in grouped {
        let pid = Pid::from_u32(pid_value);
        let process = system.process(pid);
        let process_name = process
            .map(|item| item.name().to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("Bilinmeyen süreç ({pid_value})"));
        let executable_path = process
            .and_then(|item| item.exe())
            .map(|path| path.to_string_lossy().into_owned());
        let command = process
            .map(process_command)
            .filter(|value| !value.is_empty());
        let working_directory = process
            .and_then(|item| item.cwd())
            .map(|path| path.to_string_lossy().into_owned());
        let parent_chain = process_ancestors(system, pid);
        let project = inspect_project(
            &process_name,
            executable_path.as_deref(),
            command.as_deref(),
            working_directory.as_deref(),
        );
        let mut identity = identify_process(
            &process_name,
            executable_path.as_deref(),
            command.as_deref(),
        );
        let original_category = identity.category;
        let managed = find_managed_ancestor(system, pid, &managed_roots);
        if project.recognized {
            identity.category = "development";
            identity.known_developer_tool = true;
        }
        let owned_by_another_user = match (
            process.and_then(|item| item.user_id()),
            current_user_id.as_ref(),
        ) {
            (Some(owner), Some(current_owner)) => owner != current_owner,
            _ => false,
        };
        let protection_reason = protection_reason(
            pid_value,
            &process_name,
            executable_path.as_deref(),
            identity.known_developer_tool,
            identity.security_tool,
            owned_by_another_user,
        );
        let protected = protection_reason.is_some();

        if managed.is_none() {
            let installed_app = project
                .project_root
                .as_deref()
                .is_some_and(is_installed_application_root);
            let development = (project.recognized || original_category == "development")
                && !installed_app
                && original_category != "editor"
                && !identity.security_tool;
            let infrastructure =
                include_infrastructure && matches!(original_category, "database" | "container");
            if protected || !(development || infrastructure) {
                filtered_processes += 1;
                continue;
            }
        }

        let classification_context = build_classification_context(
            system,
            pid,
            &process_name,
            executable_path.as_deref(),
            command.as_deref(),
            working_directory.as_deref(),
        );

        let mut bindings = socket_group
            .bindings
            .drain(..)
            .filter(|binding| binding.protocol == "TCP" && binding.activity == "listener")
            .map(|binding| {
                let role = classify_socket(&binding, &identity, &classification_context, protected);
                let access_urls = access_urls_for(&binding, role.role, &project, &local_addresses);
                PortBinding {
                    protocol: binding.protocol,
                    address: binding.address,
                    port: binding.port,
                    remote_address: binding.remote_address,
                    remote_port: binding.remote_port,
                    exposure: binding.exposure,
                    state: binding.state,
                    activity: binding.activity,
                    role: role.role,
                    role_reason: role.reason.into(),
                    confidence: role.confidence,
                    access_urls,
                }
            })
            .filter(|binding| {
                managed.is_some()
                    || matches!(binding.role, "published" | "infrastructure" | "unknown")
            })
            .collect::<Vec<_>>();

        if bindings.is_empty() {
            filtered_processes += 1;
            continue;
        }

        bindings.sort_by(|left, right| {
            activity_priority(left.activity)
                .cmp(&activity_priority(right.activity))
                .then(left.port.cmp(&right.port))
                .then(left.protocol.cmp(right.protocol))
                .then(left.address.cmp(&right.address))
        });

        let disk_usage = process.map(|item| item.disk_usage()).unwrap_or_default();
        let display_name = project
            .project_name
            .clone()
            .unwrap_or(identity.display_name);
        processes.push(ProcessPortGroup {
            pid: pid_value,
            process_name,
            display_name,
            executable_path,
            command,
            working_directory,
            parent_chain,
            ports: bindings,
            technology: project.technology,
            project_name: project.project_name,
            project_root: project
                .project_root
                .map(|path| path.to_string_lossy().into_owned()),
            service_kind: project.service_kind,
            service_description: project.service_description,
            category: if protected {
                "system"
            } else {
                identity.category
            },
            known_developer_tool: identity.known_developer_tool,
            protected,
            protection_reason,
            memory_bytes: process.map(|item| item.memory()).unwrap_or(0),
            cpu_usage_percent: if metrics_ready {
                process.map(|item| item.cpu_usage()).unwrap_or(0.0)
            } else {
                0.0
            },
            disk_read_bytes_per_second: if metrics_ready {
                disk_usage.read_bytes as f64 / sample_seconds
            } else {
                0.0
            },
            disk_write_bytes_per_second: if metrics_ready {
                disk_usage.written_bytes as f64 / sample_seconds
            } else {
                0.0
            },
            disk_total_read_bytes: disk_usage.total_read_bytes,
            disk_total_written_bytes: disk_usage.total_written_bytes,
            metrics_ready,
            started_at: process.map(|item| item.start_time()).unwrap_or(0),
            managed_run_id: managed.map(|item| item.run_id.clone()),
            managed_app_id: managed.map(|item| item.app_id.clone()),
            managed_project_id: managed.map(|item| item.project_id.clone()),
        });
    }

    processes.sort_by(|left, right| {
        left.protected
            .cmp(&right.protected)
            .then(process_role_priority(left).cmp(&process_role_priority(right)))
            .then(
                left.display_name
                    .to_lowercase()
                    .cmp(&right.display_name.to_lowercase()),
            )
            .then(left.pid.cmp(&right.pid))
    });

    let permission_notice = (inaccessible_sockets > 0).then(|| {
        format!(
            "{inaccessible_sockets} ağ uç noktası bir süreçle eşleştirilemedi. \
             Bazı süreç bilgileri için yönetici/root izni gerekebilir."
        )
    });

    Ok(ScanResponse {
        processes,
        scanned_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        total_sockets,
        filtered_processes,
        inaccessible_sockets,
        platform: std::env::consts::OS,
        permission_notice,
    })
}

#[tauri::command]
pub fn stop_processes(requests: Vec<StopRequest>, force: bool) -> Vec<StopResult> {
    let mut pids: Vec<Pid> = requests
        .iter()
        .map(|request| Pid::from_u32(request.pid))
        .collect();
    pids.push(Pid::from_u32(std::process::id()));
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&pids), true);
    let current_user_id = system
        .process(Pid::from_u32(std::process::id()))
        .and_then(|process| process.user_id())
        .cloned();

    requests
        .into_iter()
        .map(|request| {
            let Some(process) = system.process(Pid::from_u32(request.pid)) else {
                return StopResult {
                    pid: request.pid,
                    process_name: "Bilinmeyen süreç".into(),
                    stopped: false,
                    message: "Süreç artık çalışmıyor.".into(),
                };
            };

            let process_name = process.name().to_string_lossy().into_owned();
            let executable_path = process.exe().map(Path::to_string_lossy);
            let command = process_command(process);
            let identity =
                identify_process(&process_name, executable_path.as_deref(), Some(&command));
            let owned_by_another_user = match (process.user_id(), current_user_id.as_ref()) {
                (Some(owner), Some(current_owner)) => owner != current_owner,
                _ => false,
            };

            if let Some(reason) = protection_reason(
                request.pid,
                &process_name,
                executable_path.as_deref(),
                identity.known_developer_tool,
                identity.security_tool,
                owned_by_another_user,
            ) {
                return StopResult {
                    pid: request.pid,
                    process_name,
                    stopped: false,
                    message: format!("Korunan süreç durdurulmadı: {reason}"),
                };
            }

            if request.started_at == 0 || process.start_time() != request.started_at {
                return StopResult {
                    pid: request.pid,
                    process_name,
                    stopped: false,
                    message:
                        "Süreç kimliği başka bir süreç tarafından yeniden kullanılıyor olabilir."
                            .into(),
                };
            }

            let stopped = if force {
                process.kill()
            } else {
                process
                    .kill_with(Signal::Term)
                    .unwrap_or_else(|| process.kill())
            };

            StopResult {
                pid: request.pid,
                process_name,
                stopped,
                message: if stopped {
                    "Durdurma sinyali gönderildi.".into()
                } else {
                    "İşletim sistemi işlemi reddetti. Yönetici/root izni gerekebilir.".into()
                },
            }
        })
        .collect()
}

struct ProcessIdentity {
    display_name: String,
    category: &'static str,
    known_developer_tool: bool,
    security_tool: bool,
}

struct SocketClassification {
    role: &'static str,
    reason: &'static str,
    confidence: &'static str,
}

#[derive(Debug, Clone)]
struct ProjectIdentity {
    technology: String,
    project_name: Option<String>,
    project_root: Option<PathBuf>,
    service_kind: String,
    service_description: String,
    recognized: bool,
    likely_http: bool,
}

fn inspect_project(
    process_name: &str,
    executable: Option<&str>,
    command: Option<&str>,
    working_directory: Option<&str>,
) -> ProjectIdentity {
    let process_context = format!(
        "{} {} {}",
        process_name,
        executable.unwrap_or_default(),
        command.unwrap_or_default()
    )
    .to_lowercase();
    let project_root = working_directory.map(Path::new).and_then(find_project_root);
    let manifest_context = project_root
        .as_deref()
        .map(project_manifest_context)
        .unwrap_or_default();
    let context = format!("{process_context} {manifest_context}");

    let has_tauri = matches_any(&context, &["@tauri-apps", "tauri::", "tauri-build"])
        || project_root
            .as_deref()
            .is_some_and(|root| root.join("src-tauri").is_dir());
    let has_angular = matches_any(
        &context,
        &["@angular/core", "@angular/cli", "ng serve", "angular.json"],
    ) || project_root
        .as_deref()
        .is_some_and(|root| root.join("angular.json").is_file());
    let has_react = matches_any(
        &context,
        &[
            "\"react\"",
            "react-scripts",
            "@vitejs/plugin-react",
            "next dev",
            "next-server",
        ],
    );
    let has_vue = matches_any(
        &context,
        &["\"vue\"", "@vitejs/plugin-vue", "vue-cli-service", "nuxt"],
    );
    let has_flutter = matches_any(&context, &["flutter", "dart.exe", "dart run"])
        || project_root
            .as_deref()
            .is_some_and(|root| root.join("pubspec.yaml").is_file());
    let has_spring = matches_any(
        &context,
        &[
            "spring-boot",
            "org.springframework",
            "springframework.boot",
            "bootrun",
        ],
    );
    let has_dotnet = matches_any(&context, &["dotnet", ".csproj", "aspnetcore"])
        || project_root.as_deref().is_some_and(has_csproj);
    let has_python = matches_any(
        &context,
        &[
            "python.exe",
            "python3",
            "uvicorn",
            "gunicorn",
            "flask",
            "django",
            "fastapi",
            "pyproject.toml",
        ],
    );
    let has_rust = matches_any(&context, &["cargo run", "cargo.exe", "rustc"])
        || project_root
            .as_deref()
            .is_some_and(|root| root.join("Cargo.toml").is_file());
    let has_java = matches_any(
        &context,
        &[
            "java.exe",
            "javaw.exe",
            "maven",
            "mvnw",
            "gradlew",
            "pom.xml",
            "build.gradle",
            ".jar",
        ],
    );
    let has_javascript = matches_any(
        &context,
        &[
            "node.exe",
            "node ",
            "deno",
            "bun",
            "package.json",
            "vite",
            "webpack",
        ],
    );

    let (technology, service_kind, technology_recognized, likely_http) = if has_tauri {
        let frontend = if has_angular {
            " + Angular"
        } else if has_react {
            " + React"
        } else if has_vue {
            " + Vue"
        } else {
            ""
        };
        (
            format!("Tauri{frontend}"),
            "Masaüstü uygulaması",
            true,
            has_angular || has_react || has_vue,
        )
    } else if has_angular {
        ("Angular".into(), "Frontend", true, true)
    } else if has_react {
        ("React".into(), "Frontend", true, true)
    } else if has_vue {
        ("Vue".into(), "Frontend", true, true)
    } else if has_flutter {
        ("Flutter".into(), "Mobil / masaüstü", true, false)
    } else if has_spring {
        ("Spring Boot".into(), "Backend / API", true, true)
    } else if has_dotnet {
        (
            ".NET".into(),
            if matches_any(&context, &["aspnet", "kestrel", "webapplication"]) {
                "Backend / API"
            } else {
                "Uygulama servisi"
            },
            true,
            matches_any(&context, &["aspnet", "kestrel", "http"]),
        )
    } else if has_python {
        (
            "Python".into(),
            if matches_any(
                &context,
                &["uvicorn", "gunicorn", "flask", "django", "fastapi"],
            ) {
                "Backend / API"
            } else {
                "Uygulama servisi"
            },
            true,
            has_project_server_marker(&context),
        )
    } else if has_rust {
        (
            "Rust".into(),
            if has_project_server_marker(&context)
                || matches_any(&context, &["actix", "axum", "rocket", "warp"])
            {
                "Backend / API"
            } else {
                "Uygulama servisi"
            },
            true,
            has_project_server_marker(&context)
                || matches_any(&context, &["actix", "axum", "rocket", "warp"]),
        )
    } else if has_java {
        (
            "Java".into(),
            if has_project_server_marker(&context) {
                "Backend / API"
            } else {
                "Uygulama servisi"
            },
            true,
            has_project_server_marker(&context),
        )
    } else if has_javascript {
        (
            "JavaScript".into(),
            if has_project_server_marker(&context) {
                "Web uygulaması"
            } else {
                "JavaScript servisi"
            },
            true,
            has_project_server_marker(&context),
        )
    } else if matches_any(&context, &["postgres", "postmaster"]) {
        ("PostgreSQL".into(), "Veritabanı", false, false)
    } else if matches_any(&context, &["sqlservr", "mssql"]) {
        ("Microsoft SQL Server".into(), "Veritabanı", false, false)
    } else if matches_any(&context, &["mysqld", "mariadbd"]) {
        ("MySQL / MariaDB".into(), "Veritabanı", false, false)
    } else if matches_any(&context, &["mongod", "mongodb"]) {
        ("MongoDB".into(), "Veritabanı", false, false)
    } else if matches_any(&context, &["redis-server", "redis-server.exe"]) {
        ("Redis".into(), "Veritabanı", false, false)
    } else {
        (
            clean_process_name(process_name),
            "Uygulama servisi",
            false,
            false,
        )
    };

    let project_name = project_root.as_deref().and_then(read_project_name);
    let recognized = technology_recognized
        && (project_root.is_some() || has_project_server_marker(&process_context));
    let service_description = match project_name.as_deref() {
        Some(name) => {
            format!("{name} projesinin {service_kind} bileşeni · {technology} olarak algılandı.")
        }
        None if technology_recognized => {
            format!("{technology} tabanlı {service_kind} olarak algılandı.")
        }
        None => "Proje manifesti bulunamadı; süreç bilgisine göre gösteriliyor.".into(),
    };

    ProjectIdentity {
        technology,
        project_name,
        project_root,
        service_kind: service_kind.into(),
        service_description,
        recognized,
        likely_http: likely_http || has_project_server_marker(&context),
    }
}

fn identify_process(
    name: &str,
    executable: Option<&str>,
    command: Option<&str>,
) -> ProcessIdentity {
    let name_lower = name.to_lowercase();
    let context = format!(
        "{} {} {}",
        name_lower,
        executable.unwrap_or_default().to_lowercase(),
        command.unwrap_or_default().to_lowercase()
    );

    let (display_name, category, known_developer_tool, security_tool) =
        if is_security_process(&name_lower, &context) {
            ("Güvenlik yazılımı", "system", false, true)
        } else if matches_any(&context, &["postgres", "postmaster"]) {
            ("PostgreSQL", "database", true, false)
        } else if matches_any(&context, &["sqlservr", "mssql"]) {
            ("Microsoft SQL Server", "database", true, false)
        } else if matches_any(&context, &["mysqld", "mariadbd"]) {
            ("MySQL / MariaDB", "database", true, false)
        } else if matches_any(&context, &["mongod", "mongodb"]) {
            ("MongoDB", "database", true, false)
        } else if matches_any(&context, &["redis-server", "redis-server.exe"]) {
            ("Redis", "database", true, false)
        } else if matches_any(
            &context,
            &["com.docker.backend", "docker desktop", "dockerd"],
        ) {
            ("Docker", "container", true, false)
        } else if matches_any(
            &context,
            &["idea64", "idea.app", "intellij", "jetbrains.idea"],
        ) {
            ("IntelliJ IDEA", "editor", true, false)
        } else if (name_lower == "code" || name_lower == "code.exe")
            || matches_any(&context, &["visual studio code", "microsoft vs code"])
        {
            ("VS Code", "editor", true, false)
        } else if matches_any(&context, &["codex", "openai.codex"]) {
            ("Codex", "editor", true, false)
        } else if matches_any(&context, &["pycharm", "webstorm", "rider64", "goland"]) {
            ("JetBrains IDE", "editor", true, false)
        } else if matches_any(&name_lower, &["node", "node.exe", "deno", "bun"]) {
            ("JavaScript runtime", "runtime", true, false)
        } else if matches_any(&name_lower, &["python", "python.exe", "python3"]) {
            ("Python", "runtime", true, false)
        } else if matches_any(&name_lower, &["java", "java.exe", "javaw.exe"]) {
            ("Java", "runtime", true, false)
        } else if matches_any(&name_lower, &["dotnet", "dotnet.exe"]) {
            (".NET", "runtime", true, false)
        } else if matches_any(
            &name_lower,
            &["php", "php.exe", "ruby", "ruby.exe", "cargo", "cargo.exe"],
        ) {
            ("Geliştirme çalışma zamanı", "runtime", true, false)
        } else if has_project_server_marker(&context) {
            ("Geliştirme sunucusu", "development", true, false)
        } else {
            return ProcessIdentity {
                display_name: clean_process_name(name),
                category: "other",
                known_developer_tool: false,
                security_tool: false,
            };
        };

    ProcessIdentity {
        display_name: display_name.into(),
        category,
        known_developer_tool,
        security_tool,
    }
}

fn classify_socket(
    binding: &RawBinding,
    identity: &ProcessIdentity,
    context: &str,
    protected: bool,
) -> SocketClassification {
    if protected || identity.security_tool {
        return SocketClassification {
            role: "system",
            reason: "İşletim sistemi veya güvenlik yazılımının yönettiği uç nokta.",
            confidence: "high",
        };
    }

    if binding.activity == "connection" {
        return SocketClassification {
            role: "outbound",
            reason: "Bu bir dinleme portu değil; süreç başka bir uçla aktif TCP bağlantısı kurmuş.",
            confidence: "high",
        };
    }

    if matches!(identity.category, "database" | "container") {
        return SocketClassification {
            role: "infrastructure",
            reason: "Tanınan veritabanı veya konteyner altyapısı tarafından açılmış servis portu.",
            confidence: "high",
        };
    }

    // Bağlamın ilk satırı sürecin kendi komutudur; dil sunucusu veya derleme
    // daemon'u gibi araç süreçleri proje klasöründe çalışsa bile ayrılır.
    let own_context = context.split('\n').next().unwrap_or(context);
    if has_tool_internal_marker(own_context) {
        return SocketClassification {
            role: "toolInternal",
            reason: "Komut satırı bunun IDE/derleme aracı yardımcı süreci olduğunu gösteriyor.",
            confidence: "high",
        };
    }

    if has_project_server_marker(context) {
        return SocketClassification {
            role: "published",
            reason: "Komut satırı veya süreç ağacında geliştirme sunucusu işareti bulundu.",
            confidence: "high",
        };
    }

    if has_tool_internal_marker(context) {
        return SocketClassification {
            role: "toolInternal",
            reason: "Komut satırı bunun IDE/editör yardımcı veya eklenti süreci olduğunu gösteriyor.",
            confidence: "high",
        };
    }

    if identity.category == "editor" {
        return SocketClassification {
            role: "toolInternal",
            reason: "Port doğrudan editör sürecine ait; proje sunucusu olduğuna dair işaret bulunamadı.",
            confidence: "medium",
        };
    }

    if matches!(identity.category, "runtime" | "development")
        && binding.activity == "listener"
        && (is_common_development_port(binding.port) || binding.exposure != "local")
    {
        return SocketClassification {
            role: "published",
            reason: "Bir çalışma zamanı TCP bağlantısı bekliyor; port veya ağ kapsamı geliştirme sunucusuyla uyumlu.",
            confidence: "medium",
        };
    }

    if identity.category == "runtime" && binding.activity == "listener" {
        return SocketClassification {
            role: "unknown",
            reason: "Çalışma zamanı bağlantı bekliyor ancak hangi proje veya bileşene ait olduğu doğrulanamadı.",
            confidence: "low",
        };
    }

    SocketClassification {
        role: "unknown",
        reason: if binding.activity == "bound" {
            "UDP portu ayrılmış; UDP'de LISTEN durumu olmadığı için tek başına yayın anlamına gelmez."
        } else {
            "Süreç bağlantı bekliyor ancak amacını belirleyecek yeterli işaret bulunamadı."
        },
        confidence: "low",
    }
}

fn protection_reason(
    pid: u32,
    name: &str,
    executable: Option<&str>,
    known_developer_tool: bool,
    security_tool: bool,
    owned_by_another_user: bool,
) -> Option<String> {
    if pid == std::process::id() {
        return Some("PortControl kendi sürecini koruyor".into());
    }

    if pid == 0 || (cfg!(windows) && pid == 4) || (!cfg!(windows) && pid == 1) {
        return Some("İşletim sistemi çekirdek süreci".into());
    }

    if security_tool {
        return Some("Antivirüs veya güvenlik yazılımı süreci".into());
    }

    let name_lower = name.to_lowercase();
    const CRITICAL_NAMES: &[&str] = &[
        "system",
        "system idle process",
        "registry",
        "smss.exe",
        "csrss.exe",
        "wininit.exe",
        "services.exe",
        "lsass.exe",
        "winlogon.exe",
        "svchost.exe",
        "fontdrvhost.exe",
        "kernel_task",
        "launchd",
        "systemd",
        "init",
        "kthreadd",
        "dbus-daemon",
        "systemd-resolved",
        "systemd-networkd",
        "mdnsresponder",
        "configd",
    ];

    if CRITICAL_NAMES.contains(&name_lower.as_str()) {
        return Some("Kritik işletim sistemi süreci".into());
    }

    if owned_by_another_user && !known_developer_tool {
        return Some("Başka bir kullanıcı veya sistem hesabına ait süreç".into());
    }

    if !known_developer_tool {
        let path = executable
            .unwrap_or_default()
            .replace('\\', "/")
            .to_lowercase();
        let is_system_path = if cfg!(windows) {
            path.contains("/windows/system32/") || path.contains("/windows/syswow64/")
        } else if cfg!(target_os = "macos") {
            path.starts_with("/system/")
                || path.starts_with("/usr/libexec/")
                || path.starts_with("/usr/sbin/")
        } else {
            path.starts_with("/usr/lib/systemd/")
                || path.starts_with("/usr/sbin/")
                || path.starts_with("/sbin/")
        };

        if is_system_path {
            return Some("İşletim sistemi dizininden çalışan süreç".into());
        }
    }

    None
}

fn process_ancestors(system: &System, pid: Pid) -> Vec<ProcessAncestor> {
    let mut ancestors = Vec::new();
    let mut visited = HashSet::new();
    let mut next = system.process(pid).and_then(|process| process.parent());

    while let Some(parent_pid) = next {
        if ancestors.len() >= 5 || !visited.insert(parent_pid.as_u32()) {
            break;
        }
        let Some(parent) = system.process(parent_pid) else {
            break;
        };
        ancestors.push(ProcessAncestor {
            pid: parent_pid.as_u32(),
            name: clean_process_name(&parent.name().to_string_lossy()),
        });
        next = parent.parent();
    }

    ancestors
}

fn build_classification_context(
    system: &System,
    pid: Pid,
    process_name: &str,
    executable: Option<&str>,
    command: Option<&str>,
    working_directory: Option<&str>,
) -> String {
    let mut parts = vec![format!(
        "{} {} {}\n{}",
        process_name,
        executable.unwrap_or_default(),
        command.unwrap_or_default(),
        working_directory.unwrap_or_default()
    )];
    let mut visited = HashSet::new();
    let mut next = system.process(pid).and_then(|process| process.parent());

    while let Some(parent_pid) = next {
        if parts.len() >= 20 || !visited.insert(parent_pid.as_u32()) {
            break;
        }
        let Some(parent) = system.process(parent_pid) else {
            break;
        };
        parts.push(parent.name().to_string_lossy().into_owned());
        parts.push(process_command(parent));
        if let Some(path) = parent.exe() {
            parts.push(path.to_string_lossy().into_owned());
        }
        next = parent.parent();
    }

    parts.join(" ").to_lowercase()
}

fn process_command(process: &sysinfo::Process) -> String {
    process
        .cmd()
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}

fn has_project_server_marker(context: &str) -> bool {
    matches_any(
        context,
        &[
            "vite",
            "webpack",
            "next dev",
            "next-server",
            "nuxt",
            "ng serve",
            "ng.js serve",
            "@angular/cli",
            "react-scripts",
            "live-server",
            "ritwickdey.liveserver",
            "http-server",
            "serve-handler",
            "spring-boot",
            "org.springframework",
            "bootrun",
            "quarkus",
            "micronaut",
            "tomcat",
            "jetty",
            "undertow",
            "ktor",
            "-dserver.port",
            "uvicorn",
            "gunicorn",
            "flask run",
            "manage.py runserver",
            "dotnet run",
            "cargo run",
            "npm run",
            "pnpm run",
            "yarn run",
            "server.js",
        ],
    )
}

fn has_tool_internal_marker(context: &str) -> bool {
    matches_any(
        context,
        &[
            "--type=utility",
            "--type=gpu-process",
            "--type=renderer",
            "extensionhost",
            "extension-host",
            "bootstrap-fork",
            "shared-process",
            "crashpad-handler",
            "remoteagent",
            "language-server",
            "languageserver",
            "langserver",
            "tsserver",
            "typingsinstaller",
            "eslintserver",
            "rust-analyzer",
            "jdtls",
            "org.gradle.launcher.daemon",
            "gradledaemon",
            "kotlin-daemon",
            "kotlincompiledaemon",
            "--clientprocessid",
            "js-debug",
            "debugadapter",
            "copilot",
        ],
    )
}

fn is_security_process(name: &str, context: &str) -> bool {
    const SECURITY_NAMES: &[&str] = &[
        "avp.exe",
        "avp",
        "ksde.exe",
        "ksde",
        "msmpeng.exe",
        "nissrv.exe",
        "securityhealthservice.exe",
        "ekrn.exe",
        "egui.exe",
        "bdagent.exe",
        "vsserv.exe",
        "savservice.exe",
        "mcshield.exe",
    ];
    SECURITY_NAMES.contains(&name)
        || matches_any(
            context,
            &[
                "kaspersky lab",
                "windows defender",
                "microsoft defender",
                "eset",
                "bitdefender",
                "sophos",
                "mcafee",
            ],
        )
}

fn is_common_development_port(port: u16) -> bool {
    matches!(
        port,
        3000 | 3001
            | 4000
            | 4200
            | 5000
            | 5001
            | 5173
            | 5174
            | 5500
            | 8000
            | 8001
            | 8080
            | 8081
            | 8888
            | 9000
    )
}

fn should_include_tcp_state(state: TcpState) -> bool {
    !matches!(
        state,
        TcpState::Closed | TcpState::TimeWait | TcpState::DeleteTcb
    )
}

fn exposure_for(address: IpAddr) -> &'static str {
    if address.is_loopback() {
        "local"
    } else if address.is_unspecified() {
        "all"
    } else {
        "network"
    }
}

fn activity_priority(activity: &str) -> u8 {
    match activity {
        "listener" => 0,
        "bound" => 1,
        _ => 2,
    }
}

fn process_role_priority(process: &ProcessPortGroup) -> u8 {
    if process
        .ports
        .iter()
        .any(|binding| binding.role == "published")
    {
        0
    } else if process
        .ports
        .iter()
        .any(|binding| binding.role == "infrastructure")
    {
        1
    } else if process
        .ports
        .iter()
        .any(|binding| binding.role == "toolInternal")
    {
        2
    } else {
        3
    }
}

fn find_managed_ancestor<'a>(
    system: &System,
    pid: Pid,
    managed_roots: &'a HashMap<u32, ManagedProcess>,
) -> Option<&'a ManagedProcess> {
    if managed_roots.is_empty() {
        return None;
    }
    let mut visited = HashSet::new();
    let mut current = Some(pid);
    while let Some(candidate) = current {
        if let Some(managed) = managed_roots.get(&candidate.as_u32()) {
            return Some(managed);
        }
        if visited.len() >= 12 || !visited.insert(candidate.as_u32()) {
            break;
        }
        current = system
            .process(candidate)
            .and_then(|process| process.parent());
    }
    None
}

/// Kurulu uygulamaların paket klasörleri geliştirme projesi sayılmaz.
fn is_installed_application_root(root: &Path) -> bool {
    let path = root.to_string_lossy().replace('\\', "/").to_lowercase();
    [
        "/program files",
        "/programdata/",
        "/windows/",
        "/appdata/local/programs/",
        "/appdata/roaming/",
        "/.vscode/",
        "/.vscode-server/",
        "/.cursor/",
        "/.windsurf/",
        "/.nvm/",
        "/.npm/",
        "/.cargo/registry/",
        "/node_modules/",
        "/applications/",
        "/usr/lib/",
        "/usr/share/",
        "/opt/",
        "/snap/",
    ]
    .iter()
    .any(|marker| path.contains(marker))
}

fn matches_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn clean_process_name(name: &str) -> String {
    name.strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".EXE"))
        .unwrap_or(name)
        .to_string()
}

fn find_project_root(start: &Path) -> Option<PathBuf> {
    let start = if start.is_file() {
        start.parent()?
    } else {
        start
    };
    start
        .ancestors()
        .take(7)
        .find(|candidate| {
            [
                "package.json",
                "angular.json",
                "Cargo.toml",
                "pom.xml",
                "build.gradle",
                "build.gradle.kts",
                "pyproject.toml",
                "requirements.txt",
                "pubspec.yaml",
            ]
            .iter()
            .any(|marker| candidate.join(marker).is_file())
                || candidate.join("src-tauri").is_dir()
                || has_csproj(candidate)
        })
        .map(Path::to_path_buf)
}

fn has_csproj(root: &Path) -> bool {
    fs::read_dir(root).ok().is_some_and(|entries| {
        entries.flatten().take(250).any(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("csproj"))
        })
    })
}

fn project_manifest_context(root: &Path) -> String {
    let mut contents = Vec::new();
    for relative in [
        "package.json",
        "angular.json",
        "Cargo.toml",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "pyproject.toml",
        "requirements.txt",
        "pubspec.yaml",
    ] {
        if let Some(content) = read_small_text(&root.join(relative), 512 * 1024) {
            contents.push(relative.to_string());
            contents.push(content);
        }
    }

    if has_csproj(root)
        && let Ok(entries) = fs::read_dir(root)
    {
        for entry in entries.flatten().take(250) {
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("csproj"))
                && let Some(content) = read_small_text(&path, 512 * 1024)
            {
                contents.push(path.to_string_lossy().into_owned());
                contents.push(content);
                break;
            }
        }
    }

    contents.join(" ").to_lowercase()
}

fn read_small_text(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn read_project_name(root: &Path) -> Option<String> {
    let mut name = read_package_name(root)
        .or_else(|| read_toml_project_name(&root.join("Cargo.toml")))
        .or_else(|| read_toml_project_name(&root.join("pyproject.toml")))
        .or_else(|| read_pubspec_name(&root.join("pubspec.yaml")))
        .or_else(|| read_xml_tag(&root.join("pom.xml"), "artifactId"))
        .or_else(|| read_gradle_project_name(root))
        .or_else(|| read_csproj_name(root))
        .or_else(|| {
            root.file_name()
                .map(|value| value.to_string_lossy().into_owned())
        })?;

    if matches!(
        name.to_lowercase().as_str(),
        "frontend" | "front-end" | "client" | "web" | "app" | "backend" | "server" | "api"
    ) && let Some(parent_name) = root
        .parent()
        .and_then(Path::file_name)
        .map(|value| value.to_string_lossy().into_owned())
    {
        name = parent_name;
    }

    Some(humanize_project_name(&name))
}

fn read_package_name(root: &Path) -> Option<String> {
    let content = read_small_text(&root.join("package.json"), 512 * 1024)?;
    let json = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    json.get("name")
        .and_then(serde_json::Value::as_str)
        .map(|name| name.rsplit('/').next().unwrap_or(name).to_string())
}

fn read_toml_project_name(path: &Path) -> Option<String> {
    let content = read_small_text(path, 512 * 1024)?;
    let mut in_project_section = false;
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') {
            in_project_section = matches!(
                line,
                "[package]" | "[project]" | "[tool.poetry]" | "[workspace.package]"
            );
            continue;
        }
        if in_project_section
            && let Some(value) = line.strip_prefix("name")
            && let Some(value) = value.trim_start().strip_prefix('=')
        {
            return Some(value.trim().trim_matches(['"', '\'']).to_string());
        }
    }
    None
}

fn read_pubspec_name(path: &Path) -> Option<String> {
    let content = read_small_text(path, 512 * 1024)?;
    content.lines().find_map(|line| {
        line.trim()
            .strip_prefix("name:")
            .map(|value| value.trim().trim_matches(['"', '\'']).to_string())
    })
}

fn read_xml_tag(path: &Path, tag: &str) -> Option<String> {
    let content = read_small_text(path, 1024 * 1024)?;
    let start_tag = format!("<{tag}>");
    let end_tag = format!("</{tag}>");
    let start = content.find(&start_tag)? + start_tag.len();
    let end = content[start..].find(&end_tag)? + start;
    Some(content[start..end].trim().to_string())
}

fn read_gradle_project_name(root: &Path) -> Option<String> {
    for file in ["settings.gradle", "settings.gradle.kts"] {
        let Some(content) = read_small_text(&root.join(file), 512 * 1024) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(value) = trimmed.strip_prefix("rootProject.name") {
                let value = value
                    .trim_start()
                    .strip_prefix('=')
                    .unwrap_or(value)
                    .trim()
                    .trim_matches(['"', '\'']);
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

fn read_csproj_name(root: &Path) -> Option<String> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten().take(250) {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("csproj"))
        {
            continue;
        }
        if let Some(name) = read_xml_tag(&path, "AssemblyName") {
            return Some(name);
        }
        return path
            .file_stem()
            .map(|value| value.to_string_lossy().into_owned());
    }
    None
}

fn humanize_project_name(value: &str) -> String {
    value
        .trim()
        .trim_matches(['"', '\''])
        .split(['-', '_'])
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

fn access_urls_for(
    binding: &RawBinding,
    role: &str,
    project: &ProjectIdentity,
    local_addresses: &[String],
) -> Vec<String> {
    if binding.protocol != "TCP"
        || binding.activity != "listener"
        || role != "published"
        || !project.likely_http
    {
        return Vec::new();
    }

    let scheme = if matches!(binding.port, 443 | 8443) {
        "https"
    } else {
        "http"
    };
    let mut urls = Vec::new();
    match binding.exposure {
        "local" => {
            urls.push(format!("{scheme}://localhost:{}", binding.port));
        }
        "all" => {
            urls.push(format!("{scheme}://localhost:{}", binding.port));
            for address in local_addresses {
                urls.push(format_url(scheme, address, binding.port));
            }
        }
        "network" => {
            urls.push(format_url(scheme, &binding.address, binding.port));
        }
        _ => {}
    }
    urls.sort();
    urls.dedup();
    urls
}

fn format_url(scheme: &str, address: &str, port: u16) -> String {
    if address.contains(':') {
        format!("{scheme}://[{address}]:{port}")
    } else {
        format!("{scheme}://{address}:{port}")
    }
}

/// Bu bilgisayarın yerel ağdaki IP adresleri (QR kodlu ağ bağlantıları için).
#[tauri::command(async)]
pub fn lan_addresses() -> Vec<String> {
    discover_local_addresses()
}

fn discover_local_addresses() -> Vec<String> {
    let mut addresses = Vec::new();
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        let _ = socket.connect("8.8.8.8:80");
        if let Ok(address) = socket.local_addr()
            && !address.ip().is_loopback()
            && !address.ip().is_unspecified()
        {
            addresses.push(address.ip().to_string());
        }
    }
    if let Ok(socket) = UdpSocket::bind("[::]:0") {
        let _ = socket.connect("[2001:4860:4860::8888]:80");
        if let Ok(address) = socket.local_addr()
            && !address.ip().is_loopback()
            && !address.ip().is_unspecified()
        {
            addresses.push(address.ip().to_string());
        }
    }
    addresses
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_binding(port: u16, activity: &'static str) -> RawBinding {
        RawBinding {
            protocol: "TCP",
            address: "127.0.0.1".into(),
            port,
            remote_address: None,
            remote_port: None,
            exposure: "local",
            state: "LISTEN".into(),
            activity,
        }
    }

    #[test]
    fn recognizes_developer_and_security_tools() {
        let postgres = identify_process(
            "postgres.exe",
            Some(r"C:\Program Files\PostgreSQL\17\bin\postgres.exe"),
            None,
        );
        assert_eq!(postgres.display_name, "PostgreSQL");
        assert_eq!(postgres.category, "database");
        assert!(postgres.known_developer_tool);

        let idea = identify_process(
            "java.exe",
            None,
            Some(r#""C:\JetBrains\IntelliJ IDEA\bin\idea64.exe""#),
        );
        assert_eq!(idea.display_name, "IntelliJ IDEA");
        assert_eq!(idea.category, "editor");

        let kaspersky = identify_process("avp.exe", None, None);
        assert!(kaspersky.security_tool);
        assert_eq!(kaspersky.category, "system");
    }

    #[test]
    fn distinguishes_project_and_editor_internal_ports() {
        let editor = identify_process("Code.exe", None, None);
        let internal = classify_socket(
            &test_binding(61173, "listener"),
            &editor,
            "code.exe --type=utility extensionhost",
            false,
        );
        assert_eq!(internal.role, "toolInternal");

        let node = identify_process("node.exe", None, None);
        let project = classify_socket(
            &test_binding(5173, "listener"),
            &node,
            "node.exe vite --host 0.0.0.0",
            false,
        );
        assert_eq!(project.role, "published");
        assert_eq!(project.confidence, "high");
    }

    #[test]
    fn marks_active_tcp_as_connection_not_listener() {
        let node = identify_process("node.exe", None, None);
        let connection = classify_socket(
            &test_binding(51020, "connection"),
            &node,
            "node.exe vite",
            false,
        );
        assert_eq!(connection.role, "outbound");
    }

    #[test]
    fn protects_critical_and_security_processes() {
        assert!(protection_reason(4, "System", None, false, false, false).is_some());
        assert!(protection_reason(300, "svchost.exe", None, false, false, false).is_some());
        assert!(protection_reason(9636, "avp.exe", None, false, true, false).is_some());
        assert!(protection_reason(4200, "postgres.exe", None, true, false, true).is_none());
        assert!(protection_reason(4201, "unknown-daemon", None, false, false, true).is_some());
    }

    #[test]
    fn classifies_socket_exposure() {
        assert_eq!(exposure_for("127.0.0.1".parse().unwrap()), "local");
        assert_eq!(exposure_for("0.0.0.0".parse().unwrap()), "all");
        assert_eq!(exposure_for("192.168.1.50".parse().unwrap()), "network");
        assert_eq!(exposure_for("::1".parse().unwrap()), "local");
    }

    #[test]
    fn recognizes_requested_project_technologies() {
        let angular = inspect_project(
            "node.exe",
            None,
            Some("node @angular/cli/bin/ng.js serve --host 0.0.0.0"),
            None,
        );
        assert_eq!(angular.technology, "Angular");
        assert_eq!(angular.service_kind, "Frontend");
        assert!(angular.recognized);
        assert!(angular.likely_http);

        let spring = inspect_project(
            "java.exe",
            None,
            Some("java org.springframework.boot.loader.launch.JarLauncher"),
            None,
        );
        assert_eq!(spring.technology, "Spring Boot");
        assert_eq!(spring.service_kind, "Backend / API");
    }

    #[test]
    fn builds_local_and_lan_urls_for_exposed_http_projects() {
        let project = inspect_project(
            "node.exe",
            None,
            Some("node @angular/cli/bin/ng.js serve --host 0.0.0.0"),
            None,
        );
        let mut binding = test_binding(4200, "listener");
        binding.address = "0.0.0.0".into();
        binding.exposure = "all";
        let urls = access_urls_for(&binding, "published", &project, &["192.168.1.9".into()]);

        assert_eq!(
            urls,
            vec![
                "http://192.168.1.9:4200".to_string(),
                "http://localhost:4200".to_string()
            ]
        );
    }

    #[test]
    fn scans_real_local_sockets() {
        let result = scan_ports(false).expect("yerel soket taraması başarısız");
        let visible_bindings = result
            .processes
            .iter()
            .map(|process| process.ports.len())
            .sum::<usize>();

        assert!(result.scanned_at > 0);
        assert!(result.total_sockets >= visible_bindings);
        assert_eq!(result.platform, std::env::consts::OS);

        std::thread::sleep(Duration::from_millis(400));
        let sampled = scan_ports(false).expect("ikinci kaynak örneklemesi başarısız");
        assert!(
            sampled
                .processes
                .iter()
                .all(|process| process.metrics_ready)
        );
    }
}
