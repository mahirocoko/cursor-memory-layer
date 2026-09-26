import * as fs from 'node:fs'
import { hasFrontmatter, parseMemoryDocument, renderMemoryDocument } from './document.ts'
import {
  assertNoUnrelatedChanges,
  type CommitMemoryPathsResult,
  commitMemoryPaths,
  deleteMemoryFile,
  readCommittedMemoryFile,
  resolveMemoryPath,
  revertMemoryCommit,
  writeMemoryFile,
} from './repository.ts'
import { assertRetained } from './retention.ts'
import { classifyMemoryPath, isSkillEntryPath, requiresFrontmatter } from './scope.ts'
import { assertNoSecrets } from './secrets.ts'

const SKILL_FILE_MAX_CHARS = 20_000

export type EditOptions = {
  memoryRoot: string
  message?: string
  force?: boolean
  /** Lines the human agreed to remove from `system/`; see {@link assertRetained}. */
  drop?: string[]
}

const withDropNote = (message: string, drop?: string[]): string =>
  drop && drop.length > 0
    ? `${message}\n\nDropped on purpose:\n${drop.map((line) => `- ${line}`).join('\n')}`
    : message

export type EditResult = CommitMemoryPathsResult & {
  paths: string[]
}

export const currentDocument = (memoryRoot: string, relativePath: string) => {
  const content = readCommittedMemoryFile(memoryRoot, relativePath)
  if (content === null) return null
  if (!requiresFrontmatter(relativePath)) {
    return { description: '', body: content.trim(), readOnly: false, diagnostics: [] as string[] }
  }
  return parseMemoryDocument(content, relativePath)
}

const assertWritable = (memoryRoot: string, relativePath: string, force?: boolean): void => {
  if (force) return
  if (currentDocument(memoryRoot, relativePath)?.readOnly) {
    throw new Error(
      `${relativePath} is read_only. Ask the human before changing it, then pass --force.`,
    )
  }
}

export function validateMemoryContent(relativePath: string, content: string): string {
  const scope = classifyMemoryPath(relativePath)
  if (requiresFrontmatter(relativePath)) {
    const parsed = parseMemoryDocument(content, relativePath)
    if (parsed.diagnostics.length > 0) throw new Error(parsed.diagnostics.join('\n'))
    if (!parsed.body)
      throw new Error(`${relativePath}: body must not be empty. Use delete instead.`)
  } else if (!content.trim()) {
    throw new Error(`${relativePath}: content must not be empty. Use delete instead.`)
  }
  if (scope.tier === 'skill' && content.length > SKILL_FILE_MAX_CHARS) {
    throw new Error(
      `${relativePath} is ${content.length} characters; skill files are limited to ${SKILL_FILE_MAX_CHARS}.`,
    )
  }
  assertNoSecrets(content, relativePath)
  return content.endsWith('\n') ? content : `${content}\n`
}

const validateDocument = validateMemoryContent

const commitOwned = (memoryRoot: string, paths: string[], message: string): EditResult => ({
  ...commitMemoryPaths({ memoryRoot, relativePaths: paths, message }),
  paths,
})

export function buildDocumentContent(
  input: string,
  options: {
    description?: string
    readOnly?: boolean
    existingDescription?: string
    relativePath?: string
  },
): string {
  const normalized = input.replace(/\r\n/g, '\n')
  if (options.relativePath && !requiresFrontmatter(options.relativePath)) return normalized
  if (hasFrontmatter(normalized)) return normalized
  const description = options.description || options.existingDescription
  if (!description) {
    throw new Error('Provide --description, or send a full document with frontmatter on stdin.')
  }
  const name =
    options.relativePath && isSkillEntryPath(options.relativePath)
      ? options.relativePath.split('/')[1]
      : undefined
  return renderMemoryDocument({ description, body: input, readOnly: options.readOnly, name })
}

