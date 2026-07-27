# Repository Structure

```text
tome/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── app/                 # Providers, router, error boundaries
│       │   ├── components/          # App-specific composed components
│       │   ├── features/            # Feature-first route modules
│       │   ├── layouts/             # Title/sidebar/workspace/context/prompt shell
│       │   └── styles/              # Tailwind entry and design tokens
│       └── src-tauri/
│           ├── capabilities/        # Tauri v2 permission capabilities
│           ├── src/
│           │   ├── application/     # Deterministic use cases
│           │   ├── domain/          # Stable entities and policy vocabulary
│           │   ├── infrastructure/  # OS, database, transport adapters
│           │   └── interface/       # Tauri commands and event adapters
│           └── tauri.conf.json
├── packages/
│   ├── api/                         # HTTP/WebSocket ports and schemas
│   ├── config/                      # Shared constants and configuration
│   ├── hooks/                       # Reusable React orchestration hooks
│   ├── stores/                      # Framework-neutral Zustand stores
│   ├── types/                       # Cross-package domain vocabulary
│   ├── ui/                          # Design system and shadcn/ui primitives
│   └── utils/                       # Small dependency-light helpers
├── crates/                          # Future reusable Rust crates
├── docs/
│   ├── architecture/
│   └── roadmap.md
├── datasets/                        # Dataset manifests; no datasets committed
├── models/                          # Model manifests; no model weights committed
├── scripts/                         # Cross-platform repository automation
└── .github/workflows/               # CI and future release workflows
```

## Dependency rules

1. UI features depend on stable package contracts, not Tauri internals.
2. Tauri commands are adapters around application services.
3. Domain and application code do not depend on UI frameworks.
4. Only infrastructure adapters access SQLite, the operating system, Git,
   HTTP/WebSocket transports, or files.
5. Only the File Writer adapter may mutate project files.
6. Every potentially destructive adapter must require a security authorization
   decision.
7. AI-specific reasoning remains remote; the client validates schemas and
   orchestrates deterministic transitions.

## Naming

- Product, window title, and UI: `Tome`
- Repository and JavaScript package prefix: `tome` / `@tome/*`
- Rust crates: `tome-*`
- Desktop bundle identifier: `app.tome.desktop`

