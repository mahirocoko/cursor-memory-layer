# API & Integration Surface

Reader notes for `@letta-ai/letta-code` **0.33.1**. Source is the `origin/` symlink, git `d7fd0a6cb` (2026-09-24, `refactor(memory): initialize with workflow analysis (#4643)`). Package identity is `package.json`. The process entry that dispatches CLI flags and subcommands is `src/index.ts`.

This document lists surfaces that are registered in source. It does not claim every slash command’s TUI handler was traced past the registry stub.

## 1. Published package

`package.json` `bin.letta` is `letta.js`. `exports["."]` is also `./letta.js` (the CLI bundle), not a library of internal modules.

Runtime and type exports declared in `package.json` `exports` / `typesVersions`, built by `build.js` and `tsconfig.types.json`:

| Export | Source entry | What it is |
|---|---|---|
| `.` | built `letta.js` from the CLI | Process binary |
| `./app-server-client` | `src/app-server-client.ts` | WebSocket client (`AppServerClient`). ESM, browser, and CJS |
| `./app-server-protocol` | `src/types/app-server-protocol.ts` | Types only. Re-exports `protocol_v2`, `app-server-info`, `conversation-fork-protocol`, `queue-update-protocol` |
| `./protocol` | `src/types/protocol.ts` | Types only. Headless stdout wire (`WireMessage`) and session config types |
| `./memory-confinement` | `src/memory-confinement.ts` | `createMemoryConfinementLauncher` |
| `./memory-constraints` | `src/memory-constraints.ts` | MemFS tree/frontmatter constraint validators and `.memfs.config.json` constants |
| `./mcp-client` | `src/mcp-client.ts` | Client-side MCP connect (`stdio` / `http` / `sse`) |
| `./agent-presets` | `src/agent-presets.ts` | Browser-safe agent-create presets, tags, system prompts |
| `./schedules` | `src/schedules.ts` | Scheduled-turn prompt envelope (`formatScheduledTaskPrompt` / `parseScheduledTaskPrompt`) |
| `./channels` | `src/channels-public.ts` | Channel command, stream, and message-format helpers |
| `./gateway-core` | `src/gateway-core.ts` | `ChannelGateway`, control-request coordinator, message-channel tool executor |
| `./channels/slack` | `src/channels-slack.ts` | Slack ingress/send primitives. File comment: no Node builtins |
| `./channels/telegram` | `src/channels-telegram.ts` | Telegram ingress/send primitives. File comment: no grammY, no Node builtins |

`files` also ships `skills/`, `scripts/`, `docs/`, and `dist/types`.

## 2. CLI process

Subcommands are a `switch` in `src/cli/subcommands/router.ts` (`runSubcommand`). If the first positional is not a known subcommand, `src/index.ts` parses flags from `src/cli/args.ts` (`CLI_FLAG_CATALOG`) and starts the interactive TUI or headless mode.

### 2.1 Top-level flags

Parser: Node `parseArgs` over `CLI_FLAG_CATALOG` (`src/cli/args.ts`). Flags with a `help` field are printed by `renderCliOptionsHelp()`. Flags without `help` are accepted and hidden.

Documented (`help` present):

