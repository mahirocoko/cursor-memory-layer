# Letta Code architecture

Source: git `d7fd0a6cb` (2026-09-24), package `@letta-ai/letta-code` `0.33.1`.
Read from the ghq checkout. Counts below say how they were counted.

Letta Code is a stateful agent harness. Agent identity and conversation state live in a backend (Letta Cloud HTTP API, or an experimental on-disk local backend). This repo is the harness: terminal UI, headless runs, tool execution, permissions, memory filesystem, channels, and a WebSocket server/client so the same agent can be driven from Desktop, chat.letta.com, or another machine.

## Directory structure

Top-level layout (repo root listing): `src/` is the product, `scripts/` is checks and packaging, `python/` is a wheel launcher, `docker/` and `nix/` are distribution wrappers, `vendor/` is patched Ink, `hooks/` is sample user hooks, `docs/` is human docs. `skills/` at the repo root is a build copy of `src/skills/builtin` (`build.js` around lines 316–327) and is gitignored.

`src/` has **26** top-level directories, counted with `find src -mindepth 1 -maxdepth 1 -type d | wc -l`:

| Directory | Role |
|---|---|
| `cli/` | Ink TUI, slash commands, subcommand routers |
| `websocket/` | Outbound cloud listener and inbound App Server |
| `agent/` | Conversation, model, memory, subagent domain |
| `tools/` | Tool catalog, execution, workflow engine |
| `backend/` | `Backend` interface, cloud API client, local store |
| `providers/` | BYOK / ChatGPT / local catalog adapters |
| `permissions/` | Permission modes and rules |
| `channels/` | Slack, Telegram, Discord, Signal, WhatsApp, custom plugins |
| `mods/` | User-authored harness extensions |
| `cron/`, `queue/`, `reminders/`, `skills/`, `sandbox/`, `lsp/`, `auth/`, `telemetry/`, `updater/`, `hooks/`, `experiments/`, `helpers/`, `utils/`, `types/`, `web/`, `test-utils/`, `integration-tests/` | Leaves, protocol types, or test support |

Same count of non-test vs test TypeScript: **1131** `*.ts`/`*.tsx` files that are not `*.test.ts(x)`, and **882** test files (`find` with those name filters). Tests sit next to source, not in a separate tree (`AGENTS.md` around line 221).

Organization philosophy, stated in `AGENTS.md` (lines 132–159) and partly enforced:

- Put a file in the lowest layer that has the dependencies it needs.
- Import the module that defines a symbol. Do not barrel through orchestration files (`scripts/check-module-ownership.js`).
- Zero circular imports (`madge`, baseline 0).
- New source files stay under 1,000 lines; oversized files are ratcheted in `scripts/source-file-size-baseline.json`.
- Exported functions are declarations, not `export const fn =`.

The prose layer sketch in `AGENTS.md` (lines 138–149) is a placement guide, not a total order the checker implements. `scripts/check-layer-boundaries.js` (lines 29–83) only forbids specific upward imports: `tools`↛`cli`, `backend`↛`cli|websocket`, `providers`↛`agent|cli`, `websocket/listener`↛ raw `backend/api/client` or `conversations`, `cli/app`↛ raw conversations API, `telemetry` and `sandbox` stay leaves.

`src/*.ts` files that are not in a directory are either the process entry (`index.ts`, `standalone-entry.ts`, `headless.ts`) or **published library surfaces** (`app-server-client.ts`, `gateway-core.ts`, `channels-public.ts`, `agent-presets.ts`, `memory-*.ts`, `mcp-client.ts`, `schedules.ts`). `build.js` bundles those into `dist/` for npm subpath exports.

## Entry points

There is one product process. Surfaces are subcommands or flags of that process, plus library bundles that are not separate servers.

### Process entries

