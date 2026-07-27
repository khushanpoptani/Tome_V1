use std::{
    env, fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub ollama_url: String,
    pub ollama_executable: PathBuf,
    pub python_executable: PathBuf,
    pub worker_script: PathBuf,
    pub bearer_token: Option<String>,
    pub max_upload_bytes: u64,
    pub chunk_size: u64,
    pub job_concurrency: usize,
}

impl Default for Config {
    fn default() -> Self {
        let data_dir = default_data_dir();
        Self {
            bind: SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 11435),
            data_dir: data_dir.clone(),
            ollama_url: "http://127.0.0.1:11434".into(),
            ollama_executable: PathBuf::from(if cfg!(windows) {
                "ollama.exe"
            } else {
                "ollama"
            }),
            python_executable: PathBuf::from(if cfg!(windows) {
                "python.exe"
            } else {
                "python3"
            }),
            worker_script: data_dir.join("workers").join("train.py"),
            bearer_token: None,
            max_upload_bytes: 250 * 1024 * 1024 * 1024,
            chunk_size: 4 * 1024 * 1024,
            job_concurrency: 1,
        }
    }
}

impl Config {
    pub fn load() -> ApiResult<Self> {
        let path = env::var_os("TOME_TRAINING_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|| default_data_dir().join("config.json"));
        let mut config = if path.exists() {
            let value = fs::read_to_string(&path).map_err(|error| {
                ApiError::internal(format!("Could not read {}: {error}", path.display()))
            })?;
            serde_json::from_str::<Self>(&value).map_err(|error| {
                ApiError::invalid(format!(
                    "Training Manager config {} is invalid: {error}",
                    path.display()
                ))
            })?
        } else {
            Self::default()
        };
        if let Some(value) = env::var_os("TOME_TRAINING_DATA_DIR") {
            let previous_data_dir = config.data_dir.clone();
            config.data_dir = PathBuf::from(value);
            if let Ok(relative_worker) = config.worker_script.strip_prefix(&previous_data_dir) {
                config.worker_script = config.data_dir.join(relative_worker);
            }
        }
        if let Ok(value) = env::var("TOME_TRAINING_BIND") {
            config.bind = value.parse().map_err(|error| {
                ApiError::invalid(format!("TOME_TRAINING_BIND is invalid: {error}"))
            })?;
        }
        if let Ok(value) = env::var("TOME_OLLAMA_URL") {
            config.ollama_url = value.trim_end_matches('/').to_string();
        }
        if let Ok(value) = env::var("TOME_TRAINING_TOKEN") {
            config.bearer_token = (!value.is_empty()).then_some(value);
        }
        config.ollama_url = config.ollama_url.trim_end_matches('/').to_string();
        config.validate()?;
        Ok(config)
    }

    pub fn ensure_directories(&self) -> ApiResult<()> {
        for path in [
            self.data_dir.clone(),
            self.data_dir.join("uploads"),
            self.data_dir.join("datasets"),
            self.data_dir.join("jobs"),
            self.data_dir.join("workers"),
        ] {
            fs::create_dir_all(&path).map_err(|error| {
                ApiError::internal(format!("Could not create {}: {error}", path.display()))
            })?;
        }
        Ok(())
    }

    pub fn database_path(&self) -> PathBuf {
        self.data_dir.join("training-manager.sqlite3")
    }

    fn validate(&self) -> ApiResult<()> {
        if !(self.ollama_url.starts_with("http://") || self.ollama_url.starts_with("https://")) {
            return Err(ApiError::invalid(
                "ollamaUrl must start with http:// or https://",
            ));
        }
        if self.chunk_size < 256 * 1024 || self.chunk_size > 64 * 1024 * 1024 {
            return Err(ApiError::invalid(
                "chunkSize must be between 256 KiB and 64 MiB",
            ));
        }
        if self.job_concurrency == 0 {
            return Err(ApiError::invalid("jobConcurrency must be at least 1"));
        }
        Ok(())
    }
}

pub fn write_default_config(path: &Path) -> ApiResult<()> {
    let config = Config::default();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ApiError::internal(format!("Could not create {}: {error}", parent.display()))
        })?;
    }
    let value = serde_json::to_string_pretty(&config)
        .map_err(|error| ApiError::internal(format!("Could not serialize config: {error}")))?;
    fs::write(path, format!("{value}\n"))
        .map_err(|error| ApiError::internal(format!("Could not write {}: {error}", path.display())))
}

fn default_data_dir() -> PathBuf {
    if cfg!(windows) {
        env::var_os("PROGRAMDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"))
            .join("Tome")
            .join("TrainingManager")
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("./data"))
            .join("tome")
            .join("training-manager")
    }
}
