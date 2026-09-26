# Letta Code — Quick Reference

Source read: `origin/` symlink → `/Users/mahiro/ghq/github.com/letta-ai/letta-code`, git HEAD `d7fd0a6cb6713c7fe0f3db84167e6b7ae05df01f` (2026-09-24 23:07 -0700). Package version in `package.json` at that commit: `0.33.1`. License: Apache-2.0.

This note only records commands and settings found in README, docs, CONTRIBUTING, CLI help text, or source. Nothing here was executed.

## What it does

**Verified from `README.md`.** Letta Code is a stateful agent harness. Agents keep memory, identity, and experience over time by rewriting their own memory, skills, prompts, and the harness itself (mods). It can be used interactively or to power always-on agents.

Surfaces named in the README:

- Local CLI (`letta`)
- Desktop app for macOS, Windows, and Linux (external docs link; the desktop app is not built in this checkout)
- Browser, including mobile, at [chat.letta.com](https://chat.letta.com)
- Messaging: Telegram, Slack, Discord, and custom channels (`src/channels/README.md`)

`package.json` description: "Letta Code is a CLI tool for interacting with stateful Letta agents from the terminal." The published binary name is `letta` (`package.json` `"bin": { "letta": "letta.js" }`).

**Verified from `src/index.ts` `printHelp()`.** The CLI is a general-purpose interface to Letta agents. With no flags it resumes the last conversation for the current project. Headless one-shot mode is `letta -p "..."`.

**Verified from README "Letta Cloud" section.** Default backend is Letta Cloud. Agent state (memory, identity, conversations) can live in Letta Cloud while the harness runs on a laptop, GitHub Actions, a managed sandbox, a remote VM, or a Mac Mini. The same agents are reachable from chat.letta.com and the desktop app.

**Verified from `python/README.md`.** The Python wheel distribution is the same CLI, bundled with a Node runtime. It is not a Python SDK or API server. Python API clients are a different package, `letta-client`.

**Hypothesis, not verified by running it.** "Agents are more like people than tools" and the self-improvement claims are product framing in the README. This note does not confirm runtime behavior of memory rewriting, dreaming, or mods.

## Installation

Engines declared in `package.json`: Node `>=22.19.0`, Bun `>=1.3.2`. CONTRIBUTING asks for Bun `v1.2.20+` for source runs. Those two Bun floors disagree; both are quoted as written.

There is no documented `bun install -g` (or `bun add -g`) user install. Bun is the from-source package manager (`packageManager`: `bun@1.3.14`).

### npm (documented in README)

```bash
npm install -g @letta-ai/letta-code
```

Then, from a project directory, run `letta`. README also gives:

```bash
letta --new-agent --personality tutorial
```

Published package name and version: `@letta-ai/letta-code@0.33.1` (`package.json`). `AGENTS.md` says the published package runs bundled `letta.js` under Node (`>= 22.19`), while `bun run dev` runs TypeScript under Bun.

### From source (documented in CONTRIBUTING.md)

Requirements stated there: Bun v1.2.20+ (run `bun upgrade` if needed).

Dev workflow (picks up source changes immediately):

```bash
bun install
bun run dev
bun run dev -- -p "Hello world"
```

`scripts/dev.cjs` launches `bun` on `src/index.ts` and sets `LETTA_DEBUG=1` when that variable is unset. `AGENTS.md` states the same debug default.

Build and link a standalone binary:

```bash
bun run build
bun link
letta
```

CONTRIBUTING says to rerun `bun run build` after source edits before using the linked `letta` binary. `package.json` `build` script is `node scripts/postinstall-patches.js && bun run build.js`. `prepublishOnly` runs `bun run build`.

CLI source entry is `src/index.ts` (`#!/usr/bin/env bun`). The published bin file is `letta.js`, which is a build output (`package.json` `files` includes `letta.js`). It is not present as a tracked source file in this checkout (glob found no `letta.js`).

### Nix (documented in README and `docs/nix.md`)

From README:

```bash
nix run github:letta-ai/letta-code
nix profile install github:letta-ai/letta-code
```

From `docs/nix.md`, also:

```bash
nix run .    # local checkout, flakes enabled
```

The flake exposes `packages.<system>.default` / `letta-code`, `apps.<system>.default` / `letta`, `homeManagerModules.default` (alias `homeModules.default`), and `nixosModules.default`. Home Manager example enables `programs.letta-code.enable = true`. NixOS example sets `services.letta-code.enable`, `environmentFile`, and `extraArgs = [ "listen" ]`. The package builds the CLI with Bun from `bun.lock`. After lockfile changes, docs say to regenerate with:

```bash
bunx bun2nix -o bun.nix
```

### Docker (image exists; no user install guide in README)

README does not document Docker as an install method. What exists:

- `docker/Dockerfile` is `FROM public.ecr.aws/docker/library/node:22.19-bookworm-slim`. It runs `npm install --global "@letta-ai/letta-code@${LETTA_CODE_VERSION}"` (`ARG LETTA_CODE_VERSION=latest`). `ENTRYPOINT` is `docker/entrypoint.sh`. `CMD` is `["letta", "--help"]`. Workdir is `/workspace`.
- `.github/workflows/container.yml` builds and smokes the image. Those commands are CI, not a user guide:

```bash
docker build --tag letta-code:smoke --file docker/Dockerfile .
docker run --rm letta-code:smoke letta --version
docker run --rm letta-code:smoke letta server --help
```

- `.github/workflows/release.yml` publishes, on release, to `ghcr.io/${{ github.repository }}` (this repo: `ghcr.io/letta-ai/letta-code`) and Docker Hub image `letta/letta`, tags of the release version and `latest` for non-prereleases, platforms `linux/amd64` and `linux/arm64`.

**Inference, not a documented command:** `docker pull letta/letta` or `docker pull ghcr.io/letta-ai/letta-code` would match those release tags. This note did not confirm the registries currently serve those tags.

The entrypoint refuses the retired Python Letta server: env `SECURE`, `LETTA_SERVER_SECURE`, `LETTA_SERVER_PASSWORD`, a `/var/lib/postgresql/data` mount, or the old `letta/server/startup.sh` command. It points at `https://docs.letta.com/self-hosting/`.

### Python wheel (documented in `python/README.md`)

```sh
uv tool install letta
# or
pipx install letta
# or, inside a virtualenv
python -m pip install letta
letta --help
```

Requires Python 3.9+. Wheels target glibc Linux 2.28+ (x86-64 and ARM64), macOS 14+ (Intel and Apple Silicon), and Windows x64. Alpine/musl, 32-bit, and Windows ARM64 are stated as unsupported. Git is not bundled. In-app self-update is disabled for this distribution; upgrade with the same installer (`uv tool upgrade letta`, `pipx upgrade letta`, or `python -m pip install --upgrade letta`).

### Arch Linux AUR (documented in README, community-maintained)

```bash
yay -S letta-code      # release
yay -S letta-code-git  # nightly
```

## First run and backends

**Verified from README.** Letta Cloud is the default. On first launch, choose to sign in with Letta or proceed locally; the choice is saved. Change it with:

```bash
letta setup
letta backend cloud
letta backend local
```

One-off override without changing the saved default: `--backend cloud` or `--backend local`.

`src/cli/subcommands/backend.ts` usage text matches that, and adds: the legacy name `api` remains supported. `letta backend` with no argument prints the saved default.

**Verified discrepancy.** `printHelp()` in `src/index.ts` still says that if no credentials are configured, first run prompts for Letta Cloud OAuth. The README describes a sign-in-or-local choice. Both strings are in the tree; this note does not say which path the current TUI actually shows.

## Key features

Examples below are copied from README, `printHelp()`, or subcommand usage strings. They were not run.

### Interactive session

From `printHelp()`:

```bash
letta                 # resume last conversation for this project
letta --new           # new conversation (concurrent sessions)
letta --resume        # agent selector
letta --new-agent     # skip profile selection
letta --agent <id>    # open a specific agent
letta -n <name>       # resume a pinned agent by name (case-insensitive); flag help in src/cli/args.ts
```

Inside the session, `printHelp()` examples:

```text
/profile save MyAgent
/profiles
/pin
/unpin
/logout
```

### Models and providers

README: run `/connect` to configure LLM API keys (OpenAI / ChatGPT, Anthropic, Z.ai coding plan, and others), and `/model` to swap models. Slash-command descriptions in `src/cli/commands/registry.ts`: `/connect` is "Connect your LLM API keys (OpenAI, Anthropic, etc.)"; `/model` is "Switch model".

CLI flag help (`src/cli/args.ts`): `--model <id>` accepts a model ID or handle, examples `"opus-4.5"` or `"anthropic/claude-opus-4-5"`. `--personality` for `--new-agent` lists `"letta-code"`, `"tutorial"`, `"blank"`, `"linus"`, `"kawaii"`, `"claude"`, `"codex"`.

Headless model subcommand is in `printHelp()`: `letta model ...` (get, list, or set models and reasoning; help text says JSON-only).

### Headless prompts

From `printHelp()`:

```bash
letta -p "..."
letta -p "hello" --output-format json
```

Flag help: `--output-format` is `text`, `json`, or `stream-json` (default `text`). `--input-format stream-json` reads JSON messages from stdin. `--include-partial-messages` emits `stream_event` wrappers (stream-json only). `--ephemeral` runs a temporary conversation with no agent or memory. `--no-wait` submits a Cloud message and returns an acceptance receipt.

README example for routing a headless message through a named computer:

```bash
letta -p --agent <agent-id> --computer "work-laptop" "hello from that machine"
```

`--computer cloud` starts or reuses the target agent's cloud sandbox. Without `--computer`, agent-to-agent headless messages run on the same computer. Legacy spellings `environments` / `envs`, `--environment` / `--env`, and `--env-name` remain for compatibility (README).

### Memory, MemFS, skills

README:

- `/palace` views memory. `/sleeptime` configures periodic dreaming. `/doctor [symptom]` investigates behavior.
- `/search` searches messages across agents.
- MemFS tracks context, including memory blocks, via git. `/memory-repository set git@github.com:...` syncs to a custom GitHub remote. Registry args for `/memory-repository`: `<set|unset|status|push> [url]`.
- Skills load from global `~/.letta`, project `.agents/skills`, and agent-scoped MemFS. `/skills` views them. `/skill-creator` creates them.

Registry descriptions (same file): `/init` initializes or re-inits agent memory; `/memory` views memory; `/memfs` manages filesystem-backed memory with args `[enable|disable|sync|reset]`; `/dream` and `/reflect` launch reflection.

Memory subcommands from `printHelp()`:

```bash
letta memory status --agent <id>
letta memory diff --agent <id>
letta memory pull --agent <id>
letta memory export --agent <id> --out <dir>
letta memory backup --agent <id>
letta memory restore --agent <id> --from <backup> --force
```

Flag help: `--memfs` enables the memory filesystem for this agent. `--stateless` runs an existing agent without MemFS enablement or sync. `--memfs-startup` is `blocking`, `background`, or `skip` (headless). `--no-memfs` is accepted and ignored (comment in `src/cli/args.ts`: kept so older parents can still spawn subagents after an auto-update).

### Installing skills

README:

```bash
letta skills install https://github.com/owner/repo
letta skills install https://github.com/owner/repo/tree/main/path/to/skill
letta skills install https://github.com/owner/repo/blob/main/path/to/skill/SKILL.md
letta skills list --agent <agent-id>
letta skills delete <skill-name> --agent <agent-id>
```

ClawHub and Hermes are described as: install with that ecosystem's command, then `letta skills install <skill-slug>` or `<skill-path>`.

`printHelp()` and `src/cli/subcommands/skills.ts` also document `letta install` (skills or mod packages):

```bash
letta install official/finance/stocks --agent agent-123
letta install npm:@letta-ai/mod-plan-mode
letta skills list [--agent <id> | -n <name>]
letta skills delete <skill_name> --agent <id>
```

Source forms listed in that usage string include `npm:<package>`, `git:github.com/o/r`, a local `./path/to/package` with `package.json#letta`, `official/<path>`, `clawhub/<slug>`, `clawhub:<slug>`, a GitHub URL, a direct `SKILL.md` URL, and `owner/repo/path`.

### Remote computers and server

README:

```bash
letta server
letta server --computer-name "work-laptop"
letta computers list --online-only
letta computers current
```

`src/cli/subcommands/server.ts` help adds channel and App Server forms:

```bash
letta server --channels telegram
letta server --listen
letta server --listen ws://127.0.0.1:4500
letta server --listen ws://0.0.0.0:4500 --ws-auth capability-token --ws-token-file /path/to/token
```

`letta app-server` is a deprecated alias that warns and runs `letta server --listen` (`src/cli/subcommands/router.ts`). `letta remote` is an alias of the listen/remote path. `letta computers` aliases: `environments`, `envs`.

`printHelp()` also lists `letta teleport list|cloud|local|<computer>` and `letta sandbox ...` for Cloud sandbox file transfer.

### Messaging channels

README points at docs for Telegram, Slack, and Discord, and at `src/channels/README.md` for custom channels. That README says first-party plugins are Telegram, Slack, and Discord. User plugins live in `~/.letta/channels/<channel-id>/` with `channel.json` and `plugin.mjs`. Runtime packages install via `letta channels install <id>`.

`src/channels/README.md` example for a separate self-hosted server (quoted from that file):

```bash
LETTA_BASE_URL=http://localhost:8283 letta server --channels telegram
```

The same file says not to set a dummy `LETTA_BASE_URL` for the normal case, and that `LETTA_BASE_URL` is required in the self-hosted case.

### Permissions, hooks, schedules, secrets

README names these features and links to external docs. Local evidence:

- Permission modes in `src/permissions/mode.ts`: `"unrestricted"` (default), `"standard"`, `"acceptEdits"`, `"strict"`. `--yolo` is a parsed flag with no help text. `--permission-mode` is parsed and also omitted from generated `--help` (no `help` field in `CLI_FLAG_CATALOG`).
- `letta permissions [--agent <id>]` (`src/cli/subcommands/permissions.ts`) reports Cloud agent access as JSON (owner, org sharing, user shares, peer grants). Target order: `--agent`, then `LETTA_AGENT_ID`, then `AGENT_ID`. This is an access report, not the interactive permission-mode UI.
- `/hooks` is in the slash registry ("not fully read here beyond the command name"). README says hooks run custom scripts at points of agent execution.
- `letta cron` is a real subcommand (`router.ts`). README names crons, heartbeats, and schedules. Exact cron usage strings were not copied into this note.
- README: secrets (Letta sign-in required) are exposed as environment variables while obfuscated in context. Registry: `/secret` args `<set|list|unset> [key] [value]`. `letta secret` is a subcommand.

### Subagents, mods, toolsets

README: built-in subagents include general-purpose, forked, and recall, and agents can call other agents (including themselves). `/subagents` is in the slash registry.

Mods: `--no-mods` disables local mods for the session. Help text gives the recovery alias `LETTA_DISABLE_MODS=1 letta`. `--no-extensions` is rewritten to `--no-mods` (`preprocessCliArgs`). `printHelp()` lists `letta mods list|package|enable|disable|remove`.

Toolset flag help is generated from `TOOLSET_OPTIONS` in `src/tools/toolset-catalog.ts`. IDs verified there: `auto`, `letta`, `none`, `default` (display name "Claude"), `codex`. Manual values override model-based auto-selection.

### Other CLI subcommands present in the router

`src/cli/subcommands/router.ts` dispatches: `version`, `update` / `upgrade`, `memory` / `memfs`, `agents`, `model` / `models`, `usage`, `permissions`, `app-server` (deprecated), `messages`, `steps`, `mcp`, `computers` / `environments` / `envs`, `mods`, `sandbox`, `secret`, `teleport`, `server`, `feedback`, `remote`, `connect`, `backend`, `setup`, `install`, `shared-memory`, `skills`, `cron`, `channels`, `channel-gateway`, `local-backend`, `trajectories` / `trajectory`.

`printHelp()` does not list every one of those (missing from the help banner include `channels`, `cron`, `secret`, `shared-memory`, `trajectories`, `feedback`, `permissions`). They still exist in the router.

### Removed: AgentFile

README: AgentFile (`.af`) export/import is removed. `/export`, `/download`, `--import`, and `--from-af` are unsupported, including agent-registry imports. Memory import/export and conversation transcript export are unaffected.

## Configuration

### Settings files

**Verified in `src/settings-manager.ts`.**

| File | Role |
|---|---|
| `~/.letta/settings.json` | Global settings. Home is `process.env.HOME` or `os.homedir()`. |
| `<cwd>/.letta/settings.json` | Project settings (checked-in shape: hooks, window title). If cwd is home, this path collides with the global file and is treated as global. |
| `<cwd>/.letta/settings.local.json` | Local project settings (permissions, hooks, reflection, sessions, `listenerEnvName`). |

`printHelp()` says agent pins are stored in `~/.letta/settings.json`. The `Settings` type has per-agent records (`agents[]`) with `pinned`, not a top-level `pinnedAgents` field. Keys `pinnedAgents`, `pinnedAgentsByServer`, and `pinnedConversationsByServer` are in `OBSOLETE_SETTINGS_KEYS` (ignored on load, stripped on persist).

Worktree block inside `.letta/settings.json` (`WorktreeProjectConfig`): `symlinkDirectories` (default `["node_modules"]` when unset), `copyLocalSettings` (default true), `linkHooks` (default true), `include` (extra paths copied into new worktrees). The comment says the worktree tool reads this from disk directly.

### Settings fields worth knowing

Defaults in `DEFAULT_SETTINGS` (`src/settings-manager.ts`):

| Field | Default |
|---|---|
| `tokenStreaming` | `false` |
| `reasoningTabCycleEnabled` | `false` |
| `showCompactions` | `false` |
| `sessionContextEnabled` | `true` |
| `autoConversationTitles` | `false` |
| `autoSwapOnQuotaLimit` | `true` |
| `includeWorktreeTool` | `true` |
| `reflectionTrigger` | `"step-count"` |
| `reflectionStepCount` | `25` |
| `reflectionMerge` | `"auto"` |
| `createDefaultAgents` | comment says default `true` (field optional on the type) |

Also stored: `preferredBackendMode` (`"api"` or `"local"`; CLI says `cloud`/`local`, and `api` is the internal cloud name), `channelCredentialsStore` (`"file"` \| `"keyring"` \| `"auto"`), `recentModels` (max 10, comment on the type), `permissions`, `hooks`, `windowTitle`, `env`, `experiments`, `sessionsByServer`, OAuth `refreshToken` / `tokenExpiresAt` / `deviceId`. `refreshToken` is marked deprecated on the settings object and "now stored in secrets".

`preferredBackendMode` is what `letta backend cloud|local` writes.

### Environment variables verified in docs or comments

| Variable | Where verified | Effect as written |
|---|---|---|
| `LETTA_DEBUG=1` | `AGENTS.md`; `scripts/dev.cjs` sets it when unset | Verbose debug. Default for `bun run dev`. |
| `LETTA_DEBUG=0` | `AGENTS.md` | Suppress debug even in dev mode. |
| `LETTA_DEBUG_FILE` | `src/utils/debug.ts` | Debug log path. Behavior beyond "read this env" was not fully traced. |
| `LETTA_LOCAL_BACKEND_EXPERIMENTAL=1` | `AGENTS.md` | Enable local in-process backend. |
| `LETTA_LOCAL_BACKEND_EXECUTOR=deterministic` | `AGENTS.md` | Fake executor for tests. |
| `LETTA_LOCAL_BACKEND_DIR` | `AGENTS.md` | Local-backend storage root. Default `~/.letta/lc-local-backend`. Smoke tests should point this at a temp dir so the real store is not mutated. |
| `LETTA_API_KEY` | skills and `src/channels` docs; computers usage text | CLI auth override. |
| `LETTA_BASE_URL` | same | API base URL. Required for a separate self-hosted server; do not hard-code Cloud when talking to local. |
| `LETTA_SETTINGS_BASE_URL` | `src/settings-manager.ts` constant `SETTINGS_BASE_URL_ENV`; skill doc | Settings server-key lookup. |
| `LETTA_DISABLE_MODS=1` | `--no-mods` help text | Disable mods for a new process. |
| `LETTA_HOME` | used in tests and websocket code | Overrides the Letta home directory in those paths. Not documented in README. |
| `LETTA_AGENT_ID`, `AGENT_ID` | `letta permissions` usage | Fallback agent id for that subcommand. |
| `LETTA_SYSTEM_CRON_DIR`, `LETTA_SYSTEM_ROOT_CRONTAB` | Dockerfile `ENV` and `docker/entrypoint.sh` | Container cron restore. Defaults `/root/.letta/system-cron` and `/root/.letta/system-crontab/root`. |

NixOS `docs/nix.md` environment-file examples: `LETTA_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`.

### CLI flags that generate `--help`

From `CLI_FLAG_CATALOG` entries that have a `help` block (`src/cli/args.ts`). Short flags: `-h`, `-v`, `-r` (`--resume`), `-C` is defined on `--conversation` but that flag has **no** help block, so it is omitted from generated help. `-a` agent, `-n` name, `-m` model, `-s` system preset, `-p` headless prompt.

Documented in generated help (paraphrased from the catalog, not from a live `letta --help` run):

- `--info` — current directory, skills, pinned agents
- `--new-agent`, `--new`, `--base-tools <list>` (example in help: `"memory,web_search,fetch_webpage"`)
- `--agent`, `--name`, `--model`, `--system`, `--personality`, `--toolset`
- `--backend cloud|local`
- `--disable-memory-guard` — parent process only; subagents keep the guard
- `--output-format`, `--input-format`, `--include-partial-messages`, `--client-message-id`, `--no-wait`, `--from-agent`
- `--computer <selector>`
- `--skills <path>` — help text says default is `.skills` in the current directory
- `--skill-sources <csv>` — `all,bundled,global,agent,project` (default `all`)
- `--memfs`, `--ephemeral`, `--stateless`, `--memfs-startup`
- `--no-skills`, `--no-bundled-skills`, `--no-system-info-reminder`, `--no-mods`
- `--reflection-trigger` — `off`, `step-count`, `compaction-event`
- `--reflection-step-count <n>`

**Skill path discrepancy (verified strings, unresolved).** README says project skills live in `.agents/skills`. Flag help says `--skills` defaults to `.skills` in the current directory. `printInfo()` prints a skills directory from `SKILLS_DIR` in `@/agent/skills` joined to cwd. This note did not open that constant, so the on-disk default directory name is not confirmed here.

Flags parsed but hidden from help (no `help` field): `--run`, `--dev-backend`, `--embedding`, `--system-custom`, `--conversation` / `-C`, `--tools`, `--allowedTools`, `--disallowedTools`, `--permission-mode`, `--yolo`, `--environment`, `--env`, `--pre-load-skills`, `--tags`, `--no-memfs`, `--max-turns`. `--conv` is rewritten to `--conversation`.

### Skill source directories (README only)

- Global: `~/.letta`
- Project: `.agents/skills`
- Agent-scoped: MemFS

Custom channel plugins: `~/.letta/channels/<channel-id>/` (`src/channels/README.md`).

## Open questions

- Live `letta --help` was not executed. Help text above is from `printHelp()` and `renderCliOptionsHelp()`, which should match a built CLI, but the published `letta.js` bundle was not compared.
- Bun version floor: CONTRIBUTING says `v1.2.20+`; `package.json` engines say `>=1.3.2`. Which one current contributors must satisfy was not tested.
- First-run UX: README (sign in or local) vs `printHelp()` (Cloud OAuth if no credentials). Which screen actually appears was not run.
- Project skill directory: README `.agents/skills` vs `--skills` help default `.skills` vs `SKILLS_DIR`. The constant was not read.
- Docker Hub / GHCR tags (`letta/letta`, `ghcr.io/letta-ai/letta-code`) are release-workflow outputs. Availability of those images was not checked.
- `letta permissions` is a Cloud access report. How the interactive permission modes (`unrestricted`, `standard`, `acceptEdits`, `strict`) are set in the TUI was not traced past the mode type and the hidden `--permission-mode` flag.
- Desktop app installers are linked from the README to external docs, not defined in this repo.
- Many env vars exist in tests (`LETTA_DESKTOP_MODE`, `LETTA_CODE_TELEM`, `LETTA_SCRATCHPAD`, and others). They were not treated as user configuration.
