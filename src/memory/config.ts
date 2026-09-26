import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Soft budget for `system/` documents loaded every chat, near Letta's "about 10% of the
 * context window" guidance. The fixed contract and indexes are not counted.
 */
export const SYSTEM_MEMORY_BUDGET_TOKENS = 32_000
/** Safety cut for the whole injected block; above Letta's 65,536-character core default. */
export const ACTIVE_MEMORY_HARD_LIMIT_CHARS = 131_072
/** Doctor warns above Letta's per-file default; writes are not blocked. */
export const SYSTEM_DOCUMENT_WARN_CHARS = 20_000
/** Background reflection may grow `system/` by at most this much per run. */
export const DREAM_SYSTEM_GROWTH_MAX_CHARS = 2_000

export const getCursorHome = (): string =>
  process.env.CURSOR_HOME || path.join(os.homedir(), '.cursor')

export const getMemoryRoot = (): string =>
  process.env.CURSOR_MEMORY_DIR || path.join(getCursorHome(), 'memory')

export const getCursorProjectsDir = (): string =>
  process.env.CURSOR_PROJECTS_DIR || path.join(getCursorHome(), 'projects')

/** Empty workspace the reflection child runs in; hooks ignore sessions rooted here. */
export const getDreamWorkspace = (): string =>
  process.env.CURSOR_MEMORY_DREAM_WORKSPACE || path.join(getCursorHome(), 'memory-dream')

export const getBackupDir = (): string =>
  process.env.CURSOR_MEMORY_BACKUP_DIR || path.join(getCursorHome(), 'memory-backups')

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)
