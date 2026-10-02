/**
 * Finish a stuck memory merge when one side already contains the other.
 * Divergent text stays unresolved; this does not pick a side or abort the merge.
 */

import {
  getMemoryHeadRevision,
  getMemoryRepositoryStatus,
  runGit,
  writeMemoryFile,
} from './repository.ts'
import { isSharedOwnerPath, type MemorySettings, resolveEffectiveSettings } from './settings.ts'

export type RepairResult = {
  status: 'clean' | 'repaired' | 'unresolved' | 'dirty' | 'error'
  paths: string[]
  summary: string
  sha?: string
}

const stageBlob = (memoryRoot: string, relativePath: string, stage: 2 | 3): string | null => {
  const result = runGit(memoryRoot, ['show', `:${stage}:${relativePath}`], { allowFailure: true })
  return result.status === 0 ? result.stdout : null
}

/** Keep the text that already includes the other side. Otherwise leave the conflict. */
export function chooseContainingSide(ours: string, theirs: string): string | null {
  if (ours === theirs) return ours
  if (ours.includes(theirs)) return ours
  if (theirs.includes(ours)) return theirs
  return null
}

const unmergedPaths = (memoryRoot: string): string[] =>
  runGit(memoryRoot, ['diff', '--name-only', '--diff-filter=U'], { allowFailure: true })
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const inMerge = (memoryRoot: string): boolean =>
  runGit(memoryRoot, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { allowFailure: true })
    .status === 0

export function repairMemoryRepository(
  memoryRoot: string,
  options?: { settings?: MemorySettings },
): RepairResult {
  const settings = resolveEffectiveSettings(options?.settings)
  const status = getMemoryRepositoryStatus(memoryRoot)
  if (status.state === 'uninitialized' || status.state === 'error') {
    return { status: 'error', paths: [], summary: status.summary }
  }
  const merging = inMerge(memoryRoot)
  if (!merging && status.state !== 'conflict') {
    if (status.state === 'dirty') {
      return { status: 'dirty', paths: status.changedPaths, summary: status.summary }
    }
    return { status: 'clean', paths: [], summary: status.summary }
  }

  const unresolved: string[] = []
  const resolved: string[] = []
  for (const relativePath of unmergedPaths(memoryRoot)) {
    if (settings.sharedRead?.enabled && isSharedOwnerPath(relativePath)) {
      unresolved.push(relativePath)
      continue
    }
    const ours = stageBlob(memoryRoot, relativePath, 2)
    const theirs = stageBlob(memoryRoot, relativePath, 3)
    const chosen = ours !== null && theirs !== null ? chooseContainingSide(ours, theirs) : null
    if (chosen === null) {
      unresolved.push(relativePath)
      continue
    }
    writeMemoryFile(memoryRoot, relativePath, chosen.endsWith('\n') ? chosen : `${chosen}\n`, {
      settings,
    })
    runGit(memoryRoot, ['add', '--', relativePath])
    resolved.push(relativePath)
  }

  if (settings.sharedRead?.enabled) {
    const stagedResult = runGit(memoryRoot, ['diff', '--cached', '--name-only'], {
      allowFailure: true,
    })
    const stagedPaths = stagedResult.stdout.split('\n').filter(Boolean)
    const protectedStaged = stagedPaths.filter(isSharedOwnerPath)
    if (protectedStaged.length > 0) {
      unresolved.push(...protectedStaged)
    }
  }

  if (unresolved.length > 0) {
    const uniqueUnresolved = [...new Set(unresolved)]
    return {
      status: 'unresolved',
      paths: uniqueUnresolved,
      summary: `Left ${uniqueUnresolved.length} conflict(s) unresolved: ${uniqueUnresolved.join(', ')}.`,
    }
  }
  runGit(memoryRoot, ['commit', '-m', 'memory: repair unfinished merge'])
  return {
    status: 'repaired',
    paths: resolved,
    summary: 'Finished the memory merge.',
    sha: getMemoryHeadRevision(memoryRoot) || undefined,
  }
}
