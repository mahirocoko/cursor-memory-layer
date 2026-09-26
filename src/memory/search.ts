import { listCommittedMemoryFiles, readCommittedMemoryFile } from './repository.ts'

export type MemorySearchMatch = {
  relativePath: string
  lineNumber: number
  line: string
  score: number
}

export function searchMemory(
  memoryRoot: string,
  query: string,
  options: { limit?: number; scope?: string } = {},
): MemorySearchMatch[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) throw new Error('Search query must not be empty.')

  const matches: MemorySearchMatch[] = []
  for (const relativePath of listCommittedMemoryFiles(memoryRoot, '')) {
    if (!relativePath.endsWith('.md')) continue
    if (options.scope && !relativePath.startsWith(options.scope)) continue
    const content = readCommittedMemoryFile(memoryRoot, relativePath)
    if (content === null) continue
    const pathText = relativePath.toLowerCase()
    content.split('\n').forEach((line, index) => {
      const lower = line.toLowerCase()
      const score = terms.filter((term) => lower.includes(term) || pathText.includes(term)).length
      if (score > 0 && line.trim() && line.trim() !== '---') {
        matches.push({ relativePath, lineNumber: index + 1, line: line.trim(), score })
      }
    })
  }
  return matches
    .sort(
      (left, right) =>
        right.score - left.score || left.relativePath.localeCompare(right.relativePath),
    )
    .slice(0, options.limit || 20)
}
