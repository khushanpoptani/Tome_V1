use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub client_upload_id: String,
    pub dataset_id: String,
    pub name: String,
    pub format: String,
    pub size: i64,
    pub sha256: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub upload_id: String,
    pub uploaded_bytes: i64,
    pub chunk_size: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteUploadRequest {
    pub sha256: String,
    pub size: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteUploadResponse {
    pub dataset_id: String,
    pub validation_status: String,
    pub file_count: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRequest {
    pub client_job_id: String,
    pub dataset_id: String,
    pub model: String,
    pub base_model: String,
    pub backend: String,
    pub parameters: Value,
    pub epochs: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCreatedResponse {
    pub job_id: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub job_id: String,
    pub client_job_id: String,
    pub dataset_id: String,
    pub model: String,
    pub base_model: String,
    pub backend: String,
    pub parameters: Value,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub eta_seconds: Option<i64>,
    pub current_epoch: i64,
    pub total_epochs: i64,
    pub gpu_usage: Option<f64>,
    pub cpu_usage: Option<f64>,
    pub ram_usage: Option<i64>,
    pub disk_usage: Option<i64>,
    pub loss: Option<f64>,
    pub learning_rate: Option<f64>,
    pub training_speed: Option<f64>,
    pub warning: Option<String>,
    pub error: Option<String>,
    pub registered_model: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub logs: Vec<JobLog>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobLog {
    pub cursor: String,
    pub level: String,
    pub message: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub stage: Option<String>,
    pub progress: Option<f64>,
    pub epoch: Option<i64>,
    pub total_epochs: Option<i64>,
    pub loss: Option<f64>,
    pub learning_rate: Option<f64>,
    pub samples_per_second: Option<f64>,
    pub level: Option<String>,
    pub message: Option<String>,
    pub adapter_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ServerEvent {
    Job {
        job_id: String,
        status: String,
        stage: String,
        progress: f64,
    },
    Log {
        job_id: String,
        cursor: String,
        level: String,
        message: String,
    },
    ModelRegistered {
        job_id: String,
        model: String,
    },
    Resources,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuResource {
    pub index: i64,
    pub name: String,
    pub utilization: f64,
    pub memory_total: i64,
    pub memory_used: i64,
    pub temperature: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    pub gpus: Vec<GpuResource>,
    pub cpu_usage: f64,
    pub ram_total: i64,
    pub ram_used: i64,
    pub disk_total: i64,
    pub disk_used: i64,
    pub queue_length: i64,
    pub captured_at: String,
}
