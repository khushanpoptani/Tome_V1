use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{ipc::Channel, State};

use crate::{
    infrastructure::state::AppState,
    interface::commands::data::{add_log, update_server_diagnostics},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDiagnostics {
    pub reachable: bool,
    pub ollama_responding: bool,
    pub api_available: bool,
    pub streaming_available: bool,
    pub streaming_verified: bool,
    pub ping_ms: Option<u64>,
    pub version: Option<String>,
    pub installed_models: Vec<Value>,
    pub running_models: Vec<Value>,
    pub error: Option<String>,
    pub checked_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestServerInput {
    pub server_id: Option<String>,
    pub url: String,
    #[serde(default)]
    pub verify_streaming: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
pub enum StreamEvent {
    Status {
        message: String,
    },
    Progress {
        message: String,
        completed: Option<u64>,
        total: Option<u64>,
        percent: Option<f64>,
    },
    Token {
        content: String,
    },
    Complete {
        total_duration: Option<u64>,
        eval_count: Option<u64>,
        prompt_eval_count: Option<u64>,
    },
    Error {
        message: String,
    },
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInput {
    pub request_id: String,
    pub url: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

fn api_url(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

fn request_error_detail(error: &reqwest::Error) -> String {
    let mut detail = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        detail.push_str(": ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    detail
}

async fn post_json_with_retry(
    client: &reqwest::Client,
    url: &str,
    body: &Value,
) -> Result<reqwest::Response, String> {
    match client.post(url).json(body).send().await {
        Ok(response) => Ok(response),
        Err(first_error) => client
            .post(url)
            .json(body)
            .send()
            .await
            .map_err(|retry_error| {
                format!(
                    "request failed and the reconnect retry also failed. First attempt: {}. Retry: {}",
                    request_error_detail(&first_error),
                    request_error_detail(&retry_error)
                )
            }),
    }
}

async fn response_error(response: reqwest::Response, operation: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| value["error"].as_str().map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .unwrap_or(body);
    format!("{operation} failed with HTTP {status}: {message}")
}

#[tauri::command]
pub async fn test_ollama_server(
    state: State<'_, AppState>,
    input: TestServerInput,
) -> Result<ServerDiagnostics, String> {
    let started = Instant::now();
    let checked_at = chrono::Utc::now().to_rfc3339();
    add_log(
        &state,
        "server",
        "info",
        "Testing Ollama connection",
        Some(&input.url),
    );

    let version_response = match state
        .http
        .get(api_url(&input.url, "/api/version"))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let detail = if error.is_connect() {
                format!(
                    "Connection refused or host unreachable at {}. Confirm the host, port, firewall, and OLLAMA_HOST binding. {error}",
                    input.url
                )
            } else if error.is_timeout() {
                format!(
                    "Connection to {} timed out. Check the network route and server load. {error}",
                    input.url
                )
            } else {
                format!("Could not reach {}: {error}", input.url)
            };
            if let Some(server_id) = &input.server_id {
                update_server_diagnostics(
                    &state,
                    server_id,
                    "disconnected",
                    None,
                    None,
                    Some(&detail),
                )?;
            }
            add_log(
                &state,
                "server",
                "error",
                "Ollama connection failed",
                Some(&detail),
            );
            return Ok(ServerDiagnostics {
                reachable: false,
                ollama_responding: false,
                api_available: false,
                streaming_available: false,
                streaming_verified: false,
                ping_ms: None,
                version: None,
                installed_models: Vec::new(),
                running_models: Vec::new(),
                error: Some(detail),
                checked_at,
            });
        }
    };

    let ping_ms = started.elapsed().as_millis() as u64;
    if !version_response.status().is_success() {
        let error = response_error(version_response, "Ollama version request").await;
        if let Some(server_id) = &input.server_id {
            update_server_diagnostics(
                &state,
                server_id,
                "degraded",
                Some(ping_ms as i64),
                None,
                Some(&error),
            )?;
        }
        return Ok(ServerDiagnostics {
            reachable: true,
            ollama_responding: false,
            api_available: false,
            streaming_available: false,
            streaming_verified: false,
            ping_ms: Some(ping_ms),
            version: None,
            installed_models: Vec::new(),
            running_models: Vec::new(),
            error: Some(error),
            checked_at,
        });
    }

    let version_json = version_response
        .json::<Value>()
        .await
        .map_err(|error| format!("Ollama returned invalid version JSON: {error}"))?;
    let version = version_json["version"].as_str().map(ToOwned::to_owned);
    let tags_response = state
        .http
        .get(api_url(&input.url, "/api/tags"))
        .send()
        .await
        .map_err(|error| format!("Ollama model-list request failed: {error}"))?;
    if !tags_response.status().is_success() {
        return Err(response_error(tags_response, "Ollama model-list request").await);
    }
    let tags_json = tags_response
        .json::<Value>()
        .await
        .map_err(|error| format!("Ollama returned invalid model-list JSON: {error}"))?;
    let installed_models = tags_json["models"].as_array().cloned().unwrap_or_default();

    let ps_response = state
        .http
        .get(api_url(&input.url, "/api/ps"))
        .send()
        .await
        .map_err(|error| format!("Ollama running-model request failed: {error}"))?;
    if !ps_response.status().is_success() {
        return Err(response_error(ps_response, "Ollama running-model request").await);
    }
    let ps_json = ps_response
        .json::<Value>()
        .await
        .map_err(|error| format!("Ollama returned invalid running-model JSON: {error}"))?;
    let running_models = ps_json["models"].as_array().cloned().unwrap_or_default();
    let streaming_available = !installed_models.is_empty();
    let mut streaming_verified = false;
    let mut streaming_error = None;
    if input.verify_streaming {
        if let Some(model) = installed_models
            .first()
            .and_then(|value| value["name"].as_str())
        {
            let streaming_url = api_url(&input.url, "/api/chat");
            let streaming_body = json!({
                "model": model,
                "messages": [{ "role": "user", "content": "Reply with OK." }],
                "options": { "num_predict": 1 },
                "stream": true
            });
            match post_json_with_retry(&state.http, &streaming_url, &streaming_body).await {
                Ok(response) if response.status().is_success() => {
                    let mut stream = response.bytes_stream();
                    while let Some(chunk) = stream.next().await {
                        match chunk {
                            Ok(bytes) => {
                                let chunk_text = String::from_utf8_lossy(&bytes);
                                if chunk_text
                                    .lines()
                                    .filter(|line| !line.trim().is_empty())
                                    .any(|line| {
                                        serde_json::from_str::<Value>(line)
                                            .is_ok_and(|value| value["error"].is_null())
                                    })
                                {
                                    streaming_verified = true;
                                    break;
                                }
                            }
                            Err(error) => {
                                streaming_error =
                                    Some(format!("Streaming verification failed: {error}"));
                                break;
                            }
                        }
                    }
                }
                Ok(response) => {
                    streaming_error =
                        Some(response_error(response, "Streaming verification").await);
                }
                Err(error) => {
                    streaming_error = Some(format!("Streaming verification failed: {error}"));
                }
            }
        } else {
            streaming_error =
                Some("Streaming cannot be verified until a model is installed.".into());
        }
    }

    if let Some(server_id) = &input.server_id {
        update_server_diagnostics(
            &state,
            server_id,
            "connected",
            Some(ping_ms as i64),
            version.as_deref(),
            None,
        )?;
    }
    add_log(
        &state,
        "server",
        "info",
        "Ollama connection succeeded",
        version.as_deref(),
    );
    Ok(ServerDiagnostics {
        reachable: true,
        ollama_responding: true,
        api_available: true,
        streaming_available,
        streaming_verified,
        ping_ms: Some(ping_ms),
        version,
        installed_models,
        running_models,
        error: if let Some(error) = streaming_error {
            Some(error)
        } else if tags_json["models"].as_array().is_some_and(Vec::is_empty) {
            Some(
                "The API is healthy, but streaming inference cannot be verified until a model is installed."
                    .into(),
            )
        } else {
            None
        },
        checked_at,
    })
}

#[tauri::command]
pub async fn list_ollama_models(
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<Value>, String> {
    let response = state
        .http
        .get(api_url(&url, "/api/tags"))
        .send()
        .await
        .map_err(|error| format!("Could not list Ollama models: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Listing models").await);
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Ollama returned invalid model data: {error}"))?;
    let models = value["models"].as_array().cloned().unwrap_or_default();
    if let Ok(mut database) = state.database.lock() {
        let server_id = database
            .query_row("SELECT id FROM servers WHERE url=?1", [&url], |row| {
                row.get::<_, String>(0)
            })
            .ok();
        if let Some(server_id) = server_id {
            if let Ok(transaction) = database.transaction() {
                let _ = transaction.execute(
                    "DELETE FROM installed_models WHERE server_id=?1",
                    [&server_id],
                );
                for model in &models {
                    let _ = transaction.execute(
                        "INSERT INTO installed_models(server_id, name, size, digest, modified_at, details_json)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            server_id,
                            model["name"].as_str().unwrap_or_default(),
                            model["size"].as_u64().unwrap_or_default() as i64,
                            model["digest"].as_str(),
                            model["modified_at"].as_str(),
                            model["details"].to_string()
                        ],
                    );
                }
                let _ = transaction.commit();
            }
        }
    }
    Ok(models)
}

#[tauri::command]
pub async fn show_ollama_model(
    state: State<'_, AppState>,
    url: String,
    model: String,
) -> Result<Value, String> {
    let response = state
        .http
        .post(api_url(&url, "/api/show"))
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|error| format!("Could not read model information: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Reading model information").await);
    }
    response
        .json()
        .await
        .map_err(|error| format!("Ollama returned invalid model information: {error}"))
}

#[tauri::command]
pub async fn delete_ollama_model(
    state: State<'_, AppState>,
    url: String,
    model: String,
) -> Result<(), String> {
    let response = state
        .http
        .delete(api_url(&url, "/api/delete"))
        .json(&json!({ "model": model }))
        .send()
        .await
        .map_err(|error| format!("Could not delete model: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Deleting model").await);
    }
    add_log(
        &state,
        "model",
        "info",
        "Deleted Ollama model",
        Some(&model),
    );
    Ok(())
}

async fn stream_ndjson(
    response: reqwest::Response,
    on_event: &Channel<StreamEvent>,
    cancellation: &AtomicBool,
    mode: &str,
) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    let mut pending = String::new();
    while let Some(chunk) = stream.next().await {
        if cancellation.load(Ordering::Relaxed) {
            let _ = on_event.send(StreamEvent::Cancelled);
            return Err("Operation cancelled".into());
        }
        let chunk = chunk.map_err(|error| format!("Streaming connection failed: {error}"))?;
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = pending.find('\n') {
            let line = pending[..newline].trim().to_owned();
            pending.drain(..=newline);
            if line.is_empty() {
                continue;
            }
            let value = serde_json::from_str::<Value>(&line)
                .map_err(|error| format!("Ollama sent invalid streaming JSON: {error}"))?;
            if let Some(error) = value["error"].as_str() {
                let _ = on_event.send(StreamEvent::Error {
                    message: error.into(),
                });
                return Err(error.into());
            }
            if mode == "pull" {
                let completed = value["completed"].as_u64();
                let total = value["total"].as_u64();
                let percent = completed
                    .zip(total)
                    .filter(|(_, total)| *total > 0)
                    .map(|(completed, total)| completed as f64 / total as f64 * 100.0);
                let _ = on_event.send(StreamEvent::Progress {
                    message: value["status"].as_str().unwrap_or("Downloading").into(),
                    completed,
                    total,
                    percent,
                });
            } else {
                if let Some(content) = value["message"]["content"].as_str() {
                    if !content.is_empty() {
                        let _ = on_event.send(StreamEvent::Token {
                            content: content.into(),
                        });
                    }
                }
                if value["done"].as_bool().unwrap_or(false) {
                    let _ = on_event.send(StreamEvent::Complete {
                        total_duration: value["total_duration"].as_u64(),
                        eval_count: value["eval_count"].as_u64(),
                        prompt_eval_count: value["prompt_eval_count"].as_u64(),
                    });
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn pull_ollama_model(
    state: State<'_, AppState>,
    request_id: String,
    url: String,
    model: String,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .insert(request_id.clone(), Arc::clone(&cancellation));
    let _ = on_event.send(StreamEvent::Status {
        message: format!("Requesting {model}"),
    });
    add_log(
        &state,
        "model",
        "info",
        "Started model download",
        Some(&model),
    );
    let pull_url = api_url(&url, "/api/pull");
    let pull_body = json!({ "model": model, "stream": true });
    let response = match post_json_with_retry(&state.http, &pull_url, &pull_body).await {
        Ok(response) => response,
        Err(error) => {
            state
                .cancellations
                .lock()
                .map_err(|lock_error| lock_error.to_string())?
                .remove(&request_id);
            return Err(format!("Could not start model download: {error}"));
        }
    };
    if !response.status().is_success() {
        let error = response_error(response, "Downloading model").await;
        let _ = on_event.send(StreamEvent::Error {
            message: error.clone(),
        });
        state
            .cancellations
            .lock()
            .map_err(|lock_error| lock_error.to_string())?
            .remove(&request_id);
        return Err(error);
    }
    let result = stream_ndjson(response, &on_event, &cancellation, "pull").await;
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&request_id);
    match &result {
        Ok(()) => add_log(
            &state,
            "model",
            "info",
            "Model download finished",
            Some(&model),
        ),
        Err(error) => add_log(
            &state,
            "model",
            "error",
            "Model download failed",
            Some(error),
        ),
    }
    result
}

#[tauri::command]
pub async fn stream_ollama_chat(
    state: State<'_, AppState>,
    input: ChatInput,
    on_event: Channel<StreamEvent>,
) -> Result<(), String> {
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .insert(input.request_id.clone(), Arc::clone(&cancellation));
    add_log(
        &state,
        "chat",
        "info",
        "Started streaming completion",
        Some(&input.model),
    );
    let chat_url = api_url(&input.url, "/api/chat");
    let chat_body = json!({
        "model": input.model,
        "messages": input.messages,
        "stream": true
    });
    let response = match post_json_with_retry(&state.http, &chat_url, &chat_body).await {
        Ok(response) => response,
        Err(error) => {
            state
                .cancellations
                .lock()
                .map_err(|lock_error| lock_error.to_string())?
                .remove(&input.request_id);
            return Err(format!("Could not start chat completion: {error}"));
        }
    };
    if !response.status().is_success() {
        let error = response_error(response, "Chat completion").await;
        let _ = on_event.send(StreamEvent::Error {
            message: error.clone(),
        });
        state
            .cancellations
            .lock()
            .map_err(|lock_error| lock_error.to_string())?
            .remove(&input.request_id);
        return Err(error);
    }
    let result = stream_ndjson(response, &on_event, &cancellation, "chat").await;
    state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&input.request_id);
    match &result {
        Ok(()) => add_log(
            &state,
            "chat",
            "info",
            "Streaming completion finished",
            Some(&input.model),
        ),
        Err(error) => add_log(
            &state,
            "chat",
            "error",
            "Streaming completion failed",
            Some(error),
        ),
    }
    result
}

#[tauri::command]
pub fn cancel_operation(state: State<'_, AppState>, request_id: String) -> Result<bool, String> {
    let cancellations = state
        .cancellations
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(cancellation) = cancellations.get(&request_id) {
        cancellation.store(true, Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false)
    }
}
