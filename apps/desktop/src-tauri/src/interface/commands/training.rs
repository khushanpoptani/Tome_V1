use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use reqwest::header::{CONTENT_RANGE, CONTENT_TYPE};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{
    domain::records::{
        DatabaseResetResult, DatasetExclusion, DatasetUploadRecord, TrainingDatasetGroupInput,
        TrainingDatasetGroupRecord, TrainingDatasetInput, TrainingDatasetRecord, TrainingJobInput,
        TrainingJobRecord, TrainingLogRecord, TrainingPreflightResult, TrainingResourceRecord,
        TrainingServerInput, TrainingServerRecord,
    },
    infrastructure::state::AppState,
    interface::commands::data::add_log,
};

const DEFAULT_FORMATS: &[&str] = &["jsonl", "json", "csv", "parquet", "txt", "md"];
const DEFAULT_CHUNK_SIZE: i64 = 4 * 1024 * 1024;

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn database_error(context: &str, error: rusqlite::Error) -> String {
    format!("Database error while {context}: {error}")
}

fn api_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn request_error_details(error: &reqwest::Error) -> String {
    let mut details = vec![error.to_string()];
    let mut source = std::error::Error::source(error);
    while let Some(value) = source {
        let message = value.to_string();
        if !details.contains(&message) {
            details.push(message);
        }
        source = value.source();
    }
    details.join(": ")
}

fn map_training_server(row: &Row<'_>) -> rusqlite::Result<TrainingServerRecord> {
    Ok(TrainingServerRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        adapter: row.get(3)?,
        is_active: row.get::<_, i64>(4)? != 0,
        status: row.get(5)?,
        version: row.get(6)?,
        capabilities_json: row.get(7)?,
        last_error: row.get(8)?,
        last_checked_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_dataset(row: &Row<'_>) -> rusqlite::Result<TrainingDatasetRecord> {
    Ok(TrainingDatasetRecord {
        id: row.get(0)?,
        group_id: row.get(16)?,
        name: row.get(1)?,
        source_path: row.get(2)?,
        artifact_path: row.get(3)?,
        format: row.get(4)?,
        size: row.get(5)?,
        file_count: row.get(6)?,
        checksum: row.get(7)?,
        compressed: row.get::<_, i64>(8)? != 0,
        validation_status: row.get(9)?,
        validation_errors_json: row.get(10)?,
        preview: row.get(11)?,
        remote_dataset_id: row.get(12)?,
        training_server_id: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        exclusions_json: row.get(17)?,
    })
}

fn map_dataset_group(row: &Row<'_>) -> rusqlite::Result<TrainingDatasetGroupRecord> {
    Ok(TrainingDatasetGroupRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn map_upload(row: &Row<'_>) -> rusqlite::Result<DatasetUploadRecord> {
    Ok(DatasetUploadRecord {
        id: row.get(0)?,
        dataset_id: row.get(1)?,
        training_server_id: row.get(2)?,
        remote_upload_id: row.get(3)?,
        status: row.get(4)?,
        bytes_uploaded: row.get(5)?,
        total_bytes: row.get(6)?,
        chunk_size: row.get(7)?,
        speed_bps: row.get(8)?,
        eta_seconds: row.get(9)?,
        retry_count: row.get(10)?,
        last_error: row.get(11)?,
        started_at: row.get(12)?,
        finished_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn map_job(row: &Row<'_>) -> rusqlite::Result<TrainingJobRecord> {
    let dataset_id = row.get::<_, String>(3)?;
    let dataset_ids_json = row.get::<_, String>(4)?;
    let mut dataset_ids =
        serde_json::from_str::<Vec<String>>(&dataset_ids_json).unwrap_or_default();
    if dataset_ids.is_empty() {
        dataset_ids.push(dataset_id.clone());
    }
    Ok(TrainingJobRecord {
        id: row.get(0)?,
        training_server_id: row.get(1)?,
        remote_job_id: row.get(2)?,
        dataset_id,
        dataset_ids,
        model: row.get(5)?,
        base_model: row.get(6)?,
        backend: row.get(7)?,
        parameters_json: row.get(8)?,
        status: row.get(9)?,
        stage: row.get(10)?,
        progress: row.get(11)?,
        eta_seconds: row.get(12)?,
        started_at: row.get(13)?,
        finished_at: row.get(14)?,
        gpu_usage: row.get(15)?,
        cpu_usage: row.get(16)?,
        ram_usage: row.get(17)?,
        disk_usage: row.get(18)?,
        current_epoch: row.get(19)?,
        total_epochs: row.get(20)?,
        loss: row.get(21)?,
        learning_rate: row.get(22)?,
        training_speed: row.get(23)?,
        heartbeat_at: row.get(24)?,
        warning: row.get(25)?,
        error: row.get(26)?,
        retry_of: row.get(27)?,
        created_at: row.get(28)?,
        updated_at: row.get(29)?,
    })
}

#[tauri::command]
pub fn list_training_servers(
    state: State<'_, AppState>,
) -> Result<Vec<TrainingServerRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, name, url, adapter, is_active, status, version,
                    capabilities_json, last_error, last_checked_at, created_at, updated_at
             FROM training_servers ORDER BY is_active DESC, updated_at DESC",
        )
        .map_err(|error| database_error("preparing training servers", error))?;
    let records = statement
        .query_map([], map_training_server)
        .map_err(|error| database_error("reading training servers", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading training servers", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_training_server(
    state: State<'_, AppState>,
    input: TrainingServerInput,
) -> Result<TrainingServerRecord, String> {
    let url = input.url.trim_end_matches('/').to_owned();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Training server URL must start with http:// or https://".into());
    }
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting training server update", error))?;
    if input.is_active {
        transaction
            .execute("UPDATE training_servers SET is_active = 0", [])
            .map_err(|error| database_error("clearing active training server", error))?;
    }
    transaction
        .execute(
            "INSERT INTO training_servers(
                id, name, url, adapter, is_active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, url=excluded.url, adapter=excluded.adapter,
                is_active=excluded.is_active, updated_at=excluded.updated_at",
            params![
                id,
                input.name.trim(),
                url,
                input.adapter.unwrap_or_else(|| "tome-training-v1".into()),
                i64::from(input.is_active),
                timestamp
            ],
        )
        .map_err(|error| database_error("saving training server", error))?;
    transaction
        .commit()
        .map_err(|error| database_error("committing training server", error))?;
    drop(database);
    list_training_servers(state)?
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "Saved training server could not be reloaded".into())
}

#[tauri::command]
pub fn set_active_training_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting active training server update", error))?;
    transaction
        .execute("UPDATE training_servers SET is_active = 0", [])
        .map_err(|error| database_error("clearing active training server", error))?;
    let affected = transaction
        .execute(
            "UPDATE training_servers SET is_active = 1, updated_at = ?2 WHERE id = ?1",
            params![id, now()],
        )
        .map_err(|error| database_error("setting active training server", error))?;
    if affected == 0 {
        return Err("The selected training server no longer exists".into());
    }
    transaction
        .commit()
        .map_err(|error| database_error("committing active training server", error))
}

#[tauri::command]
pub fn delete_training_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let affected = database
        .execute("DELETE FROM training_servers WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting training server", error))?;
    if affected == 0 {
        return Err("The selected training server no longer exists".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn test_training_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<TrainingServerRecord, String> {
    let server = list_training_servers(state.clone())?
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| "The selected training server no longer exists".to_string())?;
    let health = state
        .http
        .get(api_url(&server.url, "/v1/health"))
        .send()
        .await;
    let checked_at = now();
    let (status, version, capabilities, error) = match health {
        Ok(response) if response.status().is_success() => {
            let health_json = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
            match state
                .http
                .get(api_url(&server.url, "/v1/capabilities"))
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {
                    let capabilities = response
                        .json::<Value>()
                        .await
                        .unwrap_or_else(|_| json!({}));
                    (
                        "connected",
                        health_json["version"].as_str().map(ToOwned::to_owned),
                        capabilities.to_string(),
                        None,
                    )
                }
                Ok(response) => (
                    "degraded",
                    health_json["version"].as_str().map(ToOwned::to_owned),
                    "{}".into(),
                    Some(format!(
                        "Training server capability request returned HTTP {}",
                        response.status()
                    )),
                ),
                Err(error) => (
                    "degraded",
                    health_json["version"].as_str().map(ToOwned::to_owned),
                    "{}".into(),
                    Some(format!("Training server capabilities are unavailable: {error}")),
                ),
            }
        }
        Ok(response) => (
            "disconnected",
            None,
            "{}".into(),
            Some(format!(
                "Training server health request returned HTTP {}",
                response.status()
            )),
        ),
        Err(error) => (
            "disconnected",
            None,
            "{}".into(),
            Some(format!(
                "Could not reach {}. Confirm the external Training Manager is running and accessible: {error}",
                server.url
            )),
        ),
    };
    {
        let database = state.database.lock().map_err(|value| value.to_string())?;
        database
            .execute(
                "UPDATE training_servers SET status=?2, version=?3,
                    capabilities_json=?4, last_error=?5, last_checked_at=?6,
                    updated_at=?6 WHERE id=?1",
                params![id, status, version, capabilities, error, checked_at],
            )
            .map_err(|value| database_error("saving training server diagnostics", value))?;
    }
    add_log(
        &state,
        "training-server",
        if status == "connected" {
            "info"
        } else {
            "error"
        },
        "Training server connection test",
        error.as_deref().or(Some(&server.url)),
    );
    list_training_servers(state)?
        .into_iter()
        .find(|value| value.id == id)
        .ok_or_else(|| "Tested training server could not be reloaded".into())
}

#[tauri::command]
pub async fn reset_training_manager_database(
    state: State<'_, AppState>,
    training_server_id: String,
    confirmation: String,
) -> Result<DatabaseResetResult, String> {
    if !matches!(
        confirmation.as_str(),
        "RESET SERVER DATABASE" | "RESET BOTH DATABASES"
    ) {
        return Err(
            "Type RESET SERVER DATABASE or RESET BOTH DATABASES exactly to confirm this reset"
                .into(),
        );
    }
    let server = list_training_servers(state.clone())?
        .into_iter()
        .find(|server| server.id == training_server_id)
        .ok_or_else(|| "The selected training server no longer exists".to_string())?;
    let response = state
        .http
        .post(api_url(&server.url, "/v1/admin/database/reset"))
        .timeout(Duration::from_secs(600))
        .json(&json!({ "confirmation": confirmation }))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not reset the Training Manager at {}: {}",
                server.url,
                request_error_details(&error)
            )
        })?;
    if !response.status().is_success() {
        return Err(response_failure(response, "Resetting the Training Manager database").await);
    }
    let result = response
        .json::<DatabaseResetResult>()
        .await
        .map_err(|error| format!("Training Manager returned an invalid reset response: {error}"))?;
    add_log(
        &state,
        "training-server",
        "warning",
        "Training Manager database reset",
        Some(&format!(
            "{} record(s) removed from {}",
            result.deleted_records, server.name
        )),
    );
    Ok(result)
}

#[derive(Debug)]
struct DatasetInspection {
    artifact_path: Option<String>,
    checksum: Option<String>,
    compressed: bool,
    file_count: i64,
    format: String,
    preview: Option<String>,
    size: i64,
    status: String,
    issues: Vec<DatasetValidationIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DatasetValidationIssue {
    id: String,
    severity: String,
    code: String,
    message: String,
    file: Option<String>,
    row: Option<usize>,
    can_exclude_row: bool,
    can_exclude_file: bool,
}

#[derive(Debug)]
struct InspectionProgress {
    stage: &'static str,
    message: String,
    progress: f64,
    bytes_processed: i64,
    total_bytes: i64,
    current_file: Option<String>,
}

#[derive(Debug, Default)]
struct DatasetRecordStats {
    source_records: usize,
    usable_records: usize,
    excluded_records: usize,
}

fn collect_dataset_files(
    root: &Path,
    path: &Path,
    formats: &[String],
    output: &mut Vec<(PathBuf, String)>,
) {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return,
    };
    if metadata.file_type().is_symlink() {
        return;
    }
    if metadata.is_file() {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if formats.iter().any(|format| format == &extension) {
            let relative = path
                .strip_prefix(root)
                .ok()
                .filter(|value| !value.as_os_str().is_empty())
                .unwrap_or_else(|| path.file_name().map(Path::new).unwrap_or(path))
                .to_string_lossy()
                .to_string();
            output.push((path.to_path_buf(), relative));
        }
        return;
    }
    if !metadata.is_dir() {
        return;
    }
    let mut entries = match fs::read_dir(path) {
        Ok(entries) => entries.filter_map(Result::ok).collect::<Vec<_>>(),
        Err(_) => return,
    };
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.')
            || matches!(name.as_ref(), "node_modules" | "target" | "__pycache__")
        {
            continue;
        }
        collect_dataset_files(root, &entry.path(), formats, output);
    }
}

fn issue(
    severity: &str,
    code: &str,
    message: String,
    file: Option<&str>,
    row: Option<usize>,
    can_exclude_row: bool,
) -> DatasetValidationIssue {
    let file_value = file.map(ToOwned::to_owned);
    DatasetValidationIssue {
        id: format!(
            "{severity}:{code}:{}:{}",
            file.unwrap_or("dataset"),
            row.map_or_else(|| "file".into(), |value| value.to_string())
        ),
        severity: severity.into(),
        code: code.into(),
        message,
        file: file_value,
        row,
        can_exclude_row,
        can_exclude_file: file.is_some(),
    }
}

