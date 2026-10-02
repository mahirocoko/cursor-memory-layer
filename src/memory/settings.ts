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

export type SharedReadSettings = {
  enabled: boolean
  sourceRoot: string | null
  sharedOwner: string
}

export type MemorySettings = {
  reflection: ReflectionSettings
  sharedRead: SharedReadSettings
}

export const FIXED_SHARED_OWNER = 'system/human/prefs/communication.md'
export const NATIVE_COMMUNICATION_PATH = 'human/prefs/communication.md'

export function isSharedOwnerPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  return (
    normalized === NATIVE_COMMUNICATION_PATH ||
    normalized === FIXED_SHARED_OWNER ||
    normalized === 'prefs/communication.md' ||
    normalized === 'communication.md'
  )
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
  sharedRead: {
    enabled: false,
    sourceRoot: null,
    sharedOwner: FIXED_SHARED_OWNER,
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

  const sharedInput = (
    raw.sharedRead && typeof raw.sharedRead === 'object' ? raw.sharedRead : {}
  ) as Record<string, unknown>
  const sharedDefaults = DEFAULT_SETTINGS.sharedRead

  let sharedEnabled =
    typeof sharedInput.enabled === 'boolean' ? sharedInput.enabled : sharedDefaults.enabled
  if (process.env.CURSOR_MEMORY_SHARED_READ !== undefined) {
    const envVal = process.env.CURSOR_MEMORY_SHARED_READ.trim().toLowerCase()
    sharedEnabled = envVal === '1' || envVal === 'true'
  }

  let sourceRoot =
    typeof sharedInput.sourceRoot === 'string' && sharedInput.sourceRoot.trim()
      ? sharedInput.sourceRoot.trim()
      : sharedDefaults.sourceRoot
  if (process.env.CURSOR_MEMORY_SHARED_SOURCE_ROOT) {
    sourceRoot = process.env.CURSOR_MEMORY_SHARED_SOURCE_ROOT.trim()
  }

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
    sharedRead: {
      enabled: sharedEnabled,
      sourceRoot,
      sharedOwner: FIXED_SHARED_OWNER,
    },
  }
}

/**
 * Resolves the trusted effective settings by merging an optional caller override
 * with runtime-owned live configuration.
 *
 * Security Invariant: Caller overrides must not weaken runtime-owned enabled protection.
 * Parameters may tighten (false -> true) to enable protection for tests or scoped calls,
 * but cannot disable (true -> false) live policy.
 */
export function resolveEffectiveSettings(override?: MemorySettings): MemorySettings {
  const live = loadSettings()
  if (!override) return live

  const effectiveSharedReadEnabled =
    live.sharedRead.enabled || Boolean(override.sharedRead?.enabled)
  const effectiveSourceRoot =
    override.sharedRead?.sourceRoot !== undefined
      ? override.sharedRead.sourceRoot
      : live.sharedRead.sourceRoot
  const effectiveSharedOwner =
    override.sharedRead?.sharedOwner || live.sharedRead.sharedOwner || FIXED_SHARED_OWNER

  return {
    ...live,
    ...override,
    reflection: {
      ...live.reflection,
      ...override.reflection,
    },
    sharedRead: {
      ...live.sharedRead,
      ...override.sharedRead,
      enabled: effectiveSharedReadEnabled,
      sourceRoot: effectiveSourceRoot,
      sharedOwner: effectiveSharedOwner,
    },
  }
}

export function saveSettings(file: string, settings: MemorySettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let existing: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>
    }
  } catch {}

  const merged = {
    ...existing,
    reflection: settings.reflection,
    sharedRead: settings.sharedRead,
  }

  const tempFile = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tempFile, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tempFile, file)
}
