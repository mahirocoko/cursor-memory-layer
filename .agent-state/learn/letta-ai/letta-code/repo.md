# letta-code Learning Index

## Source
- **Origin**: ./origin/
- **GitHub**: https://github.com/letta-ai/letta-code
- **Snapshot**: `d7fd0a6cb` (2026-09-24), package `@letta-ai/letta-code` `0.33.1`
- **Checkout**: `/Users/mahiro/ghq/github.com/letta-ai/letta-code` (clean after this pass; no source files written)

## Explorations

### 2026-09-25 2203 (deep)
- [[2026-09-25/2203_ARCHITECTURE|Architecture]]
- [[2026-09-25/2203_CODE-SNIPPETS|Code Snippets]]
- [[2026-09-25/2203_QUICK-REFERENCE|Quick Reference]]
- [[2026-09-25/2203_TESTING|Testing]]
- [[2026-09-25/2203_API-SURFACE|API Surface]]

**Key insights**:
- One `letta` process wraps a `Backend` singleton. Cloud uses `@letta-ai/letta-client`. Local mode is experimental and runs turns through pi-ai. The same tool runtime serves the Ink TUI, headless `-p`, an outbound Cloud computer listener, and an inbound App Server (`letta server --listen`).
- Memory is a git checkout. Tool execution returns `{ status: "error" }` instead of throwing. Subagents are child `letta` processes. Mods live in `src/mods/`. `AGENTS.md` still describes `src/extensions/`, which this snapshot does not contain. `--no-extensions` is rewritten to `--no-mods` in `src/cli/args.ts`.
- Tests are collocated `bun:test` files: 858 `src/**/*.test.ts` plus 24 `src/**/*.test.tsx` (882). Isolation is the main fixture style. `bun run check` does not run the suite, and there is no line-coverage job.
- The public surface is the CLI plus a small set of package exports (`app-server-client`, channel helpers, memory confinement, MCP client). It is not a general REST API. HTTP on the App Server is health checks plus optional OpenAI-compatible routes.
- Project skills have two directory constants in `src/agent/skills.ts`: canonical `PROJECT_SKILLS_DIR` is `.agents/skills`; legacy `SKILLS_DIR` is `.skills`. `discoverSkills` still defaults its project path to the legacy directory.

## Review notes

Reader counts agree on package version `0.33.1` and on 882 test files under `src/`. Docker is a published image and a Dockerfile, not a README install guide. `bin/letta.js` still launches platform binaries that `build.js` in this commit does not emit. Source `git status` was empty after the readers finished.
