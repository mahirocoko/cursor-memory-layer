# letta-code

Snapshot: `d7fd0a6cb`, `@letta-ai/letta-code` 0.33.1. Notes: `.agent-state/learn/letta-ai/letta-code/`.

- Letta Code is one stateful agent harness (`letta`): Cloud or experimental local backend, shared by the TUI, headless `-p`, and the App Server.
- Memory is a git checkout. Mods replaced the old `src/extensions/` tree. `--no-extensions` is only a legacy alias of `--no-mods`.
- Project skills split across `.agents/skills` (canonical) and `.skills` (legacy default of `discoverSkills`).
