#!/usr/bin/env node
import { rememberChatModel } from '../dream/state.ts'
import { evaluateDreamTrigger, launchDetachedDream } from '../dream/trigger.ts'
import { getMemoryRoot } from '../memory/config.ts'
import { isMemoryRepository } from '../memory/repository.ts'
import { loadSettings } from '../memory/settings.ts'
import { type HookInput, isDirectInvocation, runHook, stringField } from './io.ts'

/** Letta's step-count trigger: reflect after enough unreflected assistant messages. */
export function handleStop(input: HookInput, memoryRoot: string = getMemoryRoot()): object {
  const conversationId = stringField(input, 'conversation_id')
  const model = stringField(input, 'model')
  if (conversationId && model && isMemoryRepository(memoryRoot)) {
    rememberChatModel(memoryRoot, conversationId, model)
  }
  const decision = evaluateDreamTrigger(input, 'step-count', {
    memoryRoot,
    settings: loadSettings().reflection,
  })
  if (decision.fire) launchDetachedDream(decision.job, memoryRoot)
  return {}
}

if (isDirectInvocation(import.meta.url)) runHook((input) => handleStop(input))