| Flag | Mode | Role |
|---|---|---|
| `-h, --help` / `-v, --version` / `--info` | both | Help, version, directory/skills/pinned agents |
| `-r, --resume` | interactive | Agent selector after load |
| `--new-agent` / `--new` | both | Create agent (skip profile) / new conversation |
| `--base-tools <list>` | both | Base tools for `--new-agent` |
| `-a, --agent <id>` / `-n, --name <name>` | both | Agent id, or pinned name |
| `-m, --model <id>` | both | Model id or handle |
| `-s, --system <id>` | both | System prompt preset |
| `--personality <name>` | both | `letta-code`, `tutorial`, `blank`, `linus`, `kawaii`, `claude`, `codex` |
| `--toolset <name>` | both | Ids from `TOOLSET_OPTIONS` in `src/tools/toolset-catalog.ts`: `auto`, `letta`, `none`, `default`, `codex` |
| `-p, --prompt` | headless | Headless prompt mode |
| `--backend <mode>` | both | `cloud` or `local`. `parseBackendModeFlag` also maps `api` to cloud |
| `--disable-memory-guard` | headless | Parent process only; ignored for subagents |
| `--output-format <fmt>` | headless | `text`, `json`, `stream-json` (default text) |
| `--client-message-id <id>` | headless | Cloud input identity, not a command `request_id` |
| `--no-wait` | headless | Submit Cloud message and return an acceptance receipt |
| `--input-format <fmt>` | headless | `stream-json` stdin |
| `--include-partial-messages` | headless | `stream_event` chunks; stream-json only |
| `--from-agent <id>` | headless | Agent-to-agent reminder |
| `--computer <selector>` | headless | `cloud` or computer name / device id / connection id |
| `--skills <path>` / `--skill-sources <csv>` | both | Skills dir; sources `all,bundled,global,agent,project` |
| `--memfs` | both | Enable memory filesystem |
| `--ephemeral` | headless | Temporary conversation, no agent or memory |
| `--stateless` | headless | Existing agent, no MemFS enablement or sync |
| `--memfs-startup <m>` | headless | `blocking`, `background`, or `skip` |
| `--no-skills` / `--no-bundled-skills` | both | Skill source switches |
| `--no-system-info-reminder` | both | Skip first-turn environment reminder |
| `--no-mods` | both | Disable local mods. Alias env: `LETTA_DISABLE_MODS=1` |
| `--reflection-trigger <mode>` | both | `off`, `step-count`, `compaction-event` |
| `--reflection-step-count <n>` | both | Step-count interval |

Accepted but hidden from help (no `help` field in the catalog): `--conversation` / `-C`, `--embedding`, `--system-custom`, `--run`, `--dev-backend`, `--tools`, `--allowedTools`, `--disallowedTools`, `--permission-mode`, `--yolo`, `--environment`, `--env`, `--pre-load-skills`, `--tags`, `--no-memfs` (deprecated no-op, comment cites LET-9436), `--max-turns`.

Preprocess aliases (`preprocessCliArgs`): `--conv` becomes `--conversation`; `--no-extensions` becomes `--no-mods`.

### 2.2 Subcommands

Registered names in `src/cli/subcommands/router.ts`. Usage text below is copied from each subcommand’s `printUsage` / help string.

