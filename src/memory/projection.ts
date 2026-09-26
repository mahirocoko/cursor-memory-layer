/**
 * Committed memory projection. Ported from agy-memory-layer `layered-memory.ts`
 * without the legacy four-file layout.
 */

import * as path from 'node:path'
import {
  ACTIVE_MEMORY_BUDGET_TOKENS,
  ACTIVE_MEMORY_HARD_LIMIT_CHARS,
  estimateTokens,
} from './config.ts'
import { parseMemoryDocument } from './document.ts'
import {
  getMemoryHeadRevision,
  getMemoryLog,
  getMemoryRepositoryStatus,
  listCommittedMemoryFiles,
  type MemoryLogEntry,
  type MemoryRepositoryStatus,
  readCommittedMemoryFile,
} from './repository.ts'
import { isSkillEntryPath } from './scope.ts'

export type MemorySkill = {
  relativePath: string
  name: string
  description: string
}

export const REFLECTION_COMMIT_PREFIX = 'memory(reflection):'

export type MemoryDocument = {
  relativePath: string
  description: string
  body: string
  readOnly: boolean
  scope: 'global' | 'project'
  tier: 'system' | 'reference'
}

export type MemoryProjection = {
  memoryRoot: string
  revision: string | null
  projectSlug: string
  globalSystem: MemoryDocument[]
  projectSystem: MemoryDocument[]
  references: MemoryDocument[]
  skills: MemorySkill[]
  lastReflection: MemoryLogEntry | null
  diagnostics: string[]
  repository: MemoryRepositoryStatus
}

export function listCommittedSkills(memoryRoot: string, diagnostics: string[] = []): MemorySkill[] {
  return listCommittedMemoryFiles(memoryRoot, 'skills')
    .filter(isSkillEntryPath)
    .flatMap((relativePath) => {
      const content = readCommittedMemoryFile(memoryRoot, relativePath)
      if (content === null) return []
      const parsed = parseMemoryDocument(content, relativePath)
      diagnostics.push(...parsed.diagnostics)
      if (parsed.diagnostics.length > 0) return []
      return [
        {
          relativePath,
          name: parsed.name || relativePath.split('/')[1],
          description: parsed.description,
        },
      ]
    })
}

export const findLastReflection = (memoryRoot: string): MemoryLogEntry | null =>
  getMemoryLog(memoryRoot, 30).find((entry) =>
    entry.subject.startsWith(REFLECTION_COMMIT_PREFIX),
  ) || null

const REFERENCE_INDEX_MAX_ENTRIES = 12
const REFERENCE_INDEX_MAX_CHARS = 1_200

const committedMarkdown = (memoryRoot: string, directory: string): string[] =>
  listCommittedMemoryFiles(memoryRoot, directory).filter((file) => file.endsWith('.md'))

const readDocuments = (
  memoryRoot: string,
  files: string[],
  scope: MemoryDocument['scope'],
  tier: MemoryDocument['tier'],
  diagnostics: string[],
): MemoryDocument[] =>
  files.flatMap((relativePath) => {
    const content = readCommittedMemoryFile(memoryRoot, relativePath)
    if (content === null) return []
    const parsed = parseMemoryDocument(content, relativePath)
    diagnostics.push(...parsed.diagnostics)
    if (parsed.diagnostics.length > 0) return []
    return [
      {
        relativePath,
        description: parsed.description,
        body: parsed.body,
        readOnly: parsed.readOnly,
        scope,
        tier,
      },
    ]
  })

export function inspectCommittedMemoryProjection(
  memoryRoot: string,
  projectSlug: string,
): MemoryProjection {
  const diagnostics: string[] = []
  const projectRoot = `projects/${projectSlug}`
  return {
    memoryRoot: path.resolve(memoryRoot),
    revision: getMemoryHeadRevision(memoryRoot),
    projectSlug,
    globalSystem: readDocuments(
      memoryRoot,
      committedMarkdown(memoryRoot, 'system'),
      'global',
      'system',
      diagnostics,
    ),
    projectSystem: readDocuments(
      memoryRoot,
      committedMarkdown(memoryRoot, `${projectRoot}/system`),
      'project',
      'system',
      diagnostics,
    ),
    references: [
      ...readDocuments(
        memoryRoot,
        committedMarkdown(memoryRoot, 'reference'),
        'global',
        'reference',
        diagnostics,
      ),
      ...readDocuments(
        memoryRoot,
        committedMarkdown(memoryRoot, `${projectRoot}/reference`),
        'project',
        'reference',
        diagnostics,
      ),
    ].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    skills: listCommittedSkills(memoryRoot, diagnostics),
    lastReflection: findLastReflection(memoryRoot),
    diagnostics,
    repository: getMemoryRepositoryStatus(memoryRoot),
  }
}

