/**
 * Backup, export, diff, and restore. Letta copies the memory directory
 * (`letta memory backup|restore`); here backups are `git bundle` files and a
 * restore is a new commit, so it can itself be reverted.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  assertNoUnrelatedChanges,
  getMemoryHeadRevision,
  isMemoryRepository,
  runGit,
} from './repository.ts'
import { type MemorySettings, resolveEffectiveSettings } from './settings.ts'
import { isSharedOwnerPath, NATIVE_COMMUNICATION_PATH } from './shared.ts'

export type BackupInfo = { name: string; path: string; createdAt: string; bytes: number }

const RESTORE_REF = 'refs/cursor-memory/restore'
const REVISION = /^[a-f0-9]{4,40}$|^HEAD(?:~\d+)?$/i

const timestamp = (now: Date): string =>
  now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)

const requireRepository = (memoryRoot: string): void => {
  if (!isMemoryRepository(memoryRoot) || !getMemoryHeadRevision(memoryRoot)) {
    throw new Error('Memory repository has no commits yet. Run `cursor-memory init` first.')
  }
}

export function createBackup(memoryRoot: string, backupDir: string, now = new Date()): BackupInfo {
  requireRepository(memoryRoot)
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  let name = `memory-${timestamp(now)}.bundle`
  for (let suffix = 2; fs.existsSync(path.join(backupDir, name)); suffix++) {
    name = `memory-${timestamp(now)}-${suffix}.bundle`
  }
  const target = path.join(backupDir, name)
  runGit(memoryRoot, ['bundle', 'create', '-q', target, 'main'])
  fs.chmodSync(target, 0o600)
  const stat = fs.statSync(target)
  return { name, path: target, createdAt: stat.mtime.toISOString(), bytes: stat.size }
}

export function listBackups(backupDir: string): BackupInfo[] {
  if (!fs.existsSync(backupDir)) return []
  return fs
    .readdirSync(backupDir)
    .filter((name) => /^memory-.*\.bundle$/.test(name))
    .map((name) => {
      const target = path.join(backupDir, name)
      const stat = fs.statSync(target)
      return { name, path: target, createdAt: stat.mtime.toISOString(), bytes: stat.size }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

const resolveBackup = (backupDir: string, from: string): string => {
  const candidate = from.includes('/') ? path.resolve(from) : path.join(backupDir, from)
  if (!fs.existsSync(candidate)) throw new Error(`Backup not found: ${from}`)
  return candidate
}

/** Replaces the committed tree with the backup's `main` as one new, revertible commit. */
export function restoreBackup(
  memoryRoot: string,
  backupDir: string,
  from: string,
  options?: { settings?: MemorySettings },
): { committed: boolean; sha?: string; source: string } {
  requireRepository(memoryRoot)
  assertNoUnrelatedChanges(memoryRoot, [])
  const source = resolveBackup(backupDir, from)
  runGit(memoryRoot, ['bundle', 'verify', '-q', source])
  runGit(memoryRoot, ['fetch', '-q', '--no-tags', source, `+refs/heads/main:${RESTORE_REF}`])
  try {
    runGit(memoryRoot, ['read-tree', '-u', '--reset', RESTORE_REF])
    const settings = resolveEffectiveSettings(options?.settings)
    if (settings.sharedRead?.enabled) {
      const stagedFiles = runGit(memoryRoot, ['diff', '--cached', '--name-only'], {
        allowFailure: true,
      }).stdout
      const changed = stagedFiles.split('\n').filter(Boolean)
      if (changed.some(isSharedOwnerPath)) {
        throw new Error(
          `Cannot restore backup while sharedRead is enabled: backup affects protected shared owner ${NATIVE_COMMUNICATION_PATH}. Manual review required or disable sharedRead.`,
        )
      }
    }
    const staged = runGit(memoryRoot, ['diff', '--cached', '--quiet'], { allowFailure: true })
    if (staged.status === 0) return { committed: false, source }
    runGit(memoryRoot, ['commit', '-q', '-m', `memory: restore from ${path.basename(source)}`])
    return { committed: true, sha: getMemoryHeadRevision(memoryRoot) || undefined, source }
  } catch (error) {
    runGit(memoryRoot, ['read-tree', '-u', '--reset', 'HEAD'], { allowFailure: true })
    throw error
  } finally {
    runGit(memoryRoot, ['update-ref', '-d', RESTORE_REF], { allowFailure: true })
  }
}

/** Writes the committed tree as plain files (no `.git`) into an empty or new directory. */
export function exportMemory(
  memoryRoot: string,
  outDir: string,
): { files: number; outDir: string } {
  requireRepository(memoryRoot)
  const target = path.resolve(outDir)
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`${target} is not empty.`)
  }
  fs.mkdirSync(target, { recursive: true })
  const archive = spawnSync('git', ['-C', memoryRoot, 'archive', '--format=tar', 'HEAD'], {
    maxBuffer: 256 * 1024 * 1024,
  })
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr}`)
  const untar = spawnSync('tar', ['-x', '-C', target], { input: archive.stdout })
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`)
  const files = runGit(memoryRoot, ['ls-tree', '-r', '--name-only', 'HEAD'])
    .stdout.split('\n')
    .filter(Boolean).length
  return { files, outDir: target }
}

/** No revisions: uncommitted changes. One: that revision against HEAD. Two: between them. */
export function diffMemory(memoryRoot: string, revisions: string[]): string {
  requireRepository(memoryRoot)
  for (const revision of revisions) {
    if (!REVISION.test(revision)) throw new Error(`Invalid revision: ${revision}`)
  }
  if (revisions.length > 2) throw new Error('diff takes at most two revisions.')
  const args =
    revisions.length === 0
      ? ['diff', 'HEAD']
      : revisions.length === 1
        ? ['diff', revisions[0], 'HEAD']
        : ['diff', revisions[0], revisions[1]]
  const diff = runGit(memoryRoot, ['--no-pager', ...args, '--stat', '--patch']).stdout
  if (revisions.length > 0) return diff
  const untracked = runGit(memoryRoot, ['ls-files', '--others', '--exclude-standard']).stdout.trim()
  return untracked ? `${diff}\nUntracked:\n${untracked}\n` : diff
}
