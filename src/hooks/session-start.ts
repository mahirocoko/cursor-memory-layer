#!/usr/bin/env node
import { isDreamSession, rememberActiveConversation } from '../dream/state.ts'
import { getMemoryRoot } from '../memory/config.ts'
import { resolveProjectSlug } from '../memory/identity.ts'
import {
  inspectCommittedMemoryProjection,
  renderCommittedMemoryProjection,
} from '../memory/projection.ts'
import { isMemoryRepository } from '../memory/repository.ts'
import type { MemorySettings } from '../memory/settings.ts'
import {
  firstWorkspaceRoot,
  type HookInput,
  isDirectInvocation,
  runHook,
  stringField,
} from './io.ts'

export type SessionStartOutput = { additional_context?: string }

export function buildSessionStartOutput(
  input: HookInput,
  memoryRoot: string = getMemoryRoot(),
  settings?: MemorySettings,
): SessionStartOutput {
  const workspace = firstWorkspaceRoot(input) || process.cwd()
  if (isDreamSession(workspace)) return {}
  const conversationId = stringField(input, 'conversation_id') || stringField(input, 'session_id')
  if (conversationId && isMemoryRepository(memoryRoot)) {
    rememberActiveConversation(memoryRoot, conversationId)
  }
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)
  const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug, settings)
  return { additional_context: renderCommittedMemoryProjection(projection) }
}

if (isDirectInvocation(import.meta.url)) runHook((input) => buildSessionStartOutput(input))
