use crate::{application::health::application_health, domain::health::HealthStatus};

#[tauri::command]
#[must_use]
pub fn health() -> HealthStatus {
    application_health()
}
