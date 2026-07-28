use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::{
    database::{normalize_sha256, UploadRecord},
    error::{ApiError, ApiResult},
    models::{CompleteUploadRequest, CompleteUploadResponse, UploadRequest, UploadResponse},
    AppState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatus {
    pub upload_id: String,
    pub status: String,
    pub uploaded_bytes: i64,
    pub total_bytes: i64,
    pub chunk_size: i64,
    pub last_error: Option<String>,
}

pub async fn create_upload(
    State(state): State<Arc<AppState>>,
    Json(request): Json<UploadRequest>,
) -> ApiResult<(StatusCode, Json<UploadResponse>)> {
    if request.size as u64 > state.config.max_upload_bytes {
        return Err(ApiError::invalid(format!(
            "Dataset is larger than the configured {} byte upload limit",
            state.config.max_upload_bytes
        )));
    }
    let file_key = format!("{:x}", Sha256::digest(request.client_upload_id.as_bytes()));
    let partial_path = state
        .config
        .data_dir
        .join("uploads")
        .join(format!("{file_key}.partial"));
    let upload = state.database.create_or_resume_upload(
        &request,
        &partial_path,
        state.config.chunk_size as i64,
    )?;
    if upload.status == "completed" {
        return Ok((
            StatusCode::OK,
            Json(UploadResponse {
                upload_id: upload.id,
                uploaded_bytes: upload.expected_size,
                chunk_size: upload.chunk_size,
            }),
        ));
    }
    if upload.status == "validating" {
        return Err(ApiError::conflict(
            "Dataset upload is already being validated; poll this upload for completion",
        ));
    }
    if let Ok(metadata) = tokio::fs::metadata(&upload.partial_path).await {
        let actual = metadata.len() as i64;
        if actual != upload.uploaded_bytes {
            state
                .database
                .set_upload_offset(&upload.id, actual.min(upload.expected_size))?;
        }
    } else if upload.uploaded_bytes != 0 || upload.status == "cancelled" {
        state.database.set_upload_offset(&upload.id, 0)?;
    }
    let refreshed = state.database.upload(&upload.id)?;
    Ok((
        StatusCode::OK,
        Json(UploadResponse {
            upload_id: refreshed.id,
            uploaded_bytes: refreshed.uploaded_bytes,
            chunk_size: refreshed.chunk_size,
        }),
    ))
}

pub async fn get_upload(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<Json<UploadStatus>> {
    let upload = state.database.upload(&id)?;
    Ok(Json(UploadStatus {
        upload_id: upload.id,
        status: upload.status,
        uploaded_bytes: upload.uploaded_bytes,
        total_bytes: upload.expected_size,
        chunk_size: upload.chunk_size,
        last_error: upload.last_error,
    }))
}

pub async fn upload_chunk(
    State(state): State<Arc<AppState>>,
    Path((id, index)): Path<(String, i64)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<UploadStatus>> {
    let upload = state.database.upload(&id)?;
    if upload.status == "completed" {
        return Ok(Json(upload_status(&upload)));
    }
    if upload.status == "validating" {
        return Err(ApiError::conflict(
            "Dataset upload is being validated and cannot accept more chunks",
        ));
    }
    if upload.status == "cancelled" {
        return Err(ApiError::conflict("Upload session was cancelled"));
    }
    let range = headers
        .get("content-range")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::invalid("Content-Range is required"))?;
    let (start, end, total) = parse_content_range(range)?;
    if total != upload.expected_size {
        return Err(ApiError::conflict(format!(
            "Content-Range total {total} does not match expected size {}",
            upload.expected_size
        )));
    }
    if index != start / upload.chunk_size {
        return Err(ApiError::invalid(
            "Chunk index does not match Content-Range",
        ));
    }
    if body.len() as i64 != end - start + 1 {
        return Err(ApiError::invalid(
            "Chunk body length does not match Content-Range",
        ));
    }
    let expected_hash = headers
        .get("x-content-sha256")
        .and_then(|value| value.to_str().ok())
        .map(normalize_sha256)
        .ok_or_else(|| ApiError::invalid("X-Content-SHA256 is required"))?;
    let actual_hash = format!("{:x}", Sha256::digest(&body));
    if actual_hash != expected_hash {
        return Err(ApiError::invalid("Chunk SHA-256 does not match"));
    }
    if start < upload.uploaded_bytes {
        if end < upload.uploaded_bytes {
            let path = upload.partial_path.clone();
            let duplicate = body.to_vec();
            let matches =
                tokio::task::spawn_blocking(move || chunk_matches(&path, start, &duplicate))
                    .await
                    .map_err(|error| {
                        ApiError::internal(format!("Upload reader failed: {error}"))
                    })??;
            if matches {
                return Ok(Json(upload_status(&upload)));
            }
        }
        return Err(ApiError::conflict(format!(
            "Server has acknowledged {} bytes and the repeated chunk did not match; resume from that offset",
            upload.uploaded_bytes
        )));
    }
    if start > upload.uploaded_bytes {
        return Err(ApiError::conflict(format!(
            "Server has acknowledged {} bytes; resume from that offset",
            upload.uploaded_bytes
        )));
    }

    let path = upload.partial_path.clone();
    let bytes = body.to_vec();
    tokio::task::spawn_blocking(move || write_chunk(&path, start, &bytes))
        .await
        .map_err(|error| ApiError::internal(format!("Upload writer failed: {error}")))??;
    let offset = end + 1;
    state.database.set_upload_offset(&id, offset)?;
    let refreshed = state.database.upload(&id)?;
    Ok(Json(upload_status(&refreshed)))
}

pub async fn complete_upload(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<CompleteUploadRequest>,
) -> ApiResult<Response> {
    let upload = state.database.upload(&id)?;
    if upload.status == "completed" {
        let dataset = state.database.dataset(&upload.dataset_id)?;
        return Ok(Json(CompleteUploadResponse {
            dataset_id: dataset.id,
            validation_status: dataset.validation_status,
            file_count: count_files(&dataset.content_path)?,
        })
        .into_response());
    }
    if upload.status == "validating" {
        return Ok((
            StatusCode::ACCEPTED,
            Json(json!({ "uploadId": id, "status": "validating" })),
        )
            .into_response());
    }
    if upload.uploaded_bytes != upload.expected_size || request.size != upload.expected_size {
        return Err(ApiError::conflict(format!(
            "Upload is incomplete: {} of {} bytes received",
            upload.uploaded_bytes, upload.expected_size
        )));
    }
    let requested_hash = normalize_sha256(&request.sha256);
    if requested_hash != upload.expected_sha256 {
        return Err(ApiError::invalid(
            "Completion checksum differs from upload handshake",
        ));
    }
    state.database.validate_upload(&id)?;
    let validation_state = state.clone();
    let validation_id = id.clone();
    tokio::spawn(async move {
        if let Err(error) = finalize_upload(validation_state.clone(), &validation_id, upload).await
        {
            let _ = validation_state
                .database
                .fail_upload(&validation_id, &error.message);
        }
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "uploadId": id, "status": "validating" })),
    )
        .into_response())
}