1. **Dev.** `package.json` script `dev` runs `scripts/dev.cjs`, which spawns `bun run src/index.ts` with markdown loaders and `LETTA_DEBUG=1` unless already set (`scripts/dev.cjs` lines 4–15).
2. **Published npm bin.** `package.json` `bin.letta` is `letta.js` (lines 7–9). That file is a build artifact (gitignored). `build.js` (lines 76–86, 135–152) bundles `src/standalone-entry.ts` to `./letta.js` and prefixes `#!/usr/bin/env node`.
3. **Standalone bootstrap.** `src/standalone-entry.ts` (lines 1–11) calls `registerBunOAuthFlows()` from `@earendil-works/pi-ai/bun-oauth`, then dynamically imports `./index`. Dev skips this file and starts at `index.ts`.
4. **CLI main.** `src/index.ts` `main()` (line 570). Order verified in that function:
   - parse `--backend` and run `runSubcommand` (`src/cli/subcommands/router.ts`); a non-null exit code ends the process before the TUI (index.ts lines 625–629);
   - otherwise load settings, parse shared flags, then branch on `isHeadlessStartup` (`src/cli/startup-mode.ts` lines 1–18: `--prompt`/`-p`, `--run`, or non-TTY stdin with no leftover positional);
   - headless dynamically imports `handleHeadlessCommand` from `src/headless.ts` (index.ts lines 1293–1318);
   - interactive lazy-imports React, Ink, and `@/cli/App` (index.ts lines 1322–1329). `src/cli/App.tsx` re-exports `src/cli/app/AppCoordinator.tsx`.
5. **Tracked `bin/letta.js`.** `git ls-files` includes it, and `.gitignore` lists `bin/` (line 25), so it is an already-tracked file the ignore rule does not untrack. It is a Node launcher that `spawn`s a sibling platform binary (`letta-macos-arm64`, `letta-linux-x64`, and so on; `bin/letta.js` lines 20–66). `build.js` in this commit does not emit those binaries. `CONTRIBUTING.md` line 33 says “build bin/letta”; the script writes `./letta.js`. Treat `bin/letta.js` as a launcher for a binary layout this checkout’s build does not produce.
6. **Python wheel.** `python/pyproject.toml` script `letta = letta_code:main`. `python/letta_code/__init__.py` `main()` (lines 9–25) `exec`s a Node binary staged under `_payload/bin` against `_payload/app/letta.js`. It is not a Python SDK (`python/README.md` lines 80–82). `scripts/build-pypi.py` downloads Node 22.19.0, runs `bun run build`, packs the npm file list, and `python/wheel_backend.py` zips the wheel. No sdist.
7. **Docker.** `docker/Dockerfile` installs the npm package on Node 22.19 and sets entrypoint `docker/entrypoint.sh`, default command `letta --help`. The entrypoint rejects the retired Python Letta server (lines 15–30), installs cron files, then `exec`s the command.
8. **Nix.** `flake.nix` `installPhase` (lines 80–87) wraps `bun` so `$out/bin/letta` runs the built `letta.js`. `nix/modules/nixos.nix` line 77 uses that binary as `ExecStart`.

### In-process servers (not separate bins)

- **`letta server`** (`src/cli/subcommands/server.ts` `resolveServerCommand`, lines 47–103):
  - no `--listen`: remote computer. `runListenSubcommand` in `src/cli/subcommands/listen.tsx` registers an **outbound** WebSocket to Letta Cloud (file header, lines 1–4). `letta remote` is an alias (`router.ts` lines 127–129).
  - `--listen [url]`: inbound **App Server**. `runAppServerSubcommand` calls `startAppServer` (`src/cli/subcommands/app-server.ts` line 2). `src/websocket/app-server.ts` creates a Node `http.Server` plus a `ws` `WebSocketServer` (imports lines 1–5; `createServer` at line 270). Default listen URL is `ws://127.0.0.1:0` (line 35). HTTP paths verified in the request handler: `/readyz`, `/healthz`, and optional OpenAI-compatible routes (`--openai-api`). Upgrade path is `/ws`. `letta app-server` is a deprecated alias that forces `--listen` (`router.ts` lines 101–105).
- **`letta channel-gateway`** is its own subcommand (`router.ts` lines 146–148), a gateway process for channel delivery, not a second protocol server.
- **Image worker.** `build.js` lines 119–133 bundle `src/utils/image-resize-worker.ts` to `image-resize-worker.js`. It is a worker entry, not a user CLI.

