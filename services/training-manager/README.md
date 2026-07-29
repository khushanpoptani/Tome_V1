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
- two-second per-job Python worker CPU, RAM, disk-I/O, preprocessing progress, and ETA
- dataset/file/record diagnostics for incompatible training schemas
- a real Hugging Face Transformers + PEFT worker for LoRA and QLoRA
- post-training PEFT adapter validation and registration through the local Ollama CLI
- console mode for diagnostics and Windows Service mode for production

## Reliable training preflight

`POST /v1/training/preflight` checks the Python worker, accelerator requirements and
access to the original trainable source before a job is queued. Gated Hugging Face models
accept an optional read-only credential in this request. An accepted credential is held
only in service memory and passed to the Python worker as `HF_TOKEN`; it is not persisted
in the Training Manager database or job files.

The desktop automatically repeats preflight when the user clicks **Train**. Restarting the
service clears the session credential.

## Automatic open-base training

Tome's default training recipe does not require an account or token. If no compatible open
base is installed, the desktop pulls `tinyllama:latest` from the active Ollama server and
pairs it with the public Apache-2.0 `TinyLlama/TinyLlama-1.1B-Chat-v0.6` Safetensors
checkpoint. The worker downloads that checkpoint anonymously, trains a LoRA adapter with
conservative CPU defaults, and registers the adapter as a new Ollama model without
changing the original base.

The quantized GGUF blobs managed by Ollama are inference artifacts and are not used for
gradient training. The original trainable checkpoint must match the Ollama base exactly;
preflight rejects mismatched pairs. `mistral:latest`/`mistral:7b` with
`mistralai/Mistral-7B-Instruct-v0.3` is also recognized as an open pair, but is not the
recommended CPU option because it requires substantially more RAM and training time.

On Windows, unsupported GPUs fall back to CPU LoRA. QLoRA remains limited to the supported
NVIDIA CUDA worker path. In particular, older integrated Radeon Vega hardware is not
presented as a usable accelerator merely because it is available for display workloads.

Unsloth, Axolotl, merged-model export, and GGUF conversion are explicit future adapters.
The capability endpoint reports them as unavailable; it never simulates training.

## Windows installation

For normal installation, double-click:

```text
Tome-Training-Server-Setup-<version>.exe
```

The UAC-enabled wizard contains the native service and a private Python runtime. It checks
Ollama, installs the training dependencies, registers and starts the service, configures a
LocalSubnet firewall rule, and verifies `/v1/health`. Cargo, Rust, and manual PowerShell
commands are not required on the server. Detailed failures are written to
`C:\ProgramData\Tome\TrainingManager\installer.log`.

The source installer remains available for development and diagnostics. Run PowerShell as
Administrator from a Tome checkout:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows\install-training-manager.ps1
```

The installer builds the Rust service on Windows, creates a Python virtual environment,
installs the worker dependencies, registers `TomeTrainingManager` with the Windows Service
Manager, opens inbound TCP `11435`, starts the service, and checks `/v1/health`.

See [the Windows installer documentation](../../docs/windows-training-server-installer.md)
for release packaging, upgrade, firewall, and uninstall behavior.

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

For a bounded end-to-end smoke run, training parameters may include `maxRecords` and
`maxSteps`. For example, `"maxRecords": 8` and `"maxSteps": 1` validate registration and
inference without treating the resulting adapter as a production-quality fine-tune.

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