| Command | Usage source | Surface |
|---|---|---|
| `version` | `router.ts` | Prints `getVersion()` |
| `update`, `upgrade` | `router.ts` | `manualUpdate()` |
| `backend` | `backend.ts` | `letta backend` / `cloud` / `local`. Saved default. One-off override is `--backend` |
| `setup` | `setup.ts` | `letta setup` — interactive local-or-sign-in menu |
| `agents` | `agents.ts` | `list` (name, query, tags, match-all-tags, include-blocks, shared, limit) and `create` (name, model, personality, description, tags, pinned). JSON |
| `model`, `models` | `model.ts` | `get`, `list`, `set`. JSON. `--default`, `--agent`, `--conversation` (`--conv` alias), `--reasoning`, `--byok`, `--hosted`, `--structured-outputs` |
| `memory`, `memfs` | `memory.ts` | `status`, `diff`, `backup`, `backups`, `restore --from --force`, `export --out`, `pull`, `tokens`. JSON. Agent via `--agent` or `LETTA_AGENT_ID` |
| `messages` | `messages.ts` | `search`, `list`, `transcript`, `status`. JSON. Search modes `vector`, `fts`, `hybrid` |
| `steps` | `steps.ts` | `letta steps trace --agent <id> --step <id>`. JSON. Local provider traces unsupported |
| `permissions` | `permissions.ts` | `letta permissions [--agent <id>]`. Cloud access report JSON. Not exhaustive effective access |
| `usage` | `usage.ts` | `letta usage`. Markdown plan/balance/quota. Local backend: BYOK note |
| `mcp` | `mcp-io.ts` | `list`, `get <server>`, `tools`, `schema <tool>`, `search <query>`, `call <tool>`. JSON |
| `computers`, `environments`, `envs` | `environments.ts` | `list`, `current`. JSON. Online window used in code: heartbeat < 120s |
| `connect` | `connect.ts` | `letta connect <provider>`. Help examples: chatgpt/codex, grok, anthropic, openai, openai-compatible, ollama, lmstudio, llama-cpp, bedrock (`iam` or `profile`). Provider ids come from `getProviderConfigs` (`connect-normalize.ts`), not a hardcoded help list |
| `secret` | `secret.ts` | `set` (`--env`, `--stdin`, or argv value), `list`, `unset` (aliases delete/remove/rm) |
| `sandbox` | `sandbox.ts` | `upload <local>`, `download <sandbox> [--to]`. Cloud sandbox under `/root/downloads`. JSON |
| `teleport` | `teleport.ts` | `list`, `cloud`, `local`, `<computer>`. JSON. Needs Cloud agent and active conversation |
| `server` | `server.ts` | Two modes. Without `--listen`: remote computer (`listen.tsx`). With `--listen`: App Server (`app-server.ts`) |
| `remote` | `router.ts` | Alias of the remote-computer listener |
| `app-server` | `router.ts` | Deprecated. Warns and runs `server --listen` |
| `cron` | `cron.ts` | `add` (`--every` / `--at` / `--cron`), `list`, `get`, `runs`, `delete`/`remove`. JSON. Cloud vs local scheduler is chosen by execution placement |
| `channels` | `channels.ts` | `install`, `configure`, `status`, `route list/add/remove`, `bind` (Slack), `pair` |
| `channel-gateway` | `channel-gateway.ts` | Process helper, not a user help page. Requires `--app-server-url` and `--channels` or `--restore-enabled-channels`. Also `--restore-agent-scope`, `--allow-startup-errors`, `--install-channel-runtimes` |
| `skills` and `install` | `skills.ts` | `skills list`, `skills delete`, `install <thing>`. Sources include `npm:`, `git:`, GitHub URLs, `official/`, `clawhub/` |
| `mods` | `mods.ts` | `list`, `package`, `update`, `enable`, `disable`, `remove` |
| `shared-memory` | `shared-memory.ts` | `list`, `create --name`, `attach`, `detach`, `sync`, `history`. JSON. Data plane is a local git mount |
| `feedback` | `feedback.ts` | `letta feedback --message <text>` |
| `local-backend` | `local-backend.ts` | `migrate-transcripts [--storage-dir] [--dry-run]` |
| `trajectories`, `trajectory` | `trajectories.ts` | `export`, `detect`, `list`, `view`, `search`. Normalizes sessions via `@letta-ai/trajectory` |

`subcommandNeedsEarlyBackendMode` in `router.ts` lists which commands configure backend mode before running. `channel-gateway`, `local-backend`, `trajectories`, `cron`, `channels`, `setup`, `update`, and `version` are not in that list.

Remote listener flags actually parsed (`LISTEN_OPTIONS` in `listen.tsx`): `--computer-name`, `--env-name`, `--channels`, `--skills`, `--install-channel-runtimes`, `--debug`, `-h/--help`. Printed usage omits `--env-name`. `server.ts` treats `--computer-name`, `--env-name`, and `--channels` as incompatible with `--listen`.

App Server flags (`app-server.ts`): `--listen [url]`, `--openai-api`, `--ws-auth` (`capability-token` or `signed-bearer-token`), `--ws-token-file`, `--ws-token-sha256`, `--ws-shared-secret-file`, `--ws-issuer`, `--ws-audience`, `--ws-max-clock-skew-seconds`.

Cloud connect provider ids in `CLOUD_BYOK_PROVIDERS` (`src/providers/byok-providers.ts`): `codex`, `grok`, `anthropic`, `openai`, `openai-compatible`, `zai`, `zai-coding`, `minimax`, `gemini`, `moonshot`, `kimi-code`, `openrouter`, `openrouter-oauth`, `bedrock`. Local mode adds a pi-ai catalog (`LOCAL_PROVIDER_DISPLAY_NAMES`) plus extras `zai-coding`, `ollama`, `ollama-cloud`, `openai-compatible`, `lmstudio`, `llama-cpp`. Help text collapses chatgpt/codex aliases (`listConnectProvidersForHelp`).

