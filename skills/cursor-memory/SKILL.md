---
name: cursor-memory
description: Maintain your own persistent, git-backed memory across Cursor chats (Letta-style). Use when the human states a durable preference, corrects you, tells you a stable fact about themselves or a project, says "remember", "from now on", or "จำไว้", when you need something from past chats, when memory looks stale or contradictory, or when asked about memory reflection, doctor, palace, skills, backups, or mirroring.
---

# Cursor Memory

You have persistent memory at `~/.cursor/memory` (a git repo). New chats receive the committed `system/` files, this project's `projects/<slug>/system/` files, and an index of `reference/` files through the `sessionStart` hook. You keep this memory accurate yourself.

## When to write

Write when you learn something that should still be true next week:

- A preference or correction about how to communicate or work (`system/human/preferences.md`).
- A stable fact the human tells you about themselves (`system/human/identity.md`).
- A confirmed project fact, convention, or gotcha (`projects/<slug>/system/overview.md`, or a new file beside it).
- Longer detail that only matters sometimes (`reference/...` or `projects/<slug>/reference/...`, with a precise `description`).
- A repeatable procedure you want to follow again (`skills/<name>/SKILL.md`, optionally with scripts or references beside it).

Do not write:

- Secrets, tokens, credentials, private URLs with credentials. The CLI refuses them.
- One-off task state, raw transcripts, or guesses. Record facts only after the human or the repo confirms them.
- Anything the repository already says in `AGENTS.md` or rules.

Prefer `replace` over `append` when a line is stale or contradicted. Keep `system/` short: it is loaded into every chat and each file is capped at 4,000 characters.

## Commands

Run `cursor-memory slug` to get the current project slug.

```bash
cursor-memory status                       # what is loaded, token estimate, recent commits
cursor-memory show                         # exact text new chats receive
cursor-memory read system/human/preferences.md

cursor-memory append system/human/preferences.md --body "- Replies in Thai; code and identifiers stay in English."
cursor-memory replace system/human/preferences.md --old "- (nothing recorded yet)" --new "- Wants evidence before claims."
cursor-memory write projects/<slug>/reference/deploy.md --description "How deploys work for <slug>." <<'EOF'
- Deploys run from CI on tags; never deploy from a laptop.
EOF
cursor-memory move reference/old.md reference/new.md
cursor-memory delete reference/obsolete.md

cursor-memory log                          # history
cursor-memory revert <sha>                 # undo a memory change
cursor-memory search <terms>               # committed memory, including archives/
cursor-memory recall <terms> [--project]   # past Cursor chats; then Read the listed file for detail

cursor-memory write skills/release/SKILL.md --description "Cut and publish a release." <<'EOF'
1. Run the tests.
2. Tag and push.
EOF
cursor-memory skills                       # list memory skills
```

Every write is a path-scoped commit and becomes active in the next chat. A file marked `read_only: true` needs the human's approval and `--force`. New chats list your memory skills; when one matches the task, `cursor-memory read` it and follow it.

## Background reflection (dream)

Like Letta's sleeptime reflection, a separate model pass reviews the chat in the background and updates memory for you. It runs after about 25 assistant replies (`stop`), before context compaction (`preCompact`), and when a chat with at least 4 new user messages ends (`sessionEnd`). It only sees the part of a chat it has not reflected on yet. The reflector has no tools: it proposes edits as JSON, and the harness applies them with the same checks as the CLI (layout, frontmatter, size, secrets, `read_only`, no `archives/`), then commits `memory(reflection): …`. An edit to a file that changed after the reflection started is dropped, and so is a write that would drop most of an existing file's lines.

- `cursor-memory dream` reflects on the latest chat in this workspace now; add `--dry-run` to see the proposed edits without committing.
- `cursor-memory dreams` lists recent runs; `cursor-memory revert <sha>` undoes one.
- Settings live in `~/.cursor/cursor-memory.json` under `reflection` (`enabled`, `triggers`, `stepCount`, `minUserMessages`, `model` (`inherit` or a slug), `fallbackModel`). `CURSOR_MEMORY_REFLECTION=0` turns it off.

With reflection disabled, `sessionEnd` falls back to saving the human's statements of lasting intent, verbatim, to `archives/projects/<slug>/learnings/`. Promote confirmed ones into `system/`.

## Auditing memory

Run `cursor-memory doctor` when memory seems wrong, too large, or contradictory. It checks mechanically; you make the judgment calls. Letta's checklist:

- Structure: every file has valid frontmatter and sits in a supported path; skills are `skills/<name>/SKILL.md`.
- Organization: no duplicate or contradictory facts, no stale content, descriptions match what the file holds.
- Discoverability: `reference/` files have descriptions that say when to read them; links point at real files.
- Core-memory size: what dominates the always-loaded budget, and whether it belongs in `reference/` instead.

Fix findings with the normal commands, then tell the human what you changed. `cursor-memory palace` writes a browsable HTML view of all files, history with diffs, and reflection runs to `~/.cursor/memory-palace.html`.

## History and backups

- `cursor-memory diff [<rev> [<rev>]]`, `cursor-memory export --out <dir>`.
- `cursor-memory backup` writes a git bundle to `~/.cursor/memory-backups/`; `restore --from <name> --force` restores it as a new, revertible commit. Ask the human before restoring.
- Memory is local by default. `cursor-memory remote set <url>` mirrors `main` after every commit (never force-pushed); `remote pull` fast-forwards or rebases and aborts on conflict. Only the human decides to add a remote.

## Tell the human

After you change memory, say what you changed in one line, for example: "Saved to memory: you want replies in Thai (`system/human/preferences.md`)."
