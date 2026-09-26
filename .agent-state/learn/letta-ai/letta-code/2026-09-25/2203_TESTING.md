# Testing & Quality Patterns

Source: `origin/` → `/Users/mahiro/ghq/github.com/letta-ai/letta-code` at `d7fd0a6cb` (2026-09-24). Counts below are from `find` / `rg` in that checkout. `.letta/` is gitignored (`.gitignore` lists `.letta`) and contains worktree copies; those files are excluded from the counts.

No test suite was executed.

## Runner

Bun is the test runner. `package.json` sets `"packageManager": "bun@1.3.14"`. There is no Jest, Vitest, or Playwright config. `bunfig.toml` only sets text loaders and:

```toml
[test]
preload = ["./scripts/test-home-preload.ts"]
```

Assertions come from `bun:test` (`describe`, `test`, `expect`, `mock`, `beforeEach` / `afterEach` / `beforeAll` / `afterAll`). One outlier, `src/agent/memory-worktree-http.test.ts`, imports `describe` / `it` from `node:test` and `assert` from `node:assert/strict`. It still matches `*.test.ts`, so the unit runner collects it. Whether Bun executes that `node:test` API was not run here.

`package.json` has no generic `test` script. Documented local commands in `AGENTS.md`:

| Task | Command |
|------|---------|
| One file | `bun test src/path/to/file.test.ts` |
| Unit suite (docs) | `bun test $(find src -name "*.test.ts" \| grep -v integration-tests)` |
| CI unit suite | `node scripts/run-unit-tests.cjs` |
| CI API suite | `bun test src/integration-tests --timeout 15000 --shard=INDEX/COUNT` |

`scripts/run-unit-tests.cjs` invokes `bun test <files> --timeout <ms>` with `LETTA_CODE_TELEM=0`. Shared batches use 15000 ms. Isolated files use the `timeoutMs` in `scripts/isolated-unit-tests.json` (samples are 15000 or 30000).

## Test file counts

Globs are `find -name`, excluding `node_modules` and `.git`. `.letta` is excluded as noted above.

| Glob | Count | Scope |
|------|------:|-------|
| `*.test.ts` | 858 | `src/` |
| `*.test.tsx` | 24 | `src/` (23 under `src/cli`, 1 under `src/auth`) |
| `*.test.ts` + `*.test.tsx` | 882 | `src/` |
| `*.spec.ts` / `*.spec.js` | 0 | repo, excluding `node_modules` and `.git` |
| `*.e2e.test.ts` | 2 | both under `src/websocket/listener/` |
| `*.integration.test.ts` | 8 | repo, excluding `.letta` |
| `*.test.ts` | 11 | `src/integration-tests/` only (2 of these also match `*.integration.test.ts`) |
| `*.test.ts` | 23 | `scripts/` |
| `*.test.cjs` | 2 | `scripts/test-sharding.test.cjs`, `scripts/unit-test-impact.test.cjs` |
| `*.test.cjs` | 1 | `.github/scripts/contribution-guard.test.cjs` |

`src/` `*.test.ts` by first directory (this glob does not include the 24 tsx files): `cli` 156, `channels` 135, `websocket` 119, `agent` 102, `tools` 92, `backend` 49, plus smaller dirs (`utils` 23, `permissions` 20, `mods` 17, …). 60 `*.test.ts` files sit directly in `src/`.

858 of 858 `src/**/*.test.ts` files were counted by `find src -name '*.test.ts'`. 857 of those import `from "bun:test"`; the missing one is the `node:test` file above. All 24 `*.test.tsx` files import `bun:test`. 19 of 24 import `from "ink"`.

## Structure and conventions

Tests sit next to source (`local-store.test.ts` beside `local-store.ts`). `AGENTS.md` and `scripts/check-test-coverage.cjs` forbid a separate `src/tests/` tree. The coverage check fails if any `*.test.ts` / `*.test.tsx` path starts with `src/tests`.

Naming:

- Default: `*.test.ts` / `*.test.tsx`, collocated.
- `*.integration.test.ts`: live API or cross-module cases. Four agent/websocket files gate the suite with `describe` vs `describe.skip` unless `LETTA_RUN_API_INTEGRATION_TESTS=true` (and, where checked, `LETTA_API_KEY`). `src/agent/memory-filesystem.sync.integration.test.ts` is only `test.skip` placeholders. `src/channels/slack/inbound-debounce.integration.test.ts` is an in-process fake-Slack test, not an API skip.
- `*.e2e.test.ts`: two listener cleanup files. Both are registered in `scripts/isolated-unit-tests.json` (30s timeout) because they run real git pushes and mutate process-global backend, settings, and fetch.
- `src/integration-tests/`: 11 files spawned as the real CLI (`bun run dev …`) or API flows. CI runs this directory separately and does not put it in the unit file list. `startup-flow.integration.test.ts` states it needs `LETTA_API_KEY`.
- Smoke scripts that are not `bun test` files: `src/test-utils/headless-scenario.ts`, `headless-reflection-scenario.ts`, `headless-windows.ts`, `update-chain-smoke.ts`.

