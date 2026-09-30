---
name: cursor-memory
description: Maintain your own persistent, git-backed memory across Cursor chats (Letta-style). Use when the human states a durable preference, corrects you, tells you a stable fact about themselves or a project, says "remember", "from now on", or "จำไว้", when you need something from past chats, when memory looks stale or contradictory, when onboarding a repository into memory, saving a reusable procedure as a skill, or when asked about memory reflection, doctor, palace, skills, backups, or mirroring.
---

# Cursor Memory

You have persistent memory at `~/.cursor/memory` (a git repo). New chats receive `persona.md`, `human/`, `MEMORY.md`, this project's top-level files, and an index of deferred files through the `sessionStart` hook. You keep this memory accurate yourself.

Every chat also starts with a short contract adapted from Letta's system prompt (precedence, identity, learning from feedback, jogging memory, continuity); `cursor-memory show` prints it, and this skill is the reference for the commands it names.

## When to write

Write when you learn something that should still be true next week:

- A preference or correction about how to talk, code, or run work (`human/prefs/communication.md`, `coding.md`, or `workflow.md`).
- A stable fact the human tells you about themselves (`human/identity.md`).
- A confirmed project fact, convention, or gotcha (`<slug>/overview.md`, or a new file beside it).
- Longer detail that only matters sometimes (`reference/...` or `<slug>/reference/...`, with a precise `description`).
- A repeatable procedure you want to follow again (`skills/<name>/SKILL.md`, optionally with scripts or references beside it).

Do not write:

- Secrets, tokens, credentials, private URLs with credentials. The CLI refuses them.
- One-off task state, raw transcripts, or guesses. Record facts only after the human or the repo confirms them.
- Anything the repository already says in `AGENTS.md` or rules.

Prefer `replace` over `append` when a line is stale or contradicted. Everything in `system/` is loaded into every chat, so each line costs every future chat; consolidate instead of piling on, and move detail that only matters sometimes into `reference/`. Doctor warns when `system/` passes about 32,000 tokens or a file passes 20,000 characters.

## Commands

Run `cursor-memory slug` to get the current project slug.