### 2.3 Interactive slash commands

Registry: `commands` in `src/cli/commands/registry.ts`. `executeCommand` looks up the token and rejects args when `noArgs` is set. Many handlers only return a placeholder string; comments say the real work is in `App.tsx`, `AppCoordinator`, or `use-submit-handler.ts`.

Visible names (not `hidden`): `/agents`, `/model`, `/init`, `/doctor`, `/dream`, `/reflect`, `/reflect-arena`, `/skills`, `/skill-creator`, `/memory`, `/palace`, `/sleeptime`, `/compaction`, `/context-limit`, `/memfs`, `/search`, `/connect`, `/clear`, `/chdir`, `/new`, `/fork`, `/btw`, `/pin`, `/unpin`, `/rename`, `/description`, `/toolset`, `/experiments`, `/reload`, `/mods`, `/ade`, `/system`, `/personality`, `/subagents`, `/mcp`, `/secret`, `/memory-repository`, `/usage`, `/context`, `/recompile`, `/feedback`, `/hooks`, `/statusline`, `/title`, `/reasoning-tab`, `/system-reminders`, `/terminal`, `/install-github-app`, `/bg`, `/workflows`, `/exit`, `/login`, `/logout`, `/resume`.

Hidden but registered: `/reflection` (alias of `/reflect`), `/clear-messages`, `/cd`, `/help`, `/stream`, `/compact`, `/set-max-context`, `/link`, `/unlink`, `/pinned`, `/profiles`.

Handlers that actually run inside the registry (not just a stub string): `/dream` `/reflect` `/reflection` call `requestCloudReflectionRun` and error if the runtime is not TUI/listener; `/secret`; `/memory-repository`; `/system-reminders`; `/terminal` (VS Code / Cursor / Windsurf Shift+Enter keybinding); `/workflows` (in-memory `listWorkflowExecutions`).

Custom markdown commands are separate from this registry. `src/cli/commands/custom.ts` loads `~/.letta/commands/` (user) and `./.commands/` (project, higher priority). Frontmatter supplies description and argument hint; the body is the prompt.

Listener `execute_command` accepts a smaller set, `SUPPORTED_REMOTE_COMMANDS` in `src/websocket/listener/listener-constants.ts`: `clear`, `clear-messages`, `doctor`, `dream`, `reflect`, `reflection`, `init`, `compact`, `reload`, `context-limit`, `channels`, `upgrade-letta-code`, `toolset`, `secret`, `monitor_stop`. The comment says `/secret` UI uses `secret_list` / `secret_apply` frames, not `execute_command`.

## 3. HTTP and WebSocket

There is no general REST API for the CLI. The HTTP server exists only when App Server is started (`startAppServer` in `src/websocket/app-server.ts`).

Always on that server:

- `GET /readyz` and `GET /healthz` — `200` text `ok`.
- `GET /app-server-info` — JSON from `getAppServerInfoResponse`. Goes through `authorizeUpgrade`.
- Any request with an `Origin` header — `403` before those routes.
- Anything else — `404`, unless OpenAI routes are enabled.

WebSocket upgrade: default path `/ws` (`DEFAULT_WS_PATH`). `/` is also accepted. A `channel` query is rejected with `426` (“legacy split-channel”). Auth is required for non-loopback listeners and for Origin-bearing native clients (`--ws-auth`). Unauthenticated Origin upgrades are `403`.

`AppServerClient.resolveAppServerUrl` (`src/app-server-client.ts`) rewrites `http(s)` to `ws(s)` and fills pathname `/ws`. `resolveAppServerChannelUrl` is marked deprecated; the client is one bidirectional socket. Typed methods on the class: `connect`, `close`, `send`, `sendRaw`, `requestRaw`, `onMessage`, `onSend`, `onDisconnect`, `onExternalToolCall`, `input`, `submitInput`, `info`, `sync`, `abort`, `resumeQueue`, `runtimeStart`, `runtimeExternalToolsUpdate`, `launchSubagent`, `stopMonitor`, `conversationList`.