A representative pure unit test, `src/utils/frontmatter.test.ts`, is `describe` + `test` + `expect` on `parseFrontmatter`, with no mocks and no temp files.

`src/websocket/listener/AGENTS.md` assigns listener tests to owner files (`turn-lifecycle.test.ts`, `message-router.test.ts`, …) and says new tests stay under 1,000 lines rather than growing the protocol/concurrency monoliths.

## Utilities and helpers

Shared helpers live in `src/test-utils/`. Import counts are `rg -l` over `src/**/*.test.ts` and `*.test.tsx`.

| Helper | Role | Test files importing it |
|--------|------|------------------------:|
| `test-process-env.ts` | `createIsolatedCliTestEnv` strips ambient `LETTA_*` / agent ids and sets `LETTA_DISABLE_SESSION_PERSIST=1`, `DISABLE_AUTOUPDATER=1`. `createAuthenticatedCliTestEnv` copies API key/base URL back. `isolateAmbientLettaTestEnv` snapshots and restores `process.env`. | 27 |
| `runtime-model-catalog.ts` | `setupRuntimeModelCatalogFixture()` splices `src/test-utils/fixtures/runtime-model-catalog.json` into the shared mutable `models` array in `beforeEach` and clears it in `afterEach`. `AGENTS.md` requires this for tests that touch the catalog. | 26 |
| `test-fs.ts` | `TestDirectory` creates `mkdtempSync(tmpdir(), "letta-test-")` and `createFile` / `cleanup`. | 11 |
| `temp-git-repo.ts` | `initGitRepo` / `createTempGitRepo`: `git init -b main`, fixed user, `commit.gpgsign=false`, LF line endings. | 5 |
| `overflow-preview.ts` | `expectPrefixPreview` / `expectOverflowPath` for truncation previews written under the preload home. | 3 |
| `cloud-fixture-retry.ts` | Retries fixture creates on cloud shutdown responses (max 3 retries, honors `Retry-After` up to 10s). | 1 |

`scripts/test-home-preload.ts` runs for every `bun test` via `bunfig.toml`. It points `HOME` / `USERPROFILE` and several `LETTA_*` dirs at a temp directory (or `LETTA_TEST_HOME`), patches `os.homedir`, sets `LETTA_CODE_TELEM` to `"0"` if unset, and `afterEach` clears channel routes. It is a direct `os.homedir` patch, not `mock.module`, so `mock.restore()` cannot undo the home redirect.

Other fixtures: `fixtures/cloud-send-startup.ts`, PTY runners (`startup-setup-pty-runner.cjs`, `startup-secrets-pty-runner.cjs`), and channel-local harnesses such as `src/channels/slack/adapter-test-harness.ts` (`FakeSlackApp`, `installSlackAdapterTestHooks`).

64 `src` test files reference `__testOverride*` seams (load/save hooks for routes, accounts, pairing, discord module, and similar). That is the preferred stub style for shared modules.

## Mocking

Bun `mock.module()` is process-global. `AGENTS.md` says a mock in one file can affect later files in the same worker, and that a test which passes alone and fails under `bun test src/` should be treated as mock leakage first.

`scripts/check-test-mock-isolation.js` (part of `bun run check`) scans `src/**/*.test.ts(x)` and fails on:

- `mock.module` without an `afterEach` / `afterAll` that calls `mock.restore()`
- mocks of `/channels/config`, `/agent/context`, `/runtime-context`, `/settings-manager`
- top-level internal `mock.module()` (`./`, `../`, `@/`) unless the file is listed in `scripts/isolated-unit-tests.json`
- partial mocks of Slack/Telegram/Discord `runtime` modules (every export must be present)

The comment in `src/websocket/listen-client-concurrency.test.ts` is explicit: `mock.restore()` resets mock functions and does not undo `mock.module()` swaps, so that file copies real exports before mocking and restores them in `afterAll`.

`mock.module(` appears in 14 `src` test files. Most are registered as isolated processes. Examples: channel registry tests mock `@/backend/api/client`; `task-fork-receipt.test.ts` and `task-computer-routing.test.ts` mock billing/subagent launch. `src/mock-isolation-check.test.ts` feeds fixture snippets to the checker itself.

`scripts/isolated-unit-tests.json` has 47 entries (5 also set `env`). `run-unit-tests.cjs` runs each selected isolated file in its own `bun test` process before the shared batches. Reasons in the manifest are mock leakage, shared channel stores, TUI/process-global settings, or git/fetch side effects. `src/channels` is not a separate process as a whole: `check-test-coverage.cjs` calls it special-cased, and the runner only appends `findTestFiles("src/channels")` into the same file list, then isolates individual paths from the manifest.

Other stub styles, counted with `rg -l` under `src` tests:

- `spyOn(` in 16 files
- `globalThis.fetch =` in 19 files
- `mock()` from `bun:test` for function stubs (for example `createConversation` in `discord-registry.test.ts`)

