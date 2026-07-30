pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod interface;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            interface::commands::data::reset_local_database,
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
            interface::commands::data::archive_project,
            interface::commands::data::duplicate_project,
            interface::commands::data::read_file_tree,
            interface::commands::data::list_conversations,
            interface::commands::data::save_conversation,
            interface::commands::data::delete_conversation,
            interface::commands::data::move_conversation,
            interface::commands::data::duplicate_conversation,
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
            interface::commands::ollama::cancel_operation,
            interface::commands::training::list_training_servers,
            interface::commands::training::save_training_server,
            interface::commands::training::set_active_training_server,
            interface::commands::training::delete_training_server,
            interface::commands::training::test_training_server,
            interface::commands::training::reset_training_manager_database,
            interface::commands::training::list_training_dataset_groups,
            interface::commands::training::save_training_dataset_group,
            interface::commands::training::delete_training_dataset_group,
            interface::commands::training::assign_training_datasets_to_group,
            interface::commands::training::list_training_datasets,
            interface::commands::training::save_training_dataset,
            interface::commands::training::delete_training_dataset,
            interface::commands::training::list_dataset_uploads,
            interface::commands::training::start_dataset_upload,
            interface::commands::training::cancel_dataset_upload,
            interface::commands::training::list_training_jobs,
            interface::commands::training::save_training_job,
            interface::commands::training::delete_training_job,
            interface::commands::training::preflight_training_job,
            interface::commands::training::dispatch_training_job,
            interface::commands::training::refresh_training_job,
            interface::commands::training::cancel_training_job,
            interface::commands::training::retry_training_job,
            interface::commands::training::retry_training_registration,
            interface::commands::training::list_training_logs,
            interface::commands::training::refresh_training_resources,
            interface::commands::training::get_training_resources
        ])
        .run(tauri::generate_context!())
        .expect("Tome failed to start");
}
