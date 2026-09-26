/**
 * Memory Palace: a static, self-contained HTML view of the memory repository,
 * modeled on Letta's `/palace` (`src/web/generate-memory-viewer.ts`). It reads
 * committed files and git history only; nothing is sent anywhere.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readDreamLog } from '../dream/state.ts'
import { estimateTokens, SYSTEM_MEMORY_BUDGET_TOKENS } from '../memory/config.ts'
import { parseMemoryDocument } from '../memory/document.ts'
import {
  inspectCommittedMemoryProjection,
  REFLECTION_COMMIT_PREFIX,
  renderCommittedMemoryProjection,
  systemMemoryTokens,
} from '../memory/projection.ts'
import { getRemoteStatus } from '../memory/remote.ts'
import {
  getMemoryHeadRevision,
  isMemoryRepository,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
  runGit,
} from '../memory/repository.ts'
import { classifyMemoryPath, requiresFrontmatter } from '../memory/scope.ts'
import { PALACE_TEMPLATE } from './template.ts'

const MAX_COMMITS = 300
const LAST_TOUCH_COMMITS = 5_000
const DIFF_COMMITS = 40
const DIFF_MAX_CHARS = 60_000
const DIFF_TOTAL_MAX_CHARS = 3_000_000

export type PalaceTouch = {
  sha: string
  date: string
  subject: string
  added: number
  removed: number
}

export type PalaceFile = {
  path: string
  tier: string
  description: string
  readOnly: boolean
  loaded: boolean
  content: string
  chars: number
  lastCommit: PalaceTouch | null
}

export type PalaceCommit = {
  sha: string
  date: string
  author: string
  subject: string
  body: string
  reflection: boolean
  files: Array<{ path: string; added: number; removed: number }>
  diff?: string
}

export type PalaceData = {
  generatedAt: string
  memoryRoot: string
  revision: string | null
  projectSlug: string
  context: { text: string; tokens: number; systemTokens: number; budget: number }
  files: PalaceFile[]
  commits: PalaceCommit[]
  totalCommits: number
  dreams: ReturnType<typeof readDreamLog>
  remote: ReturnType<typeof getRemoteStatus>
}

function collectLastTouches(memoryRoot: string): Map<string, PalaceTouch> {
  const raw = runGit(memoryRoot, [
    'log',
    `-n${LAST_TOUCH_COMMITS}`,
    '--first-parent',
    '--no-renames',
    '--numstat',
    '--pretty=format:%x1e%H%x1f%cI%x1f%s%x1f',
  ]).stdout
  const touches = new Map<string, PalaceTouch>()
  for (const record of raw.split('\x1e')) {
    if (!record.trim()) continue
    const [sha, date, subject, stats = ''] = record.split('\x1f')
    for (const line of stats.split('\n')) {
      const [added, removed, file] = line.trim().split('\t')
      if (!file || touches.has(file)) continue
      touches.set(file, {
        sha,
        date,
        subject,
        added: Number.parseInt(added, 10) || 0,
        removed: Number.parseInt(removed, 10) || 0,
      })
    }
  }
  return touches
}

function collectFiles(memoryRoot: string, loadedPaths: Set<string>): PalaceFile[] {
  const touches = collectLastTouches(memoryRoot)
  return listCommittedMemoryFiles(memoryRoot, '').map((relativePath) => {
    const content = readCommittedMemoryFile(memoryRoot, relativePath) ?? ''
    let tier = 'other'
    try {
      tier = classifyMemoryPath(relativePath).tier
      if (relativePath.startsWith('projects/')) tier = `project-${tier}`
    } catch {}
    const parsed = requiresFrontmatter(relativePath)
      ? parseMemoryDocument(content, relativePath)
      : null
    return {
      path: relativePath,
      tier,
      description: parsed?.description || '',
      readOnly: parsed?.readOnly || false,
      loaded: loadedPaths.has(relativePath),
      content,
      chars: content.length,
      lastCommit: touches.get(relativePath) ?? null,
    }
  })
}

function collectCommits(memoryRoot: string): PalaceCommit[] {
  const raw = runGit(memoryRoot, [
    'log',
    `-n${MAX_COMMITS}`,
    '--first-parent',
    '--no-renames',
    '--numstat',
    '--pretty=format:%x1e%H%x1f%cI%x1f%an%x1f%s%x1f%b%x1f',
  ]).stdout
  const commits = raw
    .split('\x1e')
    .filter((record) => record.trim())
    .map((record): PalaceCommit => {
      const [sha, date, author, subject, body, stats = ''] = record.split('\x1f')
      const files = stats
        .split('\n')
        .map((line) => line.trim().split('\t'))
        .filter((parts) => parts.length === 3)
        .map(([added, removed, file]) => ({
          path: file,
          added: Number.parseInt(added, 10) || 0,
          removed: Number.parseInt(removed, 10) || 0,
        }))
      return {
        sha,
        date,
        author,
        subject,
        body: body.trim(),
        reflection: subject.startsWith(REFLECTION_COMMIT_PREFIX),
        files,
      }
    })
  let budget = DIFF_TOTAL_MAX_CHARS
  for (const commit of commits.slice(0, DIFF_COMMITS)) {
    const diff = runGit(memoryRoot, ['show', '--format=', '--patch', '--no-renames', commit.sha], {
      allowFailure: true,
    }).stdout
    const clipped =
      diff.length > DIFF_MAX_CHARS ? `${diff.slice(0, DIFF_MAX_CHARS)}\n… diff clipped` : diff
    if (clipped.length > budget) break
    commit.diff = clipped
    budget -= clipped.length
  }
  return commits
}

export function collectPalaceData(memoryRoot: string, projectSlug: string): PalaceData {
  if (!isMemoryRepository(memoryRoot) || !getMemoryHeadRevision(memoryRoot)) {
    throw new Error('Memory repository has no commits yet. Run `cursor-memory init` first.')
  }
  const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
  const text = renderCommittedMemoryProjection(projection)
  const loadedPaths = new Set(
    [...projection.globalSystem, ...projection.projectSystem].map(
      (document) => document.relativePath,
    ),
  )
  return {
    generatedAt: new Date().toISOString(),
    memoryRoot: path.resolve(memoryRoot),
    revision: getMemoryHeadRevision(memoryRoot),
    projectSlug,
    context: {
      text,
      tokens: estimateTokens(text),
      systemTokens: systemMemoryTokens(projection),
      budget: SYSTEM_MEMORY_BUDGET_TOKENS,
    },
    files: collectFiles(memoryRoot, loadedPaths),
    commits: collectCommits(memoryRoot),
    totalCommits:
      Number.parseInt(runGit(memoryRoot, ['rev-list', '--count', 'HEAD']).stdout.trim(), 10) || 0,
    dreams: readDreamLog(memoryRoot, 30),
    remote: getRemoteStatus(memoryRoot),
  }
}

export function renderPalace(data: PalaceData): string {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return PALACE_TEMPLATE.replace('/*__PALACE_DATA__*/null', () => json)
}

export function writePalace(memoryRoot: string, projectSlug: string, outFile: string): string {
  const html = renderPalace(collectPalaceData(memoryRoot, projectSlug))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, html, { mode: 0o600 })
  fs.chmodSync(outFile, 0o600)
  return outFile
}

export function openInBrowser(file: string): boolean {
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.TMUX) return false
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  return spawnSync(opener, [file], { stdio: 'ignore' }).status === 0
}
