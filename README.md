# cursor-memory-layer

Letta-style, git-backed memory for Cursor agents. Every chat starts with what earlier chats learned, the agent edits its own memory through a small CLI, and a background reflection pass ("dream") updates memory between chats. Memory lives in its own local git repository, so every change is a commit you can read, diff, and revert.

Built and tested against the Cursor CLI (`cursor-agent`, also distributed as `agent`). Local macOS/Linux use is the supported scope. The same user-level hook locations are documented for the Cursor IDE, but IDE behaviour has not been verified. Cloud Agents do not receive this local installation.

## How it works

| Piece | What it does |
|---|---|
| `~/.cursor/memory` | Separate git repo holding Markdown memory files. Never pushed anywhere unless you add a mirror. |
| `sessionStart` hook | Injects `persona.md`, `human/`, `MEMORY.md`, this project's top-level files, file descriptions for deferred memory, memory skills, and the last reflection into every new chat. |
| `cursor-memory` CLI + skill | How the agent reads, searches, and edits memory. Each write is a path-scoped commit that is checked for layout, frontmatter, size, and secrets. |
| `stop`, `preCompact`, `sessionEnd` hooks | Start a detached reflection after about 25 assistant replies, before context compaction, and when a chat with at least 4 new user messages ends. |
| `preToolUse` hook | Blocks detected destructive `git` or `rm -r` commands against the memory repo. This is a best-effort command guard, not a shell sandbox. |
| `recall` | Searches past Cursor chat transcripts. |
| Status line | `statusline/statusline.mjs`: folder, git, session, and context, plus memory state: `🧠✓` clean, `🧠+N` uncommitted files, `🧠…` reflecting, `🧠!` last reflection failed, `↻N` reflections committed today. |
| Slash commands | In `~/.cursor/commands/`: `/memory` (what is loaded), `/memory-init` (onboard a repo, like Letta's `/init`), `/memory-doctor [symptom]`, `/memory-groom [file]` (plan, approve, then shrink core without losing lines), `/memory-dream`, `/memory-recall <query>`, `/memory-skill [subject]`, `/memory-palace`. New chats in a project with no memory suggest `/memory-init`. |

### Memory layout

```
MEMORY.md                   loaded every chat; points at notes that load on demand
persona.md                  identity defaults; read_only, outranks model defaults
human/                      identity and standing prefs; loaded every chat
<project>/*.md              loaded every chat in that project
<project>/…                 nested files loaded on demand
reference/                  loaded on demand, by description
skills/<name>/SKILL.md      procedures the agent wrote for itself
archives/                   never loaded
```

The project slug comes from the workspace (`cursor-memory slug`).

### Reflection (dream)

The reflector runs `cursor-agent -p --mode ask` in a scratch workspace, without `--force`. Ask mode is documented as read-only but still supports code exploration tools; it is not an OS sandbox. The prompt instructs the reflector not to use tools and provides the current memory and only the part of the chat it has not reflected on yet. It replies with JSON operations. The harness validates and applies those proposed memory operations:

- The same checks as CLI writes, plus: never `archives/` or `read_only` files, at most 8 operations.
- Edits to files that changed after the snapshot are dropped.
- A write that would drop most of an existing file's lines is rejected, unless those lines move to another file in the same batch.
- Everything lands in one `memory(reflection): …` commit; `cursor-memory revert <sha>` undoes it.
- One reflection at a time; failures back off from 1 to 30 minutes.

Unlike Letta, the reflector cannot edit files itself. `cursor-agent --sandbox enabled` did not confine writes in testing, so reflection is text-in, JSON-out.

## Install

Requires Node **22.18+**, git, pnpm **10.33.0**, and an authenticated Cursor CLI (`cursor-agent`) on `PATH` (or in `~/.local/bin`). If your CLI exposes only `agent`, set `CURSOR_MEMORY_AGENT_COMMAND=agent`. Keep this checkout at its installed location: hooks and the CLI link refer to its files.

```bash
git clone https://github.com/mahirocoko/cursor-memory-layer.git
cd cursor-memory-layer
pnpm install --frozen-lockfile
pnpm memory:install
```

This:

- creates `~/.cursor/memory` if missing;
- merges the hooks into `~/.cursor/hooks.json` (other hooks are kept; the previous file is saved as `hooks.json.cursor-memory.bak`);
- installs the skill at `~/.cursor/skills/cursor-memory/` with a hash receipt; foreign, symlinked, or locally modified entries are left alone. The exact current source or the hash-pinned pre-receipt entry from `f21fc28` can be adopted. Companion files are never owned or removed;
- copies slash commands to `~/.cursor/commands/` (an existing command file that is not ours is left alone);
- sets `statusLine` in `~/.cursor/cli-config.json` and nothing else there, saving the previous value to `cli-config.statusline.pre-cursor-memory.json`. It never creates `cli-config.json`; run `cursor-agent` once first. Skip with `pnpm memory:install --no-statusline`;
- links the CLI into `~/.local/bin` if that directory exists (override with `CURSOR_MEMORY_BIN_DIR`); otherwise add this checkout's `bin/` to `PATH` or create the bin directory and reinstall.

Open a new chat to load memory; restart running CLI sessions to pick up new commands.

With `approvalMode: allowlist`, the agent asks before every `cursor-memory` command. Add `Shell(cursor-memory)` to `permissions.allow` in `cli-config.json` to let it read and edit memory on its own, as in Letta.

`pnpm memory:uninstall` removes owned hooks, the unchanged installed skill entry, commands, and CLI link, restores the previous status line, and keeps the memory repo. User-added skill files and locally modified skill entries remain.

## Privacy and safety

Local Git storage does **not** mean offline processing. Loaded memory enters your Cursor conversation; reflection sends a memory snapshot and the new transcript slice to the selected Cursor model. Model-driven reflection is enabled by default and can consume your Cursor usage/quota. Configure `reflection.enabled: false` or `CURSOR_MEMORY_REFLECTION=0` to disable it; this does not disable normal memory injection into chats or local session-end intent notes.

Do not store credentials or sensitive transcripts in memory. Secret-pattern checks are heuristic, not a guarantee. Backups, the memory palace, Git history, and an optional mirror may retain earlier data even after a file is deleted. Use only a private mirror you intend to share with; `remote set` immediately pushes existing history and later commits push automatically.

The destructive-command guard returns `deny`, not `ask`: Cursor's current hook docs say `ask` is accepted but **not enforced** for `preToolUse`. It detects common command forms, not every shell alias, script, relative-path spelling, or other tool. Intentional destructive maintenance must be performed manually outside the agent. Reflection's Ask mode and JSON validation also do not establish process confinement.

## Commands

```bash
cursor-memory show                    # exactly what a new chat receives here
cursor-memory append human/prefs/communication.md --body "- Replies in Thai."
cursor-memory search pnpm
cursor-memory recall "deploy wrangler" --project
cursor-memory log --limit 10
cursor-memory revert <sha>

cursor-memory dream --dry-run         # propose edits for the latest chat here, no commit
cursor-memory dreams                  # recent reflection runs

cursor-memory doctor                  # structure, size, duplicates, secrets, hooks, reflection
cursor-memory tokens                  # estimated tokens of the loaded core
cursor-memory repair                  # finish a stuck merge when one side contains the other
cursor-memory palace                  # static HTML viewer at ~/.cursor/memory-palace.html
cursor-memory backup | backups | restore --from <name> --force
cursor-memory remote set <url>        # optional mirror; pushes main after each commit
```

Run `cursor-memory --help` for the full list.

## Settings

`~/.cursor/cursor-memory.json` (or `$CURSOR_MEMORY_SETTINGS`). Every key is optional; these are the defaults:

```json
{
  "reflection": {
    "enabled": true,
    "triggers": ["step-count", "compaction", "session-end"],
    "stepCount": 25,
    "minUserMessages": 4,
    "model": "inherit",
    "fallbackModel": "auto",
    "timeoutMs": 300000,
    "agentCommand": "cursor-agent"
  },
  "sharedRead": {
    "enabled": false,
    "sourceRoot": null
  }
}
```

`"model": "inherit"` uses the chat's model; any slug from `cursor-agent --list-models` pins one. Unknown slugs fall back to `fallbackModel`.

### Shared communication (optional, no Letta installation required)

Opt-in, off-by-default shared communication integration. When enabled (`cursor-memory shared enable --source <path>` or `sharedRead.enabled: true`), Cursor memory reads a shared communication baseline from `sourceRoot` for `system/human/prefs/communication.md`.

**Using Cursor without Letta:** install and use this layer normally. Native memory, recall, and reflection do not depend on Letta. Leave shared mode disabled unless you want an external baseline.

**Sharing without Letta:** the source can be any distinct local Git repository with a committed, regular Markdown file at `system/human/prefs/communication.md`. Letta is one possible source, not a required runtime, service, account, or package. Use the repository root, not the file path or a subdirectory. Keep communication preferences there; personas and model rosters stay native. Only committed revisions are read, and the source must satisfy the existing content, size, and path safety checks.

- **Off by default**: `sharedRead.enabled` defaults to `false`. Default Cursor memory behavior is preserved exactly when disabled.
- **Revision pinning**: reads exactly one pinned full SHA per assembly from committed source Git object storage (`git show <sha>:system/human/prefs/communication.md`). Never loads dirty or uncommitted content from the source repository.
- **Local Git != provider-offline**: reading locally from Git does not mean your chats or models are offline. Injected context is still sent to the Cursor model provider during normal chat turns.
- **Proposals require review**: when shared mode is enabled, mutations targeting `human/prefs/communication.md` are diverted to an atomic private proposal queue in `.git/cursor-memory/proposals/`. Proposals bind the source SHA and native origin. Pending proposals never become active automatically or perform two-way sync; committing to canonical source remains an explicit human/source-owner gate. `--force` does not bypass this protection.
- **Native learning preserved**: all other native memory files (`human/identity.md`, `coding.md`, `workflow.md`, project files, reference files, skills) remain normally writable and versioned in the local native repo.
- **Read-only is cooperative, not OS security**: read-only flags and diversion are cooperative application invariants, not OS-level sandboxing.
- **Bounded integration**: this only integrates the single fixed communication preferences owner; it makes no claim of whole-memory or cross-project synchronisation.

```bash
cursor-memory shared status                 # inspect shared source, pinned revision, diagnostics
cursor-memory shared proposals              # list pending proposals and check if base revision is stale
cursor-memory shared show <id>              # show proposal metadata, diff, and status
cursor-memory shared export <id> [--out f]  # export proposal for review
cursor-memory shared enable --source <path> # enable shared read mode pointing at source Git repo
cursor-memory shared disable                # disable shared read mode
cursor-memory shared reject <id>            # discard a proposal without applying it
```

Environment overrides: `CURSOR_MEMORY_DIR`, `CURSOR_HOME`, `CURSOR_PROJECTS_DIR`, `CURSOR_MEMORY_REFLECTION=0` (turn model-driven reflection off; session end still saves lasting-intent notes), `CURSOR_MEMORY_AGENT_COMMAND`, `CURSOR_MEMORY_DREAM_WORKSPACE`, `CURSOR_MEMORY_BACKUP_DIR`. `CURSOR_HOME` is this layer's override, not a Cursor CLI setting; when Cursor uses `CURSOR_CONFIG_DIR` or Linux/BSD `XDG_CONFIG_HOME`, set `CURSOR_HOME` to the same effective directory for install and runtime.

Reflection bookkeeping (state, lock, logs) lives in `~/.cursor/memory/.git/cursor-memory/` and is never committed.

## Development

```bash
pnpm test     # typecheck + node:test
pnpm check    # typecheck + biome
pnpm fix
```

Zero runtime dependencies; TypeScript runs through Node's `--experimental-strip-types`.

## Known gaps

- Not verified in the Cursor IDE. A live CLI `/compact` on 2026-09-30 summarized the chat and did not show the reflection notice, because `stop` had already reflected those messages and `preCompact` does not start another reflection when nothing new is left.
- Transcript discovery, custom command loading, and the detailed `statusLine` schema rely on observed CLI behaviour, not a complete stable public schema. The official CLI configuration reference currently omits `statusLine`; use `--no-statusline` if your version does not support it.
- Windows, remote workspaces, and Cloud Agents are not supported by this local Bash/Node installation.

## Cursor compatibility references

Checked against the official docs on **2026-10-02** and installed CLI help for **2026.10.01-e373342**. Documentation alignment and isolated tests are not a live IDE or post-change end-to-end model proof.

- [Hooks](https://cursor.com/docs/hooks): user-level location, lifecycle/context schemas, timeouts, matchers, and the `preToolUse` `ask` limitation.
- [CLI modes](https://cursor.com/docs/cli/using) and [parameters](https://cursor.com/docs/cli/reference/parameters): Ask mode, print mode, JSON output, workspace/model/trust flags.
- [CLI configuration](https://cursor.com/docs/cli/reference/configuration) and [permissions](https://cursor.com/docs/cli/reference/permissions): config locations and `Shell(cursor-memory)` permission syntax.
- [Skills](https://cursor.com/docs/skills): global skill discovery from `~/.cursor/skills/`.
- [CLI slash commands](https://cursor.com/docs/cli/reference/slash-commands): documented compaction names are `/summarize` and `/compress`; `/compact` above is a dated observation, not the portable command contract.

MIT licensed; see [LICENSE](LICENSE). `private: true` prevents accidental npm publishing and does not prevent publishing the GitHub repository.

Dated research/retrospectives under `.agent-state/` are supporting historical evidence, not installation instructions. Letta Code excerpts in the research notes remain attributed to [letta-ai/letta-code](https://github.com/letta-ai/letta-code) under its [included upstream license](third-party/letta-code-LICENSE.txt); this repository's MIT license does not relicense those excerpts. The research notes quote/annotate source and are not unmodified upstream files. No Letta brand artwork is included.
