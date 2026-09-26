import * as os from 'node:os'
import * as path from 'node:path'

export const ACTIVE_MEMORY_BUDGET_TOKENS = 1400
export const ACTIVE_MEMORY_HARD_LIMIT_CHARS = 24_000
export const SYSTEM_DOCUMENT_MAX_CHARS = 4_000

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
