import { buildDocumentContent, currentDocument, validateMemoryContent } from '../memory/editor.ts'
import {
  assertNoUnrelatedChanges,
  commitMemoryPaths,
  deleteMemoryFile,
  getMemoryHeadRevision,
  readCommittedMemoryFile,
  runGit,
  writeMemoryFile,
} from '../memory/repository.ts'
import { classifyMemoryPath } from '../memory/scope.ts'
import type { DreamOperation } from './prompt.ts'

export type ApplyDreamResult = {
  committed: boolean
  sha?: string
  applied: string[]
  rejected: string[]
}

type PendingChange = { relativePath: string; content: string | null; existed: boolean }

const MAX_DROPPED_RATIO = 0.5
const MIN_DROPPED_LINES = 3

const contentLines = (body: string): string[] =>
  body
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*+]|\d+\.)\s+/, '')
        .replace(/\s+/g, ' ')
        .toLowerCase(),
    )
    .filter((line) => line && !line.startsWith('#') && line !== '(nothing recorded yet)')

/**
 * `write` replaces a whole file, so a careless reflection can silently lose
 * memory. Lines moved into another file in the same batch still count as kept.
 */
function assertKeepsExistingLines(
  existingBody: string,
  newBody: string,
  keptElsewhere: Set<string>,
): void {
  const before = contentLines(existingBody)
  if (before.length === 0) return
  const after = new Set(contentLines(newBody))
  const dropped = before.filter((line) => !after.has(line) && !keptElsewhere.has(line))
  if (dropped.length >= MIN_DROPPED_LINES && dropped.length / before.length > MAX_DROPPED_RATIO) {
    throw new Error(
      `would drop ${dropped.length} of ${before.length} existing lines; rewrite in place or delete the file explicitly`,
    )
  }
}

const changedSince = (
  memoryRoot: string,
  baseRevision: string,
  head: string | null,
): Set<string> => {
  if (!head || head === baseRevision) return new Set()
  const output = runGit(memoryRoot, [
    'diff',
    '--name-only',
    '--no-renames',
    baseRevision,
    head,
  ]).stdout
  return new Set(output.split('\n').filter(Boolean))
}

function planChange(
  memoryRoot: string,
  operation: DreamOperation,
  changedAfterSnapshot: Set<string>,
  keptElsewhere: Set<string>,
): PendingChange | null {
  const { relativePath, tier } = classifyMemoryPath(operation.path)
  if (tier === 'archive') throw new Error('reflection does not write archives/')
  if (changedAfterSnapshot.has(relativePath)) {
    throw new Error('changed in memory after the reflection snapshot; skipped to avoid overwriting')
  }
  const existing = currentDocument(memoryRoot, relativePath)
  if (existing?.readOnly) throw new Error('read_only')
  if (operation.op === 'delete') {
    if (!existing) throw new Error('does not exist')
    return { relativePath, content: null, existed: true }
  }
  if (existing) assertKeepsExistingLines(existing.body, operation.body, keptElsewhere)
  const content = validateMemoryContent(
    relativePath,
    buildDocumentContent(operation.body, {
      description: operation.description,
      existingDescription: existing?.description,
      readOnly: existing?.readOnly,
      relativePath,
    }),
  )
  if (readCommittedMemoryFile(memoryRoot, relativePath) === content) return null
  return { relativePath, content, existed: existing !== null }
}

/**
 * Validates every proposed operation like a CLI write would and drops the ones
 * that fail or that race with newer commits. Writes nothing.
 */
export function planDreamOperations(options: {
  memoryRoot: string
  baseRevision: string
  operations: DreamOperation[]
}): { pending: PendingChange[]; rejected: string[] } {
  const { memoryRoot } = options
  const changedAfterSnapshot = changedSince(
    memoryRoot,
    options.baseRevision,
    getMemoryHeadRevision(memoryRoot),
  )
  const pending: PendingChange[] = []
  const rejected: string[] = []
  for (const operation of options.operations) {
    const keptElsewhere = new Set(
      options.operations.flatMap((other) =>
        other !== operation && other.op === 'write' ? contentLines(other.body) : [],
      ),
    )
    try {
      const change = planChange(memoryRoot, operation, changedAfterSnapshot, keptElsewhere)
      if (!change) continue
      if (pending.some((item) => item.relativePath === change.relativePath)) {
        throw new Error('proposed more than once')
      }
      pending.push(change)
    } catch (error) {
      rejected.push(`${operation.path}: ${error instanceof Error ? error.message : error}`)
    }
  }
  return { pending, rejected }
}

/** Applies the operations that pass {@link planDreamOperations} in one commit. */
export function applyDreamOperations(options: {
  memoryRoot: string
  baseRevision: string
  operations: DreamOperation[]
  message: string
}): ApplyDreamResult {
  const { memoryRoot } = options
  assertNoUnrelatedChanges(memoryRoot, [])
  const { pending, rejected } = planDreamOperations(options)
  if (pending.length === 0) return { committed: false, applied: [], rejected }

  const paths = pending.map((change) => change.relativePath)
  try {
    for (const change of pending) {
      if (change.content === null) deleteMemoryFile(memoryRoot, change.relativePath)
      else writeMemoryFile(memoryRoot, change.relativePath, change.content)
    }
    const result = commitMemoryPaths({ memoryRoot, relativePaths: paths, message: options.message })
    return { committed: result.committed, sha: result.sha, applied: paths, rejected }
  } catch (error) {
    for (const change of pending) {
      if (change.existed) {
        runGit(memoryRoot, ['checkout', 'HEAD', '--', change.relativePath], { allowFailure: true })
      } else {
        deleteMemoryFile(memoryRoot, change.relativePath)
      }
    }
    throw error
  }
}
