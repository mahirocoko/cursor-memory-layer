#!/usr/bin/env node
import { isDreamSession } from '../dream/state.ts'
import { getMemoryRoot } from '../memory/config.ts'
import { resolveProjectSlug } from '../memory/identity.ts'
import {
  inspectCommittedMemoryProjection,
  renderCommittedMemoryProjection,
} from '../memory/projection.ts'
import { firstWorkspaceRoot, type HookInput, isDirectInvocation, runHook } from './io.ts'

export type SessionStartOutput = { additional_context?: string }

export function buildSessionStartOutput(
  input: HookInput,
  memoryRoot: string = getMemoryRoot(),
): SessionStartOutput {
  const workspace = firstWorkspaceRoot(input) || process.cwd()
  if (isDreamSession(workspace)) return {}
  const projectSlug = resolveProjectSlug(workspace, memoryRoot)
  const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
  return { additional_context: renderCommittedMemoryProjection(projection) }
}

if (isDirectInvocation(import.meta.url)) runHook((input) => buildSessionStartOutput(input))
