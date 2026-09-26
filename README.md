# cursor-memory-layer

Letta-style, git-backed memory for Cursor agents. Every chat starts with what earlier chats learned, the agent edits its own memory through a small CLI, and a background reflection pass ("dream") updates memory between chats. Memory lives in its own local git repository, so every change is a commit you can read, diff, and revert.

Built and tested against the Cursor CLI (`cursor-agent`). The same hooks load in the Cursor IDE, but IDE behaviour has not been verified.

## How it works

| Piece | What it does |
|---|---|
| `~/.cursor/memory` | Separate git repo holding Markdown memory files. Never pushed anywhere unless you add a mirror. |
| `sessionStart` hook | Injects `system/` and `projects/<slug>/system/`, file descriptions for `reference/`, memory skills, and the last reflection into every new chat. |
| `cursor-memory` CLI + skill | How the agent reads, searches, and edits memory. Each write is a path-scoped commit that is checked for layout, frontmatter, size, and secrets. |
| `stop`, `preCompact`, `sessionEnd` hooks | Start a detached reflection after about 25 assistant replies, before context compaction, and when a chat with at least 4 new user messages ends. |
| `preToolUse` hook | Asks the human before destructive `git` or `rm -r` commands against the memory repo. |
| `recall` | Searches past Cursor chat transcripts. |
| Status line | `statusline/statusline.mjs`: folder, git, session, and context, plus memory state: `🧠✓` clean, `🧠+N` uncommitted files, `🧠…` reflecting, `🧠!` last reflection failed, `↻N` reflections committed today. |
| Slash commands | In `~/.cursor/commands/`: `/memory` (what is loaded), `/memory-init` (onboard a repo, like Letta's `/init`), `/memory-doctor [symptom]`, `/memory-groom [file]` (plan, approve, then shrink core without losing lines), `/memory-dream`, `/memory-recall <query>`, `/memory-skill [subject]`, `/memory-palace`. New chats in a project with no memory suggest `/memory-init`. |

### Memory layout

```
system/                     loaded into every chat (Letta-style core; doctor warns past ~32,000 tokens)
  human/prefs/              communication.md, coding.md, workflow.md
  human/identity.md         facts the human shared about themselves
  persona.md
projects/<slug>/system/     loaded into every chat in that project
projects/<slug>/reference/  loaded on demand, by description
reference/                  loaded on demand, by description
skills/<name>/SKILL.md      procedures the agent wrote for itself
archives/                   never loaded
```

The project slug comes from the workspace (`cursor-memory slug`).

### Reflection (dream)

The reflector runs `cursor-agent -p --mode ask` in a scratch workspace with no tools. It sees the current memory and only the part of the chat it has not reflected on yet, then replies with JSON operations. The harness, not the model, applies them:

- The same checks as CLI writes, plus: never `archives/` or `read_only` files, at most 8 operations.
- Edits to files that changed after the snapshot are dropped.
- A write that would drop most of an existing file's lines is rejected, unless those lines move to another file in the same batch.
- Everything lands in one `memory(reflection): …` commit; `cursor-memory revert <sha>` undoes it.
- One reflection at a time; failures back off from 1 to 30 minutes.

Unlike Letta, the reflector cannot edit files itself. `cursor-agent --sandbox enabled` did not confine writes in testing, so reflection is text-in, JSON-out.

## Install

Requires Node 22+, git, and `cursor-agent` on `PATH` (or in `~/.local/bin`).

```bash
pnpm install
pnpm memory:install
```

This:

- creates `~/.cursor/memory` if missing;
- merges the hooks into `~/.cursor/hooks.json` (other hooks are kept; the previous file is saved as `hooks.json.cursor-memory.bak`);
- copies the skill to `~/.cursor/skills/cursor-memory/` and the slash commands to `~/.cursor/commands/` (an existing command file that is not ours is left alone);
- sets `statusLine` in `~/.cursor/cli-config.json` and nothing else there, saving the previous value to `cli-config.statusline.pre-cursor-memory.json`. It never creates `cli-config.json`; run `cursor-agent` once first. Skip with `pnpm memory:install --no-statusline`;
- links the CLI into `~/.local/bin` (override with `CURSOR_MEMORY_BIN_DIR`).

Open a new chat to load memory; restart running CLI sessions to pick up new commands.

With `approvalMode: allowlist`, the agent asks before every `cursor-memory` command. Add `Shell(cursor-memory)` to `permissions.allow` in `cli-config.json` to let it read and edit memory on its own, as in Letta.

`pnpm memory:uninstall` removes the hooks, skill, commands, and CLI link, restores the previous status line, and keeps the memory repo.

## Commands

```bash
cursor-memory show                    # exactly what a new chat receives here
cursor-memory append system/human/prefs/communication.md --body "- Replies in Thai."
cursor-memory search pnpm
cursor-memory recall "deploy wrangler" --project
cursor-memory log --limit 10
cursor-memory revert <sha>

cursor-memory dream --dry-run         # propose edits for the latest chat here, no commit
cursor-memory dreams                  # recent reflection runs

cursor-memory doctor                  # structure, size, duplicates, secrets, hooks, reflection
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
  }
}
```

`"model": "inherit"` uses the chat's model; any slug from `cursor-agent --list-models` pins one. Unknown slugs fall back to `fallbackModel`.

Environment overrides: `CURSOR_MEMORY_DIR`, `CURSOR_HOME`, `CURSOR_PROJECTS_DIR`, `CURSOR_MEMORY_REFLECTION=0` (turn reflection off), `CURSOR_MEMORY_AGENT_COMMAND`, `CURSOR_MEMORY_DREAM_WORKSPACE`, `CURSOR_MEMORY_BACKUP_DIR`.

Reflection bookkeeping (state, lock, logs) lives in `~/.cursor/memory/.git/cursor-memory/` and is never committed.

## Development

```bash
pnpm test     # typecheck + node:test
pnpm check    # typecheck + biome
pnpm fix
```

Zero runtime dependencies; TypeScript runs through Node's `--experimental-strip-types`.

## Known gaps

- Not verified in the Cursor IDE, or with automatic (non-`/compact`) compaction.
- The `preCompact` notice ("reflecting in the background") did not appear in the CLI during testing.
- Reflector transcripts accumulate under `~/.cursor/projects/<dream workspace>/`; `recall` skips them.
- `recall` skips the chat it runs in only when `CURSOR_CONVERSATION_ID` is set; Cursor's sandboxed shell may unset it.