Optional `--openai-api` (`src/websocket/app-server-openai.ts`, `app-server-openai-responses.ts`):

- `GET /v1/models` — each Letta agent is a model.
- `POST /v1/chat/completions` — non-stream JSON or SSE when `stream` is true.
- `POST /v1/responses`.

Conversation pinning (`app-server-openai-common.ts`): `X-Letta-Chat-Key` always pins. `X-OpenWebUI-Chat-Id` pins only when the request is streaming. `Idempotency-Key` and `X-Idempotency-Key` reuse an in-flight or completed outcome (cap 1024). Header-less clients are stateless: a fresh conversation replays the client transcript.

### 3.1 App Server command frames

Inbound union `WsProtocolCommand` in `src/types/protocol_v2.ts` (about line 2374). Each member’s `type` is the wire name. Groups:

- Turn control: `input`, `change_device_state`, `abort_message`, `sync`, `resume_queue` (imported), `runtime_start`, teleport commands, `runtime_external_tools_update`, external tool response, `execute_command`, `remove_queue_item`.
- Terminal: `terminal_spawn`, `terminal_input`, `terminal_resize`, `terminal_kill`.
- Workspace files: `search_files`, `grep_in_files`, `list_in_directory`, `get_tree`, `read_file`, `write_file`, `watch_file`, `unwatch_file`, `edit_file`, `file_ops`.
- Memory: `list_memory`, `memory_history`, `memory_file_at_ref`, `memory_commit_diff`, `read_memory_file`, `write_memory_file`, `delete_memory_file`, `enable_memfs`.
- Models and providers: `list_models`, `list_connect_providers`, `connect_provider`, `disconnect_provider`, ChatGPT usage read, `update_model`, `update_toolset`.
- Agents and conversations: create-agent, app-server info, agent CRUD, conversation list/retrieve/create/update/recompile/fork/messages/compact.
- Skills, reflection, experiments, cron, cwd, git branches, secrets (`secret_list`, `secret_apply`).
- Channels: list, accounts CRUD/bind/start/stop, config get/set, start/stop, pairings, routes, targets.
- Subagents: `launch_subagent` (`src/types/subagent-protocol.ts`). Args include `subagent_type`, `prompt`, `description`, optional `model`, `agent_id`, `conversation_id`, `computer`, `mcp`, `max_turns`.
- `monitor_stop`.

Outbound `WsProtocolMessage` is the matching response/event union in the same file: `control_request`, `input_accepted`, `stream_delta`, `turn_finished`, `update_subagent_state`, terminal and file events, `memory_updated`, channel `*_updated` events, and the `*_response` counterparts.

`channel-gateway` speaks a different stdin/stdout envelope (`type: "command"` plus `CHANNEL_GATEWAY_RESPONSE ` / `CHANNEL_GATEWAY_EVENT ` prefixes in `channel-gateway.ts`). That is an internal supervisor protocol, not the App Server frame format.

### 3.2 Headless stdout protocol

`src/types/protocol.ts` `WireMessage` is the `--output-format stream-json` line protocol, separate from App Server frames. Members: `SystemMessage`, `ContentMessage`, `MessageWire`, `StreamEvent`, approval requested/received, tool execution started/finished, auto-approval, cancel ack, error, retry, recovery, result, `ControlResponse`, `ControlRequest` (example subtype in file: `can_use_tool`), queue lifecycle, transcript backfill, queue snapshot, sync complete, transcript supplement. The same file exports `SystemPromptConfig` presets `default`, `letta`, `source-claude`, `source-codex`, `source-gemini`.

## 4. Extension points

### 4.1 Hooks (Claude Code-shaped)

Implementation: `src/hooks/`. Config key `hooks` on settings. Global file `~/.letta/settings.json`; project file `<cwd>/.letta/settings.json` (`src/hooks/loader.ts`). If cwd is the home directory, project hooks are treated as empty so globals are not merged twice.

