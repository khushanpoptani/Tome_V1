use std::{fs, path::Path};

use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};
use tauri::State;
use uuid::Uuid;

use crate::{
    domain::records::{
        ConnectionHistoryRecord, ConversationInput, ConversationRecord, FileTreeNode, LogRecord,
        MessageInput, MessageRecord, ModelTestRecord, ProjectInput, ProjectRecord, ServerInput,
        ServerRecord, TaskInput, TaskRecord, WorkspaceInput, WorkspaceRecord,
    },
    infrastructure::state::AppState,
};

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn database_error(context: &str, error: rusqlite::Error) -> String {
    format!("Database error while {context}: {error}")
}

fn map_server(row: &Row<'_>) -> rusqlite::Result<ServerRecord> {
    Ok(ServerRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        is_active: row.get::<_, i64>(3)? != 0,
        last_status: row.get(4)?,
        last_ping_ms: row.get(5)?,
        last_version: row.get(6)?,
        last_error: row.get(7)?,
        last_tested_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Vec<(String, String)>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .map_err(|error| database_error("preparing settings", error))?;
    let records = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| database_error("reading settings", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading settings", error))?;
    Ok(records)
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value, now()],
        )
        .map_err(|error| database_error("saving a setting", error))?;
    Ok(())
}

#[tauri::command]
pub fn list_servers(state: State<'_, AppState>) -> Result<Vec<ServerRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, name, url, is_active, last_status, last_ping_ms, last_version,
                    last_error, last_tested_at, created_at, updated_at
             FROM servers ORDER BY is_active DESC, updated_at DESC",
        )
        .map_err(|error| database_error("preparing servers", error))?;
    let records = statement
        .query_map([], map_server)
        .map_err(|error| database_error("reading servers", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading servers", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_server(state: State<'_, AppState>, input: ServerInput) -> Result<ServerRecord, String> {
    let url = input.url.trim_end_matches('/').to_owned();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Server URL must start with http:// or https://".into());
    }
    let timestamp = now();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting server update", error))?;
    if input.is_active {
        transaction
            .execute("UPDATE servers SET is_active = 0", [])
            .map_err(|error| database_error("clearing active server", error))?;
    }
    transaction
        .execute(
            "INSERT INTO servers(id, name, url, is_active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, url=excluded.url, is_active=excluded.is_active,
                updated_at=excluded.updated_at",
            params![
                id,
                input.name.trim(),
                url,
                i64::from(input.is_active),
                timestamp
            ],
        )
        .map_err(|error| database_error("saving server", error))?;
    transaction
        .commit()
        .map_err(|error| database_error("committing server", error))?;
    drop(database);
    list_servers(state)?
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "Saved server could not be reloaded".into())
}

#[tauri::command]
pub fn set_active_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting active server update", error))?;
    transaction
        .execute("UPDATE servers SET is_active = 0", [])
        .map_err(|error| database_error("clearing active server", error))?;
    let affected = transaction
        .execute(
            "UPDATE servers SET is_active = 1, updated_at = ?2 WHERE id = ?1",
            params![id, now()],
        )
        .map_err(|error| database_error("setting active server", error))?;
    if affected == 0 {
        return Err("The selected server no longer exists".into());
    }
    transaction
        .commit()
        .map_err(|error| database_error("committing active server", error))
}

#[tauri::command]
pub fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM servers WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting server", error))?;
    Ok(())
}

#[tauri::command]
pub fn list_connection_history(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<ConnectionHistoryRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, server_id, status, ping_ms, version, error, tested_at
             FROM connection_history WHERE server_id = ?1 ORDER BY tested_at DESC LIMIT 50",
        )
        .map_err(|error| database_error("preparing connection history", error))?;
    let records = statement
        .query_map([server_id], |row| {
            Ok(ConnectionHistoryRecord {
                id: row.get(0)?,
                server_id: row.get(1)?,
                status: row.get(2)?,
                ping_ms: row.get(3)?,
                version: row.get(4)?,
                error: row.get(5)?,
                tested_at: row.get(6)?,
            })
        })
        .map_err(|error| database_error("reading connection history", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading connection history", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_model_test(
    state: State<'_, AppState>,
    server_id: String,
    model: String,
    status: String,
    error: Option<String>,
) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO model_tests(server_id, model, tested_at, status, error)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(server_id, model) DO UPDATE SET
               tested_at=excluded.tested_at, status=excluded.status, error=excluded.error",
            params![server_id, model, now(), status, error],
        )
        .map_err(|value| database_error("saving model test result", value))?;
    Ok(())
}

