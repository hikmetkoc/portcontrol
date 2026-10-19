//! Proje uygulamalarını alt süreç olarak başlatır, stdout/stderr akışını satır
//! satır yakalar ve arayüze Tauri olayları olarak iletir.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use netstat2::{AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState, get_sockets_info};
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

/// DEBUG seviyesinde log basan uygulamaların (ör. JHipster dev profili) başlangıç
/// satırları kaybolmasın diye geniş tutulur.
const MAX_LOG_LINES: usize = 50_000;
const PARTIAL_FLUSH_AFTER: Duration = Duration::from_millis(220);
const EMIT_INTERVAL: Duration = Duration::from_millis(45);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    seq: u64,
    ts: u64,
    stream: &'static str,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    run_id: String,
    app_id: String,
    project_id: String,
    label: String,
    command: String,
    cwd: String,
    pid: u32,
    port: Option<u16>,
    status: &'static str,
    exit_code: Option<i32>,
    started_at: u64,
    ended_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunRequest {
    app_id: String,
    project_id: String,
    label: String,
    cwd: String,
    command: String,
    #[serde(default)]
    env: Vec<EnvVar>,
    port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogPayload {
    run_id: String,
    lines: Vec<LogLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortCheck {
    port: u16,
    free: bool,
    pid: Option<u32>,
    process_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ManagedProcess {
    pub run_id: String,
    pub app_id: String,
    pub project_id: String,
}

pub enum RunEvent {
    Log(RunLogPayload),
    Status(RunInfo),
}

type Emit = Arc<dyn Fn(RunEvent) + Send + Sync>;

struct RunEntry {
    info: RunInfo,
    logs: VecDeque<LogLine>,
    next_seq: u64,
    stdin: Option<ChildStdin>,
    child: Option<Child>,
    stop_requested: bool,
}

impl RunEntry {
    fn push_lines(&mut self, lines: Vec<(&'static str, String)>) -> Vec<LogLine> {
        let ts = now_ms();
        let mut created = Vec::with_capacity(lines.len());
        for (stream, text) in lines {
            self.next_seq += 1;
            let line = LogLine {
                seq: self.next_seq,
                ts,
                stream,
                text,
            };
            self.logs.push_back(line.clone());
            created.push(line);
        }
        while self.logs.len() > MAX_LOG_LINES {
            self.logs.pop_front();
        }
        created
    }
}

#[derive(Default)]
pub struct Runner {
    runs: Mutex<HashMap<String, Arc<Mutex<RunEntry>>>>,
    counter: AtomicU64,
}

static RUNNER: OnceLock<Runner> = OnceLock::new();

pub fn runner() -> &'static Runner {
    RUNNER.get_or_init(Runner::default)
}

impl Runner {
    pub fn start(&self, request: StartRunRequest, emit: Emit) -> Result<RunInfo, String> {
        let command_text = request.command.trim().to_string();
        if command_text.is_empty() {
            return Err("Çalıştırılacak komut boş.".into());
        }
        let cwd = Path::new(&request.cwd);
        if !cwd.is_dir() {
            return Err(format!("Çalışma klasörü bulunamadı: {}", request.cwd));
        }

        // stdout ve stderr aynı boruya yazılır; böylece satırlar terminaldeki gerçek
        // sırasıyla gelir (ayrı borularda Java uyarıları ile loglar karışık sıralanıyordu).
        let (reader, writer) =
            std::io::pipe().map_err(|error| format!("Çıktı borusu açılamadı: {error}"))?;
        let writer_err = writer
            .try_clone()
            .map_err(|error| format!("Çıktı borusu açılamadı: {error}"))?;

        let mut command = shell_command(&command_text);
        command
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(writer)
            .stderr(writer_err);
        let added_env = injected_environment();
        for (key, value) in &added_env {
            command.env(key, value);
        }
        for variable in &request.env {
            if !variable.key.trim().is_empty() {
                command.env(variable.key.trim(), &variable.value);
            }
        }

        let spawned = command.spawn();
        // Komut nesnesi borunun yazma uçlarını tutar; süreç kapanınca EOF alınabilmesi için bırak.
        drop(command);
        let mut child = spawned.map_err(|error| format!("Süreç başlatılamadı: {error}"))?;
        let pid = child.id();
        let stdin = child.stdin.take();

        let run_id = format!(
            "run-{}-{}",
            now_ms(),
            self.counter.fetch_add(1, Ordering::Relaxed)
        );
        let info = RunInfo {
            run_id: run_id.clone(),
            app_id: request.app_id,
            project_id: request.project_id,
            label: request.label,
            command: command_text.clone(),
            cwd: request.cwd,
            pid,
            port: request.port,
            status: "running",
            exit_code: None,
            started_at: now_ms(),
            ended_at: None,
        };
        let mut entry = RunEntry {
            info: info.clone(),
            logs: VecDeque::new(),
            next_seq: 0,
            stdin,
            child: Some(child),
            stop_requested: false,
        };
        let env_summary = request
            .env
            .iter()
            .map(|variable| format!("{}={}", variable.key, variable.value))
            .collect::<Vec<_>>()
            .join(" ");
        let mut intro = vec![("system", format!("$ {command_text}"))];
        if !env_summary.is_empty() {
            intro.push(("system", format!("env {env_summary}")));
        }
        intro.push((
            "system",
            format!(
                "PortControl ortamı: {}",
                added_env
                    .iter()
                    .map(|(key, value)| format!("{key}={value}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            ),
        ));
        intro.push(("system", format!("PID {pid} · {}", info.cwd)));
        let intro_lines = entry.push_lines(intro);
        let entry = Arc::new(Mutex::new(entry));
        match self.runs.lock() {
            Ok(mut runs) => {
                runs.insert(run_id.clone(), entry.clone());
            }
            Err(_) => {
                kill_tree_blocking(pid);
                return Err("Süreç tablosuna erişilemedi.".into());
            }
        }

        emit(RunEvent::Status(info.clone()));
        emit(RunEvent::Log(RunLogPayload {
            run_id: run_id.clone(),
            lines: intro_lines,
        }));

        let (sender, receiver) = mpsc::channel::<(usize, Vec<u8>)>();
        thread::spawn(move || pump(reader, 0, sender));

        let dispatcher = {
            let entry = entry.clone();
            let emit = emit.clone();
            let run_id = run_id.clone();
            thread::spawn(move || dispatch(receiver, entry, emit, run_id))
        };

        {
            let entry = entry.clone();
            let emit = emit.clone();
            thread::spawn(move || wait_for_exit(entry, emit, run_id, dispatcher));
        }

        Ok(info)
    }

    pub fn stop(&self, run_id: &str) -> Result<(), String> {
        let entry = self.entry(run_id)?;
        let pid = {
            let mut entry = entry.lock().map_err(|_| "Süreç kilidi alınamadı.")?;
            if entry.info.status != "running" {
                return Ok(());
            }
            entry.stop_requested = true;
            entry.info.pid
        };
        kill_tree(pid);
        Ok(())
    }

    pub fn write_input(&self, run_id: &str, text: &str) -> Result<Vec<LogLine>, String> {
        let entry = self.entry(run_id)?;
        // Yazma bloklanabilir; çıktı okuyucularını bekletmemek için akışı kilit dışında kullan.
        let mut stdin = entry
            .lock()
            .map_err(|_| "Süreç kilidi alınamadı.")?
            .stdin
            .take()
            .ok_or("Bu sürecin girdi akışı kapalı.")?;
        let result = stdin
            .write_all(format!("{text}\n").as_bytes())
            .and_then(|_| stdin.flush());
        let mut entry = entry.lock().map_err(|_| "Süreç kilidi alınamadı.")?;
        if entry.info.status == "running" {
            entry.stdin = Some(stdin);
        }
        result.map_err(|error| format!("Girdi gönderilemedi: {error}"))?;
        Ok(entry.push_lines(vec![("input", format!("› {text}"))]))
    }

    pub fn list(&self) -> Vec<RunInfo> {
        let Ok(runs) = self.runs.lock() else {
            return Vec::new();
        };
        let mut list = runs
            .values()
            .filter_map(|entry| entry.lock().ok().map(|entry| entry.info.clone()))
            .collect::<Vec<_>>();
        list.sort_by_key(|info| info.started_at);
        list
    }

    pub fn logs(&self, run_id: &str) -> Result<Vec<LogLine>, String> {
        let entry = self.entry(run_id)?;
        let entry = entry.lock().map_err(|_| "Süreç kilidi alınamadı.")?;
        Ok(entry.logs.iter().cloned().collect())
    }

    pub fn clear_logs(&self, run_id: &str) -> Result<(), String> {
        let entry = self.entry(run_id)?;
        entry
            .lock()
            .map_err(|_| "Süreç kilidi alınamadı.")?
            .logs
            .clear();
        Ok(())
    }

    pub fn remove(&self, run_id: &str) -> Result<(), String> {
        let mut runs = self
            .runs
            .lock()
            .map_err(|_| "Süreç tablosuna erişilemedi.")?;
        if let Some(entry) = runs.get(run_id)
            && entry
                .lock()
                .is_ok_and(|entry| entry.info.status == "running")
        {
            return Err("Çalışan bir süreç kaldırılamaz; önce durdurun.".into());
        }
        runs.remove(run_id);
        Ok(())
    }

    /// Çalışan yönetilen süreçlerin kök PID'leri.
    pub fn managed_roots(&self) -> HashMap<u32, ManagedProcess> {
        let Ok(runs) = self.runs.lock() else {
            return HashMap::new();
        };
        runs.values()
            .filter_map(|entry| {
                let entry = entry.lock().ok()?;
                (entry.info.status == "running").then(|| {
                    (
                        entry.info.pid,
                        ManagedProcess {
                            run_id: entry.info.run_id.clone(),
                            app_id: entry.info.app_id.clone(),
                            project_id: entry.info.project_id.clone(),
                        },
                    )
                })
            })
            .collect()
    }

    pub fn kill_all(&self) {
        let pids = self.managed_roots().into_keys().collect::<Vec<_>>();
        for pid in pids {
            kill_tree_blocking(pid);
        }
    }

    fn entry(&self, run_id: &str) -> Result<Arc<Mutex<RunEntry>>, String> {
        self.runs
            .lock()
            .map_err(|_| "Süreç tablosuna erişilemedi.".to_string())?
            .get(run_id)
            .cloned()
            .ok_or_else(|| "Süreç kaydı bulunamadı.".into())
    }
}

fn shell_command(command_text: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd.exe");
        command
            .raw_arg(format!("/D /S /C \"{command_text}\""))
            .creation_flags(CREATE_NO_WINDOW);
        command
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("sh");
        command.arg("-c").arg(command_text).process_group(0);
        command
    }
}

fn pump(mut reader: impl Read, stream: usize, sender: mpsc::Sender<(usize, Vec<u8>)>) {
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                if sender.send((stream, buffer[..count].to_vec())).is_err() {
                    break;
                }
            }
        }
    }
}

fn dispatch(
    receiver: mpsc::Receiver<(usize, Vec<u8>)>,
    entry: Arc<Mutex<RunEntry>>,
    emit: Emit,
    run_id: String,
) {
    const STREAMS: [&str; 2] = ["stdout", "stderr"];
    let mut partial: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
    let mut partial_since: [Option<Instant>; 2] = [None, None];
    let mut pending: Vec<(&'static str, String)> = Vec::new();
    let mut last_emit = Instant::now();
    let mut disconnected = false;

    let flush = |pending: &mut Vec<(&'static str, String)>| {
        if pending.is_empty() {
            return;
        }
        let lines = match entry.lock() {
            Ok(mut entry) => entry.push_lines(std::mem::take(pending)),
            Err(_) => {
                pending.clear();
                return;
            }
        };
        emit(RunEvent::Log(RunLogPayload {
            run_id: run_id.clone(),
            lines,
        }));
    };

    while !disconnected {
        let mut handle = |(stream, bytes): (usize, Vec<u8>)| {
            partial[stream].extend_from_slice(&bytes);
            while let Some(position) = partial[stream].iter().position(|byte| *byte == b'\n') {
                let line = partial[stream].drain(..=position).collect::<Vec<_>>();
                pending.push((STREAMS[stream], decode_line(&line)));
            }
            partial_since[stream] = if partial[stream].is_empty() {
                None
            } else {
                partial_since[stream].or(Some(Instant::now()))
            };
        };

        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                handle(chunk);
                for _ in 0..256 {
                    match receiver.try_recv() {
                        Ok(chunk) => handle(chunk),
                        Err(mpsc::TryRecvError::Empty) => break,
                        Err(mpsc::TryRecvError::Disconnected) => {
                            disconnected = true;
                            break;
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => disconnected = true,
        }

        // Satır sonu beklemeyen istemleri ("Devam edilsin mi? (Y/n)") gecikmeyle göster.
        for stream in 0..2 {
            let stale =
                partial_since[stream].is_some_and(|since| since.elapsed() >= PARTIAL_FLUSH_AFTER);
            if (stale || disconnected) && !partial[stream].is_empty() {
                let line = std::mem::take(&mut partial[stream]);
                let text = decode_line(&line);
                if !text.trim().is_empty() {
                    pending.push((STREAMS[stream], text));
                }
                partial_since[stream] = None;
            }
        }

        if !pending.is_empty()
            && (disconnected || last_emit.elapsed() >= EMIT_INTERVAL || pending.len() >= 400)
        {
            flush(&mut pending);
            last_emit = Instant::now();
        }
    }
    flush(&mut pending);
}

fn wait_for_exit(
    entry: Arc<Mutex<RunEntry>>,
    emit: Emit,
    run_id: String,
    dispatcher: thread::JoinHandle<()>,
) {
    let exit_code = loop {
        thread::sleep(Duration::from_millis(150));
        let Ok(mut guard) = entry.lock() else {
            break None;
        };
        let Some(child) = guard.child.as_mut() else {
            break None;
        };
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {}
            Err(_) => break None,
        }
    };

    // Son log satırlarının boşaltılması için kısa süre bekle.
    let deadline = Instant::now() + Duration::from_millis(1500);
    while !dispatcher.is_finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(25));
    }

    let Ok(mut guard) = entry.lock() else {
        return;
    };
    guard.child = None;
    guard.stdin = None;
    guard.info.exit_code = exit_code;
    guard.info.ended_at = Some(now_ms());
    guard.info.status = if guard.stop_requested {
        "stopped"
    } else if exit_code == Some(0) {
        "exited"
    } else {
        "failed"
    };
    let message = match (guard.info.status, exit_code) {
        ("stopped", _) => "■ Süreç kullanıcı tarafından durduruldu.".to_string(),
        (_, Some(code)) => format!("■ Süreç sonlandı · çıkış kodu {code}"),
        _ => "■ Süreç sonlandı.".to_string(),
    };
    let lines = guard.push_lines(vec![("system", message)]);
    let info = guard.info.clone();
    drop(guard);

    emit(RunEvent::Log(RunLogPayload { run_id, lines }));
    emit(RunEvent::Status(info));
}

/// Terminal davranışına yaklaşmak için alt süreçlere eklenen ortam değişkenleri.
fn injected_environment() -> Vec<(String, String)> {
    let mut variables: Vec<(String, String)> = [
        ("FORCE_COLOR", "1"),
        ("CLICOLOR_FORCE", "1"),
        ("npm_config_color", "always"),
        ("BROWSER", "none"),
        ("PYTHONUNBUFFERED", "1"),
        ("PYTHONIOENCODING", "utf-8"),
        ("SPRING_OUTPUT_ANSI_ENABLED", "ALWAYS"),
        ("DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION", "1"),
        ("NO_UPDATE_NOTIFIER", "1"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_string(), value.to_string()))
    .collect();
    if !cfg!(windows) {
        variables.push(("TERM".into(), "xterm-256color".into()));
    }
    // Çıktı boruya yazıldığında JDK 18+ System.out/err için `stdout.encoding`
    // değerini Windows kod sayfasından (ör. 1252) alır ve Türkçe karakterler `?`
    // olur. Konsoldaki gibi UTF-8 yazması için mevcut seçeneklere eklenir.
    let java_options = std::env::var("JAVA_TOOL_OPTIONS").unwrap_or_default();
    if !java_options.contains("stdout.encoding") {
        let merged = format!("{java_options} -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8");
        variables.push(("JAVA_TOOL_OPTIONS".into(), merged.trim().to_string()));
    }
    // Maven 3.9+ boruya yazarken renkleri kapatır; terminaldeki görünümü koru.
    if std::env::var_os("MAVEN_ARGS").is_none() {
        variables.push(("MAVEN_ARGS".into(), "-Dstyle.color=always".into()));
    }
    variables
}

/// UTF-8 olmayan çıktıyı (eski araçlar, Windows ANSI kod sayfası) okunur hâle getirir.
fn decode_bytes(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => decode_system_code_page(bytes),
    }
}

#[cfg(windows)]
fn decode_system_code_page(bytes: &[u8]) -> String {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MultiByteToWideChar(
            code_page: u32,
            flags: u32,
            source: *const u8,
            source_len: i32,
            target: *mut u16,
            target_len: i32,
        ) -> i32;
    }
    const CP_ACP: u32 = 0;
    if bytes.is_empty() || bytes.len() > i32::MAX as usize {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let length = bytes.len() as i32;
    // SAFETY: Tamponlar geçerli ve uzunlukları API'ye doğru bildiriliyor.
    unsafe {
        let needed =
            MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), length, std::ptr::null_mut(), 0);
        if needed <= 0 {
            return String::from_utf8_lossy(bytes).into_owned();
        }
        let mut wide = vec![0u16; needed as usize];
        let written =
            MultiByteToWideChar(CP_ACP, 0, bytes.as_ptr(), length, wide.as_mut_ptr(), needed);
        String::from_utf16_lossy(&wide[..written.max(0) as usize])
    }
}

