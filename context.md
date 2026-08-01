# Tome Project Context

This file is the handoff document for a new Codex chat or engineer working on Tome. Read
it before changing the project. It records the implemented state, architectural
constraints, deployment topology, known limitations, and the safest way to continue.

Keep this file current whenever a change affects architecture, deployment, persistence,
APIs, training behavior, security, release version, or major feature status. The source
code and migrations remain authoritative when this document and the implementation
disagree.

## 1. Project snapshot

- Product: **Tome**, a cross-platform AI-powered desktop software engineering workspace.
- Repository: `Tome_V1` at <https://github.com/khushanpoptani/Tome_V1>.
- Default branch: `main`.
- Repository visibility: private at the time of this handoff.
- Current source version: **0.1.21**.
- Primary desktop development machine: macOS, Apple Silicon.
- Current Windows AI server LAN address: `192.168.1.6`.
- Ollama endpoint: `http://192.168.1.6:11434`.
- Tome Training Manager endpoint: `http://192.168.1.6:11435`.
- Current implemented milestone: functional desktop shell, Ollama inference, persistent
  project/chat management, dataset management, and an external Windows training
  orchestration service.
- Next major product milestone: implement the AI agent and deterministic execution
  architecture described in `docs/architecture/`; those agents are not implemented yet.

Do not assume that version 0.1.21 is installed on both machines merely because the source
is at 0.1.21. Confirm the desktop version in **Settings → About** and confirm the Training
Manager version through `GET /v1/health` before diagnosing version-dependent behavior.

## 2. Non-negotiable architecture rules

1. The desktop application owns UI, local persistence, workspaces, projects, chat, context
   collection, security approvals, file operations, execution, and verification.
2. AI reasoning must remain on the configured AI server. Do not move planning, diagnosis,
   repair, code-generation, or other model reasoning into the desktop application.
3. Ollama owns inference and its model registry. Ollama does **not** provide dataset
   upload, fine-tuning-job, ETA, or training-management APIs.
4. Model training must run on the external Windows Training Manager beside Ollama. The
   Tome desktop must not train locally.
5. Inference and training are separate paths and must remain separately configurable.
6. All destructive desktop actions must pass through Tome's security layer and its
   execution mode: Ask for Approval, Smart Approval, or Full Access.
7. Database reset always requires explicit typed confirmation, regardless of execution
   mode.
8. Keep the architecture modular and compatible with future plugins, MCP, multi-window
   support, cloud sync, collaboration, marketplace, and memory.
9. Preserve strict TypeScript, small feature-oriented modules, SOLID/Clean Architecture
   boundaries, and Rust domain/application/infrastructure/interface separation.
10. Never commit tokens, local databases, datasets, model weights, private Python
    runtimes, build outputs, or machine-specific secrets.

## 3. Implemented topology

```text
Tome desktop (macOS today; Windows/Linux supported by architecture)
├── React/Tauri UI and local SQLite
├── Ollama client ─────────────── HTTP/NDJSON ──> Ollama :11434
└── Training client ───────── REST/WebSocket ──> Tome Training Manager :11435
                                                   ├── Dataset storage
                                                   ├── SQLite metadata
                                                   ├── Python Transformers/PEFT worker
                                                   ├── Job/resource/log monitoring
                                                   └── Ollama model registration ──> Ollama :11434
```

The future agent topology in the architecture PDFs and `docs/architecture/` is planned
rather than implemented. Do not report Router, Planning, Technical, Documentation, Code
Generation, Diagnosis, or Repair agents as working features.

## 4. Technology and repository layout

### Required stack

- Tauri v2 with Rust backend
- React 19, TypeScript, and Vite
- Tailwind CSS and shadcn/ui conventions
- Lucide React and Framer Motion
- Zustand and TanStack Query
- React Router, React Hook Form, and Zod
- react-markdown and Mermaid
- Monaco Editor, xterm.js, and Recharts
- Sonner notifications
- SQLite
- Ollama REST/streaming API
- pnpm workspaces and a Cargo workspace