fn push_validation_issue(issues: &mut Vec<DatasetValidationIssue>, value: DatasetValidationIssue) {
    const MAX_WARNINGS: usize = 200;
    const MAX_TOTAL_ISSUES: usize = 400;
    if issues.len() < MAX_TOTAL_ISSUES && (value.severity == "error" || issues.len() < MAX_WARNINGS)
    {
        issues.push(value);
    }
}

fn training_record_issue_code(value: &Value) -> Option<&'static str> {
    let Some(record) = value.as_object() else {
        return Some("record_not_object");
    };
    let non_empty_string = |key: &str| {
        record
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    };
    let has_direct_text = non_empty_string("text");
    let has_pair = (non_empty_string("prompt") && non_empty_string("response"))
        || (non_empty_string("instruction") && non_empty_string("output"));
    let has_messages = record
        .get("messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| {
            messages.iter().any(|message| {
                message
                    .as_object()
                    .and_then(|value| value.get("content"))
                    .and_then(Value::as_str)
                    .is_some_and(|content| !content.trim().is_empty())
            })
        });
    if has_direct_text || has_pair || has_messages {
        None
    } else {
        Some("unrecognized_training_fields")
    }
}

fn validate_training_record(
    value: &Value,
    relative: &str,
    row: usize,
    can_exclude_row: bool,
    excluded_issue_codes: &HashSet<String>,
    issues: &mut Vec<DatasetValidationIssue>,
    stats: &mut DatasetRecordStats,
) {
    stats.source_records += 1;
    let Some(code) = training_record_issue_code(value) else {
        stats.usable_records += 1;
        return;
    };
    if excluded_issue_codes.contains(code) {
        stats.excluded_records += 1;
        return;
    }
    let Some(record) = value.as_object() else {
        push_validation_issue(
            issues,
            issue(
                "error",
                "record_not_object",
                format!("{relative} row {row}: training record must be a JSON object"),
                Some(relative),
                Some(row),
                can_exclude_row,
            ),
        );
        return;
    };
    let fields = record
        .keys()
        .take(10)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    push_validation_issue(issues, issue(
        "warning",
        "unrecognized_training_fields",
        format!(
            "{relative} row {row}: no text, prompt/response, instruction/output, or messages fields were found. Configure field mapping before training or exclude this record. Available fields: {}",
            if fields.is_empty() { "none" } else { &fields }
        ),
        Some(relative),
        Some(row),
        can_exclude_row,
    ));
}

fn validate_structured_file(
    path: &Path,
    relative: &str,
    extension: &str,
    excluded_rows: &HashSet<usize>,
    excluded_issue_codes: &HashSet<String>,
    issues: &mut Vec<DatasetValidationIssue>,
    stats: &mut DatasetRecordStats,
) -> String {
    if !matches!(extension, "json" | "jsonl") {
        return extension.to_string();
    }
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            push_validation_issue(
                issues,
                issue(
                    "error",
                    "file_unreadable",
                    format!("{relative}: could not be read ({error})"),
                    Some(relative),
                    None,
                    false,
                ),
            );
            return extension.to_string();
        }
    };
    let line_oriented_json = if extension == "jsonl" {
        true
    } else {
        let mut non_empty_lines = BufReader::new(&file)
            .lines()
            .map_while(Result::ok)
            .filter(|line| !line.trim().is_empty());
        let first = non_empty_lines.next();
        let second_exists = non_empty_lines.next().is_some();
        first.is_some_and(|line| {
            !line.trim_start().starts_with('[')
                && serde_json::from_str::<Value>(&line).is_ok()
                && second_exists
        })
    };
    drop(file);
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            push_validation_issue(
                issues,
                issue(
                    "error",
                    "file_unreadable",
                    format!("{relative}: could not be read ({error})"),
                    Some(relative),
                    None,
                    false,
                ),
            );
            return extension.to_string();
        }
    };
    if line_oriented_json {
        let mut record_count = 0_usize;
        for (index, line) in BufReader::new(file).lines().enumerate() {
            let line_number = index + 1;
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    push_validation_issue(
                        issues,
                        issue(
                            "error",
                            "row_unreadable",
                            format!("{relative} line {line_number}: could not be read ({error})"),
                            Some(relative),
                            Some(line_number),
                            true,
                        ),
                    );
                    continue;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            if excluded_rows.contains(&line_number) {
                stats.source_records += 1;
                stats.excluded_records += 1;
                continue;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(value) => {
                    record_count += 1;
                    validate_training_record(
                        &value,
                        relative,
                        line_number,
                        true,
                        excluded_issue_codes,
                        issues,
                        stats,
                    );
                }
                Err(error) => {
                    stats.source_records += 1;
                    if excluded_issue_codes.contains("invalid_json") {
                        stats.excluded_records += 1;
                    } else {
                        push_validation_issue(
                            issues,
                            issue(
                                "error",
                                "invalid_json",
                                format!(
                                    "{relative} line {line_number}: invalid JSON record ({error})"
                                ),
                                Some(relative),
                                Some(line_number),
                                true,
                            ),
                        );
                    }
                }
            }
        }
        if record_count == 0
            && !issues
                .iter()
                .any(|value| value.file.as_deref() == Some(relative))
        {
            push_validation_issue(
                issues,
                issue(
                    "error",
                    "no_records",
                    format!("{relative} contains no JSON records"),
                    Some(relative),
                    None,
                    false,
                ),
            );
        }
        return if extension == "json" {
            "jsonl".into()
        } else {
            extension.to_string()
        };
    }
    let values = serde_json::Deserializer::from_reader(BufReader::new(file)).into_iter::<Value>();
    let mut record_count = 0_usize;
    for value in values {
        match value {
            Ok(Value::Array(records)) => {
                for (index, record) in records.iter().enumerate() {
                    let row = index + 1;
                    if excluded_rows.contains(&row) {
                        stats.source_records += 1;
                        stats.excluded_records += 1;
                        continue;
                    }
                    record_count += 1;
                    validate_training_record(
                        record,
                        relative,
                        row,
                        true,
                        excluded_issue_codes,
                        issues,
                        stats,
                    );
                }
            }
            Ok(value) => {
                record_count += 1;
                if excluded_rows.contains(&record_count) {
                    stats.source_records += 1;
                    stats.excluded_records += 1;
                    continue;
                }
                validate_training_record(
                    &value,
                    relative,
                    record_count,
                    true,
                    excluded_issue_codes,
                    issues,
                    stats,
                );
            }
            Err(error) => {
                let format = if extension == "jsonl" || record_count > 0 {
                    "NDJSON"
                } else {
                    "JSON"
                };
                stats.source_records += 1;
                if excluded_issue_codes.contains("invalid_json") {
                    stats.excluded_records += 1;
                } else {
                    push_validation_issue(
                        issues,
                        issue(
                            "error",
                            "invalid_json",
                            format!(
                                "{relative} line {}: invalid {format} record ({error})",
                                error.line()
                            ),
                            Some(relative),
                            Some(error.line()),
                            record_count > 0,
                        ),
                    );
                }
                break;
            }
        }
    }
    if record_count == 0
        && !issues
            .iter()
            .any(|value| value.file.as_deref() == Some(relative))
    {
        push_validation_issue(
            issues,
            issue(
                "error",
                "no_records",
                format!("{relative} contains no JSON records"),
                Some(relative),
                None,
                false,
            ),
        );
    }
    if extension == "json" && record_count > 1 {
        "jsonl".into()
    } else {
        extension.to_string()
    }
}

