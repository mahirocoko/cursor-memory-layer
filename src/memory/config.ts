import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Soft budget for `system/` documents loaded every chat. It sits under the hard
 * core cap so doctor can warn before a write is rejected. The fixed contract
 * and indexes are not counted.
 */
export const SYSTEM_MEMORY_BUDGET_TOKENS = 12_000
/** Safety cut for the whole injected block; above Letta's 65,536-character core default. */
export const ACTIVE_MEMORY_HARD_LIMIT_CHARS = 131_072
/** Doctor warns here, before a system file is rejected at {@link SYSTEM_FILE_MAX_CHARS}. */
export const SYSTEM_DOCUMENT_WARN_CHARS = 16_000
/** Letta's per-file cap. Applies to `system/` files, including frontmatter. */
export const SYSTEM_FILE_MAX_CHARS = 20_000
/** Letta's core cap. Global `system/` plus one project's `system/` files. */
export const SYSTEM_CORE_MAX_CHARS = 65_536
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
