import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstWorkspaceRoot, type HookInput, stringField } from '../hooks/io.ts'
import { getCursorProjectsDir } from '../memory/config.ts'
import { isMemoryRepository } from '../memory/repository.ts'
import type { ReflectionSettings, ReflectionTrigger } from '../memory/settings.ts'
import { readTranscript } from '../recall/transcripts.ts'
import type { DreamJob } from './runner.ts'
import {
  dreamStateDir,
  isBackedOff,
  isDreamLocked,
  isDreamSession,
  readDreamState,
} from './state.ts'

export type TriggerDecision = { fire: true; job: DreamJob } | { fire: false; reason: string }

const RUN_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run.ts')

/**
 * preCompact always sends the common hook fields, but `transcript_path` may be
 * null. Fall back to the transcript Cursor stores for this conversation.
 */
export function resolveTranscriptPath(input: HookInput): string | null {
  const given = stringField(input, 'transcript_path')
  if (given && fs.existsSync(given)) return given
  const id = stringField(input, 'conversation_id') || stringField(input, 'session_id')
  const workspace = firstWorkspaceRoot(input)
  if (!id || !workspace) return null
  const file = path.join(
    getCursorProjectsDir(),
    workspace.replace(/^[/\\]+/, '').replace(/[/\\.:\s]+/g, '-'),
    'agent-transcripts',
    id,
    `${id}.jsonl`,
  )
  return fs.existsSync(file) ? file : null
}

export function evaluateDreamTrigger(
  input: HookInput,
  event: ReflectionTrigger,
  options: { memoryRoot: string; settings: ReflectionSettings },
): TriggerDecision {
  const { memoryRoot, settings } = options
  if (!settings.enabled) return { fire: false, reason: 'reflection disabled' }
  if (!settings.triggers.includes(event)) return { fire: false, reason: `${event} trigger off` }
  if (input.is_background_agent === true) return { fire: false, reason: 'background agent' }
  const workspace = firstWorkspaceRoot(input)
  if (isDreamSession(workspace)) return { fire: false, reason: 'reflection session' }
  if (!isMemoryRepository(memoryRoot)) return { fire: false, reason: 'memory not initialized' }
  const transcriptPath = resolveTranscriptPath(input)
  if (!transcriptPath) return { fire: false, reason: 'no transcript_path' }

  const state = readDreamState(memoryRoot)
  if (isBackedOff(state)) return { fire: false, reason: 'backing off after a failed reflection' }
  if (isDreamLocked(memoryRoot)) return { fire: false, reason: 'another reflection is running' }

  const transcript = readTranscript(transcriptPath)
  if (!transcript) return { fire: false, reason: 'transcript unreadable' }
  const conversationId =
    stringField(input, 'conversation_id') || stringField(input, 'session_id') || transcript.id
  const start = state.conversations[conversationId]?.reflectedMessages || 0
  const fresh = transcript.messages.slice(start)
  const users = fresh.filter((message) => message.role === 'user').length
  const assistants = fresh.length - users
  const ready =
    event === 'step-count'
      ? users > 0 && assistants >= settings.stepCount
      : event === 'compaction'
        ? users > 0
        : users >= settings.minUserMessages
  if (!ready) {
    return {
      fire: false,
      reason: `not enough new messages (${users} user, ${assistants} assistant)`,
    }
  }

  const chatModel =
    (event === 'compaction' && state.conversations[conversationId]?.chatModel) ||
    stringField(input, 'model')
  return {
    fire: true,
    job: {
      transcriptPath,
      conversationId,
      workspace: workspace || process.cwd(),
      trigger: event,
      model: settings.model === 'inherit' ? chatModel || 'auto' : settings.model,
    },
  }
}

/** Starts the reflection in its own process group so the hook can return at once. */
export function launchDetachedDream(job: DreamJob, memoryRoot: string): string {
  const jobsDir = path.join(dreamStateDir(memoryRoot), 'jobs')
  fs.mkdirSync(jobsDir, { recursive: true })
  const safeId = job.conversationId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) || 'session'
  const jobFile = path.join(jobsDir, `${Date.now()}-${safeId}.json`)
  fs.writeFileSync(jobFile, JSON.stringify(job))
  const log = fs.openSync(path.join(dreamStateDir(memoryRoot), 'runner.log'), 'a')
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', RUN_SCRIPT, jobFile],
    {
      detached: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, CURSOR_MEMORY_DIR: memoryRoot },
    },
  )
  child.unref()
  fs.closeSync(log)
  return jobFile
}