```bash
cursor-memory status                       # what is loaded, token estimate, recent commits
cursor-memory show                         # exact text new chats receive
cursor-memory read human/prefs/communication.md

cursor-memory append human/prefs/communication.md --body "- Replies in Thai; code and identifiers stay in English."
cursor-memory replace human/prefs/communication.md --old "- (nothing recorded yet)" --new "- Wants evidence before claims."
cursor-memory write <slug>/reference/deploy.md --description "How deploys work for <slug>." <<'EOF'
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

`persona.md` is who you are: identity defaults that outrank your model defaults, below the latest user message, repository files, and the human's rules. `human/prefs/` are the human's standing defaults; you and reflection keep them current. Everything else is evidence. The persona is `read_only`: reflection never edits it, and you change it only with `replace`, after the human agrees, with `--force`.

The human can run these slash commands: `/memory` (what is loaded), `/memory-init` (onboard this repo), `/memory-doctor [symptom]`, `/memory-groom [file]`, `/memory-dream`, `/memory-recall <query>`, `/memory-skill [subject]`, and `/memory-palace`.

## Onboarding a project

Like Letta's `/init`: when a project has no memory yet (new chats then show a "Project memory" notice), capture what every future chat in it should know. Do it when the human runs `/memory-init` or agrees to your suggestion, not on your own.

- Read, do not edit: README, `AGENTS.md` and rules files, package manifests and lockfiles, scripts, lint/format/test config, CI workflows, top-level layout and entry points, `.env.example` (names only, never values).
- `<slug>/overview.md`: what the project is, its stack and versions, the top-level layout, and entry points.
- `<slug>/conventions.md`: the package manager and the dev, test, lint, typecheck, and build commands exactly as the repo defines them; conventions and gotchas the repo documents.
- Record only what files show. If something is unclear, leave it out or ask; never guess a command. Do not record what is missing ("no CI yet"); absences go stale.
- `AGENTS.md` and rules already load in every chat, so point to them ("Repo rules: `AGENTS.md`") instead of copying them.
- Keep the two files together under about 1,500 characters. Put longer detail in `<slug>/reference/<topic>.md` with a description that says when to read it.
- Show the drafts with the source file of each point, and write them only after the human agrees. Writing `overview.md` replaces the `cursor-memory init` seed.

## Writing a memory skill

A memory skill is a procedure you worked out and want to repeat, like a Letta skill in MemFS. Save one when the human runs `/memory-skill` or agrees to your suggestion after a multi-step task succeeded.

- Check `cursor-memory skills` first and update a matching skill rather than adding a near-duplicate.
- Path `skills/<name>/SKILL.md`, `<name>` lowercase with hyphens. The `name` frontmatter is filled in for you.
- The description says when to use it ("Use when cutting a release of this repo"), not what it is.
- The body: numbered steps with the exact commands that worked, how to verify the result, and the pitfalls you hit. Scripts can sit beside it as `skills/<name>/<file>`.
- Never include secrets or one-off values; use placeholders.

## Background reflection (dream)

Like Letta's sleeptime reflection, a separate model pass reviews the chat in the background and updates memory for you. It runs after about 25 assistant replies (`stop`), before context compaction (`preCompact`), and when a chat with at least 4 new user messages ends (`sessionEnd`). It only sees the part of a chat it has not reflected on yet. The reflector has no tools: it proposes edits as JSON, and the harness applies them with the same checks as the CLI (layout, frontmatter, size, secrets, `read_only`, no `archives/`), then commits `memory(reflection): …`. An edit to a file that changed after the reflection started is dropped, and so is a write that would drop most of an existing file's lines.

- `cursor-memory dream` reflects on the latest chat in this workspace now; add `--dry-run` to see the proposed edits without committing.
- `cursor-memory dreams` lists recent runs; `cursor-memory revert <sha>` undoes one.
- Settings live in `~/.cursor/cursor-memory.json` under `reflection` (`enabled`, `triggers`, `stepCount`, `minUserMessages`, `model` (`inherit` or a slug), `fallbackModel`). `CURSOR_MEMORY_REFLECTION=0` turns it off.

With reflection disabled, `sessionEnd` falls back to saving the human's statements of lasting intent, verbatim, to `archives/projects/<slug>/learnings/`. Promote confirmed ones into `human/` or the project directory.

## Auditing memory

Run `cursor-memory doctor` when memory seems wrong, too large, or contradictory. It checks mechanically; you make the judgment calls. Letta's checklist:

- Structure: every file has valid frontmatter and sits in a supported path; skills are `skills/<name>/SKILL.md`.
- Organization: no duplicate or contradictory facts, no stale content, descriptions match what the file holds.
- Discoverability: `reference/` files have descriptions that say when to read them; links point at real files.
- Core-memory size: what dominates the always-loaded budget, and whether it belongs in `reference/` instead.

Fix findings with the normal commands, then tell the human what you changed. Do not shrink `system/` during an audit; a size finding is a reason to groom. `cursor-memory palace` writes a browsable HTML view of all files, history with diffs, and reflection runs to `~/.cursor/memory-palace.html`.

## Grooming core memory

Grooming lowers the tokens every chat pays for without losing a rule that matters. It is a plan, the human's approval, then small moves (`/memory-groom` walks through it).

- Core keeps what must shape every chat, one line per rule. Detail, history, examples, and task-specific rules move to `reference/` with a description that says when to read them, and core keeps a one-line pointer.
- Each section gets one verdict: keep, move (to a named file), merge (into a named place), or drop (quote the evidence that it is stale or contradicted).
- Show the plan with before and after token estimates and the exact lines to drop, then wait for the human in the chat.
- Move first, cut second: write the `reference/` file with the moved lines verbatim, then shrink core. The CLI refuses a `system/` edit that loses three or more lines that exist nowhere else in memory; `--drop "<line>"` names a line the human agreed to remove and is recorded in the commit message.
- Groom one file per pass, and report the commit shas so any step can be reverted. Without a named file, start with an overview of every loaded file, recommend one, and ask before reading any file whole.

## History and backups

- `cursor-memory diff [<rev> [<rev>]]`, `cursor-memory export --out <dir>`.
- `cursor-memory backup` writes a git bundle to `~/.cursor/memory-backups/`; `restore --from <name> --force` restores it as a new, revertible commit. Ask the human before restoring.
- Memory is local by default. `cursor-memory remote set <url>` mirrors `main` after every commit (never force-pushed); `remote pull` fast-forwards or rebases and aborts on conflict. Only the human decides to add a remote.

## Tell the human

After you change memory, say what you changed in one line, for example: "Saved to memory: you want replies in Thai (`human/prefs/communication.md`)."
