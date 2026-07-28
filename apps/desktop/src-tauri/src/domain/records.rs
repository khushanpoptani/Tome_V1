use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRecord {
    pub id: String,
    pub name: String,
    pub url: String,
    pub is_active: bool,
    pub last_status: Option<String>,
    pub last_ping_ms: Option<i64>,
    pub last_version: Option<String>,
    pub last_error: Option<String>,
    pub last_tested_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    pub id: Option<String>,
    pub name: String,
    pub url: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHistoryRecord {
    pub id: String,
    pub server_id: String,
    pub status: String,
    pub ping_ms: Option<i64>,
    pub version: Option<String>,
    pub error: Option<String>,
    pub tested_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInput {
    pub id: Option<String>,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub create_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub workspace_id: Option<String>,
    pub name: String,
    pub path: String,
    pub archived_at: Option<String>,
    pub duplicate_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub id: Option<String>,
    pub workspace_id: Option<String>,
    pub name: String,
    pub path: String,
    pub archived_at: Option<String>,
    #[serde(default)]
    pub create_directory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub model: Option<String>,
    pub archived_at: Option<String>,
    pub duplicate_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub preview: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationInput {
    pub id: Option<String>,
    pub project_id: Option<String>,
    pub title: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingServerRecord {
    pub id: String,
    pub name: String,
    pub url: String,
    pub adapter: String,
    pub is_active: bool,
    pub status: String,
    pub version: Option<String>,
    pub capabilities_json: String,
    pub last_error: Option<String>,
    pub last_checked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingServerInput {
    pub id: Option<String>,
    pub name: String,
    pub url: String,
    pub adapter: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingDatasetGroupRecord {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingDatasetGroupInput {
    pub id: Option<String>,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingDatasetRecord {
    pub id: String,
    pub group_id: Option<String>,
    pub name: String,
    pub source_path: String,
    pub artifact_path: Option<String>,
    pub format: String,
    pub size: i64,
    pub file_count: i64,
    pub checksum: Option<String>,
    pub compressed: bool,
    pub validation_status: String,
    pub validation_errors_json: String,
    pub preview: Option<String>,
    pub remote_dataset_id: Option<String>,
    pub training_server_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingDatasetInput {
    pub id: Option<String>,
    pub group_id: Option<String>,
    pub name: String,
    pub source_path: String,
    #[serde(default)]
    pub compress: bool,
    pub supported_formats: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetUploadRecord {
    pub id: String,
    pub dataset_id: String,
    pub training_server_id: String,
    pub remote_upload_id: Option<String>,
    pub status: String,
    pub bytes_uploaded: i64,
    pub total_bytes: i64,
    pub chunk_size: i64,
    pub speed_bps: f64,
    pub eta_seconds: Option<i64>,
    pub retry_count: i64,
    pub last_error: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingJobRecord {
    pub id: String,
    pub training_server_id: Option<String>,
    pub remote_job_id: Option<String>,
    pub dataset_id: String,
    pub dataset_ids: Vec<String>,
    pub model: String,
    pub base_model: String,
    pub backend: String,
    pub parameters_json: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub eta_seconds: Option<i64>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub gpu_usage: Option<f64>,
    pub cpu_usage: Option<f64>,
    pub ram_usage: Option<i64>,
    pub disk_usage: Option<i64>,
    pub current_epoch: i64,
    pub total_epochs: i64,
    pub loss: Option<f64>,
    pub learning_rate: Option<f64>,
    pub training_speed: Option<f64>,
    pub heartbeat_at: Option<String>,
    pub warning: Option<String>,
    pub error: Option<String>,
    pub retry_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingJobInput {
    pub id: Option<String>,
    pub training_server_id: Option<String>,
    pub dataset_ids: Vec<String>,
    pub model: String,
    pub base_model: String,
    pub backend: String,
    pub parameters_json: String,
    pub total_epochs: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingResourceRecord {
    pub training_server_id: String,
    pub gpu_json: String,
    pub cpu_usage: Option<f64>,
    pub ram_total: Option<i64>,
    pub ram_used: Option<i64>,
    pub disk_total: Option<i64>,
    pub disk_used: Option<i64>,
    pub queue_length: i64,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainingLogRecord {
    pub id: i64,
    pub training_job_id: Option<String>,
    pub level: String,
    pub message: String,
    pub cursor: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub attachments_json: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInput {
    pub id: Option<String>,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub attachments_json: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub progress: f64,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub logs: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: Option<String>,
    pub kind: String,
    pub title: String,
    pub status: String,
    pub progress: f64,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub logs: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRecord {
    pub id: i64,
    pub category: String,
    pub level: String,
    pub message: String,
    pub details: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestRecord {
    pub server_id: String,
    pub model: String,
    pub tested_at: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Vec<FileTreeNode>,
}