fn write_dataset_file(
    path: &Path,
    relative: &str,
    excluded_rows: &HashSet<usize>,
    excluded_issue_codes: &HashSet<String>,
    output: &mut impl Write,
) -> Result<(), String> {
    if excluded_rows.is_empty() && excluded_issue_codes.is_empty() {
        let mut source = File::open(path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        std::io::copy(&mut source, output)
            .map_err(|error| format!("Could not copy {}: {error}", path.display()))?;
        return Ok(());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !matches!(extension.as_str(), "jsonl" | "json" | "csv" | "txt" | "md") {
        return Err(format!(
            "Rows cannot be excluded from {relative}; exclude the complete file instead"
        ));
    }
    if extension == "json" {
        let source = File::open(path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        if let Ok(value) = serde_json::from_reader::<_, Value>(BufReader::new(source)) {
            let cleaned = match value {
                Value::Array(records) => Value::Array(
                    records
                        .into_iter()
                        .enumerate()
                        .filter_map(|(index, record)| {
                            let row = index + 1;
                            let excluded_by_rule = training_record_issue_code(&record)
                                .is_some_and(|code| excluded_issue_codes.contains(code));
                            (!excluded_rows.contains(&row) && !excluded_by_rule).then_some(record)
                        })
                        .collect(),
                ),
                value => {
                    let excluded_by_rule = training_record_issue_code(&value)
                        .is_some_and(|code| excluded_issue_codes.contains(code));
                    if excluded_rows.contains(&1) || excluded_by_rule {
                        Value::Array(Vec::new())
                    } else {
                        value
                    }
                }
            };
            serde_json::to_writer(output, &cleaned)
                .map_err(|error| format!("Could not write cleaned {relative}: {error}"))?;
            return Ok(());
        }
    }
    let source =
        File::open(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    for (index, line) in BufReader::new(source).split(b'\n').enumerate() {
        let row = index + 1;
        if excluded_rows.contains(&row) {
            continue;
        }
        let line = line.map_err(|error| format!("Could not read {relative} row {row}: {error}"))?;
        if !excluded_issue_codes.is_empty() && matches!(extension.as_str(), "jsonl" | "json") {
            match serde_json::from_slice::<Value>(&line) {
                Ok(value)
                    if training_record_issue_code(&value)
                        .is_some_and(|code| excluded_issue_codes.contains(code)) =>
                {
                    continue;
                }
                Err(_) if excluded_issue_codes.contains("invalid_json") => continue,
                _ => {}
            }
        }
        output
            .write_all(&line)
            .and_then(|_| output.write_all(b"\n"))
            .map_err(|error| format!("Could not write cleaned {relative}: {error}"))?;
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Could not open upload artifact: {error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not checksum upload artifact: {error}"))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn inspect_dataset(
    id: &str,
    source_path: &Path,
    formats: &[String],
    compress: bool,
    exclusions: &[DatasetExclusion],
    data_dir: &Path,
    mut on_progress: impl FnMut(InspectionProgress),
) -> Result<DatasetInspection, String> {
    on_progress(InspectionProgress {
        stage: "Preparing Dataset",
        message: "Reading dataset metadata".into(),
        progress: 2.0,
        bytes_processed: 0,
        total_bytes: 0,
        current_file: None,
    });
    if !source_path.exists() {
        return Err(format!(
            "Dataset path does not exist: {}",
            source_path.display()
        ));
    }
    let root = if source_path.is_dir() {
        source_path
    } else {
        source_path.parent().unwrap_or_else(|| Path::new("."))
    };
    let mut files = Vec::new();
    on_progress(InspectionProgress {
        stage: "Scanning Files",
        message: "Discovering supported files".into(),
        progress: 8.0,
        bytes_processed: 0,
        total_bytes: 0,
        current_file: None,
    });
    collect_dataset_files(root, source_path, formats, &mut files);
    let excluded_files = exclusions
        .iter()
        .filter(|value| value.row.is_none() && value.issue_code.is_none())
        .map(|value| value.file.replace('\\', "/"))
        .collect::<HashSet<_>>();
    let excluded_rows = exclusions
        .iter()
        .filter(|value| value.issue_code.is_none())
        .filter_map(|value| value.row.map(|row| (value.file.replace('\\', "/"), row)))
        .fold(
            HashMap::<String, HashSet<usize>>::new(),
            |mut rows, (file, row)| {
                rows.entry(file).or_default().insert(row);
                rows
            },
        );
    let excluded_issue_codes = exclusions
        .iter()
        .filter_map(|value| value.issue_code.as_deref())
        .map(ToOwned::to_owned)
        .collect::<HashSet<_>>();
    files.retain(|(_, relative)| !excluded_files.contains(&relative.replace('\\', "/")));
    on_progress(InspectionProgress {
        stage: "Counting Files",
        message: format!("Found {} supported files", files.len()),
        progress: 18.0,
        bytes_processed: 0,
        total_bytes: 0,
        current_file: None,
    });
    if files.is_empty() {
        return Ok(DatasetInspection {
            artifact_path: None,
            checksum: None,
            compressed: false,
            file_count: 0,
            format: "unknown".into(),
            preview: None,
            size: 0,
            status: "invalid".into(),
            issues: vec![issue(
                "error",
                "no_supported_files",
                format!(
                    "No supported dataset files remain. Supported formats: {}",
                    formats.join(", ")
                ),
                None,
                None,
                false,
            )],
        });
    }
    let mut issues = Vec::new();
    let mut total_size = 0_i64;
    let mut extensions = Vec::new();
    let mut preview = None;
    let mut file_sizes = Vec::with_capacity(files.len());
    let mut record_stats = DatasetRecordStats::default();
    for (index, (path, relative)) in files.iter().enumerate() {
        let metadata = fs::metadata(path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        file_sizes.push(metadata.len() as i64);
        if metadata.len() == 0 {
            push_validation_issue(
                &mut issues,
                issue(
                    "error",
                    "empty_file",
                    format!("{relative} is empty"),
                    Some(relative),
                    None,
                    false,
                ),
            );
        }
        total_size = total_size.saturating_add(metadata.len() as i64);
        if index == 0 || index + 1 == files.len() || index % 100 == 0 {
            on_progress(InspectionProgress {
                stage: "Calculating Total Size",
                message: format!("Measured {} of {} files", index + 1, files.len()),
                progress: 18.0 + ((index + 1) as f64 / files.len() as f64) * 12.0,
                bytes_processed: total_size,
                total_bytes: 0,
                current_file: Some(path.to_string_lossy().to_string()),
            });
        }
    }
    let mut validated_bytes = 0_i64;
    for (index, ((path, relative), file_size)) in files.iter().zip(file_sizes.iter()).enumerate() {
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let rows = excluded_rows
            .get(&relative.replace('\\', "/"))
            .cloned()
            .unwrap_or_default();
        extensions.push(validate_structured_file(
            path,
            relative,
            &extension,
            &rows,
            &excluded_issue_codes,
            &mut issues,
            &mut record_stats,
        ));
        if preview.is_none()
            && matches!(extension.as_str(), "jsonl" | "json" | "csv" | "txt" | "md")
        {
            let mut file = File::open(path)
                .map_err(|error| format!("Could not preview {}: {error}", path.display()))?;
            let mut bytes = vec![0_u8; 4096];
            let count = file
                .read(&mut bytes)
                .map_err(|error| format!("Could not preview {}: {error}", path.display()))?;
            preview = Some(String::from_utf8_lossy(&bytes[..count]).to_string());
        }
        validated_bytes = validated_bytes.saturating_add(*file_size);
        let reporting_interval = (files.len() / 100).max(1);
        if index == 0 || index + 1 == files.len() || index % reporting_interval == 0 {
            on_progress(InspectionProgress {
                stage: "Validating Structure",
                message: format!("Validated {} of {} files", index + 1, files.len()),
                progress: 30.0 + ((index + 1) as f64 / files.len() as f64) * 30.0,
                bytes_processed: validated_bytes,
                total_bytes: total_size,
                current_file: Some(path.to_string_lossy().to_string()),
            });
        }
    }
    extensions.sort();
    extensions.dedup();
    if record_stats.source_records > 0 && record_stats.usable_records == 0 {
        push_validation_issue(
            &mut issues,
            issue(
                "error",
                "no_training_records",
                format!(
                    "No usable structured training records remain. {} source record(s) were inspected and {} were excluded. Transform the dataset into text, prompt/response, instruction/output, or messages records before training.",
                    record_stats.source_records, record_stats.excluded_records
                ),
                None,
                None,
                false,
            ),
        );
    }
    let format = if extensions.len() == 1 {
        extensions[0].clone()
    } else {
        "mixed".into()
    };

    let should_compress = compress || !exclusions.is_empty();
    let (artifact_path, checksum, size) = if should_compress {
        let artifact_dir = data_dir.join("training").join("datasets");
        fs::create_dir_all(&artifact_dir)
            .map_err(|error| format!("Could not create dataset artifact directory: {error}"))?;
        let artifact = artifact_dir.join(format!("{id}.zip"));
        let file = File::create(&artifact)
            .map_err(|error| format!("Could not create compressed dataset: {error}"))?;
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut compressed_source_bytes = 0_i64;
        for (index, ((path, relative), file_size)) in
            files.iter().zip(file_sizes.iter()).enumerate()
        {
            archive
                .start_file(relative.replace('\\', "/"), options)
                .map_err(|error| format!("Could not add a file to the dataset archive: {error}"))?;
            let rows = excluded_rows
                .get(&relative.replace('\\', "/"))
                .cloned()
                .unwrap_or_default();
            write_dataset_file(path, relative, &rows, &excluded_issue_codes, &mut archive)?;
            compressed_source_bytes = compressed_source_bytes.saturating_add(*file_size);
            let reporting_interval = (files.len() / 100).max(1);
            if index == 0 || index + 1 == files.len() || index % reporting_interval == 0 {
                on_progress(InspectionProgress {
                    stage: "Compressing",
                    message: format!("Compressed {} of {} files", index + 1, files.len()),
                    progress: 60.0 + ((index + 1) as f64 / files.len() as f64) * 30.0,
                    bytes_processed: compressed_source_bytes,
                    total_bytes: total_size,
                    current_file: Some(path.to_string_lossy().to_string()),
                });
            }
        }
        archive
            .finish()
            .map_err(|error| format!("Could not finalize compressed dataset: {error}"))?;
        let size = fs::metadata(&artifact)
            .map_err(|error| format!("Could not inspect compressed dataset: {error}"))?
            .len() as i64;
        (
            Some(artifact.to_string_lossy().to_string()),
            Some(sha256_file(&artifact)?),
            size,
        )
    } else if source_path.is_file() {
        (
            Some(source_path.to_string_lossy().to_string()),
            Some(sha256_file(source_path)?),
            total_size,
        )
    } else {
        (None, None, total_size)
    };
    on_progress(InspectionProgress {
        stage: "Ready for Upload",
        message: if issues.is_empty() {
            "Validation complete".into()
        } else {
            let error_count = issues
                .iter()
                .filter(|value| value.severity == "error")
                .count();
            let warning_count = issues.len().saturating_sub(error_count);
            format!(
                "Validation completed with {error_count} error(s) and {warning_count} warning(s)"
            )
        },
        progress: 100.0,
        bytes_processed: size,
        total_bytes: size,
        current_file: None,
    });
    Ok(DatasetInspection {
        artifact_path,
        checksum,
        compressed: should_compress,
        file_count: files.len() as i64,
        format,
        preview,
        size,
        status: if issues
            .iter()
            .all(|value| value.severity != "error" && value.code != "unrecognized_training_fields")
        {
            "valid".into()
        } else {
            "invalid".into()
        },
        issues,
    })
}

#[tauri::command]
pub fn list_training_dataset_groups(
    state: State<'_, AppState>,
) -> Result<Vec<TrainingDatasetGroupRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, name, created_at, updated_at
             FROM training_dataset_groups
             ORDER BY name COLLATE NOCASE",
        )
        .map_err(|error| database_error("preparing dataset groups", error))?;
    let records = statement
        .query_map([], map_dataset_group)
        .map_err(|error| database_error("reading dataset groups", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading dataset groups", error))?;
    Ok(records)
}

#[tauri::command]
pub fn save_training_dataset_group(
    state: State<'_, AppState>,
    input: TrainingDatasetGroupInput,
) -> Result<TrainingDatasetGroupRecord, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Dataset group name is required".into());
    }
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO training_dataset_groups(id, name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, updated_at=excluded.updated_at",
            params![id, name, timestamp],
        )
        .map_err(|error| database_error("saving dataset group", error))?;
    let group = database
        .query_row(
            "SELECT id, name, created_at, updated_at
             FROM training_dataset_groups WHERE id=?1",
            [id],
            map_dataset_group,
        )
        .map_err(|error| database_error("reloading dataset group", error))?;
    drop(database);
    add_log(
        &state,
        "training-dataset-group",
        "info",
        "Dataset group saved",
        Some(name),
    );
    Ok(group)
}

#[tauri::command]
pub fn delete_training_dataset_group(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let member_count = database
        .query_row(
            "SELECT COUNT(*) FROM training_datasets WHERE group_id=?1",
            [&id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| database_error("checking dataset group", error))?;
    if member_count > 0 {
        return Err("Delete the datasets in this group before deleting the group itself".into());
    }
    let deleted = database
        .execute("DELETE FROM training_dataset_groups WHERE id=?1", [&id])
        .map_err(|error| database_error("deleting dataset group", error))?;
    if deleted == 0 {
        return Err("The selected dataset group no longer exists".into());
    }
    drop(database);
    add_log(
        &state,
        "training-dataset-group",
        "info",
        "Dataset group deleted",
        Some(&id),
    );
    Ok(())
}

#[tauri::command]
pub fn assign_training_datasets_to_group(
    state: State<'_, AppState>,
    group_id: Option<String>,
    dataset_ids: Vec<String>,
) -> Result<(), String> {
    let group_id = group_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let mut unique_ids = Vec::new();
    for id in dataset_ids {
        let id = id.trim();
        if !id.is_empty() && !unique_ids.iter().any(|existing| existing == id) {
            unique_ids.push(id.to_string());
        }
    }
    if unique_ids.is_empty() {
        return Err("Select at least one dataset to add to the group".into());
    }
    let mut database = state.database.lock().map_err(|error| error.to_string())?;
    if let Some(group_id) = &group_id {
        let exists = database
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM training_dataset_groups WHERE id=?1
                 )",
                [group_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| database_error("checking dataset group", error))?
            != 0;
        if !exists {
            return Err("The selected dataset group no longer exists".into());
        }
    }
    let transaction = database
        .transaction()
        .map_err(|error| database_error("starting dataset group assignment", error))?;
    let mut updated = 0;
    let timestamp = now();
    for id in &unique_ids {
        updated += transaction
            .execute(
                "UPDATE training_datasets
                 SET group_id=?2, updated_at=?3
                 WHERE id=?1",
                params![id, group_id, timestamp],
            )
            .map_err(|error| database_error("assigning dataset group", error))?;
    }
    transaction
        .commit()
        .map_err(|error| database_error("committing dataset group assignment", error))?;
    drop(database);
    if updated == 0 {
        return Err("None of the selected datasets still exist".into());
    }
    add_log(
        &state,
        "training-dataset-group",
        "info",
        "Datasets assigned to group",
        Some(&format!("{updated} dataset(s)")),
    );
    Ok(())
}

#[tauri::command]
pub fn list_training_datasets(
    state: State<'_, AppState>,
) -> Result<Vec<TrainingDatasetRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, name, source_path, artifact_path, format, size, file_count,
                    checksum, compressed, validation_status, validation_errors_json,
                    preview, remote_dataset_id, training_server_id, created_at, updated_at,
                    group_id, exclusions_json
             FROM training_datasets ORDER BY updated_at DESC",
        )
        .map_err(|error| database_error("preparing training datasets", error))?;
    let records = statement
        .query_map([], map_dataset)
        .map_err(|error| database_error("reading training datasets", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading training datasets", error))?;
    Ok(records)
}

#[tauri::command]
pub async fn save_training_dataset(
    state: State<'_, AppState>,
    input: TrainingDatasetInput,
    on_event: Channel<TrainingStreamEvent>,
) -> Result<TrainingDatasetRecord, String> {
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let exclusions_json = serde_json::to_string(&input.exclusions)
        .map_err(|error| format!("Could not serialize dataset exclusions: {error}"))?;
    let group_id = input
        .group_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let timestamp = now();
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "INSERT INTO training_datasets(
                    id, name, source_path, format, validation_status,
                    validation_errors_json, compressed, group_id, exclusions_json,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'detecting', 'pending', '[]', ?4, ?5, ?6, ?7, ?7)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, source_path=excluded.source_path,
                    group_id=excluded.group_id,
                    exclusions_json=excluded.exclusions_json,
                    validation_status='pending', validation_errors_json='[]',
                    artifact_path=NULL, checksum=NULL, size=0, file_count=0,
                    remote_dataset_id=NULL, training_server_id=NULL,
                    updated_at=excluded.updated_at",
                params![
                    id,
                    input.name.trim(),
                    input.source_path.trim(),
                    i64::from(input.compress),
                    group_id,
                    exclusions_json,
                    timestamp,
                ],
            )
            .map_err(|error| database_error("creating pending dataset", error))?;
    }
    add_log(
        &state,
        "training-dataset",
        "info",
        "Dataset validation started",
        Some(input.source_path.trim()),
    );
    let source_path = PathBuf::from(input.source_path.trim());
    let formats = input
        .supported_formats
        .clone()
        .filter(|formats| !formats.is_empty())
        .unwrap_or_else(|| DEFAULT_FORMATS.iter().map(ToString::to_string).collect());
    let compress = input.compress;
    let exclusions = input.exclusions.clone();
    let data_dir = state.data_dir.clone();
    let inspection_id = id.clone();
    let operation_id = format!("dataset-prepare:{id}");
    let progress_channel = on_event.clone();
    let inspection_result = tokio::task::spawn_blocking(move || {
        inspect_dataset(
            &inspection_id,
            &source_path,
            &formats
                .into_iter()
                .map(|value| value.trim_start_matches('.').to_lowercase())
                .collect::<Vec<_>>(),
            compress,
            &exclusions,
            &data_dir,
            |progress| {
                let _ = progress_channel.send(TrainingStreamEvent::OperationProgress {
                    operation_id: operation_id.clone(),
                    stage: progress.stage.into(),
                    message: progress.message,
                    progress: progress.progress,
                    bytes_processed: progress.bytes_processed,
                    total_bytes: progress.total_bytes,
                    current_file: progress.current_file,
                });
            },
        )
    })
    .await;
    let inspection = match inspection_result {
        Ok(Ok(inspection)) => inspection,
        Ok(Err(message)) => {
            let errors_json = json!([message]).to_string();
            let database = state.database.lock().map_err(|error| error.to_string())?;
            database
                .execute(
                    "UPDATE training_datasets SET validation_status='invalid',
                        validation_errors_json=?2, updated_at=?3 WHERE id=?1",
                    params![id, errors_json, now()],
                )
                .map_err(|error| database_error("saving dataset validation failure", error))?;
            drop(database);
            add_log(
                &state,
                "training-dataset",
                "error",
                "Dataset validation failed",
                Some(&message),
            );
            let _ = on_event.send(TrainingStreamEvent::Error {
                message: message.clone(),
            });
            return Err(message);
        }
        Err(error) => {
            let message = format!("Dataset validation worker failed: {error}");
            let errors_json = json!([message]).to_string();
            let database = state.database.lock().map_err(|error| error.to_string())?;
            database
                .execute(
                    "UPDATE training_datasets SET validation_status='invalid',
                        validation_errors_json=?2, updated_at=?3 WHERE id=?1",
                    params![id, errors_json, now()],
                )
                .map_err(|error| database_error("saving dataset worker failure", error))?;
            drop(database);
            add_log(
                &state,
                "training-dataset",
                "error",
                "Dataset validation worker failed",
                Some(&message),
            );
            let _ = on_event.send(TrainingStreamEvent::Error {
                message: message.clone(),
            });
            return Err(message);
        }
    };
    let timestamp = now();
    let errors_json = serde_json::to_string(&inspection.issues)
        .map_err(|error| format!("Could not serialize dataset validation results: {error}"))?;
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO training_datasets(
                id, name, source_path, artifact_path, format, size, file_count,
                checksum, compressed, validation_status, validation_errors_json,
                preview, group_id, exclusions_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, source_path=excluded.source_path,
                group_id=excluded.group_id,
                artifact_path=excluded.artifact_path, format=excluded.format,
                size=excluded.size, file_count=excluded.file_count,
                checksum=excluded.checksum, compressed=excluded.compressed,
                validation_status=excluded.validation_status,
                validation_errors_json=excluded.validation_errors_json,
                exclusions_json=excluded.exclusions_json,
                preview=excluded.preview, remote_dataset_id=NULL,
                training_server_id=NULL, updated_at=excluded.updated_at",
            params![
                id,
                input.name.trim(),
                input.source_path.trim(),
                inspection.artifact_path,
                inspection.format,
                inspection.size,
                inspection.file_count,
                inspection.checksum,
                i64::from(inspection.compressed),
                inspection.status,
                errors_json,
                inspection.preview,
                group_id,
                exclusions_json,
                timestamp
            ],
        )
        .map_err(|error| database_error("saving training dataset", error))?;
    drop(database);
    add_log(
        &state,
        "training-dataset",
        if inspection
            .issues
            .iter()
            .all(|value| value.severity != "error")
        {
            "info"
        } else {
            "warning"
        },
        "Dataset validation completed",
        Some(input.source_path.trim()),
    );
    let dataset = list_training_datasets(state)?
        .into_iter()
        .find(|dataset| dataset.id == id)
        .ok_or_else(|| "Saved dataset could not be reloaded".to_string())?;
    let _ = on_event.send(TrainingStreamEvent::Complete {
        message: if dataset.validation_status == "valid" {
            format!("{} is ready for upload", dataset.name)
        } else {
            format!("{} failed validation", dataset.name)
        },
    });
    Ok(dataset)
}

fn delete_local_dataset(
    state: &AppState,
    id: &str,
    artifact_path: Option<&str>,
) -> Result<(), String> {
    if let Some(artifact) = artifact_path {
        let path = PathBuf::from(artifact);
        if path.starts_with(state.data_dir.join("training").join("datasets")) && path.is_file() {
            fs::remove_file(&path)
                .map_err(|error| format!("Could not remove managed dataset artifact: {error}"))?;
        }
    }
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM training_datasets WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting training dataset", error))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_training_dataset(
    state: State<'_, AppState>,
    id: String,
    on_event: Channel<TrainingStreamEvent>,
) -> Result<(), String> {
    let dataset = list_training_datasets(state.clone())?
        .into_iter()
        .find(|dataset| dataset.id == id)
        .ok_or_else(|| "The selected dataset no longer exists".to_string())?;
    let operation_id = format!("dataset-delete:{id}");
    let send_progress = |stage: &str, message: &str, progress: f64| {
        let _ = on_event.send(TrainingStreamEvent::OperationProgress {
            operation_id: operation_id.clone(),
            stage: stage.into(),
            message: message.into(),
            progress,
            bytes_processed: 0,
            total_bytes: dataset.size,
            current_file: None,
        });
    };
    add_log(
        &state,
        "training-dataset",
        "info",
        "Dataset delete started",
        Some(&dataset.name),
    );
    send_progress("Deleting Dataset", "Preparing deletion", 10.0);
    if let (Some(remote_id), Some(server_id)) =
        (&dataset.remote_dataset_id, &dataset.training_server_id)
    {
        send_progress(
            "Removing Remote Dataset",
            "Removing files from the Training Manager",
            35.0,
        );
        if let Some(server) = list_training_servers(state.clone())?
            .into_iter()
            .find(|server| &server.id == server_id)
        {
            match state
                .http
                .delete(api_url(&server.url, &format!("/v1/datasets/{remote_id}")))
                .send()
                .await
            {
                Ok(response)
                    if response.status().is_success()
                        || response.status() == reqwest::StatusCode::NOT_FOUND => {}
                Ok(response) => {
                    let message = response_failure(response, "Deleting the remote dataset").await;
                    add_log(
                        &state,
                        "training-dataset",
                        "error",
                        "Dataset delete failed",
                        Some(&message),
                    );
                    return Err(message);
                }
                Err(error) => {
                    let message = format!(
                        "Could not delete the remote dataset from {}: {error}",
                        server.url
                    );
                    add_log(
                        &state,
                        "training-dataset",
                        "error",
                        "Dataset delete failed",
                        Some(&message),
                    );
                    return Err(message);
                }
            }
        }
    }
    send_progress(
        "Removing Files",
        "Removing the managed local artifact",
        65.0,
    );
    send_progress(
        "Cleaning Metadata",
        "Removing upload and dataset metadata",
        85.0,
    );
    delete_local_dataset(&state, &id, dataset.artifact_path.as_deref())?;
    add_log(
        &state,
        "training-dataset",
        "info",
        "Dataset delete completed",
        Some(&dataset.name),
    );
    send_progress("Completed", "Dataset deleted", 100.0);
    let _ = on_event.send(TrainingStreamEvent::Complete {
        message: format!("{} deleted", dataset.name),
    });
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum TrainingStreamEvent {
    Status {
        message: String,
    },
    UploadProgress {
        upload_id: String,
        bytes_uploaded: i64,
        total_bytes: i64,
        progress: f64,
        speed_bps: f64,
        eta_seconds: Option<i64>,
    },
    OperationProgress {
        operation_id: String,
        stage: String,
        message: String,
        progress: f64,
        bytes_processed: i64,
        total_bytes: i64,
        current_file: Option<String>,
    },
    Complete {
        message: String,
    },
    Error {
        message: String,
    },
    Cancelled,
}

#[tauri::command]
pub fn list_dataset_uploads(
    state: State<'_, AppState>,
) -> Result<Vec<DatasetUploadRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, dataset_id, training_server_id, remote_upload_id, status,
                    bytes_uploaded, total_bytes, chunk_size, speed_bps, eta_seconds,
                    retry_count, last_error, started_at, finished_at, created_at, updated_at
             FROM dataset_uploads ORDER BY created_at DESC",
        )
        .map_err(|error| database_error("preparing dataset uploads", error))?;
    let records = statement
        .query_map([], map_upload)
        .map_err(|error| database_error("reading dataset uploads", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading dataset uploads", error))?;
    Ok(records)
}

struct UploadProgress<'a> {
    id: &'a str,
    status: &'a str,
    remote_upload_id: Option<&'a str>,
    bytes_uploaded: i64,
    total_bytes: i64,
    chunk_size: i64,
    speed_bps: f64,
    eta_seconds: Option<i64>,
    retry_count: i64,
    last_error: Option<&'a str>,
    finished: bool,
}

fn save_upload_progress(state: &AppState, progress: UploadProgress<'_>) -> Result<(), String> {
    let timestamp = now();
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "UPDATE dataset_uploads SET
                status=?2, remote_upload_id=COALESCE(?3, remote_upload_id),
                bytes_uploaded=?4, total_bytes=?5, chunk_size=?6,
                speed_bps=?7, eta_seconds=?8, retry_count=?9, last_error=?10,
                started_at=COALESCE(started_at, ?11),
                finished_at=CASE WHEN ?12 = 1 THEN ?11 ELSE NULL END,
                updated_at=?11
             WHERE id=?1",
            params![
                progress.id,
                progress.status,
                progress.remote_upload_id,
                progress.bytes_uploaded,
                progress.total_bytes,
                progress.chunk_size,
                progress.speed_bps,
                progress.eta_seconds,
                progress.retry_count,
                progress.last_error,
                timestamp,
                i64::from(progress.finished)
            ],
        )
        .map_err(|error| database_error("saving dataset upload progress", error))?;
    Ok(())
}

fn fail_upload(
    state: &AppState,
    on_event: &Channel<TrainingStreamEvent>,
    progress: UploadProgress<'_>,
) -> Result<(), String> {
    let message = progress
        .last_error
        .unwrap_or("The dataset upload failed")
        .to_string();
    let upload_id = progress.id.to_string();
    save_upload_progress(state, progress)?;
    add_log(
        state,
        "training-upload",
        "error",
        "Dataset upload failed",
        Some(&message),
    );
    let _ = on_event.send(TrainingStreamEvent::Error {
        message: message.clone(),
    });
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&upload_id);
    Err(message)
}

