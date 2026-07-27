# Tome Architecture Overview

## Source review

The initial architecture review covers all 17 supplied documents:

1. Agent Router Agent
2. Code Generation Agent
3. Diagnosis Agent
4. Documentation Agent
5. Execution Engine
6. File Writer
7. Logging Analytics
8. Planning Agent
9. Product Architecture
10. Project Context Builder
11. Repair Agent
12. Security Permissions
13. Strategy Agent
14. Technical Agent
15. Technical Architecture
16. UI/UX Architecture
17. Verification Engine

The source documents sometimes use the former product name "Codex Work".
Per the project brief, the implementation and maintained documentation use
"Tome" exclusively while preserving the described architecture.

## System boundary

Tome has two deployment layers:

- **Ollama server - AI layer:** owns every reasoning component, including
  routing, planning, strategy, code generation, diagnosis, repair,
  documentation, model management, datasets, fine-tuning, and inference.
- **Desktop client - execution layer:** owns the UI, workspaces, projects,
  chat, task queue, history, settings, local database, repository access,
  deterministic orchestration, context construction, writing, verification,
  logging, and security.

The local repository never needs to leave the client except for the deliberately
selected context sent to an agent. The desktop client must not make AI
decisions. AI outputs are structured proposals; deterministic services validate
and execute them.

## End-to-end technical workflow

1. The user submits a request.
2. The Agent Router classifies it as technical, documentation, or research.
3. For technical work, the Technical Agent selects an implementation or
   diagnosis workflow.
4. The Planning Agent produces an ordered execution plan without reading the
   repository.
5. The client-side Execution Engine processes one step at a time.
6. The Strategy Agent describes modules, expected files, dependencies,
   boundaries, deliverables, and required context.
7. The Project Context Builder indexes the repository, resolves symbols, ranks
   relevant files, and returns the smallest accurate context package.
8. The Code Generation Agent returns structured file changes for the current
   step.
9. The security layer evaluates the requested operations.
10. The File Writer is the only service permitted to modify repository files.
11. The Verification Engine runs configured builds, tests, linters, type checks,
    static analysis, and custom commands.
12. On success, the step is marked complete. On failure, structured logs flow to
    Diagnosis, then Repair, then File Writer and Verification, within retry
    limits.

Documentation requests are handled by the Documentation Agent and saved by the
File Writer. Research remains a future agent described by the router and product
roadmap.

## Component invariants

| Component | Runs on | May reason | May read repository | May write repository | May execute |
| --- | --- | ---: | ---: | ---: | ---: |
| AI agents | Ollama server | Yes | No | No | No |
| Execution Engine | Client | No | Through services | No | Coordinates only |
| Project Context Builder | Client | No | Yes | No | No |
| File Writer | Client | No | For validation | **Yes** | File operations only |
| Verification Engine | Client | No | As tools require | No | **Yes** |
| Security Layer | Client | No | Policy metadata | No | Authorizes only |

The Execution Engine must remain sequential and deterministic in V1. It stores
the current step, completed/pending/failed steps, retry count, and the next
action. A workflow completes only after every step passes verification.

## UI architecture

The desktop shell is workspace-centric, keyboard-friendly, minimally
distracting, and progressively discloses detail.

```text
Title Bar
├── Toolbar
├── Sidebar
├── Main Workspace
├── Resizable Context Panel
├── Persistent Prompt Area
└── Status Bar
```

Primary navigation:

- Dashboard
- Chat
- Workspace
- Projects
- History
- Task Queue
- Settings

Settings subsections:

- General
- Appearance
- Server Connection
- Models
- Security
- Logging
- About

The prompt area provides attachments, voice, model selection, permission mode,
and send controls. The context panel provides the current agent, running tasks,
logs, verification, and outputs. Chat rendering must eventually support
streaming Markdown, code blocks, Mermaid, images, and tables.

## Quality attributes

- **Security:** every destructive filesystem, terminal, internet, Git, training,
  upload, or server operation is authorized in Ask, Smart, or Full Access mode.
- **Performance:** fast startup, lazy route loading, streaming updates,
  virtualized long lists, bounded context, and efficient rendering.
- **Reliability:** deterministic contracts, sequential state transitions,
  conflict-safe writes, accurate exit codes, retries, and verification before
  completion.
- **Extensibility:** packages and service ports leave room for plugins, MCP,
  research, multi-window, cloud synchronization, collaboration, a marketplace,
  and memory without moving reasoning into the client.
- **Accessibility:** predictable navigation, keyboard-first interaction,
  semantic controls, visible focus, and theme contrast.

## Foundation scope

Prompt 1 establishes:

- monorepo and quality tooling;
- Tauri/React application shell;
- design tokens and reusable UI primitives;
- route and panel structure;
- shared schemas and client-service interfaces;
- Rust module boundaries and a minimal health command;
- CI/build foundations and architecture documentation.

It explicitly does not implement agent calls, repository mutation, command
execution, model management, datasets, training, task orchestration, or
verification behavior.

