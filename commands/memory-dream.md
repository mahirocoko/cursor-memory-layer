Cursor Memory: reflect on this chat now and update memory (add "dry run" to preview).

1. If the human asked for a preview ("dry run", "preview", "--dry-run"), run `cursor-memory dream --dry-run`; otherwise run `cursor-memory dream`. Both reflect on the latest chat in this workspace.
2. Report the result line. For a commit, show the sha and the files it touched, and mention `cursor-memory revert <sha>` to undo it. For a dry run, list each proposed write or delete in one line, and say nothing was committed.
3. Do not edit memory yourself as part of this command.

<!-- installed by cursor-memory-layer -->
