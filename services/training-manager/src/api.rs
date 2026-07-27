use std::sync::Arc;

use axum::{
    extract::{ws::Message, Query, State, WebSocketUpgrade},
    http::{header::ORIGIN, HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::process::Command;
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};

use crate::{
    error::{ApiError, ApiResult},
    jobs, resources, uploads, AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    protocol: &'static str,
    ollama_reachable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendCapability {
    id: &'static str,
    available: bool,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilitiesResponse {
    protocol: &'static str,
    version: &'static str,
    supported_formats: &'static [&'static str],
    backends: Vec<BackendCapability>,
    websocket: bool,
    websocket_path: &'static str,
    resumable_uploads: bool,
    model_registration: bool,
    adapter_registration_architectures: &'static [&'static str],
    max_upload_bytes: u64,
    chunk_size: u64,
}

#[derive(Deserialize)]
struct WebSocketQuery {
    token: Option<String>,
}

pub fn router(state: Arc<AppState>) -> Router {
    let chunk_limit = state.config.chunk_size.saturating_add(1024 * 1024) as usize;
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/resources", get(resources::resources))
        .route("/v1/events/ws", get(websocket))
        .route("/v1/uploads", post(uploads::create_upload))
        .route(
            "/v1/uploads/{id}",
            get(uploads::get_upload).delete(uploads::cancel_upload),
        )
        .route(
            "/v1/uploads/{id}/chunks/{index}",
            put(uploads::upload_chunk),
        )
        .route("/v1/uploads/{id}/complete", post(uploads::complete_upload))
        .route("/v1/datasets/{id}", delete(uploads::delete_dataset))
        .route("/v1/jobs", post(jobs::create_job).get(jobs::list_jobs))
        .route("/v1/jobs/{id}", get(jobs::get_job))
        .route("/v1/jobs/{id}/cancel", post(jobs::cancel_job))
        .route("/v1/jobs/{id}/retry", post(jobs::retry_job))
        .route("/v1/jobs/{id}/logs", get(jobs::get_logs))
        .layer(middleware::from_fn_with_state(state.clone(), require_auth))
        .layer(RequestBodyLimitLayer::new(chunk_limit))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    let ollama_reachable = state
        .http
        .get(format!("{}/api/version", state.config.ollama_url))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success());
    Json(HealthResponse {
        status: if ollama_reachable { "ok" } else { "degraded" },
        version: env!("CARGO_PKG_VERSION"),
        protocol: "tome-training/v1",
        ollama_reachable,
    })
}

async fn capabilities(State(state): State<Arc<AppState>>) -> ApiResult<Json<CapabilitiesResponse>> {
    let probe = Command::new(&state.config.python_executable)
        .arg(&state.config.worker_script)
        .arg("--probe")
        .output()
        .await;
    let (available, detail) = match probe {
        Ok(output) if output.status.success() => (
            true,
            String::from_utf8_lossy(&output.stdout).trim().to_string(),
        ),
        Ok(output) => (
            false,
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ),
        Err(error) => (false, format!("Python worker probe failed: {error}")),
    };
    let detail = if detail.is_empty() {
        if available {
            "Python training environment is ready".into()
        } else {
            format!(
                "Install the worker and dependencies at {}",
                state.config.worker_script.display()
            )
        }
    } else {
        detail
    };
    Ok(Json(CapabilitiesResponse {
        protocol: "tome-training/v1",
        version: env!("CARGO_PKG_VERSION"),
        supported_formats: &["zip", "jsonl", "json", "csv", "parquet", "txt", "md"],
        backends: vec![
            BackendCapability {
                id: "transformers",
                available,
                detail: detail.clone(),
            },
            BackendCapability {
                id: "peft",
                available,
                detail: detail.clone(),
            },
            BackendCapability {
                id: "lora",
                available,
                detail: detail.clone(),
            },
            BackendCapability {
                id: "qlora",
                available,
                detail,
            },
            BackendCapability {
                id: "unsloth",
                available: false,
                detail: "Adapter not installed".into(),
            },
            BackendCapability {
                id: "axolotl",
                available: false,
                detail: "Adapter not installed".into(),
            },
        ],
        websocket: true,
        websocket_path: "/v1/events/ws",
        resumable_uploads: true,
        model_registration: true,
        adapter_registration_architectures: &["llama", "mistral", "mixtral", "gemma"],
        max_upload_bytes: state.config.max_upload_bytes,
        chunk_size: state.config.chunk_size,
    }))
}

async fn websocket(
    State(state): State<Arc<AppState>>,
    Query(query): Query<WebSocketQuery>,
    headers: HeaderMap,
    websocket: WebSocketUpgrade,
) -> ApiResult<Response> {
    if let Some(origin) = headers.get(ORIGIN).and_then(|value| value.to_str().ok()) {
        let trusted_origin = matches!(
            origin,
            "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
        ) || origin.starts_with("http://localhost:");
        if !trusted_origin {
            return Err(ApiError::unauthorized());
        }
    }
    if let Some(expected) = &state.config.bearer_token {
        if query.token.as_deref() != Some(expected.as_str()) {
            return Err(ApiError::unauthorized());
        }
    }
    Ok(websocket
        .on_upgrade(move |socket| async move {
            let (mut sender, mut receiver) = socket.split();
            let mut events = state.events.subscribe();
            loop {
                tokio::select! {
                    event = events.recv() => {
                        match event {
                            Ok(event) => {
                                let Ok(value) = serde_json::to_string(&event) else {
                                    continue;
                                };
                                if sender.send(Message::Text(value.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                    message = receiver.next() => {
                        match message {
                            Some(Ok(Message::Ping(value))) => {
                                if sender.send(Message::Pong(value)).await.is_err() {
                                    break;
                                }
                            }
                            Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                            _ => {}
                        }
                    }
                }
            }
        })
        .into_response())
}

async fn require_auth(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: middleware::Next,
) -> Response {
    if state.config.bearer_token.is_none() || request.uri().path() == "/v1/health" {
        return next.run(request).await;
    }
    let authorized = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        == state.config.bearer_token.as_deref();
    if authorized || request.uri().path() == "/v1/events/ws" {
        next.run(request).await
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "A valid Training Manager bearer token is required" })),
        )
            .into_response()
    }
}