### Repository map

```text
apps/
  desktop/
    src/                    React application and desktop features
    src-tauri/src/
      application/         Use cases and orchestration
      domain/              Core entities, policies, and repository traits
      infrastructure/      SQLite, HTTP, filesystem, platform implementations
      interface/           Tauri command boundary
packages/
  api/                      Shared API clients/contracts
  config/                   Shared configuration
  hooks/                    Reusable React hooks
  stores/                   Shared Zustand state
  types/                    Shared TypeScript types
  ui/                       Shared UI primitives
  utils/                    Shared utilities
services/
  training-manager/         External Windows Training Manager Rust service
packaging/
  windows/training-server/  Inno Setup and packaged-server installer assets
scripts/
  windows/                  Windows install/build/uninstall scripts
docs/
  architecture/             Source-of-truth architecture decisions and diagrams
datasets/                   Placeholder only; do not commit real datasets
models/                     Placeholder only; do not commit model artifacts
```

## 5. Desktop application status

### Application shell and navigation

Implemented routes include:

- Dashboard: `/`
- Chat: `/chat`
- Workspace: `/workspace`
- Projects: `/projects`
- History: `/history`
- Task Queue: `/tasks`
- Settings: `/settings`
- Training: nested training views for dashboard, datasets, jobs, running/completed/failed
  jobs, history, resources, and logs

The application remembers the last route. The project/chat tree supports expand/collapse,
active chat selection, project and chat actions, and SQLite persistence. The global prompt
composer must render only on the Chat page, not on Settings, Training, or other pages.

### Functional areas

- Dashboard reads live server/model/project/chat/task/version status and provides empty
  states.
- Workspaces and projects support create/open/rename/delete and native directory
  selection.
- Chats stream Ollama output, render Markdown/code/Mermaid, persist conversations, and
  support retry, stop, copy, and regenerate flows.
- History supports search, rename, delete, and reopening conversations.
- Task Queue stores status, progress, timestamps, and logs.
- Settings persist general, appearance, server, model, security, logging, and about
  values.
- Themes support dark, light, and system modes.
- Ollama servers support add/edit/remove/test/activate/history.
- Models support refresh, list, details, pull, delete, and inference tests.
- Native Finder/file-picker buttons exist for dataset file/folder selection, workspace
  directory selection, and project directory selection. Do not replace them with typed
  paths.
- A trained model can receive an optional system prompt when its job is created. See the
  training section for registration behavior.

### Not yet implemented

- The agent router and specialist AI agents
- The deterministic execution engine described in the architecture documents
- Real Git status/integration beyond the current placeholder
- Production secret storage in Keychain/Credential Manager/libsecret
- Plugin and MCP runtime
- Cloud sync, collaboration, marketplace, and memory
- Multi-window behavior
- Release signing, macOS notarization, automatic updates, and production installer
  publishing

## 6. Ollama integration

Tome connects directly to Ollama for inference and registry operations. The implemented
client supports model listing, pulling, deletion, metadata, chat completion, and NDJSON
streaming.

Important distinctions:

- An Ollama model is optimized/quantized for inference and usually stored as GGUF layers.
- Quantized Ollama layers cannot be used directly for gradient training.
- Fine-tuning therefore requires the original trainable checkpoint named by `sourceModel`.
- The trained adapter or compatible model artifact is registered back into Ollama only
  after training completes.

The currently configured home Ollama endpoint is `http://192.168.1.6:11434`. If it appears
online in the status bar but a training operation fails, test the Training Manager
separately; the two services are distinct.

## 7. Training architecture and behavior

### Service API

The Training Manager exposes the versioned `tome-training/v1` adapter. Important routes
include:

```text
GET    /v1/health
GET    /v1/capabilities
GET    /v1/resources
GET    /v1/events/ws
POST   /v1/training/preflight

POST   /v1/uploads
GET    /v1/uploads/{upload_id}
PUT    /v1/uploads/{upload_id}/chunks/{chunk_index}
POST   /v1/uploads/{upload_id}/complete
DELETE /v1/uploads/{upload_id}
DELETE /v1/datasets/{dataset_id}

POST   /v1/jobs
GET    /v1/jobs
GET    /v1/jobs/{job_id}
POST   /v1/jobs/{job_id}/cancel
POST   /v1/jobs/{job_id}/retry
POST   /v1/jobs/{job_id}/retry-registration
GET    /v1/jobs/{job_id}/logs

POST   /v1/admin/database/reset
```

WebSocket events are preferred; Tome falls back to polling approximately every five
seconds. Worker telemetry is sampled approximately every two seconds. Resource displays
distinguish `GPU Not detected` from a real zero-percent GPU reading.

### Uploads and datasets

- Dataset preparation, scanning, validation, optional managed ZIP creation, and upload run
  as background tasks.
- Uploads use resumable chunks and checksums.
- Completion/registration is idempotent by dataset ID so retries do not create duplicate
  rows.
- Server validation may continue after all bytes reach 100%; the UI must label that stage
  rather than appearing stuck.
- Source folders are never modified. Exclusions affect only Tome's managed cleaned
  artifact.
- Supported extensions are configurable; defaults include JSONL, JSON, CSV, Parquet, TXT,
  and Markdown.
- Valid training record shapes include `text`, `prompt`/`response`,
  `instruction`/`output`, and chat `messages`.
- Structured validation issues include file path, row/line where available, code,
  severity, and suggested action.
- Users can exclude an individual file/row or bulk-exclude all issues sharing an issue
  code, then revalidate.
- Raw GitHub event archives can be syntactically valid yet unsuitable for supervised
  fine-tuning. Warnings such as missing trainable fields must not be dismissed just
  because the dataset badge says valid.

Dataset groups are desktop-side organizational metadata. A group supports add data, add
existing datasets, upload group, rename, delete, collapse/expand, and direct selection in
the training job form. Selecting a group resolves its member dataset IDs for the job.

### Training worker

The Windows worker performs real Hugging Face Transformers and PEFT training. Its private
Python environment is provisioned by the Windows installer. Key dependency families are:

- `torch >=2.7,<3`
- `transformers >=4.53,<6`
- `peft >=0.17,<1`
- `accelerate >=1.9,<2`
- `datasets >=4,<5`
- `pyarrow >=20,<24`
- `safetensors >=0.5,<1`
- `bitsandbytes` only for supported QLoRA/CUDA setups

Current Windows hardware is a Ryzen 5 with Radeon Vega 8 integrated graphics. The current
PyTorch worker does not use that AMD iGPU on Windows. `Auto (LoRA)` uses CPU and can be
very slow; QLoRA requires a supported NVIDIA CUDA runtime. CPU resource readings around
partial utilization are expected because training/data-loader behavior is not guaranteed
to saturate every core.

### Recommended automatic open-base path

For a low-friction, ungated smoke test on current hardware, use this exact pairing:

```text
Ollama base:       tinyllama:latest
Trainable source: TinyLlama/TinyLlama-1.1B-Chat-v0.6
Backend:           Auto (LoRA)
Epochs:            1
```

This pairing is anonymous and Apache-2.0. Tome also recognizes compatible Mistral
pairings, such as `mistral:latest` or `mistral:7b` with
`mistralai/Mistral-7B-Instruct-v0.3`, but they are much heavier for CPU training.

Restricted Meta Llama repositories require both license approval on Hugging Face and a
read-only token. A token alone does not grant gated-repository access. Tome sends an
entered token only to the active Training Manager, which holds it in memory for the
service session and passes it to the worker as `HF_TOKEN`; it must never be written to
SQLite, job JSON, files, or logs.

True pretraining from random weights is not implemented and is not a practical one-click
path for this hardware. “Open base” in Tome means fine-tuning a publicly downloadable
original checkpoint without gated access, not training a foundation model from scratch.

### Parameters and validation

The advanced training JSON controls fields such as:

- `sourceModel`: original full-precision trainable checkpoint
- `trainingRecipe`: selected worker recipe/pairing behavior
- `ollamaAdapterArchitecture`: adapter family used by Ollama registration
- `learningRate`: optimizer step size
- `batchSize`: records processed per device step
- `gradientAccumulationSteps`: steps accumulated before an optimizer update
- `maxLength`: token limit retained per record
- `maxRecords`: optional smoke-test cap
- `loraRank`: LoRA adapter capacity
- `systemPrompt`: optional default system instruction embedded at registration

Preflight verifies Python dependencies, accelerator availability, source access, model
pairing, supported architecture, and dataset readiness before queueing. Unsupported
adapter families, such as an unrecognized Qwen registration path, must fail during
preflight rather than after hours of training.

### System prompts

Version 0.1.21 adds an optional system-prompt field to the new-job form. It is persisted
in the job parameters, limited to 16,000 characters, and rejects a triple consecutive
quote sequence because the final Ollama Modelfile uses:

```text
SYSTEM """..."""
```

The generated model then uses this as its default behavior. Both the desktop and Windows
Training Manager must be updated to 0.1.21 or newer for the complete path to work.

### Registration and retry behavior

Training output from PEFT normally contains `adapter_model.safetensors`. Ollama 0.32.5
discovers safetensors files matching `model*.safetensors`, so Tome 0.1.20 and newer create
a job-local staging directory such as `ollama-adapter/model.safetensors`, copy the adapter
configuration beside it, and build an explicit Modelfile for registration. The original
trained artifact is preserved.

The Training Manager invokes Ollama with an explicit Modelfile path and strips terminal
control sequences from diagnostics. If training succeeds but registration fails, **Retry
registration** must reuse the existing trained output rather than rerun training. A full
retry is reserved for failed training attempts and creates an immutable new attempt.

## 8. Persistence, security, and destructive operations

### Local desktop data

The macOS SQLite database is normally located at:

```text
~/Library/Application Support/app.tome.desktop/tome.sqlite3
```

It stores settings, chats, workspaces, projects, tasks, servers, model tests, logs,
training servers, datasets, groups, uploads, jobs, and resource snapshots. Tome-managed
training ZIPs live under the same application-support tree. Source dataset folders remain
external and are not deleted by normal Tome cleanup.

### Windows Training Manager data

The packaged server uses:

```text
C:\ProgramData\Tome\TrainingManager\
├── config.json
├── training-manager.sqlite3
├── datasets\
├── uploads\
├── jobs\
├── workers\
└── installer.log
```

The Windows service name is `TomeTrainingManager`. Upgrades preserve the database and
configuration unless a reset is explicitly requested.

Default server configuration binds to `0.0.0.0:11435`, points Ollama at
`http://127.0.0.1:11434`, uses one concurrent job, 4 MiB upload chunks, and a 250 GiB
maximum upload size. Check `config.json` rather than assuming defaults on an existing
machine.

### Reset behavior

Settings → Security exposes reset actions for the local database, Windows Training Manager
database, or both. Every action requires typed confirmation.

- Server reset is available only when an active Training Manager is configured and
  reachable.
- “Reset both” resets the server first and clears local data only after the server
  succeeds.
- The server refuses reset while uploads or training jobs are active.
- Reset preserves external source folders and Ollama-installed models.
- After a local reset, the user must reconfigure Ollama and Training Manager connections.

### Network security

The current setup uses plain HTTP on a trusted LAN. The Training Manager supports an
optional bearer token. Enable authentication, firewall scoping, and TLS termination before
exposing it outside the trusted local network. Never expose port 11435 directly to the
public internet.

## 9. Windows server deployment

The desired user experience is one packaged Windows Setup executable rather than manual
Cargo/Python/PowerShell setup. The installer:

- installs or updates the Rust Training Manager binary;
- provisions a private Python runtime and worker environment;
- registers and starts the Windows service;
- preserves existing data/configuration on upgrade;
- opens TCP port 11435 for the LocalSubnet firewall scope;
- verifies the local Ollama and Training Manager health endpoints;
- logs failures to `C:\ProgramData\Tome\TrainingManager\installer.log`.