#[cfg(not(windows))]
fn decode_system_code_page(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// ANSI kaçış dizilerini (renk, imleç) metinden siler.
fn strip_ansi(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            output.push(character);
            continue;
        }
        match characters.peek() {
            Some('[') => {
                characters.next();
                for next in characters.by_ref() {
                    if next.is_ascii_alphabetic() || next == '~' {
                        break;
                    }
                }
            }
            Some(']') => {
                characters.next();
                while let Some(next) = characters.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' && characters.peek() == Some(&'\\') {
                        characters.next();
                        break;
                    }
                }
            }
            Some(_) => {
                characters.next();
            }
            None => {}
        }
    }
    output
}

fn decode_line(bytes: &[u8]) -> String {
    let mut end = bytes.len();
    while end > 0 && matches!(bytes[end - 1], b'\n' | b'\r') {
        end -= 1;
    }
    let text = decode_bytes(&bytes[..end]);
    // İlerleme çubukları satırı \r ile yeniden yazar; yalnızca son hâli göster.
    match text.rsplit('\r').find(|segment| !segment.trim().is_empty()) {
        Some(segment) => segment.to_string(),
        None => String::new(),
    }
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        thread::spawn(move || kill_tree_blocking(pid));
    }
    #[cfg(not(windows))]
    {
        signal_process_group(pid, libc::SIGTERM);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(2500));
            signal_process_group(pid, libc::SIGKILL);
        });
    }
}

