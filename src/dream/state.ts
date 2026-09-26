/**
 * Reflection bookkeeping kept inside the memory repo's `.git/cursor-memory/`,
 * so it travels with the repository but is never committed.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { getDreamWorkspace } from '../memory/config.ts'
import { isWithin } from '../memory/repository.ts'

export type ConversationState = {
  reflectedMessages: number
  lastReflectedAt?: string
  /** preCompact reports the summarizer's model, so the chat model is remembered from stop. */
  chatModel?: string
}

export type DreamState = {
  conversations: Record<string, ConversationState>
  failures: number
  lastFailureAt?: string
}

export type DreamLogEntry = {
  at: string
  conversationId: string
  trigger: string
  status: 'committed' | 'no-change' | 'skipped' | 'failed'
  detail: string
  model?: string
  sha?: string
  rejected?: string[]
}

const LOCK_STALE_MS = 20 * 60_000
const MAX_BACKOFF_MINUTES = 30

export const dreamStateDir = (memoryRoot: string): string =>
  path.join(memoryRoot, '.git', 'cursor-memory')

const statePath = (memoryRoot: string) => path.join(dreamStateDir(memoryRoot), 'state.json')
const lockPath = (memoryRoot: string) => path.join(dreamStateDir(memoryRoot), 'dream.lock')
export const dreamLogPath = (memoryRoot: string) =>
  path.join(dreamStateDir(memoryRoot), 'dream.log')

export function readDreamState(memoryRoot: string): DreamState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(memoryRoot), 'utf-8')) as DreamState
    return {
      conversations: parsed.conversations || {},
      failures: parsed.failures || 0,
      lastFailureAt: parsed.lastFailureAt,
    }
  } catch {
    return { conversations: {}, failures: 0 }
  }
}

function writeDreamState(memoryRoot: string, state: DreamState): void {
  fs.mkdirSync(dreamStateDir(memoryRoot), { recursive: true })
  const target = statePath(memoryRoot)
  const temp = `${target}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(temp, target)
}

export const reflectedMessageCount = (memoryRoot: string, conversationId: string): number =>
  readDreamState(memoryRoot).conversations[conversationId]?.reflectedMessages || 0

export function markReflected(memoryRoot: string, conversationId: string, count: number): void {
  const state = readDreamState(memoryRoot)
  state.conversations[conversationId] = {
    ...state.conversations[conversationId],
    reflectedMessages: count,
    lastReflectedAt: new Date().toISOString(),
  }
  state.failures = 0
  delete state.lastFailureAt
  writeDreamState(memoryRoot, state)
}

export function rememberChatModel(memoryRoot: string, conversationId: string, model: string): void {
  const state = readDreamState(memoryRoot)
  const current = state.conversations[conversationId]
  if (current?.chatModel === model) return
  state.conversations[conversationId] = {
    ...current,
    reflectedMessages: current?.reflectedMessages || 0,
    chatModel: model,
  }
  writeDreamState(memoryRoot, state)
}

export function recordDreamFailure(memoryRoot: string): void {
  const state = readDreamState(memoryRoot)
  state.failures += 1
  state.lastFailureAt = new Date().toISOString()
  writeDreamState(memoryRoot, state)
}

/** Automatic triggers back off 1, 2, 4 … 30 minutes after consecutive failures. */
export function isBackedOff(state: DreamState, now: Date = new Date()): boolean {
  if (state.failures <= 0 || !state.lastFailureAt) return false
  const minutes = Math.min(2 ** (state.failures - 1), MAX_BACKOFF_MINUTES)
  return now.getTime() - Date.parse(state.lastFailureAt) < minutes * 60_000
}

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isDreamLocked(memoryRoot: string): boolean {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath(memoryRoot), 'utf-8')) as {
      pid: number
      startedAt: string
    }
    return processAlive(lock.pid) && Date.now() - Date.parse(lock.startedAt) < LOCK_STALE_MS
  } catch {
    return false
  }
}

/** Single-flight lock. Returns a release function, or null when another dream is running. */
export function acquireDreamLock(memoryRoot: string): (() => void) | null {
  fs.mkdirSync(dreamStateDir(memoryRoot), { recursive: true })
  const target = lockPath(memoryRoot)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(target, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
      fs.closeSync(fd)
      return () => fs.rmSync(target, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (isDreamLocked(memoryRoot)) return null
      fs.rmSync(target, { force: true })
    }
  }
  return null
}

export function appendDreamLog(memoryRoot: string, entry: Omit<DreamLogEntry, 'at'>): void {
  fs.mkdirSync(dreamStateDir(memoryRoot), { recursive: true })
  fs.appendFileSync(
    dreamLogPath(memoryRoot),
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
  )
}

export function readDreamLog(memoryRoot: string, limit = 20): DreamLogEntry[] {
  try {
    return fs
      .readFileSync(dreamLogPath(memoryRoot), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DreamLogEntry]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export function isDreamSession(workspace: string | null): boolean {
  if (process.env.CURSOR_MEMORY_DREAM_CHILD === '1') return true
  if (!workspace) return false
  const dreamWorkspace = getDreamWorkspace()
  const resolve = (candidate: string) =>
    fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate)
  return isWithin(resolve(dreamWorkspace), resolve(workspace))
}
