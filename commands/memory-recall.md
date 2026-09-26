Cursor Memory: search memory and past Cursor chats for what we already know about a topic.

Use the text the human typed after the command as the query. If there is none, ask what to recall.

1. Run `cursor-memory search <query>` for committed memory.
2. Run `cursor-memory recall <query> --project` for past chats in this project; if that finds nothing useful, run it again without `--project`.
3. Answer from what you found, quoting only short excerpts. Name the memory file or chat each point came from, and say plainly when nothing relevant turned up.
4. If a past chat holds a durable fact that memory lacks, offer to save it; do not save it without the human's agreement.

<!-- installed by cursor-memory-layer -->
