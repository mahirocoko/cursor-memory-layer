Cursor Memory: learn this repository and record its overview and conventions in project memory.

Follow "Onboarding a project" in the `cursor-memory` skill. If the human added "again", "force", or "re-baseline", refresh existing project memory instead of stopping at it.

1. Run `cursor-memory slug` and `cursor-memory status`. If `projects/<slug>/` already holds real content and the human did not ask to refresh it, show what is there and ask before changing it.
2. Read the repository without editing it: README, `AGENTS.md` and any rules files, package manifests and lockfiles, scripts, lint/format/test config, CI workflows, the top-level layout and entry points, and `.env.example` (variable names only).
3. Draft `projects/<slug>/system/overview.md` and `projects/<slug>/system/conventions.md` as the skill describes. Show both drafts with the file each point came from, then stop and wait for the human's reply in the chat.
4. After the human agrees, write them with `cursor-memory write … --description "…"`, and report the commit shas and `cursor-memory revert <sha>`.

<!-- installed by cursor-memory-layer -->