### Subcommand router

`runSubcommand` (`src/cli/subcommands/router.ts` lines 76–157) returns `null` when the first token is not a known command, and the process continues into TUI or headless mode.

Counted from that switch: **36** `case` labels, **30** command families after collapsing aliases. Families: `version`, `update`, `memory`, `agents`, `model`, `usage`, `permissions`, `app-server`, `messages`, `steps`, `mcp`, `computers`, `mods`, `sandbox`, `secret`, `teleport`, `server`, `feedback`, `remote`, `connect`, `backend`, `setup`, `install`, `shared-memory`, `skills`, `cron`, `channels`, `channel-gateway`, `local-backend`, `trajectories`. Help text in `index.ts` `printHelp` (lines 162–227) documents a subset of these.

### Library exports (not process entries)

`package.json` `exports` has **14** keys (`Object.keys`). `build.js` produces the JS for the runnable ones. Types-only: `./protocol`, `./app-server-protocol`. Bundled: `./app-server-client` (browser ESM and Node CJS), `./memory-confinement`, `./memory-constraints`, `./mcp-client`, `./agent-presets`, `./schedules`, `./channels`, `./gateway-core`, `./channels/slack`, `./channels/telegram`. `src/channels/AGENTS.md` (lines 22–39) says the channel subpaths are pure logic so Letta Cloud can reuse them; transport (Bolt, grammY) stays in the local adapters.

### package.json scripts

**22** scripts (`Object.keys(package.json.scripts)`). Product: `dev`, `build`, `prepublishOnly`, `postinstall`. Quality gate `check` runs cycles, boundaries, export style, filename casing, file size, module ownership, mock isolation, coverage, skill frontmatter, bundled skill scripts, Biome, and `tsc` (`AGENTS.md` lines 244–255). The rest are watchers and update-chain smokes, not user entry points.

## Core abstractions

```
index.ts
  ├─ subcommands (router)
  │    ├─ server --listen  → App Server (inbound WS + HTTP)
  │    └─ server            → listen.tsx (outbound WS to Cloud)
  ├─ headless.ts            → one-shot / piped turn
  └─ cli/App → AppCoordinator → useConversationLoop
           all three call getBackend() and tools/manager.executeTool
```

**Backend.** `Backend` (`src/backend/backend.ts` lines 190–349) is the agent/conversation/message/run API. `getBackend()` (lines 708–710) is a process singleton. `configureBackendMode` (lines 721–725) swaps it. `createBackendForMode` (lines 698–700): `"local"` builds `LocalBackend`, otherwise `APIBackend`. `APIBackend` talks to `@letta-ai/letta-client`; `environmentRouting` is true only for Letta Cloud URLs (lines 356–369). `LocalBackend` (`src/backend/local/local-backend.ts` line 242) extends `HeadlessBackend` from `src/backend/dev/fake-headless-backend.ts` (class at line 196). That base stores agents in `LocalStore` and runs turns through a `HeadlessTurnExecutor`. The default executor is `DeterministicPongExecutor` (constructor default, line 215). The local product path injects a pi-ai executor via `createLocalExecutor` (imported in `local-backend.ts` lines 47–50). Local mode is experimental (`LETTA_LOCAL_BACKEND_EXPERIMENTAL`, `AGENTS.md` lines 260–266).

**Three turn owners, one tool runtime.** Interactive streaming is `src/cli/app/useConversationLoop.ts` (`src/cli/app/README.md` lines 11–12, 33–36). Headless is `handleHeadlessCommand` in `src/headless.ts` (imported from `index.ts` line 1310; file is thousands of lines, internals not fully read). Listener turns are `src/websocket/listener/turn.ts`, with `TurnLifecycle` in `turn-lifecycle.ts` as the only owner of active-turn state (`src/websocket/listener/AGENTS.md` lines 8–27). Approvals are a continuation inside the same lease, not a finished turn (lines 64–65). `src/agent/message.ts` sends streams through `getBackend()` (imports lines 15–16).

