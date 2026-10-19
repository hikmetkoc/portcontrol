mod envfile;
mod ports;
mod projects;
mod runner;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ports::scan_ports,
            ports::stop_processes,
            ports::lan_addresses,
            projects::scan_workspace,
            runner::start_run,
            runner::stop_run,
            runner::list_runs,
            runner::run_logs,
            runner::write_run_input,
            runner::clear_run_logs,
            runner::save_run_log,
            runner::remove_run,
            runner::check_port,
            runner::find_free_port,
            runner::probe_service,
            envfile::read_env_file,
            envfile::write_env_file,
            runner::open_folder,
            runner::open_in_editor
        ])
        .build(tauri::generate_context!())
        .expect("PortControl başlatılamadı")
        .run(|_app, event| {
            // Uygulama kapanırken PortControl'ün başlattığı tüm süreç ağaçlarını sonlandır.
            if let tauri::RunEvent::Exit = event {
                runner::runner().kill_all();
            }
        });
}
