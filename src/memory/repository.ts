/**
 * Git and path boundary for the Cursor memory repository.
 *
 * Ported from agy-memory-layer `memory-repository.ts` (Mahiro, MIT). Active
 * projection reads committed HEAD only; writers stay inside the root and
 * commit only the paths they own.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { isSharedOwnerPath, type MemorySettings, resolveEffectiveSettings } from './settings.ts'

export type MemoryRepositoryState = 'uninitialized' | 'clean' | 'dirty' | 'conflict' | 'error'

export type MemoryRepositoryStatus = {
  state: MemoryRepositoryState
  changedPaths: string[]
  summary: string
  error?: string
}

export type ResolvedMemoryPath = {
  relativePath: string
  absolutePath: string
}

export type CommitMemoryPathsOptions = {
  memoryRoot: string
  relativePaths: string[]
  message: string
}

export type CommitMemoryPathsResult = {
  committed: boolean
  sha?: string
}

export type MemoryLogEntry = {
  sha: string
  date: string
  subject: string
  paths: string[]
}

type GitResult = {
  status: number | null
  stdout: string
  stderr: string
}

const AUTHOR_NAME = 'Cursor Memory'
const AUTHOR_EMAIL = 'cursor-memory-layer@local'

export const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const realPathIfPresent = (candidate: string): string =>
  fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate)

const findExistingAncestor = (candidate: string): string => {
  let current = candidate
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

export function normalizeMemoryRelativePath(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('Memory path must not be empty.')
  if (value.includes('\0')) throw new Error('Memory path must not contain NUL bytes.')
  if (value.includes('\\')) throw new Error(`Memory path must use forward slashes: ${input}`)
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Memory path must be relative: ${input}`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Memory path contains an unsafe segment: ${input}`)
  }
  if (segments[0] === '.git') throw new Error(`Memory path must not touch .git: ${input}`)
  return segments.join('/')
}

export function validateProjectSlug(input: string): string {
  const slug = input.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    throw new Error(`Invalid project slug: ${input}`)
  }
  return slug
}

export function resolveMemoryPath(memoryRoot: string, input: string): ResolvedMemoryPath {
  const relativePath = normalizeMemoryRelativePath(input)
  const absoluteRoot = path.resolve(memoryRoot)
  const absolutePath = path.resolve(absoluteRoot, ...relativePath.split('/'))
  if (!isWithin(absoluteRoot, absolutePath)) {
    throw new Error(`Memory path escapes the memory root: ${input}`)
  }
  if (fs.existsSync(absoluteRoot)) {
    const realRoot = realPathIfPresent(absoluteRoot)
    if (!isWithin(realRoot, realPathIfPresent(findExistingAncestor(absolutePath)))) {
      throw new Error(`Memory path resolves through a symlink outside the root: ${input}`)
    }
    if (fs.existsSync(absolutePath) && !isWithin(realRoot, realPathIfPresent(absolutePath))) {
      throw new Error(`Memory path resolves outside the root: ${input}`)
    }
  }
  return { relativePath, absolutePath }
}

export const isMemoryRepository = (memoryRoot: string): boolean =>
  fs.existsSync(path.join(memoryRoot, '.git'))

export function runGit(
  memoryRoot: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): GitResult {
  const result = spawnSync(
    'git',
    [
      '-C',
      memoryRoot,
      '-c',
      `user.name=${AUTHOR_NAME}`,
      '-c',
      `user.email=${AUTHOR_EMAIL}`,
      ...args,
    ],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const normalized: GitResult = {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  }
  if (!options.allowFailure && result.status !== 0) {
    const detail = (normalized.stderr || normalized.stdout || `exit ${result.status}`).trim()
    throw new Error(`git ${args[0] || 'command'} failed: ${detail}`)
  }
  return normalized
}

export function initMemoryRepository(memoryRoot: string): boolean {
  if (isMemoryRepository(memoryRoot)) return false
  fs.mkdirSync(memoryRoot, { recursive: true })
  runGit(memoryRoot, ['init', '-b', 'main'])
  return true
}

const parsePorcelainPaths = (output: string): { paths: string[]; hasConflict: boolean } => {
  const records = output.split('\0').filter(Boolean)
  const paths = new Set<string>()
  let hasConflict = false
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    const status = record.slice(0, 2)
    const recordPath = record.slice(3)
    if (recordPath) paths.add(recordPath)
    if (status.includes('U') || status === 'AA' || status === 'DD') hasConflict = true
    if (status.includes('R') || status.includes('C')) {
      const originalPath = records[index + 1]
      if (originalPath) {
        paths.add(originalPath)
        index++
      }
    }
  }
  return { paths: [...paths].sort(), hasConflict }
}

export function getMemoryRepositoryStatus(memoryRoot: string): MemoryRepositoryStatus {
  if (!isMemoryRepository(memoryRoot)) {
    return {
      state: 'uninitialized',
      changedPaths: [],
      summary: 'Memory repository is not initialized.',
    }
  }
  const result = runGit(memoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    allowFailure: true,
  })
  if (result.status !== 0) {
    return {
      state: 'error',
      changedPaths: [],
      summary: 'Unable to inspect memory repository.',
      error: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    }
  }
  const parsed = parsePorcelainPaths(result.stdout)
  if (parsed.hasConflict) {
    return {
      state: 'conflict',
      changedPaths: parsed.paths,
      summary: `Memory repository has conflicts in ${parsed.paths.length} path(s).`,
    }
  }
  if (parsed.paths.length > 0) {
    return {
      state: 'dirty',
      changedPaths: parsed.paths,
      summary: `Memory repository has ${parsed.paths.length} uncommitted path(s).`,
    }
  }
  return { state: 'clean', changedPaths: [], summary: 'Memory repository is clean.' }
}

export function assertNoUnrelatedChanges(memoryRoot: string, ownedPaths: string[]): void {
  const status = getMemoryRepositoryStatus(memoryRoot)
  if (status.state === 'uninitialized') {
    throw new Error('Memory repository is not initialized. Run `cursor-memory init` first.')
  }
  if (status.state === 'error' || status.state === 'conflict') {
    throw new Error(status.error || status.summary)
  }
  const unrelated = status.changedPaths.filter((changed) => !ownedPaths.includes(changed))
  if (unrelated.length > 0) {
    throw new Error(
      `Memory repository has unrelated uncommitted paths: ${unrelated.join(', ')}. Commit or discard them first.`,
    )
  }
}

export function readCommittedMemoryFile(memoryRoot: string, input: string): string | null {
  const { relativePath } = resolveMemoryPath(memoryRoot, input)
  if (!isMemoryRepository(memoryRoot)) return null
  const result = runGit(memoryRoot, ['show', `HEAD:${relativePath}`], { allowFailure: true })
  return result.status === 0 ? result.stdout : null
}

export function listCommittedMemoryFiles(memoryRoot: string, directory: string): string[] {
  if (!isMemoryRepository(memoryRoot)) return []
  const relativePath = directory ? resolveMemoryPath(memoryRoot, directory).relativePath : ''
  const result = runGit(
    memoryRoot,
    relativePath
      ? ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', relativePath]
      : ['ls-tree', '-r', '--name-only', '-z', 'HEAD'],
    { allowFailure: true },
  )
  if (result.status !== 0) return []
  return result.stdout.split('\0').filter(Boolean).sort()
}

export function getMemoryHeadRevision(memoryRoot: string): string | null {
  if (!isMemoryRepository(memoryRoot)) return null
  const result = runGit(memoryRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  return result.status === 0 ? result.stdout.trim() : null
}

function assertProtectedWriterPreflight(
  relativePath: string,
  options?: { settings?: MemorySettings },
): void {
  const settings = resolveEffectiveSettings(options?.settings)
  if (settings.sharedRead?.enabled && isSharedOwnerPath(relativePath)) {
    throw new Error(
      `Cannot directly mutate protected shared owner "${relativePath}" while sharedRead is enabled. Queue changes through shared proposals or disable sharedRead.`,
    )
  }
}

export function writeMemoryFile(
  memoryRoot: string,
  input: string,
  content: string,
  options?: { settings?: MemorySettings },
): ResolvedMemoryPath {
  const resolved = resolveMemoryPath(memoryRoot, input)
  assertProtectedWriterPreflight(resolved.relativePath, options)
  fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true })
  resolveMemoryPath(memoryRoot, input)
  const tempPath = `${resolved.absolutePath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tempPath, content, 'utf-8')
  fs.renameSync(tempPath, resolved.absolutePath)
  return resolved
}

export function deleteMemoryFile(
  memoryRoot: string,
  input: string,
  options?: { settings?: MemorySettings },
): ResolvedMemoryPath {
  const resolved = resolveMemoryPath(memoryRoot, input)
  assertProtectedWriterPreflight(resolved.relativePath, options)
  if (fs.existsSync(resolved.absolutePath)) fs.unlinkSync(resolved.absolutePath)
  return resolved
}

export function commitMemoryPaths(
  options: CommitMemoryPathsOptions & { settings?: MemorySettings },
): CommitMemoryPathsResult {
  const relativePaths = [...new Set(options.relativePaths.map(normalizeMemoryRelativePath))]
  if (relativePaths.length === 0) return { committed: false }
  for (const relativePath of relativePaths) {
    resolveMemoryPath(options.memoryRoot, relativePath)
    assertProtectedWriterPreflight(relativePath, options)
  }
  assertNoUnrelatedChanges(options.memoryRoot, relativePaths)

  runGit(options.memoryRoot, ['add', '-A', '--', ...relativePaths])
  const staged = runGit(
    options.memoryRoot,
    ['diff', '--cached', '--quiet', '--', ...relativePaths],
    {
      allowFailure: true,
    },
  )
  if (staged.status === 0) return { committed: false }
  if (staged.status !== 1) {
    throw new Error((staged.stderr || 'Unable to inspect staged memory changes.').trim())
  }
  try {
    runGit(options.memoryRoot, ['commit', '-m', options.message, '--', ...relativePaths])
  } catch (error) {
    runGit(options.memoryRoot, ['reset', '-q', '--', ...relativePaths], { allowFailure: true })
    throw error
  }
  return { committed: true, sha: getMemoryHeadRevision(options.memoryRoot) || undefined }
}

export function getMemoryLog(
  memoryRoot: string,
  limit = 20,
  relativePath?: string,
): MemoryLogEntry[] {
  if (!getMemoryHeadRevision(memoryRoot)) return []
  const args = [
    'log',
    `-n${limit}`,
    '--no-renames',
    '--name-only',
    '--pretty=format:%x1e%H%x1f%cI%x1f%s',
  ]
  if (relativePath) args.push('--', resolveMemoryPath(memoryRoot, relativePath).relativePath)
  return runGit(memoryRoot, args)
    .stdout.split('\x1e')
    .filter((record) => record.trim())
    .map((record) => {
      const [header, ...files] = record.split('\n')
      const [sha, date, subject] = header.split('\x1f')
      return { sha, date, subject, paths: files.map((file) => file.trim()).filter(Boolean) }
    })
}

export function revertMemoryCommit(memoryRoot: string, revision: string): CommitMemoryPathsResult {
  if (!/^[a-f0-9]{4,40}$/i.test(revision)) throw new Error(`Invalid revision: ${revision}`)
  assertNoUnrelatedChanges(memoryRoot, [])
  const resolved = runGit(memoryRoot, [
    'rev-parse',
    '--verify',
    `${revision}^{commit}`,
  ]).stdout.trim()
  const parents = runGit(memoryRoot, ['rev-list', '--parents', '-n1', resolved])
    .stdout.trim()
    .split(' ')
  if (parents.length < 2) throw new Error('Cannot revert the initial memory commit.')
  try {
    runGit(memoryRoot, ['revert', '--no-edit', resolved])
  } catch (error) {
    runGit(memoryRoot, ['revert', '--abort'], { allowFailure: true })
    throw error
  }
  return { committed: true, sha: getMemoryHeadRevision(memoryRoot) || undefined }
}
