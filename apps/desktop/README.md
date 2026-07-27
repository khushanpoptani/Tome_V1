# Tome Desktop

The Tauri v2 desktop client for Tome. React renders the application shell while Rust owns
deterministic local services and platform integration.

Implemented desktop capabilities:

- Browser-history routing with last-page restoration
- Collapsible, resizable, keyboard-navigable sidebar
- SQLite migrations and persisted settings, servers, workspaces, projects, chats, tasks,
  installed-model metadata, model tests, connection history, and logs
- Ollama health diagnostics, model listing/details/pulls/deletion, and cancellable
  streamed chat
- Markdown, code, Mermaid, image, and text attachment rendering
- Dark, light, and system appearance modes

From the repository root:

```bash
pnpm desktop dev
```

Tome stores its macOS development database at:

```text
~/Library/Application Support/app.tome.desktop/tome.sqlite3
```

AI agents, training, datasets, file mutation, Git integration, and execution engines are
not part of this functional-shell milestone.
