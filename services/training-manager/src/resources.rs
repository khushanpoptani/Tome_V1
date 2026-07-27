use std::{sync::Arc, time::Duration};

use axum::{extract::State, Json};
use chrono::Utc;
use sysinfo::{Disks, System};
use tokio::process::Command;

use crate::{
    error::{ApiError, ApiResult},
    models::{GpuResource, ResourceSnapshot, ServerEvent},
    AppState,
};

pub async fn resources(State(state): State<Arc<AppState>>) -> ApiResult<Json<ResourceSnapshot>> {
    Ok(Json(snapshot(&state).await?))
}

pub async fn snapshot(state: &AppState) -> ApiResult<ResourceSnapshot> {
    let queue_length = state.database.queue_length()?;
    let system = tokio::task::spawn_blocking(|| {
        let mut system = System::new_all();
        std::thread::sleep(Duration::from_millis(120));
        system.refresh_all();
        let disks = Disks::new_with_refreshed_list();
        let disk_total = disks.iter().map(|disk| disk.total_space()).sum::<u64>();
        let disk_available = disks.iter().map(|disk| disk.available_space()).sum::<u64>();
        (
            system.global_cpu_usage() as f64,
            system.total_memory(),
            system.used_memory(),
            disk_total,
            disk_total.saturating_sub(disk_available),
        )
    })
    .await
    .map_err(|error| ApiError::internal(format!("Resource sampler failed: {error}")))?;
    Ok(ResourceSnapshot {
        gpus: nvidia_gpus().await,
        cpu_usage: system.0,
        ram_total: saturating_i64(system.1),
        ram_used: saturating_i64(system.2),
        disk_total: saturating_i64(system.3),
        disk_used: saturating_i64(system.4),
        queue_length,
        captured_at: Utc::now().to_rfc3339(),
    })
}

pub fn spawn_resource_events(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            let _ = state.events.send(ServerEvent::Resources);
        }
    });
}

async fn nvidia_gpus() -> Vec<GpuResource> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=index,name,utilization.gpu,memory.total,memory.used,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await;
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let values = line.split(',').map(str::trim).collect::<Vec<_>>();
            if values.len() < 6 {
                return None;
            }
            Some(GpuResource {
                index: values[0].parse().ok()?,
                name: values[1].to_string(),
                utilization: values[2].parse().ok()?,
                memory_total: mib_to_bytes(values[3].parse().ok()?),
                memory_used: mib_to_bytes(values[4].parse().ok()?),
                temperature: values[5].parse().ok(),
            })
        })
        .collect()
}

fn mib_to_bytes(value: i64) -> i64 {
    value.saturating_mul(1024 * 1024)
}

fn saturating_i64(value: u64) -> i64 {
    value.min(i64::MAX as u64) as i64
}
