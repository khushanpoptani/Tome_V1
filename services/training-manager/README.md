# Tome Training Manager

The Tome Training Manager is the Windows-side service that owns datasets, job execution,
hardware monitoring, model artifacts, and Ollama registration. Tome Desktop communicates
with it over `tome-training/v1`; the desktop never computes gradients.

## What is implemented

- REST health, capability, resource, dataset, upload, job, cancellation, retry, and log
  APIs
- WebSocket events for job state, logs, resources, and model registration
- resumable, checksummed chunk uploads with safe ZIP extraction and deterministic
  validation
- SQLite-backed upload sessions, datasets, immutable job attempts, logs, and restart
  recovery
- multi-dataset job specifications that combine every selected dataset in one worker run
- bounded job concurrency and process cancellation
- NVIDIA, CPU, RAM, disk, and queue telemetry
- a real Hugging Face Transformers + PEFT worker for LoRA and QLoRA
- post-training PEFT adapter validation and registration through the local Ollama CLI
- console mode for diagnostics and Windows Service mode for production

Unsloth, Axolotl, merged-model export, and GGUF conversion are explicit future adapters.
The capability endpoint reports them as unavailable; it never simulates training.

## Windows installation

Run PowerShell as Administrator from a Tome checkout:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\install-training-manager.ps1
```

The installer builds the Rust service on Windows, creates a Python virtual environment,
installs the worker dependencies, registers `TomeTrainingManager` with the Windows Service
Manager, opens inbound TCP `11435`, starts the service, and checks `/v1/health`.

To upgrade an existing installation without reinstalling the Python environment, replace
the Tome checkout with the new release, open PowerShell as Administrator, and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\scripts\windows\install-training-manager.ps1 -SkipPythonDependencies
(Invoke-RestMethod http://127.0.0.1:11435/v1/health).version
```

The installer stops the existing service, terminates an orphan process only when it is
running from the installed Training Manager path, retries replacement while Windows
releases executable or antivirus file handles, preserves `config.json`, restarts the
service, and performs a health check.

Defaults:

- API: `http://0.0.0.0:11435`
- Ollama: `http://127.0.0.1:11434`
- data: `C:\ProgramData\Tome\TrainingManager`
- configuration: `C:\ProgramData\Tome\TrainingManager\config.json`

For an NVIDIA-specific PyTorch wheel, pass the current official PyTorch index URL:

```powershell
.\scripts\windows\install-training-manager.ps1 `
  -TorchIndexUrl "https://download.pytorch.org/whl/cu128"
```

Confirm that the URL matches the CUDA/PyTorch versions installed on the server.

## Configuration

Create a baseline without installing the service:

```powershell
.\target\release\tome-training-manager.exe `
  --write-default-config C:\ProgramData\Tome\TrainingManager\config.json
```

`bearerToken` may be set for deployments beyond a trusted LAN. Tome does not store this
secret in SQLite; authenticated desktop credential integration remains a separate security
milestone.

## Diagnostics

```powershell
Invoke-RestMethod http://127.0.0.1:11435/v1/health
Invoke-RestMethod http://127.0.0.1:11435/v1/capabilities
Invoke-RestMethod http://127.0.0.1:11435/v1/resources
Get-Service TomeTrainingManager
```

Run interactively when troubleshooting:

```powershell
$env:TOME_TRAINING_CONFIG = "C:\ProgramData\Tome\TrainingManager\config.json"
.\target\release\tome-training-manager.exe
```

No installation or diagnostic command starts a training job. A job begins only after a
user dispatches a validated job draft from Tome.

`POST /v1/jobs` accepts both the compatibility `datasetId` field and `datasetIds`. When
`datasetIds` contains more than one registered dataset, the worker reads their content
paths as one combined training corpus. Every selected dataset must already be valid and
uploaded to this Training Manager.
