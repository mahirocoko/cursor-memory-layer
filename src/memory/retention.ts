/**
 * Retention guard for always-loaded memory. Shrinking `system/` is how memory
 * gets groomed, and also how facts get lost; a line may leave a `system/` file
 * only if it survives somewhere else in committed memory or is dropped on purpose.
 */

import { listCommittedMemoryFiles, readCommittedMemoryFile } from './repository.ts'

/** Removing up to this many unique lines passes, so a one-line correction needs no flag. */
export const FREE_LOST_LINES = 2
const MIN_TRACKED_LINE_CHARS = 12

export const normalizeLine = (line: string): string =>
  line
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()

export const contentLines = (body: string): string[] =>
  body
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line && !line.startsWith('#') && line !== '(nothing recorded yet)')

const normalizedText = (body: string): string => contentLines(body).join('\n')

/**
 * Lines of `before` that are gone from `after` and from every other committed
 * memory file (plus `alsoKept`, text written elsewhere in the same change).
 */
export function findLostLines(options: {
  memoryRoot: string
  relativePath: string
  before: string
  after: string
  allowed?: string[]
  alsoKept?: string
}): string[] {
  const after = normalizedText(options.after)
  const allowed = new Set((options.allowed ?? []).map(normalizeLine))
  const dropped = contentLines(options.before).filter(
    (line) => line.length >= MIN_TRACKED_LINE_CHARS && !after.includes(line) && !allowed.has(line),
  )
  if (dropped.length === 0) return []
  const elsewhere = [
    normalizedText(options.alsoKept ?? ''),
    ...listCommittedMemoryFiles(options.memoryRoot, '')
      .filter((file) => file !== options.relativePath && file.endsWith('.md'))
      .map((file) => normalizedText(readCommittedMemoryFile(options.memoryRoot, file) ?? '')),
  ].join('\n')
  return [...new Set(dropped.filter((line) => !elsewhere.includes(line)))]
}

export function assertRetained(options: Parameters<typeof findLostLines>[0]): void {
  const lost = findLostLines(options)
  if (lost.length <= FREE_LOST_LINES) return
  const shown = lost.slice(0, 8).map((line) => `  - ${line}`)
  if (lost.length > shown.length) shown.push(`  - … ${lost.length - shown.length} more`)
  throw new Error(
    `${options.relativePath}: this change would lose ${lost.length} lines that exist nowhere else in memory:\n${shown.join('\n')}\nMove them into reference/ first (verbatim), or pass --drop "<line>" for each line the human agreed to remove.`,
  )
}
