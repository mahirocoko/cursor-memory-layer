Cursor Memory: groom always-loaded memory to fewer tokens without losing what matters; add a file to focus on, e.g. "/memory-groom system/human/prefs/coding.md".

Grooming is a plan first, then small moves. Follow the "Grooming core memory" section of the `cursor-memory` skill.

1. Measure. Run `cursor-memory status` and `cursor-memory doctor` in this workspace. Note the `system/` token total and the largest files. If the human named a file, groom only that one.
2. Read each target file whole with `cursor-memory read <path>`. Do not skim.
3. Draft a plan, section by section. Give every section exactly one verdict:
   - keep in core: a rule that must shape every chat, stated in one line;
   - move to reference: detail, history, examples, or rules that matter only for some tasks; name the target `reference/...` file and the one-line pointer that stays in core;
   - merge: the same rule stated in more than one place; name the single place it will live;
   - drop: stale or contradicted; quote the line and the evidence (a newer line, a commit, a file) that makes it wrong.
   End with the estimated `system/` tokens before and after, and the exact lines you plan to `--drop`.
4. Stop and wait for the human's reply in the chat. A CLI approval prompt is not their agreement. Change nothing before they agree; apply only what they approved.
5. Apply in this order, one focused commit each: write or append the `reference/` targets first, copying moved lines verbatim; then shrink the core file with `replace` or `write`. The CLI refuses a `system/` edit that loses three or more lines found nowhere else in memory; if it does, a line was missed or reworded, so fix the reference file rather than reaching for `--drop`. Use `--drop "<line>"` only for lines the human approved dropping.
6. Verify. Run `cursor-memory doctor` and `cursor-memory status` again. Report the token change, the commit shas, and anything left for the human; note that changes load in the next chat. `cursor-memory revert <sha>` undoes any step.

<!-- installed by cursor-memory-layer -->