Ink UI tests construct a TTY-like stdout (`CaptureStream` in `src/cli/components/HelpDialog.test.tsx`) and call `render` from `ink`, then `strip-ansi` the output. They do not use `ink-testing-library` (no import found in the samples read).

## Coverage approach

There is no line-coverage tool in `package.json` scripts. `check:test-coverage` is `node scripts/check-test-coverage.cjs`. It counts `src/**/*.test.ts(x)` and fails if a file is outside the directory list in `run-unit-tests.cjs`, outside `src/channels` and `src/integration-tests`, and not a root `src/*.test.ts(x)`. `.gitignore` mentions `coverage`, `*.lcov`, and `.nyc_output`; no CI job found invokes c8, istanbul, or nyc. That gitignore block looks like a stock Node ignore list, not an active coverage pipeline.

`scripts/unit-test-impact.cjs` selects unit files on pull requests: a change runs tests for its top-level `src/` family plus families that import the changed file directly. The walk is intentionally not fully transitive. Changes to `ci.yml`, `package.json`, `bunfig.toml`, the unit-test scripts, or unresolved imports run the full unit set. Docs and a few metadata paths run no unit tests.

`scripts/test-sharding.cjs` shards by file index (`position % count === index - 1`) before Bun starts, so isolated suites are not double-counted across shards.

`bun run check` (`scripts/check.js`) does not run the test suite. It runs cycles, layer boundaries, export style, filename casing, file size, module ownership, mock isolation, the CI-inclusion coverage check, skill checks, Biome, and `tsc --noEmit`. `.husky/pre-commit` runs the same architectural checks, lint-staged Biome, and typecheck. It does not run `bun test`.

## How tests are invoked

CI is `.github/workflows/ci.yml` on pull requests and pushes to `main`. Release-bump-only diffs (title `chore: bump version to*` and only `package.json`) skip heavy jobs.

| Job | What runs |
|-----|-----------|
| `check` | `bun run check` (quality gates, not the suite) |
| `unit` | `node scripts/run-unit-tests.cjs --shard N/4` on ubuntu-24.04, ubuntu-24.04-arm, macos-14; Windows uses 8 shards. Timeout 10 minutes. Needs `run_heavy_ci`. |
| `integration` | `bun test src/integration-tests --timeout 15000 --shard=…` with `LETTA_API_KEY`. Same runner matrix. Skipped for forks and Dependabot. |
| `build` | `bun run build`, `./letta.js --help` / `--version`, npm pack install, packaged local-backend headless prompt, Windows-only `headless-windows.ts` when an API key is allowed |
| `node18-smoke` | built `letta.js --help` under Node 18 |
| `headless` / `headless-local` | `src/test-utils/headless-scenario.ts` across models and output formats; local job uses provider API keys |
| `ollama-smoke` | `continue-on-error: true`; Ollama plus `--smoke` |
| `reflection-headless` | `continue-on-error: true`; `headless-reflection-scenario.ts` |
| `update-chain-smoke` | `bun run test:update-chain:manual` after build |

Unit PR selection uses `GITHUB_EVENT_NAME=pull_request` inside `run-unit-tests.cjs`. On push to main it logs that it runs every discovered unit file.

The unit file list is the `dirs` array in `run-unit-tests.cjs` (agent, auth, backend, cli, cron, experiments, helpers, hooks, lsp, mods, permissions, providers, queue, reminders, sandbox, skills, telemetry, test-utils, tools, types, updater, utils, web, websocket), plus all of `src/channels`, root `src/*.test.ts(x)`, `scripts/codex-watch`, `scripts/claude-watch`, and the two `scripts/*.test.cjs` files. It excludes `src/integration-tests`.

Not in that list, and not referenced as `bun test` in the workflows searched: `scripts/builtin-skills-watch/*.test.ts`, `scripts/pi-ai-watch/*.test.ts`, `scripts/agent-watch/verify-pr-identity.test.ts`, and `.github/scripts/contribution-guard.test.cjs`. Those watch workflows run the scripts, not `bun test` on those files. `check-test-coverage.cjs` only walks `src/`, so this gap is outside that check.

Other workflows: `nightly-update-smoke.yml` runs `bun run test:update-chain:startup` on a cron. `telegram-live-smoke.yml` runs `bun test src/channels/telegram-live-smoke.test.ts --timeout 30000` on a cron, manual dispatch, and pushes that touch `src/channels/**`.

## Open questions

- Does `bun test` actually execute `src/agent/memory-worktree-http.test.ts` (`node:test`), or does that file get collected and then no-op? Not executed.
- Are the script-watch `*.test.ts` files and `contribution-guard.test.cjs` run in some workflow step that does not say `bun test`? The workflows read here invoke the scripts, not those tests.
- Five `*.test.tsx` files do not import `ink`. Their render path was not opened.
- `check-test-coverage.cjs` says channels are special-cased for isolation, but the runner isolates only manifest paths. Whether every channels file that mutates shared stores is on that list was not audited entry by entry (47 manifest entries, 135 channels `*.test.ts` files).