async fn response_failure(response: reqwest::Response, operation: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| value["error"].as_str().map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .unwrap_or(body);
    format!("{operation} returned HTTP {status}: {detail}")
}

#[tauri::command]
pub async fn start_dataset_upload(
    state: State<'_, AppState>,
    dataset_id: String,
    training_server_id: String,
    on_event: Channel<TrainingStreamEvent>,
) -> Result<(), String> {
    let (dataset, server) = {
        let datasets = list_training_datasets(state.clone())?;
        let servers = list_training_servers(state.clone())?;
        (
            datasets
                .into_iter()
                .find(|dataset| dataset.id == dataset_id)
                .ok_or_else(|| "The selected dataset no longer exists".to_string())?,
            servers
                .into_iter()
                .find(|server| server.id == training_server_id)
                .ok_or_else(|| "The selected training server no longer exists".to_string())?,
        )
    };
    if dataset.validation_status != "valid" {
        return Err("Only a valid dataset can be uploaded".into());
    }
    let artifact_path = dataset.artifact_path.clone().ok_or_else(|| {
        "Directory datasets must be compressed before upload so Tome has one resumable artifact"
            .to_string()
    })?;
    let checksum = dataset
        .checksum
        .clone()
        .ok_or_else(|| "The dataset artifact has no checksum; validate it again".to_string())?;
    let total_bytes = fs::metadata(&artifact_path)
        .map_err(|error| format!("The dataset artifact is unavailable: {error}"))?
        .len() as i64;
    let artifact_is_zip = dataset.compressed
        || std::path::Path::new(&artifact_path)
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("zip"));
    let upload_name = if artifact_is_zip && !dataset.name.to_ascii_lowercase().ends_with(".zip") {
        format!("{}.zip", dataset.name)
    } else {
        dataset.name.clone()
    };
    let upload_format = if artifact_is_zip {
        "zip"
    } else {
        dataset.format.as_str()
    };

    let existing = list_dataset_uploads(state.clone())?
        .into_iter()
        .find(|upload| {
            upload.dataset_id == dataset.id
                && upload.training_server_id == server.id
                && upload.status != "completed"
                && upload.status != "cancelled"
        });
    let upload_id = existing
        .as_ref()
        .map(|upload| upload.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    if existing.is_none() {
        let timestamp = now();
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "INSERT INTO dataset_uploads(
                    id, dataset_id, training_server_id, status, total_bytes,
                    chunk_size, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?6)",
                params![
                    upload_id,
                    dataset.id,
                    server.id,
                    total_bytes,
                    DEFAULT_CHUNK_SIZE,
                    timestamp
                ],
            )
            .map_err(|error| database_error("creating dataset upload", error))?;
    }
    add_log(
        &state,
        "training-upload",
        "info",
        if existing.is_some() {
            "Dataset upload resumed"
        } else {
            "Dataset upload started"
        },
        Some(&dataset.name),
    );

    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .insert(upload_id.clone(), Arc::clone(&cancellation));
    let _ = on_event.send(TrainingStreamEvent::Status {
        message: "Negotiating a resumable upload session".into(),
    });
    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
        operation_id: upload_id.clone(),
        stage: "Preparing Upload".into(),
        message: "Negotiating a resumable upload session".into(),
        progress: 1.0,
        bytes_processed: existing.as_ref().map_or(0, |upload| upload.bytes_uploaded),
        total_bytes,
        current_file: Some(artifact_path.clone()),
    });
    let mut handshake = None;
    let mut handshake_error = None;
    for attempt in 1..=3 {
        match state
            .http
            .post(api_url(&server.url, "/v1/uploads"))
            .header("Idempotency-Key", &upload_id)
            .json(&json!({
                "clientUploadId": upload_id,
                "datasetId": dataset.id,
                "name": upload_name,
                "format": upload_format,
                "size": total_bytes,
                "sha256": checksum
            }))
            .send()
            .await
        {
            Ok(response) => {
                handshake = Some(response);
                break;
            }
            Err(error) => {
                handshake_error = Some(request_error_details(&error));
                if attempt < 3 {
                    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
                        operation_id: upload_id.clone(),
                        stage: "Reconnecting".into(),
                        message: format!(
                            "Upload server connection failed; retrying handshake ({attempt}/3)"
                        ),
                        progress: 1.0,
                        bytes_processed: existing
                            .as_ref()
                            .map_or(0, |upload| upload.bytes_uploaded),
                        total_bytes,
                        current_file: Some(artifact_path.clone()),
                    });
                    tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
                }
            }
        }
    }
    let handshake = handshake.ok_or_else(|| {
        format!(
            "Could not create a training upload at {} after 3 attempts: {}",
            server.url,
            handshake_error.unwrap_or_else(|| "unknown connection error".into())
        )
    });
    let handshake = match handshake {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            let error = response_failure(response, "Creating the upload session").await;
            save_upload_progress(
                &state,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: None,
                    bytes_uploaded: existing.as_ref().map_or(0, |upload| upload.bytes_uploaded),
                    total_bytes,
                    chunk_size: DEFAULT_CHUNK_SIZE,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count: existing.as_ref().map_or(0, |upload| upload.retry_count),
                    last_error: Some(&error),
                    finished: false,
                },
            )?;
            let _ = on_event.send(TrainingStreamEvent::Error {
                message: error.clone(),
            });
            state
                .cancellations
                .lock()
                .map_err(|value| value.to_string())?
                .remove(&upload_id);
            return Err(error);
        }
        Err(message) => {
            save_upload_progress(
                &state,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: None,
                    bytes_uploaded: existing.as_ref().map_or(0, |upload| upload.bytes_uploaded),
                    total_bytes,
                    chunk_size: DEFAULT_CHUNK_SIZE,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count: existing.as_ref().map_or(0, |upload| upload.retry_count),
                    last_error: Some(&message),
                    finished: false,
                },
            )?;
            state
                .cancellations
                .lock()
                .map_err(|value| value.to_string())?
                .remove(&upload_id);
            return Err(message);
        }
    };
    let handshake = match handshake.json::<Value>().await {
        Ok(value) => value,
        Err(error) => {
            let message = format!("Training Manager returned invalid upload JSON: {error}");
            return fail_upload(
                &state,
                &on_event,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: None,
                    bytes_uploaded: existing.as_ref().map_or(0, |upload| upload.bytes_uploaded),
                    total_bytes,
                    chunk_size: DEFAULT_CHUNK_SIZE,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count: existing.as_ref().map_or(0, |upload| upload.retry_count),
                    last_error: Some(&message),
                    finished: false,
                },
            );
        }
    };
    let remote_upload_id = match handshake["uploadId"]
        .as_str()
        .or_else(|| handshake["id"].as_str())
    {
        Some(id) => id.to_string(),
        None => {
            let message = "Training Manager did not return an uploadId".to_string();
            return fail_upload(
                &state,
                &on_event,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: None,
                    bytes_uploaded: existing.as_ref().map_or(0, |upload| upload.bytes_uploaded),
                    total_bytes,
                    chunk_size: DEFAULT_CHUNK_SIZE,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count: existing.as_ref().map_or(0, |upload| upload.retry_count),
                    last_error: Some(&message),
                    finished: false,
                },
            );
        }
    };
    let mut bytes_uploaded = handshake["uploadedBytes"]
        .as_i64()
        .or_else(|| existing.as_ref().map(|upload| upload.bytes_uploaded))
        .unwrap_or(0)
        .clamp(0, total_bytes);
    let chunk_size = handshake["chunkSize"]
        .as_i64()
        .unwrap_or(DEFAULT_CHUNK_SIZE)
        .clamp(256 * 1024, 64 * 1024 * 1024);
    save_upload_progress(
        &state,
        UploadProgress {
            id: &upload_id,
            status: "uploading",
            remote_upload_id: Some(&remote_upload_id),
            bytes_uploaded,
            total_bytes,
            chunk_size,
            speed_bps: 0.0,
            eta_seconds: None,
            retry_count: 0,
            last_error: None,
            finished: false,
        },
    )?;

    let mut file = match tokio::fs::File::open(&artifact_path).await {
        Ok(file) => file,
        Err(error) => {
            let message = format!("Could not open the dataset artifact: {error}");
            return fail_upload(
                &state,
                &on_event,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: Some(&remote_upload_id),
                    bytes_uploaded,
                    total_bytes,
                    chunk_size,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count: 0,
                    last_error: Some(&message),
                    finished: false,
                },
            );
        }
    };
    if let Err(error) = file
        .seek(std::io::SeekFrom::Start(bytes_uploaded as u64))
        .await
    {
        let message = format!("Could not resume the dataset artifact: {error}");
        return fail_upload(
            &state,
            &on_event,
            UploadProgress {
                id: &upload_id,
                status: "failed",
                remote_upload_id: Some(&remote_upload_id),
                bytes_uploaded,
                total_bytes,
                chunk_size,
                speed_bps: 0.0,
                eta_seconds: None,
                retry_count: 0,
                last_error: Some(&message),
                finished: false,
            },
        );
    }
    let started = Instant::now();
    let starting_offset = bytes_uploaded;
    let mut retry_count = 0_i64;
    while bytes_uploaded < total_bytes {
        if cancellation.load(Ordering::Relaxed) {
            save_upload_progress(
                &state,
                UploadProgress {
                    id: &upload_id,
                    status: "cancelled",
                    remote_upload_id: Some(&remote_upload_id),
                    bytes_uploaded,
                    total_bytes,
                    chunk_size,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count,
                    last_error: None,
                    finished: true,
                },
            )?;
            let _ = on_event.send(TrainingStreamEvent::Cancelled);
            add_log(
                &state,
                "training-upload",
                "warning",
                "Dataset upload cancelled",
                Some(&dataset.name),
            );
            state
                .cancellations
                .lock()
                .map_err(|error| error.to_string())?
                .remove(&upload_id);
            return Ok(());
        }
        let remaining = (total_bytes - bytes_uploaded) as usize;
        let mut chunk = vec![0_u8; remaining.min(chunk_size as usize)];
        let count = match file.read(&mut chunk).await {
            Ok(count) => count,
            Err(error) => {
                let message = format!("Could not read the dataset artifact: {error}");
                return fail_upload(
                    &state,
                    &on_event,
                    UploadProgress {
                        id: &upload_id,
                        status: "failed",
                        remote_upload_id: Some(&remote_upload_id),
                        bytes_uploaded,
                        total_bytes,
                        chunk_size,
                        speed_bps: 0.0,
                        eta_seconds: None,
                        retry_count,
                        last_error: Some(&message),
                        finished: false,
                    },
                );
            }
        };
        if count == 0 {
            let message = "Dataset artifact ended before the expected byte count".to_string();
            return fail_upload(
                &state,
                &on_event,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: Some(&remote_upload_id),
                    bytes_uploaded,
                    total_bytes,
                    chunk_size,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count,
                    last_error: Some(&message),
                    finished: false,
                },
            );
        }
        chunk.truncate(count);
        let start = bytes_uploaded;
        let end = start + count as i64 - 1;
        let chunk_index = start / chunk_size;
        let chunk_hash = format!("{:x}", Sha256::digest(&chunk));
        let mut accepted = false;
        let mut last_error = String::new();
        for attempt in 0..3 {
            let response = state
                .http
                .put(api_url(
                    &server.url,
                    &format!("/v1/uploads/{remote_upload_id}/chunks/{chunk_index}"),
                ))
                .header("Idempotency-Key", format!("{upload_id}:{chunk_index}"))
                .header(CONTENT_TYPE, "application/octet-stream")
                .header(CONTENT_RANGE, format!("bytes {start}-{end}/{total_bytes}"))
                .header("X-Content-SHA256", &chunk_hash)
                .body(chunk.clone())
                .send()
                .await;
            match response {
                Ok(response) if response.status().is_success() => {
                    accepted = true;
                    break;
                }
                Ok(response) => {
                    last_error = response_failure(response, "Uploading a dataset chunk").await;
                }
                Err(error) => {
                    last_error = format!("Dataset chunk request failed: {error}");
                }
            }
            retry_count += 1;
            if attempt < 2 {
                tokio::time::sleep(Duration::from_millis(250 * 4_u64.pow(attempt))).await;
            }
        }
        if !accepted {
            save_upload_progress(
                &state,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: Some(&remote_upload_id),
                    bytes_uploaded,
                    total_bytes,
                    chunk_size,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count,
                    last_error: Some(&last_error),
                    finished: false,
                },
            )?;
            let _ = on_event.send(TrainingStreamEvent::Error {
                message: last_error.clone(),
            });
            state
                .cancellations
                .lock()
                .map_err(|error| error.to_string())?
                .remove(&upload_id);
            return Err(last_error);
        }
        bytes_uploaded = end + 1;
        let elapsed = started.elapsed().as_secs_f64().max(0.001);
        let speed_bps = (bytes_uploaded - starting_offset) as f64 / elapsed;
        let eta_seconds = (speed_bps > 0.0)
            .then(|| ((total_bytes - bytes_uploaded) as f64 / speed_bps).ceil() as i64);
        let progress = bytes_uploaded as f64 / total_bytes.max(1) as f64 * 100.0;
        save_upload_progress(
            &state,
            UploadProgress {
                id: &upload_id,
                status: "uploading",
                remote_upload_id: Some(&remote_upload_id),
                bytes_uploaded,
                total_bytes,
                chunk_size,
                speed_bps,
                eta_seconds,
                retry_count,
                last_error: None,
                finished: false,
            },
        )?;
        let _ = on_event.send(TrainingStreamEvent::UploadProgress {
            upload_id: upload_id.clone(),
            bytes_uploaded,
            total_bytes,
            progress,
            speed_bps,
            eta_seconds,
        });
    }
    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
        operation_id: upload_id.clone(),
        stage: "Server Validation".into(),
        message: "Upload complete; validating checksum and registering the dataset".into(),
        progress: 99.0,
        bytes_processed: total_bytes,
        total_bytes,
        current_file: Some(artifact_path.clone()),
    });
    add_log(
        &state,
        "training-upload",
        "info",
        "Server dataset validation started",
        Some(&dataset.name),
    );
    let completion_request = state
        .http
        .post(api_url(
            &server.url,
            &format!("/v1/uploads/{remote_upload_id}/complete"),
        ))
        // Server-side checksum, extraction, and validation can take substantially
        // longer than the normal API timeout for multi-gigabyte archives.
        .timeout(Duration::from_secs(60 * 60))
        .header("Idempotency-Key", format!("{upload_id}:complete"))
        .json(&json!({ "sha256": checksum, "size": total_bytes }))
        .send();
    tokio::pin!(completion_request);
    let validation_started = Instant::now();
    let mut validation_heartbeat = tokio::time::interval(Duration::from_secs(5));
    validation_heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let completion = loop {
        tokio::select! {
            response = &mut completion_request => break response,
            _ = validation_heartbeat.tick() => {
                let elapsed = validation_started.elapsed().as_secs();
                let _ = on_event.send(TrainingStreamEvent::OperationProgress {
                    operation_id: upload_id.clone(),
                    stage: "Server Validation".into(),
                    message: format!(
                        "Windows is validating and registering the dataset ({elapsed}s elapsed)"
                    ),
                    progress: 99.0,
                    bytes_processed: total_bytes,
                    total_bytes,
                    current_file: Some(artifact_path.clone()),
                });
            }
        }
    };
    let completion = match completion {
        Ok(response) => response,
        Err(error) => {
            let message = format!("Could not finalize dataset upload: {error}");
            return fail_upload(
                &state,
                &on_event,
                UploadProgress {
                    id: &upload_id,
                    status: "failed",
                    remote_upload_id: Some(&remote_upload_id),
                    bytes_uploaded,
                    total_bytes,
                    chunk_size,
                    speed_bps: 0.0,
                    eta_seconds: None,
                    retry_count,
                    last_error: Some(&message),
                    finished: false,
                },
            );
        }
    };
    if !completion.status().is_success() {
        let message = response_failure(completion, "Finalizing the dataset upload").await;
        return fail_upload(
            &state,
            &on_event,
            UploadProgress {
                id: &upload_id,
                status: "failed",
                remote_upload_id: Some(&remote_upload_id),
                bytes_uploaded,
                total_bytes,
                chunk_size,
                speed_bps: 0.0,
                eta_seconds: None,
                retry_count,
                last_error: Some(&message),
                finished: false,
            },
        );
    }
    let completion_is_async = completion.status().as_u16() == 202;
    let mut completion_json = completion
        .json::<Value>()
        .await
        .unwrap_or_else(|_| json!({}));
    if completion_is_async {
        let monitoring_started = Instant::now();
        let mut consecutive_monitor_failures = 0_u8;
        loop {
            if monitoring_started.elapsed() >= Duration::from_secs(60 * 60) {
                let message =
                    "Windows dataset validation did not finish within one hour".to_string();
                return fail_upload(
                    &state,
                    &on_event,
                    UploadProgress {
                        id: &upload_id,
                        status: "failed",
                        remote_upload_id: Some(&remote_upload_id),
                        bytes_uploaded,
                        total_bytes,
                        chunk_size,
                        speed_bps: 0.0,
                        eta_seconds: None,
                        retry_count,
                        last_error: Some(&message),
                        finished: false,
                    },
                );
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
            let status_response = state
                .http
                .get(api_url(
                    &server.url,
                    &format!("/v1/uploads/{remote_upload_id}"),
                ))
                .send()
                .await;
            let status_response = match status_response {
                Ok(response) if response.status().is_success() => {
                    consecutive_monitor_failures = 0;
                    response
                }
                Ok(response) => {
                    consecutive_monitor_failures = consecutive_monitor_failures.saturating_add(1);
                    let detail = response_failure(response, "Monitoring dataset validation").await;
                    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
                        operation_id: upload_id.clone(),
                        stage: "Reconnecting".into(),
                        message: detail,
                        progress: 99.0,
                        bytes_processed: total_bytes,
                        total_bytes,
                        current_file: Some(artifact_path.clone()),
                    });
                    continue;
                }
                Err(error) => {
                    consecutive_monitor_failures = consecutive_monitor_failures.saturating_add(1);
                    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
                        operation_id: upload_id.clone(),
                        stage: "Reconnecting".into(),
                        message: format!(
                            "Validation continues on Windows; status check failed ({consecutive_monitor_failures}): {}",
                            request_error_details(&error)
                        ),
                        progress: 99.0,
                        bytes_processed: total_bytes,
                        total_bytes,
                        current_file: Some(artifact_path.clone()),
                    });
                    continue;
                }
            };
            let status_json = status_response
                .json::<Value>()
                .await
                .unwrap_or_else(|_| json!({}));
            match status_json["status"].as_str().unwrap_or("validating") {
                "completed" => {
                    completion_json =
                        json!({ "datasetId": dataset.id, "validationStatus": "valid" });
                    break;
                }
                "failed" | "cancelled" => {
                    let message = status_json["lastError"]
                        .as_str()
                        .unwrap_or("Windows rejected the dataset during validation")
                        .to_string();
                    return fail_upload(
                        &state,
                        &on_event,
                        UploadProgress {
                            id: &upload_id,
                            status: "failed",
                            remote_upload_id: Some(&remote_upload_id),
                            bytes_uploaded,
                            total_bytes,
                            chunk_size,
                            speed_bps: 0.0,
                            eta_seconds: None,
                            retry_count,
                            last_error: Some(&message),
                            finished: false,
                        },
                    );
                }
                status => {
                    let elapsed = monitoring_started.elapsed().as_secs();
                    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
                        operation_id: upload_id.clone(),
                        stage: "Server Validation".into(),
                        message: format!(
                            "Windows reports {status}; validation has run for {elapsed}s"
                        ),
                        progress: 99.0,
                        bytes_processed: total_bytes,
                        total_bytes,
                        current_file: Some(artifact_path.clone()),
                    });
                }
            }
        }
    }
    let remote_dataset_id = completion_json["datasetId"]
        .as_str()
        .unwrap_or(&remote_upload_id)
        .to_string();
    save_upload_progress(
        &state,
        UploadProgress {
            id: &upload_id,
            status: "completed",
            remote_upload_id: Some(&remote_upload_id),
            bytes_uploaded: total_bytes,
            total_bytes,
            chunk_size,
            speed_bps: 0.0,
            eta_seconds: Some(0),
            retry_count,
            last_error: None,
            finished: true,
        },
    )?;
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "UPDATE training_datasets SET remote_dataset_id=?2,
                    training_server_id=?3, updated_at=?4 WHERE id=?1",
                params![dataset.id, remote_dataset_id, server.id, now()],
            )
            .map_err(|error| database_error("linking remote dataset", error))?;
    }
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&upload_id);
    add_log(
        &state,
        "training-upload",
        "info",
        "Dataset upload completed",
        Some(&dataset.name),
    );
    let _ = on_event.send(TrainingStreamEvent::OperationProgress {
        operation_id: upload_id,
        stage: "Dataset Registered".into(),
        message: "Dataset is available on the Training Manager".into(),
        progress: 100.0,
        bytes_processed: total_bytes,
        total_bytes,
        current_file: None,
    });
    let _ = on_event.send(TrainingStreamEvent::Complete {
        message: format!("{} uploaded", dataset.name),
    });
    Ok(())
}

