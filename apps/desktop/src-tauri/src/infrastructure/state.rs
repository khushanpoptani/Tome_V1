use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex},
};

use reqwest::Client;
use rusqlite::Connection;

use super::sqlite::open_connection;

pub struct AppState {
    pub database: Mutex<Connection>,
    pub http: Client,
    pub cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new(database_path: &Path) -> Result<Self, String> {
        let database = open_connection(database_path)
            .map_err(|error| format!("Could not open Tome database: {error}"))?;
        database
            .execute_batch(
                "UPDATE dataset_uploads
                 SET status='paused', speed_bps=0, eta_seconds=NULL,
                     updated_at=datetime('now')
                 WHERE status='uploading';

                 UPDATE tasks
                 SET status='pending', ended_at=NULL,
                     logs=logs || CASE WHEN logs='' THEN '' ELSE char(10) END ||
                         'Paused: Tome restarted; resume the upload from Datasets',
                     updated_at=datetime('now')
                 WHERE kind='dataset-upload' AND status='running'
                   AND id IN (
                       SELECT id FROM dataset_uploads WHERE status='paused'
                   );

                 DELETE FROM tasks
                 WHERE kind='dataset-upload'
                   AND id NOT IN (SELECT id FROM dataset_uploads);

                 UPDATE tasks
                 SET status='failed', ended_at=datetime('now'),
                     logs=logs || CASE WHEN logs='' THEN '' ELSE char(10) END ||
                         'Interrupted: Tome closed before this operation completed',
                     updated_at=datetime('now')
                 WHERE kind IN ('dataset-preparation', 'dataset-delete')
                   AND status='running';

                 UPDATE training_datasets
                 SET validation_status='invalid',
                     validation_errors_json='[\"Validation was interrupted when Tome closed. Replace this dataset to retry.\"]',
                     updated_at=datetime('now')
                 WHERE validation_status='pending';",
            )
            .map_err(|error| format!("Could not reconcile interrupted operations: {error}"))?;
        let http = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|error| format!("Could not initialize HTTP client: {error}"))?;

        Ok(Self {
            database: Mutex::new(database),
            http,
            cancellations: Mutex::new(HashMap::new()),
            data_dir: database_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf(),
        })
    }
}