/// Süreç `process_group(0)` ile kendi grubunun lideri olarak başlatılır; negatif
/// PID tüm grubu (npm → node → vite gibi alt süreçleri) hedefler.
#[cfg(not(windows))]
fn signal_process_group(pid: u32, signal: libc::c_int) {
    let Ok(group) = libc::pid_t::try_from(pid) else {
        return;
    };
    // SAFETY: kill(2) yalnızca sinyal gönderir; bellek güvenliğini etkilemez.
    unsafe {
        libc::kill(-group, signal);
    }
}

fn kill_tree_blocking(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        signal_process_group(pid, libc::SIGKILL);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn listening_ports() -> HashMap<u16, Option<u32>> {
    let mut ports = HashMap::new();
    if let Ok(sockets) = get_sockets_info(
        AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6,
        ProtocolFlags::TCP,
    ) {
        for socket in sockets {
            if let ProtocolSocketInfo::Tcp(tcp) = socket.protocol_socket_info
                && tcp.state == TcpState::Listen
            {
                ports
                    .entry(tcp.local_port)
                    .or_insert_with(|| socket.associated_pids.first().copied());
            }
        }
    }
    ports
}

fn can_bind(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok() && TcpListener::bind(("0.0.0.0", port)).is_ok()
}

// ---------------------------------------------------------------------------
// Tauri komutları
// ---------------------------------------------------------------------------

fn tauri_emitter(app: AppHandle) -> Emit {
    Arc::new(move |event| {
        let _ = match event {
            RunEvent::Log(payload) => app.emit("run-log", payload),
            RunEvent::Status(info) => app.emit("run-status", info),
        };
    })
}

#[tauri::command]
pub fn start_run(app: AppHandle, request: StartRunRequest) -> Result<RunInfo, String> {
    runner().start(request, tauri_emitter(app))
}

#[tauri::command]
pub fn stop_run(run_id: String) -> Result<(), String> {
    runner().stop(&run_id)
}

#[tauri::command]
pub fn list_runs() -> Vec<RunInfo> {
    runner().list()
}

#[tauri::command]
pub fn run_logs(run_id: String) -> Result<Vec<LogLine>, String> {
    runner().logs(&run_id)
}

#[tauri::command]
pub fn write_run_input(app: AppHandle, run_id: String, text: String) -> Result<(), String> {
    let lines = runner().write_input(&run_id, &text)?;
    let _ = app.emit("run-log", RunLogPayload { run_id, lines });
    Ok(())
}

/// Çalıştırmanın bellekteki tüm loglarını renk kodları temizlenmiş olarak dosyaya yazar.
#[tauri::command(async)]
pub fn save_run_log(run_id: String, path: String) -> Result<usize, String> {
    let lines = runner().logs(&run_id)?;
    let mut content = String::new();
    for line in &lines {
        let prefix = match line.stream {
            "system" => "# ",
            "input" => "> ",
            _ => "",
        };
        content.push_str(prefix);
        content.push_str(&strip_ansi(&line.text));
        content.push('\n');
    }
    std::fs::write(&path, content).map_err(|error| format!("Log dosyası yazılamadı: {error}"))?;
    Ok(lines.len())
}

#[tauri::command]
pub fn clear_run_logs(run_id: String) -> Result<(), String> {
    runner().clear_logs(&run_id)
}

#[tauri::command]
pub fn remove_run(run_id: String) -> Result<(), String> {
    runner().remove(&run_id)
}

#[tauri::command(async)]
pub fn check_port(port: u16) -> PortCheck {
    let listeners = listening_ports();
    let owner = listeners.get(&port).copied();
    let free = owner.is_none() && can_bind(port);
    let pid = owner.flatten();
    let process_name = pid.and_then(|pid| {
        let mut system = System::new();
        let target = Pid::from_u32(pid);
        system.refresh_processes(ProcessesToUpdate::Some(&[target]), true);
        system
            .process(target)
            .map(|process| process.name().to_string_lossy().into_owned())
    });
    PortCheck {
        port,
        free,
        pid,
        process_name,
    }
}

#[tauri::command(async)]
pub fn find_free_port(start: u16, exclude: Option<Vec<u16>>) -> Option<u16> {
    let listeners = listening_ports();
    let excluded = exclude
        .unwrap_or_default()
        .into_iter()
        .collect::<HashSet<_>>();
    let start = start.max(1024);
    (start..=start.saturating_add(400))
        .find(|port| !listeners.contains_key(port) && !excluded.contains(port) && can_bind(*port))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    ok: bool,
    status: Option<u16>,
    latency_ms: u64,
    error: Option<String>,
}

/// Yerel bir servisin hazır olup olmadığını denetler. `path` verilirse küçük bir
/// HTTP/1.1 GET isteği gönderilir ve 500'ün altındaki her yanıt sağlıklı sayılır;
/// verilmezse yalnızca TCP bağlantısı kurulabildiğine bakılır.
pub fn probe(port: u16, path: Option<&str>, timeout: Duration) -> ProbeResult {
    use std::net::{SocketAddr, TcpStream};
    let started = Instant::now();
    let addresses: [SocketAddr; 2] = [
        ([127, 0, 0, 1], port).into(),
        ([0, 0, 0, 0, 0, 0, 0, 1], port).into(),
    ];
    let mut last_error = String::new();
    let mut stream = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(connected) => {
                stream = Some(connected);
                break;
            }
            Err(error) => last_error = error.to_string(),
        }
    }
    let failure = |error: String| ProbeResult {
        ok: false,
        status: None,
        latency_ms: started.elapsed().as_millis() as u64,
        error: Some(error),
    };
    let Some(mut stream) = stream else {
        return failure(last_error);
    };
    let Some(path) = path.filter(|value| !value.trim().is_empty()) else {
        return ProbeResult {
            ok: true,
            status: None,
            latency_ms: started.elapsed().as_millis() as u64,
            error: None,
        };
    };
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: localhost:{port}\r\nUser-Agent: PortControl\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    if let Err(error) = stream.write_all(request.as_bytes()) {
        return failure(error.to_string());
    }
    let mut buffer = [0u8; 256];
    let mut received = Vec::new();
    while !received.windows(2).any(|pair| pair == b"\r\n") && received.len() < 1024 {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => received.extend_from_slice(&buffer[..count]),
            Err(error) => return failure(error.to_string()),
        }
    }
    let status_line = String::from_utf8_lossy(&received);
    let status = status_line
        .strip_prefix("HTTP/")
        .and_then(|rest| rest.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok());
    match status {
        Some(code) => ProbeResult {
            ok: code < 500,
            status: Some(code),
            latency_ms: started.elapsed().as_millis() as u64,
            error: None,
        },
        None => failure("HTTP yanıtı alınamadı".into()),
    }
}

