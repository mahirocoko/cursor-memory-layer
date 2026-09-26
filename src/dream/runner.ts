import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getDreamWorkspace } from '../memory/config.ts'
import { resolveProjectSlug } from '../memory/identity.ts'
import { REFLECTION_COMMIT_PREFIX } from '../memory/projection.ts'
import { getMemoryHeadRevision, getMemoryRepositoryStatus } from '../memory/repository.ts'
import type { ReflectionSettings } from '../memory/settings.ts'
import { readTranscript } from '../recall/transcripts.ts'
import { applyDreamOperations, planDreamOperations } from './apply.ts'
import {
  buildDreamPrompt,
  buildMemorySnapshot,
  type DreamOperation,
  parseDreamResponse,
  renderTranscriptSlice,
} from './prompt.ts'
import {
  acquireDreamLock,
  appendDreamLog,
  type DreamLogEntry,
  dreamStateDir,
  markReflected,
  recordDreamFailure,
  reflectedMessageCount,
} from './state.ts'

export type DreamJob = {
  transcriptPath: string
  conversationId: string
  workspace: string
  trigger: string
  /** Requested model; `auto` or a slug that is checked against `cursor-agent --list-models`. */
  model: string
}

export type AgentRunInput = {
  prompt: string
  model: string
  workspace: string
  timeoutMs: number
  agentCommand: string
}

export type AgentRunResult = { ok: true; text: string } | { ok: false; error: string }

export type AgentRunner = (input: AgentRunInput) => AgentRunResult

export type DreamOutcome = Omit<DreamLogEntry, 'at' | 'status'> & {
  status: DreamLogEntry['status'] | 'dry-run'
  /** Dry runs only: what the reflector proposed and which paths would change. */
  operations?: DreamOperation[]
  planned?: string[]
}

const MODEL_CACHE_MS = 24 * 60 * 60_000

export function resolveAgentCommand(command: string): string {
  if (command.includes('/')) return command
  const directories = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(os.homedir(), '.local', 'bin'),
  ]
  for (const directory of directories) {
    const candidate = path.join(directory, command)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {}
  }
  return command
}

