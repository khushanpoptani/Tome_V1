use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use tokio::{
    fs,
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, Semaphore},
};

use crate::{
    error::{ApiError, ApiResult},
    models::{JobCreatedResponse, JobLog, JobRequest, JobSnapshot, ServerEvent, WorkerEvent},
    registry, resources, AppState,
};

#[derive(Deserialize)]
pub struct LogsQuery {
    after: Option<String>,
}

pub async fn create_job(
    State(state): State<Arc<AppState>>,
    Json(request): Json<JobRequest>,
) -> ApiResult<(StatusCode, Json<JobCreatedResponse>)> {
    validate_backend(&request.backend)?;
    if request.parameters.get("huggingFaceToken").is_some() {
        return Err(ApiError::invalid(
            "huggingFaceToken is a secret and must be supplied through the training preflight endpoint",
        ));
    }
    registry::validate_adapter_compatibility(&request.base_model, &request.parameters)?;
    let (job, inserted) = state.database.create_job(&request)?;
    if inserted {
        state
            .queue
            .send(job.id.clone())
            .await
            .map_err(|_| ApiError::internal("Training queue is unavailable"))?;
        emit_job(&state, &job.id)?;
    }
    Ok((
        if inserted {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(JobCreatedResponse {
            job_id: job.id,
            status: job.status,
        }),
    ))
}

pub async fn list_jobs(State(state): State<Arc<AppState>>) -> ApiResult<Json<Vec<JobSnapshot>>> {
    Ok(Json(state.database.list_job_snapshots()?))
}

pub async fn get_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<Json<JobSnapshot>> {
    Ok(Json(state.database.job_snapshot(&id)?))
}

pub async fn cancel_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<Json<JobSnapshot>> {
    let job = state.database.job_record(&id)?;
    if matches!(job.status.as_str(), "completed" | "failed" | "cancelled") {
        return Ok(Json(state.database.job_snapshot(&id)?));
    }
    if state.database.cancel_queued_job(&id)? {
        append_log(&state, &id, "info", "Queued job cancelled")?;
        emit_job(&state, &id)?;
        return Ok(Json(state.database.job_snapshot(&id)?));
    }
    let cancellation = state
        .cancellations
        .lock()
        .map_err(|error| ApiError::internal(format!("Cancellation lock failed: {error}")))?
        .get(&id)
        .cloned()
        .ok_or_else(|| ApiError::conflict("Running job cancellation handle is unavailable"))?;
    cancellation.store(true, Ordering::Relaxed);
    state.database.update_job(
        &id,
        "cancelling",
        "Cancelling",
        state.database.job_snapshot(&id)?.progress,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )?;
    append_log(&state, &id, "warning", "Cancellation requested")?;
    emit_job(&state, &id)?;
    Ok(Json(state.database.job_snapshot(&id)?))
}

pub async fn retry_job(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ApiResult<(StatusCode, Json<JobCreatedResponse>)> {
    let original = state.database.job_record(&id)?;
    validate_backend(&original.backend)?;
    registry::validate_adapter_compatibility(&original.base_model, &original.parameters)?;
    let client_job_id = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let job = state.database.retry_job(&id, &client_job_id)?;
    state
        .queue
        .send(job.id.clone())
        .await
        .map_err(|_| ApiError::internal("Training queue is unavailable"))?;
    emit_job(&state, &job.id)?;
    Ok((
        StatusCode::CREATED,
        Json(JobCreatedResponse {
            job_id: job.id,
            status: job.status,
        }),
    ))
}

pub async fn retry_registration(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<Json<JobSnapshot>> {
    let job = state.database.job_record(&id)?;
    let snapshot = state.database.job_snapshot(&id)?;
    if job.status != "failed" || snapshot.progress < 97.0 {
        return Err(ApiError::conflict(
            "Registration can only be retried for a failed job whose training artifacts were exported",
        ));
    }
    let job_dir = state.config.data_dir.join("jobs").join(&id);
    let adapter_path = job_dir.join("output");
    if !adapter_path.join("adapter_config.json").is_file()
        || !adapter_path.join("adapter_model.safetensors").is_file()
    {
        return Err(ApiError::conflict(format!(
            "The trained adapter artifacts are incomplete at {}. Run a full training retry.",
            adapter_path.display()
        )));
    }
    state.database.update_job(
        &id,
        "running",
        "Registering with Ollama",
        98.0,
        None,
        Some(job.total_epochs),
        snapshot.loss,
        snapshot.learning_rate,
        snapshot.training_speed,
        None,
        None,
    )?;
    append_log(
        &state,
        &id,
        "info",
        "Retrying Ollama registration with the existing trained adapter",
    )?;
    emit_job(&state, &id)?;
    if let Err(error) =
        registry::register_adapter(&state.config, &job, &adapter_path, &job_dir).await
    {
        state.database.update_job(
            &id,
            "failed",
            "Registration failed",
            98.0,
            None,
            Some(job.total_epochs),
            snapshot.loss,
            snapshot.learning_rate,
            snapshot.training_speed,
            None,
            Some(&error.message),
        )?;
        append_log(&state, &id, "error", &error.message)?;
        emit_job(&state, &id)?;
        return Err(error);
    }
    complete_registration(&state, &job).await?;
    Ok(Json(state.database.job_snapshot(&id)?))
}

pub async fn get_logs(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<LogsQuery>,
) -> ApiResult<Json<Vec<JobLog>>> {
    let mut logs = state.database.job_snapshot(&id)?.logs;
    if let Some(after) = query.after {
        if let Some(position) = logs.iter().position(|log| log.cursor == after) {
            logs = logs.into_iter().skip(position + 1).collect();
        }
    }
    Ok(Json(logs))
}

pub fn spawn_queue(state: Arc<AppState>, mut receiver: mpsc::Receiver<String>, concurrency: usize) {
    tokio::spawn(async move {
        let semaphore = Arc::new(Semaphore::new(concurrency));
        while let Some(id) = receiver.recv().await {
            let Ok(permit) = semaphore.clone().acquire_owned().await else {
                break;
            };
            let state = state.clone();
            tokio::spawn(async move {
                let _permit = permit;
                if let Err(error) = run_job(state.clone(), &id).await {
                    tracing::error!(job_id = %id, error = %error.message, "training job failed");
                    let snapshot = state.database.job_snapshot(&id).ok();
                    let already_cancelled = snapshot
                        .as_ref()
                        .is_some_and(|job| job.status == "cancelled");
                    if !already_cancelled {
                        let _ = state.database.update_job(
                            &id,
                            "failed",
                            "Failed",
                            snapshot.map(|job| job.progress).unwrap_or_default(),
                            None,
                            None,
                            None,
                            None,
                            None,
                            None,
                            Some(&error.message),
                        );
                        let _ = append_log(&state, &id, "error", &error.message);
                        let _ = emit_job(&state, &id);
                    }
                }
                if let Ok(mut cancellations) = state.cancellations.lock() {
                    cancellations.remove(&id);
                }
            });
        }
    });
}

pub async fn recover_queue(state: &Arc<AppState>) -> ApiResult<()> {
    for id in state.database.queued_job_ids()? {
        state
            .queue
            .send(id)
            .await
            .map_err(|_| ApiError::internal("Training queue is unavailable"))?;
    }
    Ok(())
}

async fn run_job(state: Arc<AppState>, id: &str) -> ApiResult<()> {
    let job = state.database.job_record(id)?;
    if job.status == "cancelled" {
        return Ok(());
    }
    validate_backend(&job.backend)?;
    registry::validate_adapter_compatibility(&job.base_model, &job.parameters)?;
    let mut datasets = Vec::with_capacity(job.dataset_ids.len());
    for dataset_id in &job.dataset_ids {
        let dataset = state.database.dataset(dataset_id)?;
        if dataset.validation_status != "valid" {
            return Err(ApiError::conflict(format!(
                "Training dataset {} is not valid",
                dataset.name
            )));
        }
        datasets.push(dataset);
    }
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|error| ApiError::internal(format!("Cancellation lock failed: {error}")))?
        .insert(id.to_string(), cancellation.clone());
    state.database.mark_running(id)?;
    append_log(&state, id, "info", "Training worker preparation started")?;
    emit_job(&state, id)?;

    let job_dir = state.config.data_dir.join("jobs").join(id);
    let output_dir = job_dir.join("output");
    fs::create_dir_all(&output_dir).await?;
    let specification_path = job_dir.join("specification.json");
    let dataset_paths = datasets
        .iter()
        .map(|dataset| dataset.content_path.clone())
        .collect::<Vec<_>>();
    let dataset_sources = datasets
        .iter()
        .map(|dataset| {
            serde_json::json!({
                "id": dataset.id,
                "name": dataset.name,
                "path": dataset.content_path,
            })
        })
        .collect::<Vec<_>>();
    let specification = serde_json::json!({
        "jobId": job.id,
        "datasetPath": dataset_paths[0],
        "datasetPaths": dataset_paths,
        "datasets": dataset_sources,
        "outputPath": output_dir,
        "model": job.model,
        "baseModel": job.base_model,
        "backend": normalized_backend(&job.backend),
        "parameters": job.parameters,
        "epochs": job.total_epochs
    });
    fs::write(
        &specification_path,
        serde_json::to_vec_pretty(&specification)
            .map_err(|error| ApiError::internal(format!("Could not serialize job: {error}")))?,
    )
    .await?;
    ensure_worker_available(&state).await?;
    let mut worker_command = Command::new(&state.config.python_executable);
    worker_command
        .arg(&state.config.worker_script)
        .arg("--spec")
        .arg(&specification_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(token) = state
        .huggingface_token
        .lock()
        .map_err(|error| ApiError::internal(format!("Credential lock failed: {error}")))?
        .clone()
    {
        worker_command.env("HF_TOKEN", token);
    }
    let mut child = worker_command.spawn().map_err(|error| {
        ApiError::internal(format!(
            "Could not start Python worker {}: {error}",
            state.config.python_executable.display()
        ))
    })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ApiError::internal("Worker stderr was unavailable"))?;
    let state_for_stderr = state.clone();
    let id_for_stderr = id.to_string();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = append_log(&state_for_stderr, &id_for_stderr, "warning", &line);
        }
    });
    let worker_pid = child.id();
    let adapter_path = consume_worker(
        &state,
        id,
        &mut child,
        cancellation,
        Instant::now(),
        worker_pid,
    )
    .await?;
    let _ = stderr_task.await;

    state.database.update_job(
        id,
        "running",
        "Registering with Ollama",
        98.0,
        None,
        Some(job.total_epochs),
        None,
        None,
        None,
        None,
        None,
    )?;
    append_log(
        &state,
        id,
        "info",
        "Training artifacts validated; registering model with Ollama",
    )?;
    emit_job(&state, id)?;
    registry::register_adapter(&state.config, &job, &adapter_path, &job_dir).await?;
    complete_registration(&state, &job).await
}