#[tauri::command]
pub async fn cancel_dataset_upload(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(cancellation) = state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .get(&id)
    {
        cancellation.store(true, Ordering::Relaxed);
    }
    let upload = list_dataset_uploads(state.clone())?
        .into_iter()
        .find(|upload| upload.id == id)
        .ok_or_else(|| "The selected upload no longer exists".to_string())?;
    if let Some(remote_id) = &upload.remote_upload_id {
        if let Some(server) = list_training_servers(state.clone())?
            .into_iter()
            .find(|server| server.id == upload.training_server_id)
        {
            let _ = state
                .http
                .delete(api_url(&server.url, &format!("/v1/uploads/{remote_id}")))
                .send()
                .await;
        }
    }
    save_upload_progress(
        &state,
        UploadProgress {
            id: &id,
            status: "cancelled",
            remote_upload_id: upload.remote_upload_id.as_deref(),
            bytes_uploaded: upload.bytes_uploaded,
            total_bytes: upload.total_bytes,
            chunk_size: upload.chunk_size,
            speed_bps: 0.0,
            eta_seconds: None,
            retry_count: upload.retry_count,
            last_error: None,
            finished: true,
        },
    )?;
    add_log(
        &state,
        "training-upload",
        "warning",
        "Dataset upload cancellation requested",
        Some(&upload.dataset_id),
    );
    Ok(())
}