Events (`src/hooks/types.ts`):

- Tool matchers: `PreToolUse` (can block), `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` (can allow or deny).
- Unmatched: `UserPromptSubmit` (can block), `Notification`, `Stop` (can block), `SubagentStop` (can block), `PreCompact`, `SessionStart`, `SessionEnd`.

Hook `type` is `command` (shell, default timeout comment 60000 ms) or `prompt` (LLM eval, `$ARGUMENTS` placeholder, default timeout comment 30000 ms). Prompt hooks are limited to `PROMPT_HOOK_SUPPORTED_EVENTS`. Tool matchers are exact names, `Edit|Write` unions, or `*` / empty. Slash command `/hooks` opens the manager; it does not define the schema.

Runners exported from `src/hooks/index.ts`: `runPreToolUseHooks`, `runPostToolUseHooks`, `runPostToolUseFailureHooks`, `runPermissionRequestHooks`, `runUserPromptSubmitHooks`, `runNotificationHooks`, `runStopHooks`, `runSubagentStopHooks`, `runPreCompactHooks`, `runSessionStartHooks`, `runSessionEndHooks`, `hasHooks`.

### 4.2 Mods

Local mod engine: `src/mods/mod-engine.ts`. A package is installable when `package.json` has a `letta` object (`LettaPackageManifest` in `src/mods/package-manifest.ts`): `manifestVersion` 1, `mods: string[]`, optional `capabilities` and `engines.lettaCodeCli` / `lettaCodeDesktop`.

`LettaModApi` given to a factory:

- `commands.register` / `unregister`
- `tools.register` / `unregister`
- `providers.register` / `unregister` (also top-level `registerProvider`)
- `events.on` / `off`
- `permissions.register` / `unregister`
- `diagnostics.report`
- `ui.openPanel` / `closePanel` / `notify`. `setStatus`, `clearStatus`, and `setStatuslineRenderer` are deprecated and emit a migration diagnostic

Event names (`src/mods/types.ts`): `conversation_open`, `conversation_close`, `tool_start`, `tool_end`, `turn_start`, `turn_end`, `compact_start`, `compact_end`, `llm_start`, `llm_end`. `turn_start` may cancel or rewrite input.

Capability ids (`src/mods/capabilities.ts`): `tools`, `commands`, `providers`, `permissions`, `events.lifecycle`, `events.turns`, `events.tools`, `events.compact`, `events.llm`, `ui.panels`. Env `LETTA_MOD_CAPABILITY_PROFILE=providers-only` forces the providers-only profile.

CLI: `letta mods` and `letta install` for npm/git/local packages (`src/mods/package-installer.ts`). Session flag `--no-mods`. Slash `/reload` reloads settings and local mods. Source scopes in `ModSourceScope`: `legacy_global`, `global`, `project`, `bundled`, `agent`.

### 4.3 Channels

First-party ids (`FIRST_PARTY_CHANNEL_IDS` in `src/channels/types.ts`): `telegram`, `slack`, `discord`, `custom`, `whatsapp`, `signal`. Extra ids load from `~/.letta/channels/<id>/channel.json` (comment on `SUPPORTED_CHANNEL_IDS`). Registry: `src/channels/plugin-registry.ts`.

`ChannelGatewayHooks` (`src/channels/gateway-core.ts`): `buildExternalTool`, `executeExternalTool`, `onLifecycle`, `onProgress`, `onControlRequest`, optional `createRichDraft`. Published for embedders via `@letta-ai/letta-code/gateway-core` and `@letta-ai/letta-code/channels`.

`letta channels` writes config and routes on disk. Its own usage note says route/pair changes do not update a running listener; live changes go through the `/channels` WebSocket command or a server restart.

### 4.4 MCP

Two placements, both reached by `letta mcp` (`src/cli/subcommands/mcp.ts`):

- Client process: `@letta-ai/letta-code/mcp-client` `connectMcpServer`. Transports `stdio` (default), `http` (streamable HTTP), `sse`. Optional OAuth via `ConnectMcpServerOptions.oauth`.
- Server-side unified MCP: `src/backend/api/unified-mcp.ts`. Hosted Letta Cloud skips stdio-type cloud servers (`defaultIsHostedLettaCloud` compares `getServerUrl()` to `LETTA_CLOUD_API_URL`).

