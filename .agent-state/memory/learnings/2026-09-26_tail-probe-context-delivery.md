---
artifact: reference-learning
authority: non-canonical
status: candidate
source: .agent-state/memory/retrospectives/2026-09/26/16.18_letta-core-load-groom-guard.md
---

# Verify injected context with a tail probe

Tags: context-injection, hooks, verification, memory

- **Intent**: Know that an injected context block actually reaches the model whole and is attributed correctly, instead of inferring it from code or byte counts.
- **Trigger**: Changing what a hook, rule, or memory layer injects at session start: size, section order, headings, or truncation limits.
- **Action**: Start a fresh real chat and ask, with tools explicitly forbidden, for facts that appear only near the end of the injected block and for which file/section they came from; compare against the source text.
- **Boundary**: Proves delivery and attribution for that model and client at that moment, not answer quality or behavior; rerun when the client, model, or injection format changes. Do not use it on content containing secrets.
- **Rationale**: On 2026-09-26 the probe confirmed ~26k tokens reached a Cursor CLI chat and exposed that an in-file `##` heading was read as a separate file — a bug invisible to unit tests.
