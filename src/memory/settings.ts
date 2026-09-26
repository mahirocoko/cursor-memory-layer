import * as fs from 'node:fs'
import * as path from 'node:path'
import { getCursorHome } from './config.ts'

export type ReflectionTrigger = 'step-count' | 'compaction' | 'session-end'

export type ReflectionSettings = {
  enabled: boolean
  triggers: ReflectionTrigger[]
  /** Unreflected assistant messages that fire the `step-count` trigger (Letta default 25). */
  stepCount: number
  /** Unreflected user messages required before `session-end` fires. */
  minUserMessages: number
  /** `inherit` uses the chat's model when cursor-agent accepts it. */
  model: string
  fallbackModel: string
  timeoutMs: number
  agentCommand: string
}

export type MemorySettings = {
  reflection: ReflectionSettings
}

const TRIGGERS: ReflectionTrigger[] = ['step-count', 'compaction', 'session-end']

export const DEFAULT_SETTINGS: MemorySettings = {
  reflection: {
    enabled: true,
    triggers: [...TRIGGERS],
    stepCount: 25,
    minUserMessages: 4,
    model: 'inherit',
    fallbackModel: 'auto',
    timeoutMs: 5 * 60_000,
    agentCommand: 'cursor-agent',
  },
}

export const getSettingsPath = (): string =>
  process.env.CURSOR_MEMORY_SETTINGS || path.join(getCursorHome(), 'cursor-memory.json')

const positiveInteger = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

const nonEmptyString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

export function loadSettings(file: string = getSettingsPath()): MemorySettings {
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>
    }
  } catch {}
  const input = (
    raw.reflection && typeof raw.reflection === 'object' ? raw.reflection : {}
  ) as Record<string, unknown>
  const defaults = DEFAULT_SETTINGS.reflection
  const triggers = Array.isArray(input.triggers)
    ? input.triggers.filter((value): value is ReflectionTrigger =>
        TRIGGERS.includes(value as ReflectionTrigger),
      )
    : defaults.triggers
  return {
    reflection: {
      enabled:
        process.env.CURSOR_MEMORY_REFLECTION !== '0' &&
        (typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled),
      triggers,
      stepCount: positiveInteger(input.stepCount, defaults.stepCount),
      minUserMessages: positiveInteger(input.minUserMessages, defaults.minUserMessages),
      model: nonEmptyString(input.model, defaults.model),
      fallbackModel: nonEmptyString(input.fallbackModel, defaults.fallbackModel),
      timeoutMs: positiveInteger(input.timeoutMs, defaults.timeoutMs),
      agentCommand: nonEmptyString(
        process.env.CURSOR_MEMORY_AGENT_COMMAND || input.agentCommand,
        defaults.agentCommand,
      ),
    },
  }
}