Subagent launches can pass `mcp: { inherit, servers? }` (`src/types/subagent-protocol.ts`).

### 4.5 Subagents

Discovery: `src/agent/subagents/index.ts`. Project dir `.letta/agents`. Builtin names from `getBuiltinSubagentNames()`. External CLIs advertised as `claude-code` and `codex` (`EXTERNAL_CODING_AGENT_DESCRIPTORS`). Launch wire is `launch_subagent` (section 3.1). Slash `/subagents` opens the TUI manager.

### 4.6 Memory

- MemFS git repo per agent. `letta memory` is status/diff/backup/restore/export/pull/tokens. Commit and push are git, per the usage note.
- Shared org repos: `letta shared-memory`. Comment in `shared-memory.ts` says the HTTP data plane is `/v1/git/<agent>/repositories/<name>.git` on the Letta server, and the local mount is `$MEMORY_DIR/../<name>`.
- Constraints package validates trees and frontmatter. Config path constant `.memfs.config.json`, version 1 (`src/memory-constraints.ts`).
- `createMemoryConfinementLauncher` wraps a process in the fail-closed memory sandbox used by unattended memory subagents. It throws if no supported kernel sandbox exists (`src/memory-confinement.ts`).
- App Server memory frames (section 3.1) are the remote editor API for that filesystem.

## 5. Integration patterns

**Letta server.** Interactive and headless modes talk to a backend selected by `letta backend` or `--backend`. Cloud is the Letta API (`@letta-ai/letta-client` in dependencies). Auth override noted on several JSON subcommands: `LETTA_API_KEY` and `LETTA_BASE_URL`. `letta server` without `--listen` registers this machine as a Cloud computer (`listen.tsx` → `registerWithCloudRetry`). `letta computers current` prints the stable `deviceId`. Headless `--computer` routes a message to `cloud` or a registered computer.

**Providers.** `letta connect` writes BYOK credentials into the cloud provider store or the local pi-ai catalog, depending on backend (`src/providers/byok-providers.ts`). App Server frames `connect_provider` / `disconnect_provider` / `list_connect_providers` are the same idea over the socket. Mods may `providers.register` a pi provider at runtime.

**Schedules.** `letta cron` creates either a durable Cloud schedule (`src/backend/api/schedules.ts`) or a local task (`src/cron`). The prompt bytes on the transcript are the shared envelope in `@letta-ai/letta-code/schedules`. Managed Cloud sandboxes may target `--computer <deviceId>`.

**Agent creation from another app.** `@letta-ai/letta-code/agent-presets` is documented in-file as the browser-safe payload builder so another surface can create Letta Code agents through Core with the same personalities, blocks, prompts, and tags as the CLI.

**Desktop / IDE.** App Server plus `AppServerClient` is the embedder socket. OpenAI-compatible routes are an additional adapter (agents as models), gated by `--openai-api`.

## Open questions

- Registry stubs vs real behavior: most slash commands in `registry.ts` return placeholder strings. Which of them are fully wired in the TUI, the listener, both, or neither was not traced command by command.
- `WsProtocolCommand` member list is verified; per-command payload fields and which commands the listener actually handles were not all opened. `FileOpsCommand` appears on both the command union and the message union in `protocol_v2.ts` — whether that is intentional was not checked.
- Cloud computer registration URL and heartbeat protocol live in `src/websocket/listen-register.ts` / `listener/auth.ts` and were not read, so no Cloud WebSocket URL is listed here.
- `letta connect` help is generated from `getProviderConfigs(target)`. The exact string list for local vs cloud at runtime depends on that function’s filter, not only the `id` literals in `CLOUD_BYOK_PROVIDERS`.
- Channel plugins beyond the first-party six, and the `channel.json` manifest schema, were not fully read.
- `messages status` flags beyond `--conversation` and `--agent` were not extracted from `message-status.ts`.
