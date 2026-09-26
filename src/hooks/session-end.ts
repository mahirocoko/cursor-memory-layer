#!/usr/bin/env node
import {
  evaluateDreamTrigger,
  launchDetachedDream,
  type TriggerDecision,
} from '../dream/trigger.ts'
import { getMemoryRoot } from '../memory/config.ts'
import { resolveProjectSlug } from '../memory/identity.ts'
import { isMemoryRepository } from '../memory/repository.ts'
import { loadSettings } from '../memory/settings.ts'
import { readTranscript } from '../recall/transcripts.ts'
import { type ReflectionResult, writeReflectionNote } from '../reflection.ts'
import {
  firstWorkspaceRoot,
  type HookInput,
  isDirectInvocation,
  runHook,
  stringField,
} from './io.ts'

/** Heuristic fallback used when model-driven reflection is disabled. */
export function reflectOnSession(
  input: HookInput,
  memoryRoot: string = getMemoryRoot(),
): ReflectionResult {
  if (process.env.CURSOR_MEMORY_REFLECTION === '0') return { status: 'skipped', reason: 'disabled' }
  if (input.is_background_agent === true) return { status: 'skipped', reason: 'background agent' }
  if (!isMemoryRepository(memoryRoot))
    return { status: 'skipped', reason: 'memory not initialized' }
  const transcriptPath = stringField(input, 'transcript_path') || process.env.CURSOR_TRANSCRIPT_PATH
  if (!transcriptPath) return { status: 'skipped', reason: 'no transcript_path' }
  const transcript = readTranscript(transcriptPath)
  if (!transcript) return { status: 'skipped', reason: 'transcript unreadable' }
  const workspace = firstWorkspaceRoot(input) || process.cwd()
  return writeReflectionNote({
    memoryRoot,
    projectSlug: resolveProjectSlug(workspace, memoryRoot),
    conversationId:
      stringField(input, 'conversation_id') || stringField(input, 'session_id') || transcript.id,
    messages: transcript.messages,
  })
}

export function handleSessionEnd(
  input: HookInput,
  memoryRoot: string = getMemoryRoot(),
): TriggerDecision | ReflectionResult {
  const settings = loadSettings().reflection
  if (!settings.enabled) return reflectOnSession(input, memoryRoot)
  const decision = evaluateDreamTrigger(input, 'session-end', { memoryRoot, settings })
  if (decision.fire) launchDetachedDream(decision.job, memoryRoot)
  return decision
}

if (isDirectInvocation(import.meta.url)) {
  runHook((input) => {
    handleSessionEnd(input)
    return {}
  })
}