pub async fn cancel_upload(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    if state.database.upload(&id)?.status == "validating" {
        return Err(ApiError::conflict(
            "Dataset validation is already running and cannot be cancelled safely",
        ));
    }
    let upload = state.database.cancel_upload(&id)?;
    if upload.partial_path.exists() {
        tokio::fs::remove_file(&upload.partial_path).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_dataset(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let dataset = state.database.delete_dataset(&id)?;
    let managed_root = state.config.data_dir.join("datasets");
    for path in [dataset.artifact_path, dataset.content_path] {
        if path.starts_with(&managed_root) && path.exists() {
            if path.is_dir() {
                tokio::fs::remove_dir_all(path).await?;
            } else {
                tokio::fs::remove_file(path).await?;
            }
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

fn upload_status(upload: &UploadRecord) -> UploadStatus {
    UploadStatus {
        upload_id: upload.id.clone(),
        status: upload.status.clone(),
        uploaded_bytes: upload.uploaded_bytes,
        total_bytes: upload.expected_size,
        chunk_size: upload.chunk_size,
        last_error: upload.last_error.clone(),
    }
}

async fn finalize_upload(state: Arc<AppState>, id: &str, upload: UploadRecord) -> ApiResult<()> {
    let source = upload.partial_path.clone();
    let expected = upload.expected_sha256.clone();
    let actual = tokio::task::spawn_blocking(move || sha256_file(&source))
        .await
        .map_err(|error| ApiError::internal(format!("Checksum worker failed: {error}")))??;
    if actual != expected {
        return Err(ApiError::invalid("Final dataset SHA-256 does not match"));
    }

    let dataset_root = state.config.data_dir.join("datasets").join(id);
    let artifact_path = dataset_root.join("artifact");
    let content_path = dataset_root.join("content");
    let upload_for_validation = upload.clone();
    let result = tokio::task::spawn_blocking(move || {
        commit_and_validate(
            &upload_for_validation,
            &dataset_root,
            &artifact_path,
            &content_path,
        )
    })
    .await
    .map_err(|error| ApiError::internal(format!("Dataset validation worker failed: {error}")))??;
    state
        .database
        .complete_upload(&upload, &result.0, &result.1, result.2)?;
    Ok(())
}

fn parse_content_range(value: &str) -> ApiResult<(i64, i64, i64)> {
    let value = value
        .strip_prefix("bytes ")
        .ok_or_else(|| ApiError::invalid("Content-Range must start with 'bytes '"))?;
    let (range, total) = value
        .split_once('/')
        .ok_or_else(|| ApiError::invalid("Content-Range total is missing"))?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| ApiError::invalid("Content-Range byte range is invalid"))?;
    let start = start
        .parse::<i64>()
        .map_err(|_| ApiError::invalid("Content-Range start is invalid"))?;
    let end = end
        .parse::<i64>()
        .map_err(|_| ApiError::invalid("Content-Range end is invalid"))?;
    let total = total
        .parse::<i64>()
        .map_err(|_| ApiError::invalid("Content-Range total is invalid"))?;
    if start < 0 || end < start || total <= end {
        return Err(ApiError::invalid("Content-Range values are inconsistent"));
    }
    Ok((start, end, total))
}

fn write_chunk(path: &FsPath, offset: i64, bytes: &[u8]) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)?;
    file.seek(SeekFrom::Start(offset as u64))?;
    file.write_all(bytes)?;
    file.flush()?;
    Ok(())
}

fn chunk_matches(path: &FsPath, offset: i64, expected: &[u8]) -> ApiResult<bool> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset as u64))?;
    let mut actual = vec![0_u8; expected.len()];
    file.read_exact(&mut actual)?;
    Ok(actual == expected)
}