async fn complete_registration(
    state: &AppState,
    job: &crate::database::JobRecord,
) -> ApiResult<()> {
    let id = &job.id;
    state.database.mark_registered(id, &job.model)?;
    state.database.update_job(
        id,
        "completed",
        "Completed",
        100.0,
        Some(0),
        Some(job.total_epochs),
        None,
        None,
        None,
        None,
        None,
    )?;
    append_log(
        state,
        id,
        "info",
        &format!("Model {} registered with Ollama", job.model),
    )?;
    let _ = state.events.send(ServerEvent::ModelRegistered {
        job_id: id.to_string(),
        model: job.model.clone(),
    });
    emit_job(state, id)?;
    Ok(())
}

async fn consume_worker(
    state: &AppState,
    id: &str,
    child: &mut Child,
    cancellation: Arc<AtomicBool>,
    started: Instant,
    worker_pid: Option<u32>,
) -> ApiResult<PathBuf> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::internal("Worker stdout was unavailable"))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut adapter_path = None;
    let mut last_worker_error = None;
    let resource_interval = Duration::from_secs(2);
    let mut last_resource_sample = Instant::now()
        .checked_sub(resource_interval)
        .unwrap_or_else(Instant::now);
    loop {
        if cancellation.load(Ordering::Relaxed) {
            let _ = child.start_kill();
            let _ = child.wait().await;
            state.database.update_job(
                id,
                "cancelled",
                "Cancelled",
                state.database.job_snapshot(id)?.progress,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            )?;
            append_log(state, id, "warning", "Training worker cancelled")?;
            emit_job(state, id)?;
            return Err(ApiError::conflict("Training job was cancelled"));
        }
        match tokio::time::timeout(Duration::from_millis(300), lines.next_line()).await {
            Ok(Ok(Some(line))) => {
                if let Ok(event) = serde_json::from_str::<WorkerEvent>(&line) {
                    if event.kind == "log" && event.level.as_deref() == Some("error") {
                        last_worker_error = event.message.clone();
                    }
                    if let Some(path) = process_worker_event(state, id, event, started)? {
                        adapter_path = Some(path);
                    }
                } else if !line.trim().is_empty() {
                    append_log(state, id, "info", &line)?;
                }
            }
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                return Err(ApiError::internal(format!(
                    "Could not read worker output: {error}"
                )));
            }
            Err(_) => {
                if let Some(status) = child.try_wait()? {
                    if !status.success() {
                        return Err(worker_failure(status, last_worker_error.as_deref()));
                    }
                    break;
                }
                if last_resource_sample.elapsed() >= resource_interval {
                    last_resource_sample = Instant::now();
                    if let Ok(snapshot) = resources::job_usage(state, worker_pid).await {
                        state.database.update_job_resources(
                            id,
                            snapshot.gpu_usage,
                            snapshot.cpu_usage,
                            snapshot.ram_usage,
                            snapshot.disk_io,
                        )?;
                        emit_job(state, id)?;
                    }
                }
            }
        }
    }
    let status = child.wait().await?;
    if !status.success() {
        return Err(worker_failure(status, last_worker_error.as_deref()));
    }
    adapter_path.ok_or_else(|| {
        ApiError::internal("Training worker completed without reporting an adapterPath")
    })
}

