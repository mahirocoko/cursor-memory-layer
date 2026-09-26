#!/usr/bin/env node
import * as os from 'node:os'
import * as path from 'node:path'
import { getMemoryRoot } from '../memory/config.ts'
import { isWithin } from '../memory/repository.ts'
import { type HookInput, isDirectInvocation, runHook } from './io.ts'

export type GuardDecision =
  | Record<string, never>
  | { permission: 'ask'; user_message: string; agent_message: string }

const DESTRUCTIVE_GIT = [
  /\bgit\b[^;&|]*\breset\b[^;&|]*--hard\b/,
  /\bgit\b[^;&|]*\bpush\b[^;&|]*(?:--force\b|--force-with-lease\b|\s-f\b|\s\+\S)/,
  /\bgit\b[^;&|]*\bfilter-(?:branch|repo)\b/,
  /\bgit\b[^;&|]*\bclean\b[^;&|]*\s-[a-zA-Z]*f/,
  /\bgit\b[^;&|]*\b(?:checkout|restore)\b[^;&|]*\s(?:--\s+)?\.(?:\s|$)/,
  /\bgit\b[^;&|]*\brebase\b/,
  /\bgit\b[^;&|]*\bbranch\b[^;&|]*\s-D\b/,
  /\bgit\b[^;&|]*\bupdate-ref\b[^;&|]*\s-d\b/,
  /\bgit\b[^;&|]*\breflog\b[^;&|]*\bexpire\b/,
  /\bgit\b[^;&|]*\bgc\b[^;&|]*--prune/,
]

const DESTRUCTIVE_FS = /\brm\b[^;&|]*\s-[a-zA-Z]*[rR]/

const memoryRootSpellings = (memoryRoot: string): string[] => {
  const absolute = path.resolve(memoryRoot)
  const spellings = [absolute]
  const home = os.homedir()
  if (isWithin(home, absolute)) {
    const relative = path.relative(home, absolute)
    spellings.push(`~/${relative}`, `$HOME/${relative}`, `\${HOME}/${relative}`)
  }
  return spellings
}

const shellCommand = (input: HookInput): { command: string; cwd: string | null } => {
  const toolInput =
    input.tool_input && typeof input.tool_input === 'object'
      ? (input.tool_input as Record<string, unknown>)
      : {}
  const command = [toolInput.command, input.command].find(
    (value): value is string => typeof value === 'string',
  )
  const cwd = [toolInput.working_directory, toolInput.cwd, input.cwd].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  return { command: command || '', cwd: cwd || null }
}

export function evaluateShellCommand(
  input: HookInput,
  memoryRoot: string = getMemoryRoot(),
): GuardDecision {
  const toolName = typeof input.tool_name === 'string' ? input.tool_name : 'Shell'
  if (toolName !== 'Shell') return {}
  const { command, cwd } = shellCommand(input)
  if (!command) return {}

  const mentionsMemory = memoryRootSpellings(memoryRoot).some((spelling) =>
    command.includes(spelling),
  )
  const runsInMemory = cwd ? isWithin(path.resolve(memoryRoot), path.resolve(cwd)) : false
  if (!mentionsMemory && !runsInMemory) return {}

  const destructiveGit = DESTRUCTIVE_GIT.some((pattern) => pattern.test(command))
  const destructiveFs = mentionsMemory && DESTRUCTIVE_FS.test(command)
  if (!destructiveGit && !destructiveFs) return {}

  return {
    permission: 'ask',
    user_message: `This command can rewrite or erase Cursor memory history in ${memoryRoot}. Approve only if you intend that.`,
    agent_message:
      'Destructive git or rm against the Cursor memory repository needs human approval. For normal edits use `cursor-memory write/replace/delete`, and `cursor-memory revert <sha>` to undo.',
  }
}

if (isDirectInvocation(import.meta.url)) runHook((input) => evaluateShellCommand(input))
