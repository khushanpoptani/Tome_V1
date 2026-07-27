# ADR-0001: Foundation Tooling

- Status: Accepted for Prompt 1
- Date: 2026-07-27

## Context

Tome requires a cross-platform desktop client, modular TypeScript packages, a Rust
execution layer, strict quality gates, and future compatibility with plugins, MCP,
collaboration, and multiple windows.

## Decision

- Use pnpm workspaces for JavaScript/TypeScript packages.
- Use a Cargo workspace for Rust packages.
- Keep one Tauri v2 application in `apps/desktop`.
- Keep reusable TypeScript contracts under `packages/`.
- Use feature-first organization inside the desktop application.
- Use ESLint flat configuration, Prettier, Husky, lint-staged, Vitest, and GitHub Actions.
- Keep the native Git CLI behind a future provider boundary until its final selection is
  reviewed.

## Consequences

- Package boundaries are explicit without adding a build orchestrator before it is
  necessary.
- Frontend packages expose TypeScript source within the private workspace.
- A future publishing strategy may add per-package builds without changing consumers.
- Rust toolchain and platform WebView dependencies remain development prerequisites.