export const runCursorAgent: AgentRunner = (input) => {
  fs.mkdirSync(input.workspace, { recursive: true })
  const result = spawnSync(
    resolveAgentCommand(input.agentCommand),
    [
      '-p',
      '--output-format',
      'json',
      '--mode',
      'ask',
      '--trust',
      '--workspace',
      input.workspace,
      '--model',
      input.model,
      input.prompt,
    ],
    {
      cwd: input.workspace,
      encoding: 'utf-8',
      timeout: input.timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CURSOR_MEMORY_DREAM_CHILD: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (result.error) return { ok: false, error: result.error.message }
  const line = result.stdout
    .split('\n')
    .reverse()
    .find((candidate) => candidate.trim().startsWith('{'))
  if (!line) {
    return { ok: false, error: (result.stderr || `exit ${result.status}`).trim().slice(0, 500) }
  }
  try {
    const parsed = JSON.parse(line) as { is_error?: boolean; result?: string }
    if (parsed.is_error || typeof parsed.result !== 'string') {
      return { ok: false, error: `cursor-agent error: ${line.slice(0, 500)}` }
    }
    return { ok: true, text: parsed.result }
  } catch {
    return { ok: false, error: `unparseable cursor-agent output: ${line.slice(0, 200)}` }
  }
}

export function listAgentModels(memoryRoot: string, agentCommand: string): string[] {
  const cache = path.join(dreamStateDir(memoryRoot), 'models.json')
  try {
    const cached = JSON.parse(fs.readFileSync(cache, 'utf-8')) as { at: number; models: string[] }
    if (Date.now() - cached.at < MODEL_CACHE_MS && cached.models.length > 0) return cached.models
  } catch {}
  const result = spawnSync(resolveAgentCommand(agentCommand), ['--list-models'], {
    encoding: 'utf-8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const models = (result.stdout || '')
    .split('\n')
    .map((line) => line.match(/^(\S+) - /)?.[1])
    .filter((model): model is string => Boolean(model))
  if (models.length > 0) {
    fs.mkdirSync(path.dirname(cache), { recursive: true })
    fs.writeFileSync(cache, JSON.stringify({ at: Date.now(), models }))
  }
  return models
}

export function resolveDreamModel(
  requested: string,
  settings: ReflectionSettings,
  available: () => string[],
): string {
  if (!requested || requested === 'auto') return settings.fallbackModel
  return available().includes(requested) ? requested : settings.fallbackModel
}

export function runDream(
  job: DreamJob,
  options: {
    memoryRoot: string
    settings: ReflectionSettings
    runAgent?: AgentRunner
    availableModels?: () => string[]
    /** Propose and validate without committing, logging, or touching reflection state. */
    dryRun?: boolean
  },
): DreamOutcome {
  const { memoryRoot, settings, dryRun = false } = options
  const base = { conversationId: job.conversationId, trigger: job.trigger }
  const finish = (outcome: DreamOutcome): DreamOutcome => {
    if (!dryRun) appendDreamLog(memoryRoot, outcome as Omit<DreamLogEntry, 'at'>)
    return outcome
  }
  const recordFailure = () => {
    if (!dryRun) recordDreamFailure(memoryRoot)
  }
  const release = dryRun ? () => {} : acquireDreamLock(memoryRoot)
  if (!release)
    return finish({ ...base, status: 'skipped', detail: 'another reflection is running' })
  try {
    const transcript = readTranscript(job.transcriptPath)
    if (!transcript) return finish({ ...base, status: 'skipped', detail: 'transcript unreadable' })
    const start = Math.min(
      reflectedMessageCount(memoryRoot, job.conversationId),
      transcript.messages.length,
    )
    const fresh = transcript.messages.slice(start)
    if (!fresh.some((message) => message.role === 'user')) {
      if (!dryRun) markReflected(memoryRoot, job.conversationId, transcript.messages.length)
      return finish({ ...base, status: 'skipped', detail: 'no new user messages' })
    }
    const status = getMemoryRepositoryStatus(memoryRoot)
    const revision = getMemoryHeadRevision(memoryRoot)
    if (status.state !== 'clean' || !revision) {
      return finish({ ...base, status: 'skipped', detail: status.summary })
    }

    const projectSlug = resolveProjectSlug(job.workspace, memoryRoot)
    const model = resolveDreamModel(
      job.model,
      settings,
      options.availableModels || (() => listAgentModels(memoryRoot, settings.agentCommand)),
    )
    const run = (options.runAgent || runCursorAgent)({
      prompt: buildDreamPrompt({
        snapshot: buildMemorySnapshot(memoryRoot, projectSlug),
        transcript: renderTranscriptSlice(fresh, start),
        projectSlug,
        conversationId: job.conversationId,
        revision,
      }),
      model,
      workspace: getDreamWorkspace(),
      timeoutMs: settings.timeoutMs,
      agentCommand: settings.agentCommand,
    })
    if (!run.ok) {
      recordFailure()
      return finish({ ...base, model, status: 'failed', detail: run.error })
    }

    let response: ReturnType<typeof parseDreamResponse>
    try {
      response = parseDreamResponse(run.text)
    } catch (error) {
      recordFailure()
      return finish({
        ...base,
        model,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    if (dryRun) {
      const plan = planDreamOperations({
        memoryRoot,
        baseRevision: revision,
        operations: response.operations,
      })
      return {
        ...base,
        model,
        status: 'dry-run',
        detail: response.summary,
        operations: response.operations,
        planned: plan.pending.map((change) => change.relativePath),
        ...(plan.rejected.length > 0 ? { rejected: plan.rejected } : {}),
      }
    }

    const applied = applyDreamOperations({
      memoryRoot,
      baseRevision: revision,
      operations: response.operations,
      message: [
        `${REFLECTION_COMMIT_PREFIX} ${response.summary}`,
        '',
        `Conversation: ${job.conversationId}`,
        `Messages: ${start + 1}-${transcript.messages.length}`,
        `Trigger: ${job.trigger}`,
        `Model: ${model}`,
      ].join('\n'),
    })
    markReflected(memoryRoot, job.conversationId, transcript.messages.length)
    return finish({
      ...base,
      model,
      status: applied.committed ? 'committed' : 'no-change',
      detail: applied.committed
        ? `${response.summary} (${applied.applied.join(', ')})`
        : response.summary,
      ...(applied.sha ? { sha: applied.sha } : {}),
      ...(applied.rejected.length > 0 ? { rejected: applied.rejected } : {}),
    })
  } catch (error) {
    recordFailure()
    return finish({
      ...base,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    release()
  }
}
