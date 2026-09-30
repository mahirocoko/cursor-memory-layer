import { DREAM_SYSTEM_GROWTH_MAX_CHARS } from '../memory/config.ts'
import {
  assertSystemCoreSize,
  buildDocumentContent,
  currentDocument,
  validateMemoryContent,
} from '../memory/editor.ts'
import {
  assertNoUnrelatedChanges,
  commitMemoryPaths,
  deleteMemoryFile,
  getMemoryHeadRevision,
  readCommittedMemoryFile,
  runGit,
  writeMemoryFile,
} from '../memory/repository.ts'
import { assertRetained, contentLines } from '../memory/retention.ts'
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

type Draft = {
  relativePath: string
  tier: string
  committed: string | null
  committedBody: string | null
  description?: string
  readOnly: boolean
  body: string | null
  content: string | null
}

const addedText = (operation: DreamOperation): string =>
  operation.op === 'write' || operation.op === 'append'
    ? operation.body
    : operation.op === 'replace'
      ? operation.new
      : ''

const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1

function loadDraft(memoryRoot: string, relativePath: string, tier: string): Draft {
  const existing = currentDocument(memoryRoot, relativePath)
  if (existing?.readOnly) throw new Error('read_only')
  const committed = readCommittedMemoryFile(memoryRoot, relativePath)
  return {
    relativePath,
    tier,
    committed,
    committedBody: existing?.body ?? null,
    description: existing?.description,
    readOnly: existing?.readOnly ?? false,
    body: existing?.body ?? null,
    content: committed,
  }
}

function nextBody(draft: Draft, operation: DreamOperation): string | null {
  if (operation.op === 'delete') {
    if (draft.body === null) throw new Error('does not exist')
    return null
  }
  if (operation.op === 'write') return operation.body
  if (operation.op === 'append') {
    return draft.body ? `${draft.body.trimEnd()}\n${operation.body.trim()}` : operation.body
  }
  if (draft.body === null) throw new Error('does not exist')
  const matches = countOccurrences(draft.body, operation.old)
  if (matches !== 1) throw new Error(`old text matched ${matches} times; it must match once`)
  return draft.body.replace(operation.old, () => operation.new)
}

const systemGrowth = (drafts: Iterable<Draft>): number => {
  let growth = 0
  for (const draft of drafts) {
    if (draft.tier !== 'system') continue
    growth += (draft.content?.length ?? 0) - (draft.committed?.length ?? 0)
  }
  return growth
}

/**
 * Validates every proposed operation like a CLI write would and drops the ones
 * that fail, that race with newer commits, or that grow `system/` past
 * {@link DREAM_SYSTEM_GROWTH_MAX_CHARS}. Operations on one file apply in order.
 * Writes nothing.
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
  const drafts = new Map<string, Draft>()
  const rejected: string[] = []
  for (const operation of options.operations) {
    const keptElsewhere = new Set(
      options.operations.flatMap((other) =>
        other !== operation ? contentLines(addedText(other)) : [],
      ),
    )
    try {
      const { relativePath, tier } = classifyMemoryPath(operation.path)
      if (tier === 'archive') throw new Error('reflection does not write archives/')
      if (changedAfterSnapshot.has(relativePath)) {
        throw new Error(
          'changed in memory after the reflection snapshot; skipped to avoid overwriting',
        )
      }
      const draft = drafts.get(relativePath) ?? loadDraft(memoryRoot, relativePath, tier)
      const body = nextBody(draft, operation)
      if (body !== null && draft.committedBody !== null) {
        assertKeepsExistingLines(draft.committedBody, body, keptElsewhere)
      }
      if (tier === 'system' && draft.committedBody !== null) {
        assertRetained({
          memoryRoot,
          relativePath,
          before: draft.committedBody,
          after: body ?? '',
          alsoKept: options.operations
            .filter((other) => other !== operation)
            .map(addedText)
            .join('\n'),
        })
      }
      const content =
        body === null
          ? null
          : validateMemoryContent(
              relativePath,
              buildDocumentContent(body, {
                description: 'description' in operation ? operation.description : undefined,
                existingDescription: draft.description,
                readOnly: draft.readOnly,
                relativePath,
              }),
            )
      if (tier === 'system') {
        const overlays = new Map<string, string | null>()
        for (const pendingDraft of drafts.values()) {
          if (pendingDraft.tier === 'system') {
            overlays.set(pendingDraft.relativePath, pendingDraft.content)
          }
        }
        overlays.set(relativePath, content)
        assertSystemCoreSize(memoryRoot, overlays)
      }
      const next = new Map(drafts).set(relativePath, { ...draft, body, content })
      const growth = systemGrowth(next.values())
      if (tier === 'system' && growth > DREAM_SYSTEM_GROWTH_MAX_CHARS) {
        throw new Error(
          `would grow system/ by ${growth} characters in one reflection (limit ${DREAM_SYSTEM_GROWTH_MAX_CHARS}); put detail in reference/`,
        )
      }
      drafts.set(relativePath, { ...draft, body, content })
    } catch (error) {
      rejected.push(`${operation.path}: ${error instanceof Error ? error.message : error}`)
    }
  }
  const pending = [...drafts.values()]
    .filter((draft) => draft.content !== draft.committed)
    .map((draft) => ({
      relativePath: draft.relativePath,
      content: draft.content,
      existed: draft.committed !== null,
    }))
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
