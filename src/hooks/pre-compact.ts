#!/usr/bin/env node
import { evaluateDreamTrigger, launchDetachedDream } from '../dream/trigger.ts'
import { getMemoryRoot } from '../memory/config.ts'
import { loadSettings } from '../memory/settings.ts'
import { type HookInput, isDirectInvocation, runHook } from './io.ts'

/** Letta's compaction-event trigger: reflect before the context is summarized. */
export function handlePreCompact(
  input: HookInput,
  memoryRoot: string = getMemoryRoot(),
): { user_message?: string } {
  const decision = evaluateDreamTrigger(input, 'compaction', {
    memoryRoot,
    settings: loadSettings().reflection,
  })
  if (!decision.fire) return {}
  launchDetachedDream(decision.job, memoryRoot)
  return { user_message: 'Cursor Memory is reflecting on this chat in the background.' }
}

if (isDirectInvocation(import.meta.url)) runHook((input) => handlePreCompact(input))