#[tauri::command]
pub fn list_training_jobs(state: State<'_, AppState>) -> Result<Vec<TrainingJobRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, training_server_id, remote_job_id, dataset_id, dataset_ids_json,
                    model, base_model, backend, parameters_json, status, stage, progress,
                    eta_seconds, started_at,
                    finished_at, gpu_usage, cpu_usage, ram_usage, disk_usage,
                    current_epoch, total_epochs, loss, learning_rate, training_speed, heartbeat_at,
                    warning, error, retry_of, created_at, updated_at
             FROM training_jobs ORDER BY created_at DESC",
        )
        .map_err(|error| database_error("preparing training jobs", error))?;
    let records = statement
        .query_map([], map_job)
        .map_err(|error| database_error("reading training jobs", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading training jobs", error))?;
    Ok(records)
}

fn validate_open_training_pair(base_model: &str, parameters: &Value) -> Result<(), String> {
    if parameters["trainingRecipe"].as_str() != Some("open-base-lora") {
        return Ok(());
    }
    let normalized = base_model.to_ascii_lowercase();
    let expected_source = if normalized.starts_with("tinyllama") {
        Some("TinyLlama/TinyLlama-1.1B-Chat-v0.6")
    } else if normalized == "mistral"
        || normalized.starts_with("mistral:latest")
        || normalized.starts_with("mistral:7b")
        || normalized.starts_with("mistral:v0.3")
    {
        Some("mistralai/Mistral-7B-Instruct-v0.3")
    } else {
        None
    };
    let expected_source = expected_source.ok_or_else(|| {
        format!(
            "Automatic open-base training cannot use '{base_model}'. Select \
tinyllama:latest in the Open Ollama training base field."
        )
    })?;
    let source_model = parameters["sourceModel"].as_str().unwrap_or_default();
    if source_model.eq_ignore_ascii_case(expected_source) {
        return Ok(());
    }
    Err(format!(
        "The selected Ollama base '{base_model}' requires sourceModel \
'{expected_source}', but the draft contains '{source_model}'. Create or repair the draft \
with the automatic open-base workflow."
    ))
}

#[tauri::command]
pub fn save_training_job(
    state: State<'_, AppState>,
    input: TrainingJobInput,
) -> Result<TrainingJobRecord, String> {
    let parameters = serde_json::from_str::<Value>(&input.parameters_json)
        .map_err(|error| format!("Training parameters must be valid JSON: {error}"))?;
    if parameters.get("huggingFaceToken").is_some() {
        return Err(
            "Remove huggingFaceToken from Training parameters. Credentials must be entered through Check readiness so they are never saved in the job or logs."
                .into(),
        );
    }
    if parameters["sourceModel"]
        .as_str()
        .map_or(true, |value| value.trim().is_empty())
    {
        return Err("Training parameters must include a non-empty sourceModel".into());
    }
    validate_open_training_pair(input.base_model.trim(), &parameters)?;
    if input.total_epochs < 1 {
        return Err("Training epochs must be at least 1".into());
    }
    if input.model.trim().is_empty() {
        return Err("The output model name is required".into());
    }
    if input.base_model.trim().is_empty() {
        return Err("The Ollama base model is required".into());
    }
    let mut dataset_ids = Vec::new();
    for value in &input.dataset_ids {
        let id = value.trim();
        if !id.is_empty() && !dataset_ids.iter().any(|existing| existing == id) {
            dataset_ids.push(id.to_string());
        }
    }
    if dataset_ids.is_empty() {
        return Err("Select at least one training dataset".into());
    }
    let datasets = list_training_datasets(state.clone())?;
    if let Some(missing_id) = dataset_ids
        .iter()
        .find(|id| !datasets.iter().any(|dataset| &dataset.id == *id))
    {
        return Err(format!(
            "The selected dataset {missing_id} no longer exists"
        ));
    }
    let dataset_id = dataset_ids[0].clone();
    let dataset_ids_json = serde_json::to_string(&dataset_ids)
        .map_err(|error| format!("Could not encode selected datasets: {error}"))?;
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let timestamp = now();
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "INSERT INTO training_jobs(
                id, training_server_id, dataset_id, dataset_ids_json, model, base_model, backend,
                parameters_json, status, stage, total_epochs, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', 'Draft', ?9, ?10, ?10)
             ON CONFLICT(id) DO UPDATE SET
                training_server_id=excluded.training_server_id,
                dataset_id=excluded.dataset_id, dataset_ids_json=excluded.dataset_ids_json,
                model=excluded.model,
                base_model=excluded.base_model,
                backend=excluded.backend, parameters_json=excluded.parameters_json,
                total_epochs=excluded.total_epochs, updated_at=excluded.updated_at",
            params![
                id,
                input.training_server_id,
                dataset_id,
                dataset_ids_json,
                input.model.trim(),
                input.base_model.trim(),
                input.backend.trim(),
                input.parameters_json,
                input.total_epochs,
                timestamp
            ],
        )
        .map_err(|error| database_error("saving training job", error))?;
    drop(database);
    list_training_jobs(state)?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "Saved training job could not be reloaded".into())
}

#[tauri::command]
pub fn delete_training_job(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let job = list_training_jobs(state.clone())?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "The selected training job no longer exists".to_string())?;
    if matches!(
        job.status.as_str(),
        "queued" | "running" | "paused" | "cancelling"
    ) {
        return Err("Active jobs must be cancelled before they can be removed".into());
    }
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let affected = database
        .execute("DELETE FROM training_jobs WHERE id = ?1", [id])
        .map_err(|error| database_error("deleting training job", error))?;
    if affected == 0 {
        return Err("The selected training job no longer exists".into());
    }
    Ok(())
}

fn active_training_server(
    state: State<'_, AppState>,
    preferred_id: Option<&str>,
) -> Result<TrainingServerRecord, String> {
    list_training_servers(state)?
        .into_iter()
        .find(|server| {
            preferred_id
                .map(|id| server.id == id)
                .unwrap_or(server.is_active)
        })
        .ok_or_else(|| {
            "Configure and activate an external Training Manager before dispatching jobs".into()
        })
}

fn record_training_heartbeat_failure(
    state: &State<'_, AppState>,
    id: &str,
    message: &str,
) -> Result<(), String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .execute(
            "UPDATE training_jobs SET
                heartbeat_failures=heartbeat_failures + 1,
                status=CASE
                    WHEN heartbeat_failures + 1 >= 3 THEN 'unreachable'
                    ELSE status
                END,
                warning=?2,
                updated_at=?3
             WHERE id=?1",
            params![id, message, now()],
        )
        .map_err(|error| database_error("recording training heartbeat failure", error))?;
    Ok(())
}

async fn run_training_preflight(
    state: &State<'_, AppState>,
    job: &TrainingJobRecord,
    credential: Option<String>,
) -> Result<TrainingPreflightResult, String> {
    let server = active_training_server(state.clone(), job.training_server_id.as_deref())?;
    let parameters = serde_json::from_str::<Value>(&job.parameters_json)
        .map_err(|error| format!("Stored training parameters are invalid: {error}"))?;
    validate_open_training_pair(&job.base_model, &parameters)?;
    if parameters.get("huggingFaceToken").is_some() {
        return Err(
            "This draft contains a persisted Hugging Face token. Remove it and use Check readiness to provide the token securely."
                .into(),
        );
    }
    let source_model = parameters["sourceModel"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Training parameters do not contain sourceModel".to_string())?;
    let response = state
        .http
        .post(api_url(&server.url, "/v1/training/preflight"))
        .timeout(Duration::from_secs(200))
        .json(&json!({
            "baseModel": job.base_model,
            "sourceModel": source_model,
            "backend": job.backend,
            "credential": credential
        }))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not run training preflight on {}: {}",
                server.url,
                request_error_details(&error)
            )
        })?;
    if !response.status().is_success() {
        return Err(response_failure(response, "Checking training readiness").await);
    }
    response
        .json::<TrainingPreflightResult>()
        .await
        .map_err(|error| format!("Training Manager returned invalid preflight JSON: {error}"))
}

#[tauri::command]
pub async fn preflight_training_job(
    state: State<'_, AppState>,
    id: String,
    credential: Option<String>,
) -> Result<TrainingPreflightResult, String> {
    let job = list_training_jobs(state.clone())?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "The selected training job no longer exists".to_string())?;
    run_training_preflight(&state, &job, credential).await
}

