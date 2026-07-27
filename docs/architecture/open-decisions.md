# Open Architecture Decisions

The source documents define component responsibilities clearly, but they do not fully
define the following contracts. Prompt 1 deliberately leaves these behaviors unimplemented
so review can resolve them without rework.

| ID     | Decision needed                                                                                     | Why it matters                                                        | Foundation treatment                                  |
| ------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| OD-001 | Ollama agent API paths, version negotiation, authentication, and error envelope                     | Defines every remote agent boundary                                   | Typed transport ports only                            |
| OD-002 | WebSocket protocol, reconnect/backpressure rules, ordering, cancellation, and resumability          | Required for reliable streaming                                       | UI streaming states only                              |
| OD-003 | SQLite schema, migration ownership, retention, and encryption                                       | Affects history, queue, logs, and settings                            | SQLite runtime and connection boundary only           |
| OD-004 | Native Git CLI versus `git2`, and credential flow                                                   | Security and cross-platform behavior differ                           | Provider interface; native CLI is the initial default |
| OD-005 | Secure secret storage per platform                                                                  | Server credentials must not live in plain settings                    | No credential persistence yet                         |
| OD-006 | Exact Smart Approval policy and Full Access guardrails                                              | Core security behavior must be explicit                               | Modes are modeled; no authorization decisions yet     |
| OD-007 | Terminal command allow/deny rules, sandboxing, timeouts, and process-tree termination               | Required before executing arbitrary commands                          | No command execution yet                              |
| OD-008 | File Writer transaction, backup, rollback, conflict, symlink, and path containment semantics        | Prevents unintended repository changes                                | Port only; no writes yet                              |
| OD-009 | Context ranking/token budgets, binary/generated-file policy, ignore rules, and privacy controls     | Determines data sent to the server                                    | No indexing yet                                       |
| OD-010 | Agent schema compatibility and prompt/model lifecycle                                               | Required for deterministic JSON contracts                             | Zod schema package is ready for versioned contracts   |
| OD-011 | Logging redaction, retention, export, and telemetry consent                                         | Logs can contain source or credentials                                | UI categories only; no capture yet                    |
| OD-012 | Packaging identity, code-signing, notarization, updater, and release channels                       | Required for production distribution                                  | Bundle targets declared; release pipeline deferred    |
| OD-013 | Research Agent V1 scope                                                                             | Router includes research, but no component specification was supplied | Reserved route only                                   |
| OD-014 | Whether Planning uses "implementation plan" or the document's proposed "execution plan" terminology | Affects public schemas                                                | UI uses "plan"; external contract deferred            |

## Reversible foundation assumptions

- pnpm workspaces manage JavaScript packages.
- Cargo workspaces manage Rust crates.
- The app is dark-first and can follow the system theme.
- Shared packages expose source directly during early development; publishing is out of
  scope.
- Native Git CLI sits behind a provider interface until OD-004 is resolved.
- Routes and heavy editor/terminal/chart modules are lazy-loaded when they become
  functional.
