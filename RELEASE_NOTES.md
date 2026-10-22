# v0.2.1 — Upgrade-Safe Node Path

Publication status is owned by GitHub Releases.

- Install now writes a Homebrew launcher (`bin/node`, or `opt/<formula>/bin/node` for keg-only formulas) instead of the versioned Cellar binary, when that launcher resolves to the same Node. A Homebrew Node upgrade no longer silently breaks every memory hook and the status line.
- Adds `CURSOR_MEMORY_NODE` to choose the Node used by hooks and the status line, for version managers such as nvm that have no stable launcher. It must be an existing absolute path named `node`.
- `cursor-memory doctor` now reports an error when the Node binary used by an installed hook or the status line is missing or not executable, and names what cannot run.
- Ownership detection is unchanged: existing installs, including ones pointing at a removed Node, are still recognized and replaced in place by `pnpm memory:install`.

Verification: `pnpm check` and 119 tests with an isolated `CURSOR_HOME`/`CURSOR_MEMORY_SETTINGS`. On a live install the resolver mapped `/opt/homebrew/Cellar/node/26.12.0/bin/node` to `/opt/homebrew/bin/node`, and doctor reported no install findings.

Existing installs pinned to a Cellar path keep that path until `pnpm memory:install` is run again.