Build the Windows package from macOS with:

```bash
./scripts/build-windows-training-server-package.sh
```

Build the setup executable on Windows with:

```powershell
.\scripts\windows\build-training-server-installer.ps1
```

Generated package and installer artifacts are intentionally ignored under
`target/release/bundle/windows-training-server/`; they are not pushed to GitHub. A fresh
clone must rebuild or retrieve a separately published release asset.

Useful Windows diagnostics:

```powershell
Get-Service TomeTrainingManager
Invoke-RestMethod http://127.0.0.1:11435/v1/health | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:11434/api/version
Get-Content C:\ProgramData\Tome\TrainingManager\installer.log -Tail 200
```

## 10. Development and verification

Requirements:

- Node.js 22 or newer
- pnpm 11.9.0, as pinned by the workspace
- current stable Rust toolchain
- Tauri platform prerequisites

Common commands:

```bash
pnpm install
pnpm desktop dev

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

pnpm rust:fmt
pnpm rust:clippy
pnpm rust:check
```

For a native macOS bundle:

```bash
pnpm --filter @tome/desktop tauri build
```

or, for unsigned local app/DMG bundles:

```bash
pnpm desktop build --bundles app,dmg --no-sign
```

At the 0.1.21 feature baseline, the workspace passed formatting, linting, TypeScript
checks, web tests/build, Rust formatting/clippy/checks, 21 desktop Rust tests, and 16
Training Manager tests. Re-run checks relevant to every change; do not treat this
historical result as proof that later code still passes.

CI currently runs web quality checks and Rust quality/tests. A Windows installer workflow
exists for manual dispatch or version tags. Production signing, notarization, and updater
publication remain pending.

## 11. Documentation and architecture references

Read these before making architecture-level changes:

- `README.md`
- `docs/architecture/overview.md`
- `docs/architecture/dependency-graph.md`
- `docs/architecture/repository-structure.md`
- `docs/architecture/training-management.md`
- `docs/architecture/open-decisions.md`
- `docs/architecture/decisions/0001-foundation-tooling.md`
- `docs/roadmap.md`
- `docs/windows-training-server-installer.md`

The original architecture PDFs are not stored in the Git repository. Their durable
conclusions have been captured in `docs/architecture/` and this handoff. If a PDF and
implemented code conflict, stop before redesigning and ask for direction.

Important unresolved architecture decisions include agent-server API/authentication,
WebSocket semantics, secure secret storage, final Smart Approval policy, execution
sandboxing, File Writer semantics, Project Context Builder privacy/exclusions, logging
retention/redaction, and release signing/updating.

Key implementation entry points for the current training path are:

- `apps/desktop/src/features/training/training-page.tsx`
- `apps/desktop/src-tauri/src/interface/commands/training.rs`
- `services/training-manager/src/api.rs`
- `services/training-manager/src/jobs.rs`
- `services/training-manager/src/uploads.rs`
- `services/training-manager/src/registry.rs`
- `services/training-manager/workers/train.py`
- `packaging/windows/training-server/`

## 12. Project evolution

The Git history is intentionally incremental and buildable. Its major sequence is:

1. Architecture review, monorepo/Tauri foundation, quality gates, and CI.
2. Native macOS shell correction, settings shell, functional navigation, SQLite, and
   Ollama inference/chat.
3. Project-owned chat hierarchy and initial training-management UI.
4. External Rust Training Manager for Windows.
5. Transparent dataset progress, reliable deletion, JSONL recognition, multi-dataset jobs,
   and complete Ollama model refresh.
6. Windows service reliability, resumable uploads, retry recovery, and dataset groups.
7. Resilient finalization, locked-binary upgrade recovery, idempotent dataset retries,
   compact group hierarchy, and Chat-only prompt composition.
8. Worker progress/failure reporting, compatible Transformers support, real adapter
   export, and Ollama registration.
9. Structured dataset issue recovery, guarded local/server reset, and a one-click Windows
   installer/bundle.