fn sha256_file(path: &FsPath) -> ApiResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn commit_and_validate(
    upload: &UploadRecord,
    dataset_root: &FsPath,
    artifact_path: &FsPath,
    content_path: &FsPath,
) -> ApiResult<(PathBuf, PathBuf, i64)> {
    if dataset_root.exists() {
        fs::remove_dir_all(dataset_root)?;
    }
    fs::create_dir_all(content_path)?;
    fs::rename(&upload.partial_path, artifact_path)?;
    let validation = validate_committed_dataset(upload, artifact_path, content_path);
    if let Err(error) = validation {
        if content_path.exists() {
            fs::remove_dir_all(content_path)?;
        }
        if let Some(parent) = upload.partial_path.parent() {
            fs::create_dir_all(parent)?;
        }
        if artifact_path.exists() {
            fs::rename(artifact_path, &upload.partial_path)?;
        }
        if dataset_root.exists() {
            fs::remove_dir_all(dataset_root)?;
        }
        return Err(error);
    }
    let file_count = validation?;
    Ok((
        artifact_path.to_path_buf(),
        content_path.to_path_buf(),
        file_count,
    ))
}

fn validate_committed_dataset(
    upload: &UploadRecord,
    artifact_path: &FsPath,
    content_path: &FsPath,
) -> ApiResult<i64> {
    let is_zip = upload.format.eq_ignore_ascii_case("zip")
        || upload.name.to_ascii_lowercase().ends_with(".zip");
    if is_zip {
        extract_zip_safely(artifact_path, content_path)?;
    } else {
        let extension = FsPath::new(&upload.name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("data");
        fs::copy(
            artifact_path,
            content_path.join(format!("dataset.{extension}")),
        )?;
    }
    let files = collect_files(content_path)?;
    if files.is_empty() {
        return Err(ApiError::invalid("Dataset archive contains no files"));
    }
    for file in &files {
        validate_dataset_file(file)?;
    }
    Ok(files.len() as i64)
}

fn extract_zip_safely(archive_path: &FsPath, destination: &FsPath) -> ApiResult<()> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| ApiError::invalid(format!("Dataset ZIP is invalid: {error}")))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| ApiError::invalid(format!("Could not read ZIP entry: {error}")))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| ApiError::invalid("Dataset ZIP contains an unsafe path"))?;
        let output = destination.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&output)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(output)?;
        std::io::copy(&mut entry, &mut file)?;
    }
    Ok(())
}