#[tauri::command]
pub fn list_model_tests(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<ModelTestRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT server_id, model, tested_at, status, error
             FROM model_tests WHERE server_id=?1 ORDER BY tested_at DESC",
        )
        .map_err(|error| database_error("preparing model tests", error))?;
    let records = statement
        .query_map([server_id], |row| {
            Ok(ModelTestRecord {
                server_id: row.get(0)?,
                model: row.get(1)?,
                tested_at: row.get(2)?,
                status: row.get(3)?,
                error: row.get(4)?,
            })
        })
        .map_err(|error| database_error("reading model tests", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading model tests", error))?;
    Ok(records)
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, name, path, created_at, updated_at, last_opened_at
             FROM workspaces ORDER BY last_opened_at DESC",
        )
        .map_err(|error| database_error("preparing workspaces", error))?;
    let records = statement
        .query_map([], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                last_opened_at: row.get(5)?,
            })
        })
        .map_err(|error| database_error("reading workspaces", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading workspaces", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_workspace(
    state: State<'_, AppState>,
    input: WorkspaceInput,
) -> Result<WorkspaceRecord, String> {
    let path = Path::new(input.path.trim());
    if input.create_directory && !path.exists() {
        fs::create_dir_all(path)
            .map_err(|error| format!("Could not create workspace directory: {error}"))?;
    }
    if !path.is_dir() {
        return Err(format!(
            "Workspace directory does not exist: {}",
            path.display()
        ));
    }
    let timestamp = now();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO workspaces(id, name, path, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path,
               updated_at=excluded.updated_at, last_opened_at=excluded.last_opened_at",
            params![id, input.name.trim(), path.to_string_lossy(), timestamp],
        )
        .map_err(|error| database_error("saving workspace", error))?;
    drop(database);
    list_workspaces(state)?
        .into_iter()
        .find(|workspace| workspace.id == id)
        .ok_or_else(|| "Saved workspace could not be reloaded".into())
}

#[tauri::command]
pub fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM workspaces WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting workspace", error))?;
    Ok(())
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, workspace_id, name, path, created_at, updated_at, last_opened_at
             FROM projects ORDER BY last_opened_at DESC",
        )
        .map_err(|error| database_error("preparing projects", error))?;
    let records = statement
        .query_map([], |row| {
            Ok(ProjectRecord {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                last_opened_at: row.get(6)?,
            })
        })
        .map_err(|error| database_error("reading projects", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading projects", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_project(
    state: State<'_, AppState>,
    input: ProjectInput,
) -> Result<ProjectRecord, String> {
    let path = Path::new(input.path.trim());
    if input.create_directory && !path.exists() {
        fs::create_dir_all(path)
            .map_err(|error| format!("Could not create project directory: {error}"))?;
    }
    if !path.is_dir() {
        return Err(format!(
            "Project directory does not exist: {}",
            path.display()
        ));
    }
    let timestamp = now();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO projects(id, workspace_id, name, path, created_at, updated_at, last_opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,
               name=excluded.name, path=excluded.path, updated_at=excluded.updated_at,
               last_opened_at=excluded.last_opened_at",
            params![id, input.workspace_id, input.name.trim(), path.to_string_lossy(), timestamp],
        )
        .map_err(|error| database_error("saving project", error))?;
    drop(database);
    list_projects(state)?
        .into_iter()
        .find(|project| project.id == id)
        .ok_or_else(|| "Saved project could not be reloaded".into())
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting project", error))?;
    Ok(())
}

fn build_tree(path: &Path, depth: usize) -> Vec<FileTreeNode> {
    if depth > 5 {
        return Vec::new();
    }
    let mut entries = match fs::read_dir(path) {
        Ok(entries) => entries.filter_map(Result::ok).collect::<Vec<_>>(),
        Err(_) => return Vec::new(),
    };
    entries.sort_by_key(|entry| (!entry.path().is_dir(), entry.file_name()));
    entries
        .into_iter()
        .filter(|entry| {
            !matches!(
                entry.file_name().to_string_lossy().as_ref(),
                ".git" | "node_modules" | "target" | ".DS_Store"
            )
        })
        .take(500)
        .map(|entry| {
            let entry_path = entry.path();
            let is_directory = entry_path.is_dir();
            FileTreeNode {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry_path.to_string_lossy().to_string(),
                is_directory,
                children: if is_directory {
                    build_tree(&entry_path, depth + 1)
                } else {
                    Vec::new()
                },
            }
        })
        .collect()
}

#[tauri::command]
pub fn read_file_tree(path: String) -> Result<Vec<FileTreeNode>, String> {
    let path = Path::new(&path);
    if !path.is_dir() {
        return Err(format!(
            "Project directory is unavailable: {}",
            path.display()
        ));
    }
    Ok(build_tree(path, 0))
}

#[tauri::command]
pub fn list_conversations(
    state: State<'_, AppState>,
    search: Option<String>,
) -> Result<Vec<ConversationRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let query = search.unwrap_or_default();
    let pattern = format!("%{}%", query.trim());
    let mut statement = database
        .prepare(
            "SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
                    COUNT(m.id), MAX(CASE WHEN m.role = 'user' THEN m.content END)
             FROM conversations c
             LEFT JOIN messages m ON m.conversation_id = c.id
             WHERE c.title LIKE ?1 OR m.content LIKE ?1
             GROUP BY c.id ORDER BY c.updated_at DESC",
        )
        .map_err(|error| database_error("preparing conversations", error))?;
    let records = statement
        .query_map([pattern], |row| {
            Ok(ConversationRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                model: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                message_count: row.get(5)?,
                preview: row.get(6)?,
            })
        })
        .map_err(|error| database_error("reading conversations", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading conversations", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_conversation(
    state: State<'_, AppState>,
    input: ConversationInput,
) -> Result<ConversationRecord, String> {
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO conversations(id, title, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, model=excluded.model,
               updated_at=excluded.updated_at",
            params![id, input.title.trim(), input.model, timestamp],
        )
        .map_err(|error| database_error("saving conversation", error))?;
    drop(database);
    list_conversations(state, None)?
        .into_iter()
        .find(|conversation| conversation.id == id)
        .ok_or_else(|| "Saved conversation could not be reloaded".into())
}

#[tauri::command]
pub fn delete_conversation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM conversations WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting conversation", error))?;
    Ok(())
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<MessageRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, conversation_id, role, content, attachments_json, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|error| database_error("preparing messages", error))?;
    let records = statement
        .query_map([conversation_id], |row| {
            Ok(MessageRecord {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                attachments_json: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|error| database_error("reading messages", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading messages", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_message(
    state: State<'_, AppState>,
    input: MessageInput,
) -> Result<MessageRecord, String> {
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let attachments = input.attachments_json.unwrap_or_else(|| "[]".into());
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting message update", error))?;
    transaction
        .execute(
            "INSERT INTO messages(id, conversation_id, role, content, attachments_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET content=excluded.content,
               attachments_json=excluded.attachments_json",
            params![
                id,
                input.conversation_id,
                input.role,
                input.content,
                attachments,
                timestamp
            ],
        )
        .map_err(|error| database_error("saving message", error))?;
    transaction
        .execute(
            "UPDATE conversations SET updated_at = ?2 WHERE id = ?1",
            params![input.conversation_id, timestamp],
        )
        .map_err(|error| database_error("updating conversation", error))?;
    transaction
        .commit()
        .map_err(|error| database_error("committing message", error))?;
    Ok(MessageRecord {
        id,
        conversation_id: input.conversation_id,
        role: input.role,
        content: input.content,
        attachments_json: attachments,
        created_at: timestamp,
    })
}

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>) -> Result<Vec<TaskRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, kind, title, status, progress, started_at, ended_at, logs,
                    created_at, updated_at FROM tasks ORDER BY created_at DESC",
        )
        .map_err(|error| database_error("preparing tasks", error))?;
    let records = statement
        .query_map([], |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                status: row.get(3)?,
                progress: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                logs: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| database_error("reading tasks", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading tasks", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_task(state: State<'_, AppState>, input: TaskInput) -> Result<TaskRecord, String> {
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let logs = input.logs.unwrap_or_default();
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO tasks(id, kind, title, status, progress, started_at, ended_at,
                               logs, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET status=excluded.status, progress=excluded.progress,
               started_at=excluded.started_at, ended_at=excluded.ended_at,
               logs=excluded.logs, updated_at=excluded.updated_at",
            params![
                id,
                input.kind,
                input.title,
                input.status,
                input.progress.clamp(0.0, 100.0),
                input.started_at,
                input.ended_at,
                logs,
                timestamp
            ],
        )
        .map_err(|error| database_error("saving task", error))?;
    drop(database);
    list_tasks(state)?
        .into_iter()
        .find(|task| task.id == id)
        .ok_or_else(|| "Saved task could not be reloaded".into())
}

#[tauri::command]
pub fn clear_finished_tasks(state: State<'_, AppState>) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "DELETE FROM tasks WHERE status IN ('completed', 'failed', 'cancelled')",
            [],
        )
        .map_err(|error| database_error("clearing finished tasks", error))?;
    Ok(())
}

#[tauri::command]
pub fn list_logs(state: State<'_, AppState>, limit: Option<u32>) -> Result<Vec<LogRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, category, level, message, details, created_at
             FROM logs ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|error| database_error("preparing logs", error))?;
    let records = statement
        .query_map([limit.unwrap_or(200)], |row| {
            Ok(LogRecord {
                id: row.get(0)?,
                category: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                details: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|error| database_error("reading logs", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading logs", error))?;
    Ok(records)
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppState>) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM logs", [])
        .map_err(|error| database_error("clearing logs", error))?;
    Ok(())
}

pub fn add_log(
    state: &AppState,
    category: &str,
    level: &str,
    message: &str,
    details: Option<&str>,
) {
    if let Ok(database) = state.database.lock() {
        let _ = database.execute(
            "INSERT INTO logs(category, level, message, details, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![category, level, message, details, now()],
        );
    }
}

pub fn update_server_diagnostics(
    state: &AppState,
    server_id: &str,
    status: &str,
    ping_ms: Option<i64>,
    version: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    let timestamp = now();
    let history_id = Uuid::new_v4().to_string();
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting diagnostics update", error))?;
    transaction
        .execute(
            "UPDATE servers SET last_status=?2, last_ping_ms=?3, last_version=?4,
              last_error=?5, last_tested_at=?6, updated_at=?6 WHERE id=?1",
            params![server_id, status, ping_ms, version, error, timestamp],
        )
        .map_err(|error| database_error("saving diagnostics", error))?;
    transaction
        .execute(
            "INSERT INTO connection_history(id, server_id, status, ping_ms, version, error, tested_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                history_id,
                server_id,
                status,
                ping_ms,
                version,
                error,
                timestamp
            ],
        )
        .map_err(|error| database_error("saving connection history", error))?;
    transaction
        .commit()
        .map_err(|error| database_error("committing diagnostics", error))
}

#[tauri::command]
pub fn get_active_server(state: State<'_, AppState>) -> Result<Option<ServerRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .query_row(
            "SELECT id, name, url, is_active, last_status, last_ping_ms, last_version,
                    last_error, last_tested_at, created_at, updated_at
             FROM servers WHERE is_active = 1 LIMIT 1",
            [],
            map_server,
        )
        .optional()
        .map_err(|error| database_error("reading active server", error))
}