export function writeMemory(
  path: string,
  input: string,
  options: EditOptions & { description?: string; readOnly?: boolean },
): EditResult {
  const { relativePath, tier } = classifyMemoryPath(path)
  assertNoUnrelatedChanges(options.memoryRoot, [relativePath])
  assertWritable(options.memoryRoot, relativePath, options.force)
  const existing = currentDocument(options.memoryRoot, relativePath)
  const content = validateDocument(
    relativePath,
    buildDocumentContent(input, {
      description: options.description,
      readOnly: options.readOnly ?? existing?.readOnly,
      existingDescription: existing?.description,
      relativePath,
    }),
  )
  if (tier === 'system' && existing) {
    assertRetained({
      memoryRoot: options.memoryRoot,
      relativePath,
      before: existing.body,
      after: parseMemoryDocument(content, relativePath).body,
      allowed: options.drop,
    })
  }
  writeMemoryFile(options.memoryRoot, relativePath, content)
  return commitOwned(
    options.memoryRoot,
    [relativePath],
    withDropNote(
      options.message || `memory: ${existing ? 'update' : 'create'} ${relativePath}`,
      options.drop,
    ),
  )
}

export function appendMemory(
  path: string,
  text: string,
  options: EditOptions & { description?: string },
): EditResult {
  const { relativePath } = classifyMemoryPath(path)
  const addition = text.trim()
  if (!addition) throw new Error('Nothing to append.')
  const existing = currentDocument(options.memoryRoot, relativePath)
  if (existing && existing.diagnostics.length > 0) throw new Error(existing.diagnostics.join('\n'))
  const listItem = /^\s*(?:[-*+]|\d+\.)\s/
  const lastLine = existing?.body.split('\n').at(-1) || ''
  const separator = listItem.test(addition) && listItem.test(lastLine) ? '\n' : '\n\n'
  const body = existing ? `${existing.body}${separator}${addition}` : addition
  return writeMemory(relativePath, body, {
    ...options,
    description: options.description || existing?.description,
    message: options.message || `memory: append to ${relativePath}`,
  })
}

export function replaceInMemory(
  path: string,
  oldText: string,
  newText: string,
  options: EditOptions,
): EditResult {
  const { relativePath } = classifyMemoryPath(path)
  if (!oldText) throw new Error('--old must not be empty.')
  const content = readCommittedMemoryFile(options.memoryRoot, relativePath)
  if (content === null) throw new Error(`${relativePath} does not exist in committed memory.`)
  const occurrences = content.split(oldText).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `--old must match exactly once in ${relativePath}; it matched ${occurrences} time(s).`,
    )
  }
  return writeMemory(
    relativePath,
    content.replace(oldText, () => newText),
    {
      ...options,
      message: options.message || `memory: edit ${relativePath}`,
    },
  )
}

export function moveMemory(from: string, to: string, options: EditOptions): EditResult {
  const source = classifyMemoryPath(from).relativePath
  const target = classifyMemoryPath(to).relativePath
  if (source === target) throw new Error('Source and target are the same path.')
  assertNoUnrelatedChanges(options.memoryRoot, [source, target])
  assertWritable(options.memoryRoot, source, options.force)
  const content = readCommittedMemoryFile(options.memoryRoot, source)
  if (content === null) throw new Error(`${source} does not exist in committed memory.`)
  if (fs.existsSync(resolveMemoryPath(options.memoryRoot, target).absolutePath)) {
    throw new Error(`${target} already exists.`)
  }
  writeMemoryFile(options.memoryRoot, target, validateDocument(target, content))
  deleteMemoryFile(options.memoryRoot, source)
  return commitOwned(
    options.memoryRoot,
    [source, target],
    options.message || `memory: move ${source} -> ${target}`,
  )
}

export function deleteMemory(path: string, options: EditOptions): EditResult {
  const { relativePath, tier } = classifyMemoryPath(path)
  assertNoUnrelatedChanges(options.memoryRoot, [relativePath])
  assertWritable(options.memoryRoot, relativePath, options.force)
  const existing = currentDocument(options.memoryRoot, relativePath)
  if (!existing) throw new Error(`${relativePath} does not exist in committed memory.`)
  if (tier === 'system') {
    assertRetained({
      memoryRoot: options.memoryRoot,
      relativePath,
      before: existing.body,
      after: '',
      allowed: options.drop,
    })
  }
  deleteMemoryFile(options.memoryRoot, relativePath)
  return commitOwned(
    options.memoryRoot,
    [relativePath],
    withDropNote(options.message || `memory: delete ${relativePath}`, options.drop),
  )
}

export function revertMemory(revision: string, options: EditOptions): EditResult {
  return { ...revertMemoryCommit(options.memoryRoot, revision), paths: [] }
}
