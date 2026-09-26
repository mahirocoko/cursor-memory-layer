Cursor Memory: show what memory this chat loaded, how big it is, and what changed recently.

1. Run `cursor-memory status` and `cursor-memory dreams --limit 3`.
2. Report briefly:
   - the project slug, and the files loaded into every chat with the token estimate (the `system/` files have a soft budget of about 32,000);
   - how many `reference/` files and memory skills are available on demand;
   - uncommitted memory, if any, and diagnostics;
   - the last few commits and background reflections, with shas.
3. Run `cursor-memory show` only if the human wants the exact text chats receive.

<!-- installed by cursor-memory-layer -->