10. Bulk row cleanup, guarded training readiness, automatic TinyLlama open-base pairing,
    mismatch prevention, staged PEFT registration, and registration-only retry.
11. Version 0.1.21 system prompts and native file/folder pickers.

Use `git log --oneline --reverse` for the authoritative commit-level history. Do not
squash or rewrite the published `main` history without explicit user approval.

## 13. Recent failures and durable fixes

These are important because a new chat should not repeat the same diagnosis or undo the
fixes:

1. **Dataset JSON “trailing characters”**: the files were JSON Lines rather than one JSON
   document. Validation now distinguishes JSON and JSONL and reports exact rows/files.
2. **Duplicate dataset IDs**: upload completion could collide with existing SQLite rows.
   Registration was made idempotent/update-safe.
3. **Upload appears stuck at 99–100%**: byte upload had completed while server validation
   was still running. The UI now exposes the server-validation stage and logs.
4. **Windows service install exit 1639**: service registration/update syntax and installer
   behavior required corrections. The packaged installer is the supported path.
5. **Installer could not replace an in-use executable**: installation now stops/removes
   the service before replacing the binary.
6. **Gated Meta Llama 401**: a token is insufficient without repository license approval.
   Preflight and token-entry diagnostics now explain this before training.
7. **Open-base mismatch**: `llama3.2:3b` cannot be anonymously mapped to an original
   checkpoint automatically. Use a verified pair such as TinyLlama or explicitly provide
   authorized source access.
8. **Training was extremely slow**: Windows Radeon Vega 8 is not used by the current
   worker, so training ran on CPU. ETA/resource UI now reflects this rather than implying
   GPU acceleration.
9. **Training completed but Ollama registration failed with “no Modelfile or safetensors
   files found”**: Ollama did not discover `adapter_model.safetensors`. Registration now
   stages it as `model.safetensors`, generates an explicit Modelfile, and offers
   retry-registration without retraining.
10. **Logs and path UX were confusing**: training logs are shown in the right context
    panel, prompt composition is limited to Chat, and native browse buttons replace manual
    path entry where applicable.

## 14. Working rules for a new chat

1. Start by reading this file, `README.md`, relevant architecture documents, and the
   affected source. Do not restart the project from scratch.
2. Run `git status --short --branch` before editing. Preserve all user changes and never
   reset or discard unrelated work.
3. Inspect the actual implementation and migrations before relying on old screenshots or
   chat history.
4. Verify installed desktop/server versions and live health endpoints before diagnosing a
   regression.
5. Use `rg`/`rg --files` for search and `apply_patch` for source edits.
6. Keep business logic out of React components and Tauri commands; route it through the
   existing application/domain layers.
7. Keep network contracts in shared typed clients and schemas. Do not introduce `any` to
   bypass a contract mismatch.
8. Treat long-running operations as state machines with stage, progress, speed, ETA,
   cancellation, retry, persistence, notifications, and logs.
9. Never hide an error behind a generic Invalid/Failed badge. Surface a safe, actionable
   message and keep detailed logs.
10. Never write secrets into logs, database rows, job payloads, screenshots, or Git
    history.
11. Update tests and documentation with each major change.
12. Keep the repository buildable and use meaningful milestone commits.
13. Push only when the user asks. When pushing, verify the remote, branch, working tree,
    commit contents, and absence of secrets first.
14. Do not claim that a Windows installer or DMG was deployed merely because it built
    locally.
15. Update this file at the end of any architecture, deployment, release, or major feature
    change.

## 15. Handoff checklist

Before declaring future work complete, record here or in the relevant architecture
document:

- what changed and why;
- desktop and Training Manager versions affected;
- schema/API migration implications;
- tests and build commands run;
- artifacts built and whether they were actually installed;
- live endpoint diagnostics if the change touches Ollama/training;
- remaining blockers or unverified assumptions;
- security/privacy implications;
- the Git commit and pushed branch.

This context deliberately separates current capability from the intended final
architecture. Continue incrementally from the implemented foundation and do not silently
redesign Tome.
