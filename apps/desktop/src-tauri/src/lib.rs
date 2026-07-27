pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod interface;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            interface::commands::health::health
        ])
        .run(tauri::generate_context!())
        .expect("Tome failed to start");
}