**Tools.** `TOOLSET_CATALOG` in `src/tools/toolset-catalog.ts` (line 18) names presets such as `letta` (AskUserQuestion, Task, Read, Edit, Workflow, shell tools, and others). `src/tools/manager.ts` loads schemas, checks permissions, and `executeTool` (export at line 2573). **55** non-test `*.ts` files sit directly in `src/tools/impl/` (`find` maxdepth 1). Permissions are applied before execution (`checkToolPermission` in the same manager). `permissions/` is not allowed to depend on the TUI.

**Listener runtime.** `ListenerRuntime` / `ConversationRuntime` live in `src/websocket/listener/types.ts`. One App Server runtime can serve many conversations (comment at types.ts line 102). The inbound HTTP server attaches sockets with `createRuntime` from `listener/lifecycle.ts` (`app-server.ts` imports lines 22–27). The outbound listener uses the same runtime and adds cloud registration (`listen.tsx`). Cron (`src/cron/scheduler.ts` header, lines 1–12) ticks inside that listener and enqueues into `src/queue/queue-runtime.ts`.

**Channels.** `ChannelGateway` in `src/channels/gateway-core.ts`, re-exported by `src/gateway-core.ts`, is the shared policy point for on-device and Cloud hosts (`src/channels/AGENTS.md` lines 8–19). First-party plugin dirs under `src/channels/`: `slack`, `telegram`, `discord`, `signal`, `whatsapp`, plus `custom` and `transcription` (7 directories, `find` maxdepth 1). User plugins load from `~/.letta/channels/<id>/` (`src/channels/README.md` lines 11–21). Slack and Telegram transports are installed on demand (`runtimePackages` in `src/channels/slack/plugin.ts` and `telegram/plugin.ts`), which is why `grammy` and `@slack/bolt` are devDependencies and `build.js` keeps `grammy` external (lines 98–114).

**Mods.** `src/mods/README.md` (lines 5–11): mods are trusted local code the agent can edit; the host only wraps invariants (turns, tools, permissions, reload). `ModAdapter` (`src/mods/mod-adapter.ts`) fronts `createModEngine` (`src/mods/mod-engine.ts`), which transpiles `.ts` mods with the TypeScript compiler (import at line 15). `AGENTS.md` lines 486–511 still describe `src/extensions/extension-engine.ts` and a `--no-extensions` flag. **Verified:** `src/extensions/` has zero files. The living tree is `src/mods/`. Treat that AGENTS section as stale.

**Workflows.** `src/tools/workflow/workflow-engine.ts` runs a script in `node:vm` (header lines 1–15; not a security boundary). Production spawning is `sdk-spawner.ts`, which calls `@letta-ai/letta-agent-sdk` loaded lazily by `sdk-loader.ts`.

**Settings.** `settingsManager` (`src/settings-manager.ts`) holds tokens, backend preference, and device id. Startup in `index.ts` refreshes OAuth before the TUI (function `refreshStartupOAuthToken`, lines 126–150).

## Dependencies

Counted from `package.json`: **20** `dependencies`, **1** optional (`@vscode/ripgrep`), **19** `devDependencies`. Package manager is Bun `1.3.14`; engines are Bun `>=1.3.2` and Node `>=22.19.0` (lines 5–6, 125–128). Lockfile is Bun lockfileVersion 1 (`bun.lock` line 1). Resolved versions below are from that lock’s package records, not from memory.

Direct, and what they are for:

| Package | Resolved | Role |
|---|---|---|
| `@letta-ai/letta-client` | 1.10.2 | Cloud agent/conversation HTTP API (`APIBackend`) |
| `@earendil-works/pi-ai` | 0.87.1 | Local model runtime and bundled OAuth (`standalone-entry.ts`) |
| `@letta-ai/letta-agent-sdk` | 0.8.17 | Workflow subagent `query()` |
| `@letta-ai/trajectory` | 0.2.0 | Trajectory subcommands (not read in depth) |
| `@modelcontextprotocol/sdk` | 1.30.0 | MCP client (`src/mcp-client.ts`) |
| `ink` + `react` 18.2.0 | ink 5.2.1 | TUI. `react` types in devDeps are 19, runtime React is 18 |
| `ws` | 8.19.0 | App Server and cloud listener. Kept external in the bundle (`build.js` line 109) |
| `node-pty` | ^1.1.0 | Terminal tool. Native; postinstall chmods the darwin spawn helper |
| `sharp` + `@janhapke/sharp-electron` | sharp ^0.34.5; electron build 0.35.3-electron.1 | Image resize. Electron build is external so libvips stays beside the package (`build.js` lines 129–132) |
| `@pierre/diffs`, `shiki` | diffs 1.2.2; shiki ^4.0.2 | Diff viewer. diffs stays external so a second shiki is not inlined (`build.js` lines 103–107) |
| `cron-parser`, `glob`, `cross-spawn`, `open`, `strip-ansi`, `ink-link`, `@scarf/scarf` | as ranged in package.json | Scheduling, file match, process spawn, browser open, ANSI, analytics pixel |

Notable transitive patterns from `bun.lock`:

- **pi-ai 0.87.1** depends on `@anthropic-ai/sdk` 0.124.0, `@google/genai` 2.21.0, `@aws-sdk/client-bedrock-runtime` 3.1127.0, and `openai` 6.40.0 (lock line 124). A second `openai` ^6.48.0 is a direct devDependency. Local inference providers are not first-party modules in `src/providers/`; they arrive through pi-ai. `src/providers/` (12 ts files) is BYOK, Codex, and ChatGPT usage.
- **Two `letta-client` versions.** Root record is 1.10.2 (lock line 200). The SDK depends on `@letta-ai/letta-client` `^1.12.1` and on `@letta-ai/letta-code` `0.33.1` (lock line 198), and the lock records nested 1.12.1 under both the SDK and a `letta-code` key (lines 1230–1232). The SDK package depends on this package by version. That is an npm-level cycle, separate from the in-repo import cycle check.
- **MCP SDK 1.30.0** pulls `express` 5, `hono`, `zod` 3 or 4, `jose`, `ajv` (lock line 206). Those are not direct dependencies of the CLI.
- **Ink** pulls `yoga-layout`, `react-reconciler` 0.29, and its own `ws` 8.18.3 (lock line 680 and `ink/ws` at line 1284), beside the direct `ws` 8.19.0.
- **`@pierre/diffs`** depends on `shiki` 3.23.0 (lock line 1236) while the app depends on shiki 4. `build.js` leaves diffs external so that copy is not bundled.
- **sharp-electron** depends on `sharp` 0.35.3 (lock line 194), newer than the direct `sharp` ^0.34.5.
- **Channel transports** `grammy` 1.42.0 and `@slack/bolt` 4.7.0 are devDependencies. Plugins declare them as `runtimePackages` and `src/channels/runtime-deps.ts` can install them later. They are not in `dependencies`.

`vendor/ink` and `vendor/ink-text-input` are patched copies applied by `scripts/postinstall-patches.js` (`AGENTS.md` lines 467–471). They are not npm dependencies.

## Open questions

- Who still ships the platform binaries that `bin/letta.js` spawns? This commit’s `build.js`, release workflow grep, and PyPI script produce a Node `letta.js`, not `letta-macos-arm64` and siblings.
- `AGENTS.md` extension diagram versus `src/mods/`: the kill-switch flag name in current CLI parsing was not fully traced past `shouldDisableMods` (`index.ts` line 788). Confirm `--no-mods` versus the documented `--no-extensions`.
- `HeadlessBackend`’s default executor is a deterministic pong. The production local path’s executor factory was not read line by line; the pi-ai wiring is inferred from `LocalBackend` imports (`local-executor-factory`, `pi-models-runtime`).
- `src/headless.ts` and `src/index.ts` are far past the 1,000-line rule and were only sliced. Startup after line ~1320 of `index.ts` (Ink props, agent resolve) was not read.
- Whether bun’s install hoists one `letta-client` or actually loads both 1.10.2 and 1.12.1 at runtime was not executed.
- `@letta-ai/trajectory` call sites were not opened.