fn worker_failure(status: std::process::ExitStatus, last_worker_error: Option<&str>) -> ApiError {
    let status_detail = format!("worker {status}");
    match last_worker_error
        .map(str::trim)
        .filter(|message| !message.is_empty())
    {
        Some(message) => ApiError::internal(format!("{message} ({status_detail})")),
        None => ApiError::internal(format!("Training worker exited with {status}")),
    }
}

fn process_worker_event(
    state: &AppState,
    id: &str,
    event: WorkerEvent,
    started: Instant,
) -> ApiResult<Option<PathBuf>> {
    if event.kind == "log" {
        append_log(
            state,
            id,
            event.level.as_deref().unwrap_or("info"),
            event.message.as_deref().unwrap_or("Worker event"),
        )?;
        return Ok(None);
    }
    if event.kind == "complete" {
        return Ok(event.adapter_path.map(PathBuf::from));
    }
    let current = state.database.job_snapshot(id)?;
    let progress = event.progress.unwrap_or(current.progress).clamp(0.0, 97.0);
    let eta = (progress > 0.0).then(|| {
        ((started.elapsed().as_secs_f64() / progress) * (100.0 - progress)).round() as i64
    });
    state.database.update_job(
        id,
        "running",
        event.stage.as_deref().unwrap_or("Training"),
        progress,
        eta,
        event.epoch,
        event.loss,
        event.learning_rate,
        event.samples_per_second,
        None,
        None,
    )?;
    if let Some(message) = event.message {
        append_log(
            state,
            id,
            event.level.as_deref().unwrap_or("info"),
            &message,
        )?;
    }
    emit_job(state, id)?;
    Ok(None)
}

