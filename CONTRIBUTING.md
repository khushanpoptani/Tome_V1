# Contributing to Tome

## Development workflow

1. Create a focused branch from `main`.
2. Keep changes within the architecture boundaries in
   [`docs/architecture/overview.md`](docs/architecture/overview.md).
3. Update documentation in the same change as behavior.
4. Run the quality checks before committing:

   ```bash
   pnpm format:check
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm rust:fmt
   pnpm rust:clippy
   ```

5. Use a meaningful, scoped commit message.

## Architecture guardrails

- The desktop client performs deterministic execution only.
- All AI reasoning stays on the Ollama server.
- The File Writer is the only component permitted to mutate project files.
- Potentially destructive operations require the security layer.
- Shared packages cannot depend on application features.
- Avoid `any`; validate external data at trust boundaries.

## Pull requests

Keep pull requests small enough to review. Include the motivation, the architecture
impact, verification evidence, screenshots for UI changes, and any new or resolved open
decisions.
