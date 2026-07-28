mod ports;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ports::scan_ports,
            ports::stop_processes
        ])
        .run(tauri::generate_context!())
        .expect("PortControl başlatılamadı");
}