#[tauri::command]
pub async fn dispatch_training_job(
    state: State<'_, AppState>,
    id: String,
) -> Result<TrainingJobRecord, String> {
    let job = list_training_jobs(state.clone())?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "The selected training job no longer exists".to_string())?;
    if job.status != "draft" && job.status != "failed" {
        return Err("Only draft or failed jobs can be dispatched".into());
    }
    let preflight = run_training_preflight(&state, &job, None).await?;
    if !preflight.ready {
        let details = preflight
            .checks
            .iter()
            .filter(|check| check.status != "passed")
            .map(|check| {
                check
                    .resolution
                    .as_ref()
                    .map(|resolution| format!("{} {}", check.message, resolution))
                    .unwrap_or_else(|| check.message.clone())
            })
            .collect::<Vec<_>>()
            .join(" ");
        return Err(format!(
            "Training requires attention before dispatch. {details}"
        ));
    }
    let server = active_training_server(state.clone(), job.training_server_id.as_deref())?;
    let datasets = list_training_datasets(state.clone())?;
    let mut remote_dataset_ids = Vec::with_capacity(job.dataset_ids.len());
    for dataset_id in &job.dataset_ids {
        let dataset = datasets
            .iter()
            .find(|dataset| &dataset.id == dataset_id)
            .ok_or_else(|| format!("The job dataset {dataset_id} no longer exists"))?;
        let remote_dataset_id = dataset.remote_dataset_id.as_ref().ok_or_else(|| {
            format!(
                "Upload {} to the selected Training Manager before dispatching this job",
                dataset.name
            )
        })?;
        if dataset.training_server_id.as_deref() != Some(server.id.as_str()) {
            return Err(format!(
                "{} was uploaded to a different Training Manager; upload it to {}",
                dataset.name, server.name
            ));
        }
        remote_dataset_ids.push(remote_dataset_id.clone());
    }
    let parameters = serde_json::from_str::<Value>(&job.parameters_json)
        .map_err(|error| format!("Stored training parameters are invalid: {error}"))?;
    let response = state
        .http
        .post(api_url(&server.url, "/v1/jobs"))
        .header("Idempotency-Key", &job.id)
        .json(&json!({
            "clientJobId": job.id,
            "datasetId": remote_dataset_ids[0],
            "datasetIds": remote_dataset_ids,
            "model": job.model,
            "baseModel": job.base_model,
            "backend": job.backend,
            "parameters": parameters,
            "epochs": job.total_epochs
        }))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Could not dispatch the job to {}. No training was started: {error}",
                server.url
            )
        })?;
    if !response.status().is_success() {
        return Err(response_failure(response, "Dispatching the training job").await);
    }
    let response = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Training Manager returned invalid job JSON: {error}"))?;
    let remote_id = response["jobId"]
        .as_str()
        .or_else(|| response["id"].as_str())
        .ok_or_else(|| "Training Manager did not return a jobId".to_string())?;
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "UPDATE training_jobs SET training_server_id=?2, remote_job_id=?3,
                    status='queued', stage='Queued', progress=0, error=NULL,
                    started_at=COALESCE(started_at, ?4), heartbeat_at=?4, updated_at=?4
                 WHERE id=?1",
                params![id, server.id, remote_id, now()],
            )
            .map_err(|error| database_error("saving dispatched training job", error))?;
    }
    add_log(
        &state,
        "training-job",
        "info",
        "Training job dispatched",
        Some(&job.model),
    );
    list_training_jobs(state)?
        .into_iter()
        .find(|value| value.id == id)
        .ok_or_else(|| "Dispatched job could not be reloaded".into())
}

fn value_f64(value: &Value, camel: &str, snake: &str) -> Option<f64> {
    value[camel].as_f64().or_else(|| value[snake].as_f64())
}

fn value_i64(value: &Value, camel: &str, snake: &str) -> Option<i64> {
    value[camel].as_i64().or_else(|| value[snake].as_i64())
}

fn value_string(value: &Value, camel: &str, snake: &str) -> Option<String> {
    value[camel]
        .as_str()
        .or_else(|| value[snake].as_str())
        .map(ToOwned::to_owned)
}

#[tauri::command]
pub async fn refresh_training_job(
    state: State<'_, AppState>,
    id: String,
) -> Result<TrainingJobRecord, String> {
    let job = list_training_jobs(state.clone())?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "The selected training job no longer exists".to_string())?;
    let remote_id = job
        .remote_job_id
        .clone()
        .ok_or_else(|| "Draft jobs have no remote status".to_string())?;
    let server = active_training_server(state.clone(), job.training_server_id.as_deref())?;
    let response = match state
        .http
        .get(api_url(&server.url, &format!("/v1/jobs/{remote_id}")))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let message = format!("Training job heartbeat failed: {error}");
            record_training_heartbeat_failure(&state, &id, &message)?;
            return Err(message);
        }
    };
    if !response.status().is_success() {
        let message = response_failure(response, "Refreshing the training job").await;
        record_training_heartbeat_failure(&state, &id, &message)?;
        return Err(message);
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Training Manager returned invalid job status JSON: {error}"))?;
    let status = value_string(&value, "status", "status").unwrap_or_else(|| job.status.clone());
    let stage = value_string(&value, "stage", "stage").unwrap_or_else(|| job.stage.clone());
    let progress = value_f64(&value, "progress", "progress")
        .unwrap_or(job.progress)
        .clamp(0.0, 100.0);
    let elapsed_seconds = job
        .started_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|started| {
            (Utc::now() - started.with_timezone(&Utc))
                .num_seconds()
                .max(0)
        });
    let estimated_eta = value_i64(&value, "etaSeconds", "eta_seconds").or_else(|| {
        elapsed_seconds
            .filter(|_| progress > 0.0 && progress < 100.0)
            .map(|elapsed| ((elapsed as f64 / progress) * (100.0 - progress)).round() as i64)
    });
    let terminal = matches!(status.as_str(), "completed" | "failed" | "cancelled");
    let timestamp = now();
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "UPDATE training_jobs SET
                    status=?2, stage=?3, progress=?4, eta_seconds=?5,
                    gpu_usage=?6, cpu_usage=?7, ram_usage=?8, disk_usage=?9,
                    current_epoch=?10, total_epochs=COALESCE(?11, total_epochs),
                    loss=?12, learning_rate=?13, training_speed=?14, heartbeat_at=?15,
                    warning=?16, error=?17,
                    heartbeat_failures=0,
                    finished_at=CASE WHEN ?18=1 THEN COALESCE(finished_at, ?15) ELSE NULL END,
                    updated_at=?15 WHERE id=?1",
                params![
                    id,
                    status,
                    stage,
                    progress,
                    estimated_eta,
                    value_f64(&value, "gpuUsage", "gpu_usage"),
                    value_f64(&value, "cpuUsage", "cpu_usage"),
                    value_i64(&value, "ramUsage", "ram_usage"),
                    value_i64(&value, "diskUsage", "disk_usage"),
                    value_i64(&value, "currentEpoch", "current_epoch").unwrap_or(job.current_epoch),
                    value_i64(&value, "totalEpochs", "total_epochs"),
                    value_f64(&value, "loss", "loss"),
                    value_f64(&value, "learningRate", "learning_rate"),
                    value_f64(&value, "trainingSpeed", "training_speed"),
                    timestamp,
                    value_string(&value, "warning", "warning"),
                    value_string(&value, "error", "error"),
                    i64::from(terminal)
                ],
            )
            .map_err(|error| database_error("saving training job heartbeat", error))?;
    }
    if let Some(logs) = value["logs"].as_array() {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        for log in logs.iter().take(500) {
            let message = log["message"].as_str().unwrap_or_default();
            if message.is_empty() {
                continue;
            }
            let cursor = log["cursor"].as_str();
            database
                .execute(
                    "INSERT INTO training_logs(
                        training_job_id, level, message, cursor, created_at
                     )
                     SELECT ?1, ?2, ?3, ?4, ?5
                     WHERE NOT EXISTS(
                        SELECT 1 FROM training_logs
                        WHERE training_job_id=?1 AND cursor IS ?4 AND message=?3
                     )",
                    params![
                        id,
                        log["level"].as_str().unwrap_or("info"),
                        message,
                        cursor,
                        log["createdAt"].as_str().unwrap_or(&timestamp)
                    ],
                )
                .map_err(|error| database_error("saving training job logs", error))?;
        }
    }
    list_training_jobs(state)?
        .into_iter()
        .find(|value| value.id == id)
        .ok_or_else(|| "Refreshed job could not be reloaded".into())
}

#[tauri::command]
pub async fn cancel_training_job(
    state: State<'_, AppState>,
    id: String,
) -> Result<TrainingJobRecord, String> {
    let job = list_training_jobs(state.clone())?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "The selected training job no longer exists".to_string())?;
    let remote_id = job
        .remote_job_id
        .clone()
        .ok_or_else(|| "Draft jobs can be removed without remote cancellation".to_string())?;
    let server = active_training_server(state.clone(), job.training_server_id.as_deref())?;
    let response = state
        .http
        .post(api_url(
            &server.url,
            &format!("/v1/jobs/{remote_id}/cancel"),
        ))
        .header("Idempotency-Key", format!("{}:cancel", job.id))
        .send()
        .await
        .map_err(|error| format!("Could not request training job cancellation: {error}"))?;
    if !response.status().is_success() {
        return Err(response_failure(response, "Cancelling the training job").await);
    }
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "UPDATE training_jobs SET status='cancelling', stage='Cancelling',
                    updated_at=?2 WHERE id=?1",
                params![id, now()],
            )
            .map_err(|error| database_error("saving training cancellation", error))?;
    }
    list_training_jobs(state)?
        .into_iter()
        .find(|value| value.id == id)
        .ok_or_else(|| "Cancelled job could not be reloaded".into())
}

#[tauri::command]
pub async fn retry_training_job(
    state: State<'_, AppState>,
    id: String,
) -> Result<TrainingJobRecord, String> {
    let source = list_training_jobs(state.clone())?
        .into_iter()
        .find(|job| job.id == id)
        .ok_or_else(|| "The selected training job no longer exists".to_string())?;
    if source.status != "failed" && source.status != "cancelled" {
        return Err("Only failed or cancelled jobs can be retried".into());
    }
    let remote_id = source
        .remote_job_id
        .clone()
        .ok_or_else(|| "The failed job has no remote identifier".to_string())?;
    let server = active_training_server(state.clone(), source.training_server_id.as_deref())?;
    let retry_id = Uuid::new_v4().to_string();
    let response = state
        .http
        .post(api_url(&server.url, &format!("/v1/jobs/{remote_id}/retry")))
        .header("Idempotency-Key", &retry_id)
        .send()
        .await
        .map_err(|error| format!("Could not retry the training job: {error}"))?;
    if !response.status().is_success() {
        return Err(response_failure(response, "Retrying the training job").await);
    }
    let response = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    let new_remote_id = response["jobId"]
        .as_str()
        .or_else(|| response["id"].as_str())
        .ok_or_else(|| "Training Manager did not return a retry jobId".to_string())?;
    let timestamp = now();
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "INSERT INTO training_jobs(
                    id, training_server_id, remote_job_id, dataset_id, dataset_ids_json,
                    model, base_model, backend,
                    parameters_json, status, stage, progress, started_at,
                    current_epoch, total_epochs, retry_of, created_at, updated_at
                 ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'queued', 'Queued', 0, ?10,
                    0, ?11, ?12, ?10, ?10
                 )",
                params![
                    retry_id,
                    server.id,
                    new_remote_id,
                    source.dataset_id,
                    serde_json::to_string(&source.dataset_ids)
                        .map_err(|error| format!("Could not encode retry datasets: {error}"))?,
                    source.model,
                    source.base_model,
                    source.backend,
                    source.parameters_json,
                    timestamp,
                    source.total_epochs,
                    source.id
                ],
            )
            .map_err(|error| database_error("saving retried training job", error))?;
    }
    list_training_jobs(state)?
        .into_iter()
        .find(|value| value.id == retry_id)
        .ok_or_else(|| "Retried job could not be reloaded".into())
}

