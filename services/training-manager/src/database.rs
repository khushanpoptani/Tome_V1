use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    models::{JobLog, JobRequest, JobSnapshot, UploadRequest},
};

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone)]
pub struct UploadRecord {
    pub id: String,
    pub client_upload_id: String,
    pub dataset_id: String,
    pub name: String,
    pub format: String,
    pub expected_size: i64,
    pub expected_sha256: String,
    pub uploaded_bytes: i64,
    pub chunk_size: i64,
    pub status: String,
    pub partial_path: PathBuf,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DatasetRecord {
    pub id: String,
    pub name: String,
    pub format: String,
    pub size: i64,
    pub sha256: String,
    pub artifact_path: PathBuf,
    pub content_path: PathBuf,
    pub validation_status: String,
}

#[derive(Debug, Clone)]
pub struct JobRecord {
    pub id: String,
    pub client_job_id: String,
    pub dataset_id: String,
    pub dataset_ids: Vec<String>,
    pub model: String,
    pub base_model: String,
    pub backend: String,
    pub parameters: Value,
    pub status: String,
    pub total_epochs: i64,
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> ApiResult<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "busy_timeout", 5_000)?;
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS uploads (
                id TEXT PRIMARY KEY,
                client_upload_id TEXT NOT NULL UNIQUE,
                dataset_id TEXT NOT NULL,
                name TEXT NOT NULL,
                format TEXT NOT NULL,
                expected_size INTEGER NOT NULL,
                expected_sha256 TEXT NOT NULL,
                uploaded_bytes INTEGER NOT NULL DEFAULT 0,
                chunk_size INTEGER NOT NULL,
                status TEXT NOT NULL,
                partial_path TEXT NOT NULL,
                last_error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY,
                source_upload_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                format TEXT NOT NULL,
                size INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                artifact_path TEXT NOT NULL,
                content_path TEXT NOT NULL,
                file_count INTEGER NOT NULL,
                validation_status TEXT NOT NULL,
                validation_errors_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(source_upload_id) REFERENCES uploads(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                client_job_id TEXT NOT NULL UNIQUE,
                dataset_id TEXT NOT NULL,
                dataset_ids_json TEXT NOT NULL DEFAULT '[]',
                model TEXT NOT NULL,
                base_model TEXT NOT NULL,
                backend TEXT NOT NULL,
                parameters_json TEXT NOT NULL,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress REAL NOT NULL DEFAULT 0,
                eta_seconds INTEGER,
                current_epoch INTEGER NOT NULL DEFAULT 0,
                total_epochs INTEGER NOT NULL,
                gpu_usage REAL,
                cpu_usage REAL,
                ram_usage INTEGER,
                disk_usage INTEGER,
                loss REAL,
                learning_rate REAL,
                training_speed REAL,
                warning TEXT,
                error TEXT,
                registered_model TEXT,
                retry_of TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(dataset_id) REFERENCES datasets(id) ON DELETE RESTRICT,
                FOREIGN KEY(retry_of) REFERENCES jobs(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

            CREATE TABLE IF NOT EXISTS job_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                cursor TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(job_id, cursor),
                FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );

            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
            VALUES (1, datetime('now'));
            "#,
        )?;
        let has_dataset_ids = {
            let mut statement = connection.prepare("PRAGMA table_info(jobs)")?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;
            columns.iter().any(|column| column == "dataset_ids_json")
        };
        if !has_dataset_ids {
            connection.execute_batch(
                r#"
                BEGIN IMMEDIATE;
                ALTER TABLE jobs
                    ADD COLUMN dataset_ids_json TEXT NOT NULL DEFAULT '[]';
                UPDATE jobs
                SET dataset_ids_json='["' || dataset_id || '"]'
                WHERE dataset_ids_json='[]';
                INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (2, datetime('now'));
                COMMIT;
                "#,
            )?;
        } else {
            connection.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                 VALUES (2, datetime('now'))",
                [],
            )?;
        }
        connection.execute(
            "UPDATE jobs SET status='queued', stage='Recovering after restart',
                warning='The Training Manager restarted; the job was re-queued',
                updated_at=?1
             WHERE status IN ('running', 'cancelling')",
            [now()],
        )?;
        connection.execute(
            "UPDATE uploads SET status='failed',
                last_error='Training Manager restarted during server validation; resume the upload to recover',
                updated_at=?1
             WHERE status='validating'",
            [now()],
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn create_or_resume_upload(
        &self,
        request: &UploadRequest,
        partial_path: &Path,
        chunk_size: i64,
    ) -> ApiResult<UploadRecord> {
        if request.client_upload_id.trim().is_empty()
            || request.dataset_id.trim().is_empty()
            || request.name.trim().is_empty()
            || request.size <= 0
            || request.sha256.trim().is_empty()
        {
            return Err(ApiError::invalid(
                "clientUploadId, datasetId, name, size, and sha256 are required",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "INSERT INTO uploads(
                id, client_upload_id, dataset_id, name, format, expected_size,
                expected_sha256, uploaded_bytes, chunk_size, status, partial_path,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, 'pending', ?9, ?10, ?10)
             ON CONFLICT(client_upload_id) DO UPDATE SET
                dataset_id=excluded.dataset_id,
                name=excluded.name,
                format=excluded.format,
                updated_at=excluded.updated_at
             WHERE uploads.status != 'completed'
               AND uploads.expected_size=excluded.expected_size
               AND uploads.expected_sha256=excluded.expected_sha256",
            params![
                id,
                request.client_upload_id,
                request.dataset_id,
                request.name.trim(),
                request.format.trim(),
                request.size,
                normalize_sha256(&request.sha256),
                chunk_size,
                partial_path.to_string_lossy(),
                timestamp
            ],
        )?;
        let upload = query_upload(&connection, "client_upload_id", &request.client_upload_id)?
            .ok_or_else(|| ApiError::internal("Upload session could not be loaded"))?;
        if upload.expected_size != request.size
            || upload.expected_sha256 != normalize_sha256(&request.sha256)
        {
            return Err(ApiError::conflict(
                "This upload ID already belongs to a different dataset artifact",
            ));
        }
        Ok(upload)
    }

    pub fn upload(&self, id: &str) -> ApiResult<UploadRecord> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        query_upload(&connection, "id", id)?
            .ok_or_else(|| ApiError::not_found("Upload session does not exist"))
    }

    pub fn set_upload_offset(&self, id: &str, offset: i64) -> ApiResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "UPDATE uploads SET uploaded_bytes=?2, status='uploading',
                last_error=NULL, updated_at=?3 WHERE id=?1",
            params![id, offset, now()],
        )?;
        Ok(())
    }

    pub fn fail_upload(&self, id: &str, error: &str) -> ApiResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|value| ApiError::internal(format!("Database lock was poisoned: {value}")))?;
        connection.execute(
            "UPDATE uploads SET status='failed', last_error=?2, updated_at=?3 WHERE id=?1",
            params![id, error, now()],
        )?;
        Ok(())
    }

    pub fn validate_upload(&self, id: &str) -> ApiResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|value| ApiError::internal(format!("Database lock was poisoned: {value}")))?;
        connection.execute(
            "UPDATE uploads SET status='validating', last_error=NULL, updated_at=?2
             WHERE id=?1",
            params![id, now()],
        )?;
        Ok(())
    }

    pub fn complete_upload(
        &self,
        upload: &UploadRecord,
        artifact_path: &Path,
        content_path: &Path,
        file_count: i64,
    ) -> ApiResult<DatasetRecord> {
        let dataset_id = upload.dataset_id.clone();
        let timestamp = now();
        let mut connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "INSERT INTO datasets(
                id, source_upload_id, name, format, size, sha256, artifact_path,
                content_path, file_count, validation_status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'valid', ?10, ?10)
             ON CONFLICT(id) DO UPDATE SET
                source_upload_id=excluded.source_upload_id,
                name=excluded.name, format=excluded.format, size=excluded.size,
                sha256=excluded.sha256, artifact_path=excluded.artifact_path,
                content_path=excluded.content_path, file_count=excluded.file_count,
                validation_status='valid', validation_errors_json='[]',
                updated_at=excluded.updated_at",
            params![
                dataset_id,
                upload.id,
                upload.name,
                upload.format,
                upload.expected_size,
                upload.expected_sha256,
                artifact_path.to_string_lossy(),
                content_path.to_string_lossy(),
                file_count,
                timestamp
            ],
        )?;
        transaction.execute(
            "UPDATE uploads SET status='completed', uploaded_bytes=expected_size,
                updated_at=?2 WHERE id=?1",
            params![upload.id, timestamp],
        )?;
        transaction.commit()?;
        drop(connection);
        self.dataset_by_upload(&upload.id)?
            .ok_or_else(|| ApiError::internal("Committed dataset could not be loaded"))
    }

    pub fn cancel_upload(&self, id: &str) -> ApiResult<UploadRecord> {
        let upload = self.upload(id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "UPDATE uploads SET status='cancelled', updated_at=?2 WHERE id=?1",
            params![id, now()],
        )?;
        Ok(upload)
    }

    pub fn dataset(&self, id: &str) -> ApiResult<DatasetRecord> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        query_dataset(&connection, "id", id)?
            .ok_or_else(|| ApiError::not_found("Dataset does not exist"))
    }

    pub fn delete_dataset(&self, id: &str) -> ApiResult<DatasetRecord> {
        let dataset = self.dataset(id)?;
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection
            .execute("DELETE FROM datasets WHERE id=?1", [id])
            .map_err(|error| {
                if error.to_string().contains("FOREIGN KEY") {
                    ApiError::conflict("Dataset is referenced by a training job")
                } else {
                    ApiError::from(error)
                }
            })?;
        Ok(dataset)
    }

    fn dataset_by_upload(&self, upload_id: &str) -> ApiResult<Option<DatasetRecord>> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        query_dataset(&connection, "source_upload_id", upload_id)
    }

    pub fn create_job(&self, request: &JobRequest) -> ApiResult<(JobRecord, bool)> {
        if request.client_job_id.trim().is_empty()
            || request.model.trim().is_empty()
            || request.base_model.trim().is_empty()
            || request.epochs < 1
        {
            return Err(ApiError::invalid(
                "clientJobId, model, baseModel, and at least one epoch are required",
            ));
        }
        let requested_dataset_ids = if request.dataset_ids.is_empty() {
            vec![request.dataset_id.trim().to_string()]
        } else {
            request
                .dataset_ids
                .iter()
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty())
                .collect::<Vec<_>>()
        };
        let mut dataset_ids = Vec::new();
        for dataset_id in requested_dataset_ids {
            if !dataset_ids.contains(&dataset_id) {
                dataset_ids.push(dataset_id);
            }
        }
        if dataset_ids.is_empty() {
            return Err(ApiError::invalid("At least one datasetId is required"));
        }
        for dataset_id in &dataset_ids {
            self.dataset(dataset_id)?;
        }
        let dataset_id = dataset_ids[0].clone();
        let dataset_ids_json = serde_json::to_string(&dataset_ids)
            .map_err(|error| ApiError::invalid(format!("datasetIds are invalid: {error}")))?;
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        let parameters = serde_json::to_string(&request.parameters)
            .map_err(|error| ApiError::invalid(format!("parameters are invalid: {error}")))?;
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        let inserted = connection.execute(
            "INSERT INTO jobs(
                id, client_job_id, dataset_id, dataset_ids_json, model, base_model, backend,
                parameters_json, status, stage, progress, current_epoch,
                total_epochs, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', 'Queued', 0, 0, ?9, ?10, ?10)
             ON CONFLICT(client_job_id) DO NOTHING",
            params![
                id,
                request.client_job_id,
                dataset_id,
                dataset_ids_json,
                request.model.trim(),
                request.base_model.trim(),
                request.backend.trim(),
                parameters,
                request.epochs,
                timestamp
            ],
        )?;
        let record = query_job_record(&connection, "client_job_id", &request.client_job_id)?
            .ok_or_else(|| ApiError::internal("Training job could not be loaded"))?;
        Ok((record, inserted > 0))
    }

    pub fn retry_job(&self, source_id: &str, client_job_id: &str) -> ApiResult<JobRecord> {
        let source = self.job_record(source_id)?;
        if !matches!(source.status.as_str(), "failed" | "cancelled") {
            return Err(ApiError::conflict(
                "Only failed or cancelled jobs can be retried",
            ));
        }
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "INSERT INTO jobs(
                id, client_job_id, dataset_id, dataset_ids_json, model, base_model, backend,
                parameters_json, status, stage, progress, current_epoch,
                total_epochs, retry_of, created_at, updated_at
             ) SELECT ?1, ?2, dataset_id, dataset_ids_json, model, base_model, backend,
                      parameters_json, 'queued', 'Queued', 0, 0,
                      total_epochs, id, ?3, ?3
               FROM jobs WHERE id=?4",
            params![id, client_job_id, timestamp, source_id],
        )?;
        query_job_record(&connection, "id", &id)?
            .ok_or_else(|| ApiError::internal("Retried job could not be loaded"))
    }

    pub fn queued_job_ids(&self) -> ApiResult<Vec<String>> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        let mut statement =
            connection.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at")?;
        let values = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(values)
    }

    pub fn job_record(&self, id: &str) -> ApiResult<JobRecord> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        query_job_record(&connection, "id", id)?
            .ok_or_else(|| ApiError::not_found("Training job does not exist"))
    }

    pub fn job_snapshot(&self, id: &str) -> ApiResult<JobSnapshot> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        query_job_snapshot(&connection, id)?
            .ok_or_else(|| ApiError::not_found("Training job does not exist"))
    }

    pub fn list_job_snapshots(&self) -> ApiResult<Vec<JobSnapshot>> {
        let ids = {
            let connection = self.connection.lock().map_err(|error| {
                ApiError::internal(format!("Database lock was poisoned: {error}"))
            })?;
            let mut statement =
                connection.prepare("SELECT id FROM jobs ORDER BY created_at DESC")?;
            let values = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        ids.into_iter().map(|id| self.job_snapshot(&id)).collect()
    }

    pub fn mark_running(&self, id: &str) -> ApiResult<()> {
        self.update_job(
            id,
            "running",
            "Preparing",
            0.0,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )?;
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "UPDATE jobs SET started_at=COALESCE(started_at, ?2) WHERE id=?1",
            params![id, now()],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_job(
        &self,
        id: &str,
        status: &str,
        stage: &str,
        progress: f64,
        eta_seconds: Option<i64>,
        current_epoch: Option<i64>,
        loss: Option<f64>,
        learning_rate: Option<f64>,
        training_speed: Option<f64>,
        warning: Option<&str>,
        error: Option<&str>,
    ) -> ApiResult<()> {
        let terminal = matches!(status, "completed" | "failed" | "cancelled");
        let timestamp = now();
        let connection = self
            .connection
            .lock()
            .map_err(|value| ApiError::internal(format!("Database lock was poisoned: {value}")))?;
        connection.execute(
            "UPDATE jobs SET status=?2, stage=?3, progress=?4, eta_seconds=?5,
                current_epoch=COALESCE(?6, current_epoch), loss=?7,
                learning_rate=?8, training_speed=?9, warning=?10, error=?11,
                finished_at=CASE WHEN ?12=1 THEN COALESCE(finished_at, ?13) ELSE NULL END,
                updated_at=?13 WHERE id=?1",
            params![
                id,
                status,
                stage,
                progress.clamp(0.0, 100.0),
                eta_seconds,
                current_epoch,
                loss,
                learning_rate,
                training_speed,
                warning,
                error,
                i64::from(terminal),
                timestamp
            ],
        )?;
        Ok(())
    }

    pub fn update_job_resources(
        &self,
        id: &str,
        gpu: Option<f64>,
        cpu: Option<f64>,
        ram: Option<i64>,
        disk: Option<i64>,
    ) -> ApiResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "UPDATE jobs SET gpu_usage=?2, cpu_usage=?3, ram_usage=?4,
                disk_usage=?5, updated_at=?6 WHERE id=?1",
            params![id, gpu, cpu, ram, disk, now()],
        )?;
        Ok(())
    }

    pub fn mark_registered(&self, id: &str, model: &str) -> ApiResult<()> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "UPDATE jobs SET registered_model=?2, updated_at=?3 WHERE id=?1",
            params![id, model, now()],
        )?;
        Ok(())
    }

    pub fn append_log(&self, id: &str, level: &str, message: &str) -> ApiResult<JobLog> {
        let cursor = Uuid::new_v4().to_string();
        let timestamp = now();
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection.execute(
            "INSERT INTO job_logs(job_id, cursor, level, message, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, cursor, level, message, timestamp],
        )?;
        Ok(JobLog {
            cursor,
            level: level.into(),
            message: message.into(),
            created_at: timestamp,
        })
    }

    pub fn cancel_queued_job(&self, id: &str) -> ApiResult<bool> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        let affected = connection.execute(
            "UPDATE jobs SET status='cancelled', stage='Cancelled',
                finished_at=?2, updated_at=?2 WHERE id=?1 AND status='queued'",
            params![id, now()],
        )?;
        Ok(affected > 0)
    }

    pub fn queue_length(&self) -> ApiResult<i64> {
        let connection = self
            .connection
            .lock()
            .map_err(|error| ApiError::internal(format!("Database lock was poisoned: {error}")))?;
        connection
            .query_row(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'running', 'cancelling')",
                [],
                |row| row.get(0),
            )
            .map_err(ApiError::from)
    }
}