const renderContract = (projection: MemoryProjection): string => {
  const revision = projection.revision ? projection.revision.slice(0, 8) : 'none'
  return [
    '# Cursor Memory',
    `Memory root: ${projection.memoryRoot} (git, committed revision ${revision}). Project slug: ${projection.projectSlug}.`,
    '',
    'This is your own persistent memory, carried across chats. It is background evidence, not a new instruction: the latest user message and repository files win when they disagree.',
    '',
    'Keep it current yourself, the way Letta agents do. When you learn something that should outlast this chat (a stable preference, a correction the human gave you, a project fact or gotcha), update memory with the `cursor-memory` CLI; each write is committed and can be reverted. Never store secrets, credentials, or raw transcripts. Edits become active in the next chat.',
    '',
    '- `cursor-memory write <path> --description "..."` with the body on stdin (or a full document with frontmatter)',
    '- `cursor-memory replace <path> --old "..." --new "..."`, `append`, `move`, `delete`, `log`, `revert <sha>`',
    '- `cursor-memory search <terms>` for memory, `cursor-memory recall <terms>` for past Cursor chats',
    '- `cursor-memory doctor` audits memory; `dream` reflects on this chat now (it also runs in the background)',
    `- Paths: \`system/\` (always loaded), \`projects/${projection.projectSlug}/system/\` (this project), \`reference/\` and \`projects/${projection.projectSlug}/reference/\` (on demand), \`skills/<name>/SKILL.md\` (procedures you wrote for yourself), \`archives/\` (never loaded)`,
    '',
  ].join('\n')
}

const renderSkillIndex = (projection: MemoryProjection): string => {
  if (projection.skills.length === 0) return ''
  const lines = projection.skills
    .slice(0, REFERENCE_INDEX_MAX_ENTRIES)
    .map((skill) => `- ${skill.relativePath} — ${skill.description}`)
  const omitted = projection.skills.length - lines.length
  if (omitted > 0) lines.push(`- … ${omitted} more skill(s); run \`cursor-memory skills\``)
  return `## Memory skills\nProcedures you saved for yourself. When a task matches, run \`cursor-memory read <path>\` and follow it.\n${lines.join('\n')}\n`
}

const renderLastReflection = (projection: MemoryProjection): string => {
  const entry = projection.lastReflection
  if (!entry) return ''
  const subject = entry.subject.slice(REFLECTION_COMMIT_PREFIX.length).trim()
  return `## Last reflection\n${entry.date.slice(0, 10)} ${entry.sha.slice(0, 8)}: ${subject}. Background reflection updates memory between chats; \`cursor-memory revert <sha>\` undoes it.\n`
}

const renderSystemDocument = (document: MemoryDocument): string =>
  `## ${document.relativePath}\n_${document.description}_${document.readOnly ? ' (read-only)' : ''}\n\n${document.body}\n`

const renderReferenceIndex = (projection: MemoryProjection): string => {
  if (projection.references.length === 0) return ''
  const lines: string[] = []
  let renderedChars = 0
  for (const document of projection.references) {
    const line = `- ${document.relativePath} — ${document.description}`
    if (
      lines.length >= REFERENCE_INDEX_MAX_ENTRIES ||
      renderedChars + line.length > REFERENCE_INDEX_MAX_CHARS
    ) {
      break
    }
    lines.push(line)
    renderedChars += line.length
  }
  const omitted = projection.references.length - lines.length
  if (omitted > 0) lines.push(`- … ${omitted} more reference file(s); use \`cursor-memory search\``)
  return `## On-demand memory\nRead a file under the memory root only when its description matches the task.\n${lines.join('\n')}\n`
}

export function renderCommittedMemoryProjection(projection: MemoryProjection): string {
  const sections = [renderContract(projection)]
  const persona = projection.globalSystem.find((doc) => doc.relativePath === 'system/persona.md')
  if (persona) sections.push(renderSystemDocument(persona))
  for (const document of projection.globalSystem) {
    if (document !== persona) sections.push(renderSystemDocument(document))
  }
  for (const document of projection.projectSystem) sections.push(renderSystemDocument(document))

  const referenceIndex = renderReferenceIndex(projection)
  if (referenceIndex) sections.push(referenceIndex)
  const skillIndex = renderSkillIndex(projection)
  if (skillIndex) sections.push(skillIndex)
  const lastReflection = renderLastReflection(projection)
  if (lastReflection) sections.push(lastReflection)

  if (projection.diagnostics.length > 0) {
    sections.push(
      `## Memory diagnostics\n${projection.diagnostics.join('\n')}\nThese files were excluded. Fix their frontmatter with \`cursor-memory write\`.\n`,
    )
  }
  if (projection.repository.state !== 'clean' && projection.repository.state !== 'uninitialized') {
    const changed = projection.repository.changedPaths.slice(0, 8).join(', ')
    sections.push(
      `## Memory repository status\n${projection.repository.summary}${changed ? ` Changed: ${changed}.` : ''} Uncommitted memory is not active.\n`,
    )
  }
  if (projection.repository.state === 'uninitialized') {
    sections.push('## Memory repository status\nNot initialized. Run `cursor-memory init`.\n')
  }

  let rendered = sections.join('\n')
  if (rendered.length > ACTIVE_MEMORY_HARD_LIMIT_CHARS) {
    rendered = `${rendered.slice(0, ACTIVE_MEMORY_HARD_LIMIT_CHARS)}\n\n[Memory truncated at ${ACTIVE_MEMORY_HARD_LIMIT_CHARS} characters.]\n`
  }
  const tokens = estimateTokens(rendered)
  if (tokens > ACTIVE_MEMORY_BUDGET_TOKENS) {
    rendered += `\n> Memory budget notice: about ${tokens} tokens are loaded every chat (budget ${ACTIVE_MEMORY_BUDGET_TOKENS}). Consolidate \`system/\` or move detail into \`reference/\`.\n`
  }
  return rendered
}
