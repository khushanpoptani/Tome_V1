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
