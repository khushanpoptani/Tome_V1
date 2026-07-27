pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod interface;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;

            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Could not resolve Tome data directory: {error}"))?;
            let state = infrastructure::state::AppState::new(&data_dir.join("tome.sqlite3"))?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            interface::commands::health::health,
            interface::commands::data::get_settings,
            interface::commands::data::set_setting,
            interface::commands::data::list_servers,
            interface::commands::data::save_server,
            interface::commands::data::set_active_server,
            interface::commands::data::delete_server,
            interface::commands::data::list_connection_history,
            interface::commands::data::save_model_test,
            interface::commands::data::list_model_tests,
            interface::commands::data::get_active_server,
            interface::commands::data::list_workspaces,
            interface::commands::data::save_workspace,
            interface::commands::data::delete_workspace,
            interface::commands::data::list_projects,
            interface::commands::data::save_project,
            interface::commands::data::delete_project,
            interface::commands::data::read_file_tree,
            interface::commands::data::list_conversations,
            interface::commands::data::save_conversation,
            interface::commands::data::delete_conversation,
            interface::commands::data::list_messages,
            interface::commands::data::save_message,
            interface::commands::data::list_tasks,
            interface::commands::data::save_task,
            interface::commands::data::clear_finished_tasks,
            interface::commands::data::list_logs,
            interface::commands::data::clear_logs,
            interface::commands::ollama::test_ollama_server,
            interface::commands::ollama::list_ollama_models,
            interface::commands::ollama::show_ollama_model,
            interface::commands::ollama::delete_ollama_model,
            interface::commands::ollama::pull_ollama_model,
            interface::commands::ollama::stream_ollama_chat,
            interface::commands::ollama::cancel_operation
        ])
        .run(tauri::generate_context!())
        .expect("Tome failed to start");
}
