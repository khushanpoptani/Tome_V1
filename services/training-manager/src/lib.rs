use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

use axum::Router;
use reqwest::Client;
use tokio::sync::{broadcast, mpsc};

use crate::{
    config::Config,
    database::Database,
    error::{ApiError, ApiResult},
    models::ServerEvent,
};

pub mod api;
pub mod config;
pub mod database;
pub mod error;
pub mod jobs;
pub mod models;
pub mod registry;
pub mod resources;
pub mod uploads;

pub struct AppState {
    pub config: Config,
    pub database: Database,
    pub http: Client,
    pub events: broadcast::Sender<ServerEvent>,
    pub queue: mpsc::Sender<String>,
    pub cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Session-only model registry credential. It is never written to SQLite,
    /// job specifications, logs, or the filesystem.
    pub huggingface_token: Mutex<Option<String>>,
}

pub async fn build(config: Config) -> ApiResult<(Router, Arc<AppState>)> {
    config.ensure_directories()?;
    let database = Database::open(&config.database_path())?;
    let http = Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| ApiError::internal(format!("Could not build HTTP client: {error}")))?;
    let (events, _) = broadcast::channel(2048);
    let (queue, receiver) = mpsc::channel(4096);
    let concurrency = config.job_concurrency;
    let state = Arc::new(AppState {
        config,
        database,
        http,
        events,
        queue,
        cancellations: jobs::cancellations(),
        huggingface_token: Mutex::new(None),
    });
    jobs::spawn_queue(state.clone(), receiver, concurrency);
    jobs::recover_queue(&state).await?;
    resources::spawn_resource_events(state.clone());
    Ok((api::router(state.clone()), state))
}
