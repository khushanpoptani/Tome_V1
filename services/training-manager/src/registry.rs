use std::path::Path;

use tokio::{fs, process::Command};

use crate::{
    config::Config,
    database::JobRecord,
    error::{ApiError, ApiResult},
};

const OLLAMA_ADAPTER_ARCHITECTURES: &[&str] = &["llama", "mistral", "mixtral", "gemma"];

pub fn validate_adapter_compatibility(
    base_model: &str,
    parameters: &serde_json::Value,
) -> ApiResult<()> {
    let declared = parameters["ollamaAdapterArchitecture"]
        .as_str()
        .map(str::to_ascii_lowercase);
    let inferred = base_model.to_ascii_lowercase();
    let supported = OLLAMA_ADAPTER_ARCHITECTURES.iter().any(|architecture| {
        declared.as_deref() == Some(*architecture) || inferred.contains(architecture)
    });
    if supported {
        return Ok(());
    }
    Err(ApiError::invalid(format!(
        "Ollama does not document Safetensors adapter import for base model '{base_model}'. \
Use a Llama, Mistral/Mixtral, or Gemma base, or install a future GGUF export adapter. \
No training job was queued."
    )))
}

pub async fn register_adapter(
    config: &Config,
    job: &JobRecord,
    adapter_path: &Path,
    job_dir: &Path,
) -> ApiResult<()> {
    validate_model_name(&job.model)?;
    validate_model_name(&job.base_model)?;
    if !adapter_path.is_dir() {
        return Err(ApiError::internal(format!(
            "Training completed without an adapter directory at {}",
            adapter_path.display()
        )));
    }
    let adapter = adapter_path.to_string_lossy().replace('\\', "/");
    let modelfile = job_dir.join("Modelfile");
    fs::write(
        &modelfile,
        format!("FROM {}\nADAPTER \"{}\"\n", job.base_model, adapter),
    )
    .await?;
    let output = Command::new(&config.ollama_executable)
        .arg("create")
        .arg(&job.model)
        .arg("-f")
        .arg(&modelfile)
        .current_dir(job_dir)
        .output()
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "Could not start {}: {error}",
                config.ollama_executable.display()
            ))
        })?;
    if !output.status.success() {
        return Err(ApiError::internal(format!(
            "Ollama model registration failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    verify_registered(config, &job.model).await
}

async fn verify_registered(config: &Config, model: &str) -> ApiResult<()> {
    let response = reqwest::Client::new()
        .get(format!("{}/api/tags", config.ollama_url))
        .send()
        .await
        .map_err(|error| {
            ApiError::internal(format!(
                "Ollama did not respond after model registration: {error}"
            ))
        })?;
    if !response.status().is_success() {
        return Err(ApiError::internal(format!(
            "Ollama model list returned HTTP {} after registration",
            response.status()
        )));
    }
    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| ApiError::internal(format!("Ollama returned invalid JSON: {error}")))?;
    let latest_name = (!model.contains(':')).then(|| format!("{model}:latest"));
    let found = value["models"].as_array().is_some_and(|models| {
        models.iter().any(|candidate| {
            [candidate["name"].as_str(), candidate["model"].as_str()]
                .into_iter()
                .flatten()
                .any(|candidate_name| {
                    candidate_name == model || latest_name.as_deref() == Some(candidate_name)
                })
        })
    });
    if !found {
        return Err(ApiError::internal(format!(
            "Ollama did not list registered model {model}"
        )));
    }
    Ok(())
}

fn validate_model_name(value: &str) -> ApiResult<()> {
    if value.is_empty()
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '/' | ':')
        })
    {
        return Err(ApiError::invalid(format!(
            "Model name contains unsupported characters: {value}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_adapter_compatibility, validate_model_name};

    #[test]
    fn validates_registry_model_names() {
        assert!(validate_model_name("team/model-name:latest").is_ok());
        assert!(validate_model_name("model; shutdown").is_err());
        assert!(validate_model_name("").is_err());
    }

    #[test]
    fn rejects_undocumented_ollama_adapter_architectures_before_training() {
        assert!(validate_adapter_compatibility("llama3.2:3b", &serde_json::json!({})).is_ok());
        assert!(validate_adapter_compatibility(
            "custom-base:latest",
            &serde_json::json!({"ollamaAdapterArchitecture": "gemma"})
        )
        .is_ok());
        assert!(validate_adapter_compatibility("qwen2.5:3b", &serde_json::json!({})).is_err());
    }
}
