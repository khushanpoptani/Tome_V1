use std::{sync::Arc, time::Duration};

use axum::{extract::State, Json};
use chrono::Utc;
use sysinfo::{Disks, Pid, ProcessesToUpdate, System};
use tokio::process::Command;

use crate::{
    error::{ApiError, ApiResult},
    models::{GpuResource, ResourceSnapshot, ServerEvent},
    AppState,
};

pub struct JobResourceUsage {
    pub gpu_usage: Option<f64>,
    pub cpu_usage: Option<f64>,
    pub ram_usage: Option<i64>,
    pub disk_io: Option<i64>,
}

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

pub async fn job_usage(state: &AppState, worker_pid: Option<u32>) -> ApiResult<JobResourceUsage> {
    let (host, worker) = tokio::join!(snapshot(state), worker_process_usage(worker_pid));
    let host = host?;
    let (cpu_usage, ram_usage, disk_io) = worker?;
    Ok(JobResourceUsage {
        gpu_usage: host.gpus.first().map(|gpu| gpu.utilization),
        cpu_usage,
        ram_usage,
        disk_io,
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

async fn worker_process_usage(
    worker_pid: Option<u32>,
) -> ApiResult<(Option<f64>, Option<i64>, Option<i64>)> {
    let Some(worker_pid) = worker_pid else {
        return Ok((None, None, None));
    };
    tokio::task::spawn_blocking(move || {
        let mut system = System::new_all();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_processes(ProcessesToUpdate::All, true);
        let root = Pid::from_u32(worker_pid);
        let mut cpu_usage = 0.0;
        let mut ram_usage = 0_u64;
        let mut disk_io = 0_u64;
        let mut matched = false;
        for (pid, process) in system.processes() {
            if *pid != root && !is_descendant_of(&system, *pid, root) {
                continue;
            }
            matched = true;
            cpu_usage += f64::from(process.cpu_usage());
            ram_usage = ram_usage.saturating_add(process.memory());
            let usage = process.disk_usage();
            disk_io = disk_io
                .saturating_add(usage.total_read_bytes)
                .saturating_add(usage.total_written_bytes);
        }
        if matched {
            (
                Some(cpu_usage),
                Some(saturating_i64(ram_usage)),
                Some(saturating_i64(disk_io)),
            )
        } else {
            (None, None, None)
        }
    })
    .await
    .map_err(|error| ApiError::internal(format!("Worker resource sampler failed: {error}")))
}

fn is_descendant_of(system: &System, mut candidate: Pid, root: Pid) -> bool {
    for _ in 0..32 {
        let Some(parent) = system
            .process(candidate)
            .and_then(|process| process.parent())
        else {
            return false;
        };
        if parent == root {
            return true;
        }
        if parent == candidate {
            return false;
        }
        candidate = parent;
    }
    false
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
