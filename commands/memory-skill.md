Cursor Memory: save a reusable procedure from this chat as a memory skill.

Use the text the human typed after the command as the skill's subject. If there is none, name the repeatable multi-step procedure this chat worked out, or ask which one to save.

Follow "Writing a memory skill" in the `cursor-memory` skill:

1. Run `cursor-memory skills`. Update a matching skill instead of creating a near-duplicate.
2. Draft `skills/<name>/SKILL.md` (`<name>` is lowercase letters, digits, and hyphens): a description that says when to use it, then numbered steps with the exact commands that worked here, how to verify the result, and known pitfalls.
3. Show the draft, then stop and wait for the human's reply in the chat. After the human agrees, write it with `cursor-memory write skills/<name>/SKILL.md --description "…"` and report the path and commit sha.

<!-- installed by cursor-memory-layer -->