fn query_upload(
    connection: &Connection,
    column: &str,
    value: &str,
) -> ApiResult<Option<UploadRecord>> {
    if !matches!(column, "id" | "client_upload_id") {
        return Err(ApiError::internal("Invalid upload lookup column"));
    }
    connection
        .query_row(
            &format!(
                "SELECT id, client_upload_id, dataset_id, name, format,
                        expected_size, expected_sha256, uploaded_bytes,
                        chunk_size, status, partial_path, last_error
                 FROM uploads WHERE {column}=?1"
            ),
            [value],
            |row| {
                Ok(UploadRecord {
                    id: row.get(0)?,
                    client_upload_id: row.get(1)?,
                    dataset_id: row.get(2)?,
                    name: row.get(3)?,
                    format: row.get(4)?,
                    expected_size: row.get(5)?,
                    expected_sha256: row.get(6)?,
                    uploaded_bytes: row.get(7)?,
                    chunk_size: row.get(8)?,
                    status: row.get(9)?,
                    partial_path: PathBuf::from(row.get::<_, String>(10)?),
                    last_error: row.get(11)?,
                })
            },
        )
        .optional()
        .map_err(ApiError::from)
}

fn query_dataset(
    connection: &Connection,
    column: &str,
    value: &str,
) -> ApiResult<Option<DatasetRecord>> {
    if !matches!(column, "id" | "source_upload_id") {
        return Err(ApiError::internal("Invalid dataset lookup column"));
    }
    connection
        .query_row(
            &format!(
                "SELECT id, name, format, size, sha256, artifact_path,
                        content_path, validation_status
                 FROM datasets WHERE {column}=?1"
            ),
            [value],
            |row| {
                Ok(DatasetRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    format: row.get(2)?,
                    size: row.get(3)?,
                    sha256: row.get(4)?,
                    artifact_path: PathBuf::from(row.get::<_, String>(5)?),
                    content_path: PathBuf::from(row.get::<_, String>(6)?),
                    validation_status: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(ApiError::from)
}

fn query_job_record(
    connection: &Connection,
    column: &str,
    value: &str,
) -> ApiResult<Option<JobRecord>> {
    if !matches!(column, "id" | "client_job_id") {
        return Err(ApiError::internal("Invalid job lookup column"));
    }
    connection
        .query_row(
            &format!(
                "SELECT id, client_job_id, dataset_id, dataset_ids_json, model, base_model,
                        backend, parameters_json, status, total_epochs
                 FROM jobs WHERE {column}=?1"
            ),
            [value],
            |row| {
                let dataset_id = row.get::<_, String>(2)?;
                let dataset_ids_json = row.get::<_, String>(3)?;
                let mut dataset_ids =
                    serde_json::from_str::<Vec<String>>(&dataset_ids_json).unwrap_or_default();
                if dataset_ids.is_empty() {
                    dataset_ids.push(dataset_id.clone());
                }
                let parameters = row.get::<_, String>(7)?;
                Ok(JobRecord {
                    id: row.get(0)?,
                    client_job_id: row.get(1)?,
                    dataset_id,
                    dataset_ids,
                    model: row.get(4)?,
                    base_model: row.get(5)?,
                    backend: row.get(6)?,
                    parameters: serde_json::from_str(&parameters).unwrap_or(Value::Null),
                    status: row.get(8)?,
                    total_epochs: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(ApiError::from)
}

fn query_job_snapshot(connection: &Connection, id: &str) -> ApiResult<Option<JobSnapshot>> {
    let snapshot = connection
        .query_row(
            "SELECT id, client_job_id, dataset_id, dataset_ids_json, model, base_model,
                    backend, parameters_json, status, stage, progress, eta_seconds,
                    current_epoch, total_epochs, gpu_usage, cpu_usage, ram_usage,
                    disk_usage, loss, learning_rate, training_speed, warning,
                    error, registered_model, started_at, finished_at, created_at, updated_at
             FROM jobs WHERE id=?1",
            [id],
            map_job_snapshot,
        )
        .optional()?;
    let Some(mut snapshot) = snapshot else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT cursor, level, message, created_at FROM job_logs
         WHERE job_id=?1 ORDER BY id DESC LIMIT 500",
    )?;
    snapshot.logs = statement
        .query_map([id], |row| {
            Ok(JobLog {
                cursor: row.get(0)?,
                level: row.get(1)?,
                message: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    snapshot.logs.reverse();
    Ok(Some(snapshot))
}

fn map_job_snapshot(row: &Row<'_>) -> rusqlite::Result<JobSnapshot> {
    let dataset_id = row.get::<_, String>(2)?;
    let dataset_ids_json = row.get::<_, String>(3)?;
    let mut dataset_ids =
        serde_json::from_str::<Vec<String>>(&dataset_ids_json).unwrap_or_default();
    if dataset_ids.is_empty() {
        dataset_ids.push(dataset_id.clone());
    }
    let parameters = row.get::<_, String>(7)?;
    Ok(JobSnapshot {
        job_id: row.get(0)?,
        client_job_id: row.get(1)?,
        dataset_id,
        dataset_ids,
        model: row.get(4)?,
        base_model: row.get(5)?,
        backend: row.get(6)?,
        parameters: serde_json::from_str(&parameters).unwrap_or(Value::Null),
        status: row.get(8)?,
        stage: row.get(9)?,
        progress: row.get(10)?,
        eta_seconds: row.get(11)?,
        current_epoch: row.get(12)?,
        total_epochs: row.get(13)?,
        gpu_usage: row.get(14)?,
        cpu_usage: row.get(15)?,
        ram_usage: row.get(16)?,
        disk_usage: row.get(17)?,
        loss: row.get(18)?,
        learning_rate: row.get(19)?,
        training_speed: row.get(20)?,
        warning: row.get(21)?,
        error: row.get(22)?,
        registered_model: row.get(23)?,
        started_at: row.get(24)?,
        finished_at: row.get(25)?,
        created_at: row.get(26)?,
        updated_at: row.get(27)?,
        logs: Vec::new(),
    })
}

pub fn normalize_sha256(value: &str) -> String {
    value.trim().trim_start_matches("sha256:").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::Database;
    use crate::models::{JobRequest, UploadRequest};
    use rusqlite::params;
    use serde_json::json;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn refreshes_metadata_when_a_matching_upload_is_resumed() {
        let root = std::env::temp_dir().join(format!("tome-training-resume-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("test directory should be created");
        let database =
            Database::open(&root.join("training.sqlite3")).expect("training database should open");
        let partial_path = root.join("dataset.partial");
        let mut request = UploadRequest {
            client_upload_id: "client-upload".into(),
            dataset_id: "dataset".into(),
            name: "dataset".into(),
            format: "jsonl".into(),
            size: 1024,
            sha256: "abc123".into(),
        };
        database
            .create_or_resume_upload(&request, &partial_path, 4 * 1024 * 1024)
            .expect("upload should be created");

        request.name = "dataset.zip".into();
        request.format = "zip".into();
        let resumed = database
            .create_or_resume_upload(&request, &partial_path, 4 * 1024 * 1024)
            .expect("upload should resume");

        assert_eq!(resumed.name, "dataset.zip");
        assert_eq!(resumed.format, "zip");
        drop(database);
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn replaces_a_dataset_when_a_new_upload_session_reuses_its_id() {
        let root = std::env::temp_dir().join(format!("tome-training-reupload-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("test directory should be created");
        let database =
            Database::open(&root.join("training.sqlite3")).expect("training database should open");
        let mut request = UploadRequest {
            client_upload_id: "first-upload".into(),
            dataset_id: "stable-dataset-id".into(),
            name: "Planning v1".into(),
            format: "jsonl".into(),
            size: 1024,
            sha256: "first".into(),
        };
        let first_upload = database
            .create_or_resume_upload(&request, &root.join("first.partial"), 4 * 1024 * 1024)
            .expect("first upload should be created");
        database
            .complete_upload(
                &first_upload,
                &root.join("first.artifact"),
                &root.join("first-content"),
                10,
            )
            .expect("first upload should register the dataset");

        request.client_upload_id = "replacement-upload".into();
        request.name = "Planning v2".into();
        request.size = 2048;
        request.sha256 = "second".into();
        let replacement_upload = database
            .create_or_resume_upload(&request, &root.join("replacement.partial"), 4 * 1024 * 1024)
            .expect("replacement upload should be created");
        let replaced = database
            .complete_upload(
                &replacement_upload,
                &root.join("replacement.artifact"),
                &root.join("replacement-content"),
                20,
            )
            .expect("replacement upload should update the existing dataset");

        assert_eq!(replaced.id, "stable-dataset-id");
        assert_eq!(replaced.name, "Planning v2");
        assert_eq!(replaced.size, 2048);
        assert_eq!(replaced.sha256, "second");
        assert!(database
            .dataset_by_upload(&first_upload.id)
            .expect("old upload lookup should succeed")
            .is_none());
        assert!(database
            .dataset_by_upload(&replacement_upload.id)
            .expect("replacement upload lookup should succeed")
            .is_some());

        drop(database);
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn persists_all_datasets_selected_for_one_job() {
        let root =
            std::env::temp_dir().join(format!("tome-training-multi-dataset-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("test directory should be created");
        let database =
            Database::open(&root.join("training.sqlite3")).expect("training database should open");
        {
            let connection = database
                .connection
                .lock()
                .expect("test database should lock");
            for id in ["one", "two"] {
                connection
                    .execute(
                        "INSERT INTO uploads(
                            id, client_upload_id, dataset_id, name, format,
                            expected_size, expected_sha256, uploaded_bytes,
                            chunk_size, status, partial_path, created_at, updated_at
                         ) VALUES (?1, ?2, ?3, ?3, 'jsonl', 10, 'sha', 10, 4,
                                   'completed', ?4, ?5, ?5)",
                        params![
                            format!("upload-{id}"),
                            format!("client-upload-{id}"),
                            id,
                            root.join(format!("{id}.part")).to_string_lossy(),
                            "2026-07-28T00:00:00Z"
                        ],
                    )
                    .expect("test upload should be inserted");
                connection
                    .execute(
                        "INSERT INTO datasets(
                            id, source_upload_id, name, format, size, sha256,
                            artifact_path, content_path, file_count, validation_status,
                            created_at, updated_at
                         ) VALUES (?1, ?2, ?1, 'jsonl', 10, 'sha', ?3, ?4, 1,
                                   'valid', ?5, ?5)",
                        params![
                            id,
                            format!("upload-{id}"),
                            root.join(format!("{id}.zip")).to_string_lossy(),
                            root.join(id).to_string_lossy(),
                            "2026-07-28T00:00:00Z"
                        ],
                    )
                    .expect("test dataset should be inserted");
            }
        }

        let request = JobRequest {
            client_job_id: "client-job".into(),
            dataset_id: "one".into(),
            dataset_ids: vec!["one".into(), "two".into()],
            model: "tome-test:latest".into(),
            base_model: "llama3.2:3b".into(),
            backend: "lora".into(),
            parameters: json!({"sourceModel": "meta-llama/Llama-3.2-3B"}),
            epochs: 1,
        };
        let (job, inserted) = database
            .create_job(&request)
            .expect("multi-dataset job should be created");

        assert!(inserted);
        assert_eq!(job.dataset_ids, ["one", "two"]);
        let snapshot = database
            .job_snapshot(&job.id)
            .expect("snapshot should load");
        assert_eq!(snapshot.dataset_ids, ["one", "two"]);
        drop(database);
        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
