Cursor Memory: audit persistent memory and fix what the doctor finds.

1. Run `cursor-memory doctor` in this workspace.
2. Follow the "Auditing memory" section of the `cursor-memory` skill for every `warn` or `FAIL` line: fix it with `cursor-memory write`, `replace`, `move`, or `delete`, one focused commit per fix.
3. Ask the human before deleting a file, moving more than three files, or changing anything marked `read_only`.
4. Run `cursor-memory doctor` again and report what changed, with the commit shas, and anything left for the human to decide.

<!-- installed by cursor-memory-layer -->