async fn ensure_worker_available(state: &AppState) -> ApiResult<()> {
    if !state.config.worker_script.is_file() {
        return Err(ApiError::conflict(format!(
            "Training worker is not installed at {}",
            state.config.worker_script.display()
        )));
    }
    let output = Command::new(&state.config.python_executable)
        .arg(&state.config.worker_script)
        .arg("--probe")
        .output()
        .await
        .map_err(|error| {
            ApiError::conflict(format!(
                "Python training environment is unavailable: {error}"
            ))
        })?;
    if !output.status.success() {
        return Err(ApiError::conflict(format!(
            "Python training dependencies are unavailable: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

fn validate_backend(value: &str) -> ApiResult<()> {
    if matches!(
        value.to_ascii_lowercase().as_str(),
        "auto" | "transformers" | "peft" | "lora" | "qlora"
    ) {
        Ok(())
    } else {
        Err(ApiError::invalid(format!(
            "Backend {value} is not installed. Supported executable backends: transformers, PEFT, LoRA, QLoRA"
        )))
    }
}

fn normalized_backend(value: &str) -> &str {
    if value.eq_ignore_ascii_case("auto") {
        "lora"
    } else {
        value
    }
}

fn append_log(state: &AppState, id: &str, level: &str, message: &str) -> ApiResult<()> {
    let log = state.database.append_log(id, level, message)?;
    let _ = state.events.send(ServerEvent::Log {
        job_id: id.to_string(),
        cursor: log.cursor,
        level: log.level,
        message: log.message,
    });
    Ok(())
}

fn emit_job(state: &AppState, id: &str) -> ApiResult<()> {
    let job = state.database.job_snapshot(id)?;
    let _ = state.events.send(ServerEvent::Job {
        job_id: id.to_string(),
        status: job.status,
        stage: job.stage,
        progress: job.progress,
    });
    Ok(())
}

pub fn cancellations() -> Mutex<HashMap<String, Arc<AtomicBool>>> {
    Mutex::new(HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::worker_failure;

    #[cfg(unix)]
    #[test]
    fn preserves_the_actionable_worker_error_when_the_process_fails() {
        use std::os::unix::process::ExitStatusExt;

        let error = worker_failure(
            std::process::ExitStatus::from_raw(1 << 8),
            Some("Dataset 'planning', file 'records.json', record 4 needs output"),
        );

        assert!(error.message.contains("Dataset 'planning'"));
        assert!(error.message.contains("record 4"));
        assert!(error.message.contains("exit status: 1"));
    }
}
