/**
 * Memory document frontmatter. Ported from agy-memory-layer `layered-memory.ts`.
 * Only `description` (required) and `read_only` are accepted, plus `name` in
 * `skills/<name>/SKILL.md`.
 */

import { isSkillEntryPath } from './scope.ts'

export type ParsedMemoryDocument = {
  description: string
  body: string
  readOnly: boolean
  name?: string
  diagnostics: string[]
}

const FRONTMATTER_KEYS = new Set(['description', 'read_only'])
const SKILL_FRONTMATTER_KEYS = new Set(['name', 'description', 'read_only'])

const stripSimpleQuotes = (value: string): string => {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export const hasFrontmatter = (content: string): boolean => content.startsWith('---\n')

export function parseMemoryDocument(content: string, relativePath: string): ParsedMemoryDocument {
  const normalized = content.replace(/\r\n/g, '\n')
  const diagnostics: string[] = []
  if (!hasFrontmatter(normalized)) {
    return {
      description: '',
      body: '',
      readOnly: false,
      diagnostics: [`${relativePath}: missing required description frontmatter.`],
    }
  }

  const closingIndex = normalized.indexOf('\n---', 3)
  const afterClosing = normalized.slice(closingIndex + 4)
  if (closingIndex < 0 || (afterClosing !== '' && !afterClosing.startsWith('\n'))) {
    return {
      description: '',
      body: '',
      readOnly: false,
      diagnostics: [`${relativePath}: frontmatter is not closed.`],
    }
  }

  const skillEntry = isSkillEntryPath(relativePath)
  const allowedKeys = skillEntry ? SKILL_FRONTMATTER_KEYS : FRONTMATTER_KEYS
  const values = new Map<string, string>()
  for (const line of normalized.slice(4, closingIndex).split('\n')) {
    if (!line.trim()) continue
    if (/^\s/.test(line)) {
      diagnostics.push(`${relativePath}: multiline frontmatter is not supported.`)
      continue
    }
    const separator = line.indexOf(':')
    if (separator <= 0) {
      diagnostics.push(`${relativePath}: malformed frontmatter line "${line}".`)
      continue
    }
    const key = line.slice(0, separator).trim()
    const value = stripSimpleQuotes(line.slice(separator + 1).trim())
    if (!allowedKeys.has(key)) {
      diagnostics.push(`${relativePath}: unknown frontmatter key "${key}".`)
      continue
    }
    if (values.has(key)) {
      diagnostics.push(`${relativePath}: duplicate frontmatter key "${key}".`)
      continue
    }
    values.set(key, value)
  }

  const description = values.get('description') || ''
  if (!description) diagnostics.push(`${relativePath}: description must not be empty.`)
  const readOnlyValue = values.get('read_only')
  if (readOnlyValue !== undefined && readOnlyValue !== 'true' && readOnlyValue !== 'false') {
    diagnostics.push(`${relativePath}: read_only must be true or false.`)
  }
  const name = values.get('name')
  if (skillEntry) {
    const expected = relativePath.split('/')[1]
    if (name !== expected) diagnostics.push(`${relativePath}: name must be "${expected}".`)
  }

  return {
    description,
    body: diagnostics.length > 0 ? '' : afterClosing.trim(),
    readOnly: readOnlyValue === 'true',
    ...(name ? { name } : {}),
    diagnostics,
  }
}

export function renderMemoryDocument(document: {
  description: string
  body: string
  readOnly?: boolean
  name?: string
}): string {
  const description = document.description.replace(/\s+/g, ' ').trim()
  if (!description) throw new Error('Memory description must not be empty.')
  const lines = ['---']
  if (document.name) lines.push(`name: ${document.name}`)
  lines.push(`description: ${description}`)
  if (document.readOnly) lines.push('read_only: true')
  lines.push('---', '', document.body.trim(), '')
  return lines.join('\n')
}
