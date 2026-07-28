# Tome Phased Implementation Roadmap

## Phase 0 - Foundation (complete)

- Review and codify the supplied architecture.
- Establish pnpm and Cargo workspaces.
- Configure strict TypeScript, formatting, linting, hooks, staged checks, and CI.
- Scaffold Tauri v2, React 19, Vite, Tailwind, shadcn/ui conventions, routing, state/query
  providers, and the base desktop shell.
- Define shared domain vocabulary and service ports without business behavior.
- Verify builds, tests, Rust checks, and the browser-rendered shell.

Exit criterion: a clean clone installs, checks, builds, and opens a polished Tome shell
with no implemented engineering workflows.

## Phase 1 - Local platform core (functional-shell scope complete)

- Implement versioned SQLite migrations.
- Implement settings, workspace/project records, task state, and conversation history.
- Implement structured application, connection, model, and streaming logs.
- Introduce secure credential storage and platform environment discovery.

Dependencies: Phase 0 and OD-003, OD-005, OD-011.

## Phase 2 - Ollama connectivity (functional-shell scope complete)

- Finalize versioned HTTP and WebSocket contracts.
- Add connection validation, health status, model discovery, streaming, cancellation, and
  detailed error handling.
- Add server/model settings forms and connection diagnostics.

Dependencies: Phase 1 and OD-001, OD-002, OD-010.

## Phase 3 - Workspace and context

- Add workspace/project lifecycle, file explorer, search, favorites, Git/build status, and
  project summaries.
- Implement repository indexing, Tree-sitter parsing, symbol/import graphs, ignore/privacy
  rules, ranking, and bounded context packages.
- Add virtualized file/search result views and Monaco read-only/edit surfaces.

Dependencies: Phase 1, Phase 2, and OD-004, OD-009.

## Phase 4 - Security and deterministic execution services

- Formalize Ask, Smart, and Full Access policies.
- Add scoped approvals, capability audit records, command policy, sandbox strategy, and
  emergency cancellation.
- Implement File Writer path validation, conflicts, transactional operations,
  backup/rollback, patching, and integrity checks.
- Implement Verification Engine command profiles, streaming output, timeouts, exit-code
  capture, and xterm.js presentation.

Dependencies: Phase 3 and OD-006, OD-007, OD-008.

## Phase 5 - Execution Engine

- Implement persisted sequential plan state, dependency validation, retries, pause/cancel,
  recovery after restart, and deterministic event envelopes.
- Wire Strategy → Context → Codegen → Security → Writer → Verification.
- Wire failure → Diagnosis → Repair → Security → Writer → Verification.
- Add task queue, context panel status, logs, verification, and outputs.

Dependencies: Phase 2, Phase 4.

## Phase 6 - AI workflows

- Implement Agent Router, Technical, Planning, Strategy, Code Generation, Diagnosis,
  Repair, and Documentation contracts.
- Add streaming chat, Markdown, code blocks, Mermaid, images, and tables.
- Add prompt attachments, voice entry, model selection, permissions, history, and
  documentation workflows.

Dependencies: Phase 5 and approved agent schemas.

## Phase 7 - Models, datasets, and training (management foundation complete)

- Implement model install/compare/benchmark views.
- Implemented dataset inspection, configurable formats, preview, validation, compression,
  checksums, reusable dataset groups, group-level upload/delete actions, resumable chunk
  uploads, retries, cancellation, speed, and ETA.
- Implemented the Windows Training Manager runtime, job drafts, dispatch, WebSocket and
  heartbeat monitoring, retry/cancel, resource snapshots, persistent logs, and Ollama
  registry integration.
- Implemented a real Hugging Face Transformers + PEFT worker for LoRA and QLoRA. Server
  installation is explicit, and Tome never starts training without a user-dispatched job.

Dependencies: Phase 2, Phase 4, and explicit server management/training APIs.

## Phase 8 - Production hardening and distribution

- Performance profiling, accessibility audit, recovery/chaos tests, dependency and
  security scans, coverage goals, and platform integration tests.
- Configure Windows `.exe`/`.msi`, macOS universal `.app`/`.dmg`, and Linux
  `.deb`/`.rpm`/`.AppImage`.
- Add signing, notarization, SBOMs, provenance, updater, channels, and release automation.

Dependencies: all V1 feature phases and OD-012.

## Future-compatible seams

- Plugin and MCP registries sit beside transport and capability abstractions.
- Multi-window state is scoped by window/workspace identifiers.
- Sync/collaboration consumes event and persistence ports rather than local-only
  assumptions.
- Marketplace packages are versioned extensions, not imports into domain code.
- Memory is a server-side reasoning/data service with explicit client privacy and
  persistence controls.