#[tauri::command]
pub fn list_training_logs(
    state: State<'_, AppState>,
    training_job_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<TrainingLogRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    let mut statement = database
        .prepare(
            "SELECT id, training_job_id, level, message, cursor, created_at
             FROM (
                SELECT id, training_job_id, level, message, cursor, created_at
                FROM training_logs
                WHERE (?1 IS NULL OR training_job_id = ?1)
                UNION ALL
                SELECT -id, NULL, level,
                       message || CASE
                           WHEN details IS NULL OR details = '' THEN ''
                           ELSE ': ' || details
                       END,
                       NULL, created_at
                FROM logs
                WHERE ?1 IS NULL AND category LIKE 'training-%'
             )
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .map_err(|error| database_error("preparing training logs", error))?;
    let records = statement
        .query_map(params![training_job_id, limit.unwrap_or(1000)], |row| {
            Ok(TrainingLogRecord {
                id: row.get(0)?,
                training_job_id: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                cursor: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|error| database_error("reading training logs", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| database_error("reading training logs", error))?;
    Ok(records)
}

#[tauri::command]
pub async fn refresh_training_resources(
    state: State<'_, AppState>,
    training_server_id: String,
) -> Result<TrainingResourceRecord, String> {
    let server = active_training_server(state.clone(), Some(&training_server_id))?;
    let response = state
        .http
        .get(api_url(&server.url, "/v1/resources"))
        .send()
        .await
        .map_err(|error| format!("Could not refresh training server resources: {error}"))?;
    if !response.status().is_success() {
        return Err(response_failure(response, "Refreshing training resources").await);
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Training Manager returned invalid resource JSON: {error}"))?;
    let captured_at = now();
    let gpu_json = value["gpus"].as_array().cloned().unwrap_or_default();
    let gpu_json = serde_json::to_string(&gpu_json)
        .map_err(|error| format!("Could not serialize GPU resources: {error}"))?;
    {
        let database = state.database.lock().map_err(|error| error.to_string())?;
        database
            .execute(
                "INSERT INTO training_resources(
                    training_server_id, gpu_json, cpu_usage, ram_total, ram_used,
                    disk_total, disk_used, queue_length, captured_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(training_server_id) DO UPDATE SET
                    gpu_json=excluded.gpu_json, cpu_usage=excluded.cpu_usage,
                    ram_total=excluded.ram_total, ram_used=excluded.ram_used,
                    disk_total=excluded.disk_total, disk_used=excluded.disk_used,
                    queue_length=excluded.queue_length, captured_at=excluded.captured_at",
                params![
                    server.id,
                    gpu_json,
                    value_f64(&value, "cpuUsage", "cpu_usage"),
                    value_i64(&value, "ramTotal", "ram_total"),
                    value_i64(&value, "ramUsed", "ram_used"),
                    value_i64(&value, "diskTotal", "disk_total"),
                    value_i64(&value, "diskUsed", "disk_used"),
                    value_i64(&value, "queueLength", "queue_length").unwrap_or(0),
                    captured_at
                ],
            )
            .map_err(|error| database_error("saving training resources", error))?;
    }
    get_training_resources(state, training_server_id)?
        .ok_or_else(|| "Training resources could not be reloaded".into())
}

#[tauri::command]
pub fn get_training_resources(
    state: State<'_, AppState>,
    training_server_id: String,
) -> Result<Option<TrainingResourceRecord>, String> {
    let database = state.database.lock().map_err(|error| error.to_string())?;
    database
        .query_row(
            "SELECT training_server_id, gpu_json, cpu_usage, ram_total, ram_used,
                    disk_total, disk_used, queue_length, captured_at
             FROM training_resources WHERE training_server_id = ?1",
            [training_server_id],
            |row| {
                Ok(TrainingResourceRecord {
                    training_server_id: row.get(0)?,
                    gpu_json: row.get(1)?,
                    cpu_usage: row.get(2)?,
                    ram_total: row.get(3)?,
                    ram_used: row.get(4)?,
                    disk_total: row.get(5)?,
                    disk_used: row.get(6)?,
                    queue_length: row.get(7)?,
                    captured_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|error| database_error("reading training resources", error))
}

#[cfg(test)]
mod tests {
    use super::{
        delete_local_dataset, inspect_dataset, validate_open_training_pair, TrainingStreamEvent,
    };
    use crate::domain::records::DatasetExclusion;
    use crate::infrastructure::state::AppState;
    use rusqlite::params;
    use std::{fs, io::Read};
    use uuid::Uuid;
    use zip::ZipArchive;

    #[test]
    fn rejects_open_training_with_a_restricted_ollama_base() {
        assert!(validate_open_training_pair(
            "tinyllama:latest",
            &serde_json::json!({
                "trainingRecipe": "open-base-lora",
                "sourceModel": "TinyLlama/TinyLlama-1.1B-Chat-v0.6"
            }),
        )
        .is_ok());
        let error = validate_open_training_pair(
            "llama3.2:3b",
            &serde_json::json!({
                "trainingRecipe": "open-base-lora",
                "sourceModel": "TinyLlama/TinyLlama-1.1B-Chat-v0.6"
            }),
        )
        .expect_err("restricted Ollama base must be rejected");
        assert!(error.contains("tinyllama:latest"));
    }

    #[test]
    fn serializes_upload_progress_fields_for_typescript() {
        let event = TrainingStreamEvent::UploadProgress {
            upload_id: "upload-1".into(),
            bytes_uploaded: 10,
            total_bytes: 20,
            progress: 50.0,
            speed_bps: 4.0,
            eta_seconds: Some(3),
        };
        let value = serde_json::to_value(event).expect("event should serialize");

        assert_eq!(value["type"], "uploadProgress");
        assert_eq!(value["uploadId"], "upload-1");
        assert_eq!(value["bytesUploaded"], 10);
        assert_eq!(value["totalBytes"], 20);
        assert!(value.get("upload_id").is_none());
    }

    #[test]
    fn deletes_dataset_metadata_and_managed_artifact() {
        let root = std::env::temp_dir().join(format!("tome-delete-test-{}", Uuid::new_v4()));
        let database_path = root.join("tome.sqlite3");
        let artifact_dir = root.join("training").join("datasets");
        let artifact = artifact_dir.join("fixture.zip");
        fs::create_dir_all(&artifact_dir).expect("managed artifact directory should be created");
        fs::write(&artifact, b"managed test artifact").expect("managed artifact should be written");
        let state = AppState::new(&database_path).expect("test state should be created");
        {
            let database = state.database.lock().expect("test database should lock");
            database
                .execute(
                    "INSERT INTO training_datasets(
                        id, name, source_path, artifact_path, format, compressed,
                        validation_status, validation_errors_json, created_at, updated_at
                     ) VALUES (?1, 'Fixture', '/external/source.jsonl', ?2, 'jsonl', 1,
                               'valid', '[]', ?3, ?3)",
                    params![
                        "fixture",
                        artifact.to_string_lossy().to_string(),
                        "2026-07-28T00:00:00Z"
                    ],
                )
                .expect("test dataset should be inserted");
        }

        delete_local_dataset(&state, "fixture", artifact.to_str())
            .expect("dataset should be deleted");

        assert!(!artifact.exists());
        let remaining = state
            .database
            .lock()
            .expect("test database should lock")
            .query_row(
                "SELECT COUNT(*) FROM training_datasets WHERE id='fixture'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .expect("dataset count should be readable");
        assert_eq!(remaining, 0);
        drop(state);
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn validates_and_compresses_jsonl_datasets() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("instructions.jsonl");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(
            &dataset,
            "{\"prompt\":\"Hello\",\"response\":\"Hi\"}\n{\"prompt\":\"Bye\",\"response\":\"Goodbye\"}\n",
        )
        .expect("test dataset should be written");

        let mut stages = Vec::new();
        let result = inspect_dataset(
            "fixture",
            &dataset,
            &["jsonl".into()],
            true,
            &[],
            &root,
            |progress| stages.push(progress.stage),
        )
        .expect("dataset should be inspected");

        assert_eq!(result.status, "valid");
        assert_eq!(result.file_count, 1);
        assert!(result.checksum.is_some());
        assert!(result
            .artifact_path
            .as_deref()
            .is_some_and(|path| path.ends_with("fixture.zip")));
        assert!(stages.contains(&"Scanning Files"));
        assert!(stages.contains(&"Validating Structure"));
        assert!(stages.contains(&"Compressing"));
        assert_eq!(stages.last(), Some(&"Ready for Upload"));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn detects_ndjson_records_stored_with_a_json_extension() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("github-events.json");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(
            &dataset,
            "{\"prompt\":\"Plan one\",\"response\":\"Step one\u{2028}Step two\"}\n{\"instruction\":\"Plan two\",\"output\":\"Review dependencies\"}\n",
        )
        .expect("test dataset should be written");

        let result = inspect_dataset(
            "github-events",
            &dataset,
            &["json".into()],
            false,
            &[],
            &root,
            |_| {},
        )
        .expect("dataset should be inspected");

        assert_eq!(result.status, "valid");
        assert_eq!(result.format, "jsonl");
        assert!(result.issues.iter().all(|issue| issue.severity != "error"));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn reports_invalid_jsonl_with_a_line_number() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("invalid.jsonl");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(&dataset, "{\"valid\":true}\nnot-json\n")
            .expect("test dataset should be written");

        let result = inspect_dataset(
            "invalid",
            &dataset,
            &["jsonl".into()],
            false,
            &[],
            &root,
            |_| {},
        )
        .expect("dataset should be inspected");

        assert_eq!(result.status, "invalid");
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.message.contains("line 2")));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn excludes_a_bad_jsonl_row_from_the_managed_artifact() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("records.jsonl");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(
            &dataset,
            "{\"instruction\":\"Plan A\",\"output\":\"Steps A\"}\nnot-json\n{\"instruction\":\"Plan B\",\"output\":\"Steps B\"}\n",
        )
        .expect("test dataset should be written");

        let initial = inspect_dataset(
            "repairable",
            &dataset,
            &["jsonl".into()],
            true,
            &[],
            &root,
            |_| {},
        )
        .expect("dataset should be inspected");
        let invalid_issue = initial
            .issues
            .iter()
            .find(|issue| issue.code == "invalid_json")
            .expect("invalid row should be reported");
        assert_eq!(invalid_issue.row, Some(2));
        assert!(invalid_issue.can_exclude_row);

        let repaired = inspect_dataset(
            "repairable",
            &dataset,
            &["jsonl".into()],
            true,
            &[DatasetExclusion {
                file: "records.jsonl".into(),
                row: Some(2),
                issue_code: None,
            }],
            &root,
            |_| {},
        )
        .expect("dataset should be repaired");
        assert_eq!(repaired.status, "valid");
        let artifact = fs::File::open(
            repaired
                .artifact_path
                .as_deref()
                .expect("repaired artifact should exist"),
        )
        .expect("artifact should open");
        let mut archive = ZipArchive::new(artifact).expect("artifact should be a ZIP");
        let mut content = String::new();
        archive
            .by_name("records.jsonl")
            .expect("cleaned dataset file should exist")
            .read_to_string(&mut content)
            .expect("cleaned file should be readable");
        assert!(!content.contains("not-json"));
        assert!(content.contains("Plan A"));
        assert!(content.contains("Plan B"));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn excludes_all_rows_matching_a_validation_code() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("mixed-records.jsonl");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(
            &dataset,
            "{\"instruction\":\"Plan release\",\"output\":\"Review dependencies\"}\n{\"id\":\"event-1\",\"type\":\"IssuesEvent\"}\n{\"id\":\"event-2\",\"type\":\"PullRequestEvent\"}\n",
        )
        .expect("test dataset should be written");

        let repaired = inspect_dataset(
            "bulk-repair",
            &dataset,
            &["jsonl".into()],
            true,
            &[DatasetExclusion {
                file: "*".into(),
                row: None,
                issue_code: Some("unrecognized_training_fields".into()),
            }],
            &root,
            |_| {},
        )
        .expect("dataset should be inspected");

        assert_eq!(repaired.status, "valid");
        assert!(repaired
            .issues
            .iter()
            .all(|issue| issue.code != "unrecognized_training_fields"));
        let artifact = fs::File::open(
            repaired
                .artifact_path
                .as_deref()
                .expect("repaired artifact should exist"),
        )
        .expect("artifact should open");
        let mut archive = ZipArchive::new(artifact).expect("artifact should be a ZIP");
        let mut content = String::new();
        archive
            .by_name("mixed-records.jsonl")
            .expect("cleaned dataset file should exist")
            .read_to_string(&mut content)
            .expect("cleaned file should be readable");
        assert!(content.contains("Plan release"));
        assert!(!content.contains("event-1"));
        assert!(!content.contains("event-2"));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn rejects_a_dataset_when_bulk_cleanup_removes_every_record() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("events.jsonl");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(
            &dataset,
            "{\"id\":\"event-1\",\"type\":\"IssuesEvent\"}\n{\"id\":\"event-2\",\"type\":\"PushEvent\"}\n",
        )
        .expect("test dataset should be written");

        let result = inspect_dataset(
            "empty-after-cleanup",
            &dataset,
            &["jsonl".into()],
            true,
            &[DatasetExclusion {
                file: "*".into(),
                row: None,
                issue_code: Some("unrecognized_training_fields".into()),
            }],
            &root,
            |_| {},
        )
        .expect("dataset should be inspected");

        assert_eq!(result.status, "invalid");
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.code == "no_training_records"));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn excludes_a_logical_row_from_a_json_array_without_corrupting_json() {
        let root = std::env::temp_dir().join(format!("tome-dataset-test-{}", Uuid::new_v4()));
        let dataset = root.join("instructions.json");
        fs::create_dir_all(&root).expect("test directory should be created");
        fs::write(
            &dataset,
            r#"[
              {"instruction":"Plan A","output":"Steps A"},
              {"instruction":"Missing answer","output":""},
              {"instruction":"Plan B","output":"Steps B"}
            ]"#,
        )
        .expect("test dataset should be written");

        let repaired = inspect_dataset(
            "json-array-repair",
            &dataset,
            &["json".into()],
            true,
            &[DatasetExclusion {
                file: "instructions.json".into(),
                row: Some(2),
                issue_code: None,
            }],
            &root,
            |_| {},
        )
        .expect("dataset should be inspected");

        assert_eq!(repaired.status, "valid");
        let artifact = fs::File::open(
            repaired
                .artifact_path
                .as_deref()
                .expect("repaired artifact should exist"),
        )
        .expect("artifact should open");
        let mut archive = ZipArchive::new(artifact).expect("artifact should be a ZIP");
        let mut content = String::new();
        archive
            .by_name("instructions.json")
            .expect("cleaned dataset file should exist")
            .read_to_string(&mut content)
            .expect("cleaned file should be readable");
        let parsed: serde_json::Value =
            serde_json::from_str(&content).expect("cleaned file should remain valid JSON");
        assert_eq!(parsed.as_array().map(Vec::len), Some(2));
        assert!(content.contains("Plan A"));
        assert!(content.contains("Plan B"));
        assert!(!content.contains("Missing answer"));
        fs::remove_dir_all(&root).expect("test directory should be removed");
    }
}