fn collect_files(root: &FsPath) -> ApiResult<Vec<PathBuf>> {
    let mut output = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(ApiError::invalid("Dataset may not contain symbolic links"));
            }
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                output.push(entry.path());
            }
        }
    }
    Ok(output)
}

fn validate_dataset_file(path: &FsPath) -> ApiResult<()> {
    let metadata = fs::metadata(path)?;
    if metadata.len() == 0 {
        return Err(ApiError::invalid(format!(
            "{} is empty",
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Dataset file")
        )));
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "json" => {
            if let Err(document_error) =
                serde_json::from_reader::<_, serde_json::Value>(File::open(path)?)
            {
                validate_json_lines(path).map_err(|line_error| {
                    ApiError::invalid(format!(
                        "{} is neither a valid JSON document ({document_error}) nor valid JSON Lines ({})",
                        path.display(),
                        line_error.message
                    ))
                })?;
            }
        }
        "jsonl" => {
            validate_json_lines(path)?;
        }
        _ => {}
    }
    Ok(())
}

fn validate_json_lines(path: &FsPath) -> ApiResult<()> {
    let mut record_count = 0_u64;
    for (index, line) in BufReader::new(File::open(path)?).lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        serde_json::from_str::<serde_json::Value>(&line).map_err(|error| {
            ApiError::invalid(format!("line {} contains invalid JSON: {error}", index + 1))
        })?;
        record_count += 1;
    }
    if record_count == 0 {
        return Err(ApiError::invalid("the file contains no JSON records"));
    }
    Ok(())
}

fn count_files(path: &FsPath) -> ApiResult<i64> {
    Ok(collect_files(path)?.len() as i64)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use uuid::Uuid;

    use super::{parse_content_range, validate_dataset_file};

    #[test]
    fn parses_content_ranges() {
        assert_eq!(
            parse_content_range("bytes 0-9/10").expect("range should parse"),
            (0, 9, 10)
        );
        assert!(parse_content_range("items 0-9/10").is_err());
        assert!(parse_content_range("bytes 9-0/10").is_err());
    }

    #[test]
    fn accepts_json_lines_with_a_json_extension() {
        let path = std::env::temp_dir().join(format!("tome-{}.json", Uuid::new_v4()));
        fs::write(&path, "{\"prompt\":\"one\"}\n{\"prompt\":\"two\"}\n")
            .expect("fixture should be written");
        let result = validate_dataset_file(&path);
        let _ = fs::remove_file(path);
        assert!(result.is_ok(), "{result:?}");
    }
}
