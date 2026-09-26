Cursor Memory: audit memory and fix what the doctor finds; add a symptom to investigate it, e.g. "/memory-doctor keeps forgetting pnpm".

If the human described a symptom after the command, investigate it first:

1. Restate the symptom in one line. Run `cursor-memory show` (what chats actually receive) and `cursor-memory search <key terms>`; check `cursor-memory log --limit 20` and `cursor-memory dreams` when a recent change may be involved.
2. Name the cause, from evidence:
   - added or changed after this chat started: memory loads when a chat starts, so the next chat already has it and nothing needs fixing;
   - never recorded;
   - recorded where chats do not load it (`reference/` with a vague description, `archives/`, another project slug, uncommitted);
   - stale, contradicted, or too vague to act on;
   - crowded out: the memory budget notice or truncation appears in `cursor-memory show`;
   - changed or removed by a commit or reflection (give the sha; `cursor-memory revert <sha>` may be the fix).
3. Propose the smallest fix, in one file (do not copy a fact into a second file), and stop. Run no write command until the human agrees in the chat; a CLI approval prompt is not their agreement. Then apply it and note it takes effect in the next chat.

Then, or when no symptom was given, run the general audit:

1. Run `cursor-memory doctor` in this workspace.
2. Follow the "Auditing memory" section of the `cursor-memory` skill for every `warn` or `FAIL` line: fix it with `cursor-memory write`, `replace`, `move`, or `delete`, one focused commit per fix.
3. Do not shrink `system/` here. For a `core size` warning, summarize what dominates and suggest `/memory-groom`, which plans first and asks before cutting.
4. Ask the human before deleting a file, moving more than three files, or changing anything marked `read_only`.
5. Run `cursor-memory doctor` again and report what changed, with the commit shas, and anything left for the human to decide.

<!-- installed by cursor-memory-layer -->
