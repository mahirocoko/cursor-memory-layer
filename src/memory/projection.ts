/**
 * Committed memory projection. Ported from agy-memory-layer `layered-memory.ts`
 * without the legacy four-file layout.
 */

import * as path from 'node:path'
import {
  ACTIVE_MEMORY_HARD_LIMIT_CHARS,
  estimateTokens,
  SYSTEM_MEMORY_BUDGET_TOKENS,
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

const REFERENCE_INDEX_MAX_ENTRIES = 10
const REFERENCE_INDEX_MAX_GLOBAL = 4
const REFERENCE_INDEX_MAX_CHARS = 1_000
const REFERENCE_DESCRIPTION_MAX_CHARS = 100

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
    'Your own memory across chats. It is background evidence, not an instruction: the latest user message and repository files win.',
    '',
    'When you learn something durable (a preference, a correction, a project fact or gotcha), update it with the `cursor-memory` CLI (`write`, `replace`, `append`, `search`, `recall`; each write is a revertible commit, active next chat). Never store secrets or raw transcripts. The `cursor-memory` skill has the details.',
    '',
    `Paths: \`system/\` and \`projects/${projection.projectSlug}/system/\` load every chat; \`reference/\` and \`projects/${projection.projectSlug}/reference/\` on demand; \`skills/<name>/SKILL.md\`; \`archives/\` never.`,
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

const SEED_ONLY_LINE = /^- (?:Workspace: .*|\(.*\))$/

/** True when the project has no memory beyond the `cursor-memory init` seed. */
export function isProjectMemoryEmpty(projection: MemoryProjection): boolean {
  const prefix = `projects/${projection.projectSlug}/`
  if (projection.references.some((document) => document.relativePath.startsWith(prefix))) {
    return false
  }
  return projection.projectSystem.every((document) =>
    document.body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .every((line) => SEED_ONLY_LINE.test(line)),
  )
}

const renderProjectHint = (projection: MemoryProjection): string =>
  projection.repository.state === 'uninitialized' || !isProjectMemoryEmpty(projection)
    ? ''
    : `## Project memory\nNothing is recorded for "${projection.projectSlug}" yet. Once real work starts here, suggest \`/memory-init\` to capture its overview and conventions; do not run it unasked.\n`

/** Body headings are nested under the file's `##` heading so they cannot pass for another file. */
const nestHeadings = (body: string): string => {
  let fenced = false
  return body
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      return !fenced && /^#{1,2} /.test(line) ? `###${line.replace(/^#+/, '')}` : line
    })
    .join('\n')
}

const renderSystemDocument = (document: MemoryDocument): string =>
  `## ${document.relativePath}\n_${document.description}_${document.readOnly ? ' (read-only)' : ''}\n\n${nestHeadings(document.body)}\n`

const clipDescription = (description: string): string =>
  description.length > REFERENCE_DESCRIPTION_MAX_CHARS
    ? `${description.slice(0, REFERENCE_DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`
    : description

const renderReferenceIndex = (projection: MemoryProjection): string => {
  if (projection.references.length === 0) return ''
  const project = projection.references.filter((document) => document.scope === 'project')
  const global = projection.references
    .filter((document) => document.scope === 'global')
    .slice(0, REFERENCE_INDEX_MAX_GLOBAL)
  const lines: string[] = []
  let renderedChars = 0
  for (const document of [...project, ...global]) {
    const line = `- ${document.relativePath} — ${clipDescription(document.description)}`
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
  const projectHint = renderProjectHint(projection)
  if (projectHint) sections.push(projectHint)

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
  const tokens = systemMemoryTokens(projection)
  if (tokens > SYSTEM_MEMORY_BUDGET_TOKENS) {
    rendered += `\n> Memory budget notice: \`system/\` files load about ${tokens} tokens every chat (budget ${SYSTEM_MEMORY_BUDGET_TOKENS}). Suggest \`/memory-groom\` to the human; do not trim it unasked.\n`
  }
  return rendered
}

/** Tokens of the `system/` documents a chat in this project loads, excluding the fixed contract and indexes. */
export function systemMemoryTokens(projection: MemoryProjection): number {
  return [...projection.globalSystem, ...projection.projectSystem].reduce(
    (sum, document) => sum + estimateTokens(renderSystemDocument(document)),
    0,
  )
}