#[tauri::command(async)]
pub fn probe_service(port: u16, path: Option<String>, timeout_ms: Option<u64>) -> ProbeResult {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(100, 10_000));
    probe(port, path.as_deref(), timeout)
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Klasör bulunamadı.".into());
    }
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Klasör açılamadı: {error}"))
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: Option<String>) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Klasör bulunamadı.".into());
    }
    let editor = editor
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "code".into());
    if !editor
        .chars()
        .all(|character| character.is_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("Geçersiz editör komutu.".into());
    }
    let mut command = shell_command(&format!("{editor} \"{path}\""));
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Editör açılamadı: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collecting_emitter() -> (Emit, Arc<Mutex<Vec<String>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let emit: Emit = Arc::new(move |event| {
            let text = match event {
                RunEvent::Log(payload) => payload
                    .lines
                    .iter()
                    .map(|line| format!("{}:{}", line.stream, line.text))
                    .collect::<Vec<_>>()
                    .join("\n"),
                RunEvent::Status(info) => format!("status:{}", info.status),
            };
            sink.lock().unwrap().push(text);
        });
        (emit, events)
    }

    fn request(command: &str) -> StartRunRequest {
        StartRunRequest {
            app_id: "app".into(),
            project_id: "project".into(),
            label: "test".into(),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            command: command.into(),
            env: vec![EnvVar {
                key: "PORTCONTROL_TEST".into(),
                value: "neon".into(),
            }],
            port: None,
        }
    }

    fn wait_for_status(runner: &Runner, run_id: &str, expected: &str) {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if runner
                .list()
                .iter()
                .any(|info| info.run_id == run_id && info.status == expected)
            {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        panic!("{run_id} {expected} durumuna geçmedi: {:?}", runner.list());
    }

    #[test]
    fn captures_output_environment_and_exit_code() {
        let runner = Runner::default();
        let (emit, events) = collecting_emitter();
        let command = if cfg!(windows) {
            "echo hello-%PORTCONTROL_TEST% && echo oops 1>&2 && exit /b 3"
        } else {
            "echo hello-$PORTCONTROL_TEST && echo oops 1>&2 && exit 3"
        };
        let info = runner.start(request(command), emit).unwrap();
        wait_for_status(&runner, &info.run_id, "failed");

        let logs = runner.logs(&info.run_id).unwrap();
        // stdout ve stderr tek borudan, gerçek sırasıyla gelir.
        let output = logs
            .iter()
            .filter(|line| line.stream == "stdout")
            .map(|line| line.text.trim().to_string())
            .collect::<Vec<_>>();
        assert_eq!(output, vec!["hello-neon", "oops"]);
        assert!(
            logs.iter()
                .any(|line| line.stream == "system" && line.text.contains("stdout.encoding=UTF-8"))
        );
        let final_info = runner
            .list()
            .into_iter()
            .find(|run| run.run_id == info.run_id)
            .unwrap();
        assert_eq!(final_info.exit_code, Some(3));
        let events = events.lock().unwrap();
        assert_eq!(events.first().map(String::as_str), Some("status:running"));
        assert_eq!(events.last().map(String::as_str), Some("status:failed"));
        assert!(runner.remove(&info.run_id).is_ok());
    }

    #[test]
    fn stops_long_running_process_tree() {
        let runner = Runner::default();
        let (emit, _) = collecting_emitter();
        let command = if cfg!(windows) {
            "ping -n 30 127.0.0.1"
        } else {
            "sleep 30"
        };
        let info = runner.start(request(command), emit).unwrap();
        assert!(runner.managed_roots().contains_key(&info.pid));
        assert!(runner.remove(&info.run_id).is_err());
        runner.stop(&info.run_id).unwrap();
        wait_for_status(&runner, &info.run_id, "stopped");
        assert!(runner.managed_roots().is_empty());
    }

    #[test]
    fn decodes_non_utf8_output_and_strips_ansi() {
        // Windows-1252/1254 "café" (0xE9) UTF-8 değil; sistem kod sayfasıyla çözülür.
        let decoded = decode_bytes(b"caf\xE9");
        assert!(decoded.starts_with("caf"));
        assert!(!decoded.contains(char::REPLACEMENT_CHARACTER) || !cfg!(windows));
        assert_eq!(decode_bytes("şğı".as_bytes()), "şğı");
        assert_eq!(
            strip_ansi("\u{1b}[32mINFO\u{1b}[0m ok \u{1b}]0;title\u{7}done"),
            "INFO ok done"
        );
    }

    #[test]
    fn decodes_progress_lines() {
        assert_eq!(
            decode_line(b"building 10%\rbuilding 100%\r\n"),
            "building 100%"
        );
        assert_eq!(decode_line(b"ready\n"), "ready");
    }

    #[test]
    fn probes_tcp_and_http_services() {
        use std::io::{BufRead, BufReader};
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            for status in ["200 OK", "503 Service Unavailable"] {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert!(line.starts_with("GET /health HTTP/1.1"));
                let mut stream = stream;
                stream
                    .write_all(format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\n\r\n").as_bytes())
                    .unwrap();
            }
        });
        let healthy = probe(port, Some("/health"), Duration::from_secs(2));
        assert!(healthy.ok);
        assert_eq!(healthy.status, Some(200));
        let failing = probe(port, Some("health"), Duration::from_secs(2));
        assert!(!failing.ok);
        assert_eq!(failing.status, Some(503));
        server.join().unwrap();

        let closed = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let closed_port = closed.local_addr().unwrap().port();
        drop(closed);
        assert!(!probe(closed_port, None, Duration::from_millis(300)).ok);
    }

    #[test]
    fn finds_free_ports() {
        let occupied = TcpListener::bind(("0.0.0.0", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        assert!(!check_port(port).free);
        let free = find_free_port(port, None).unwrap();
        assert_ne!(free, port);
    }
}
