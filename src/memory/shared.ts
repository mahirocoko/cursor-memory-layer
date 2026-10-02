import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { SYSTEM_FILE_MAX_CHARS } from './config.ts'
import { parseMemoryDocument } from './document.ts'
import type { MemoryDocument } from './projection.ts'
import { getMemoryHeadRevision, isWithin } from './repository.ts'
import { findSecretLikeContent } from './secrets.ts'
import {
  FIXED_SHARED_OWNER,
  isSharedOwnerPath,
  NATIVE_COMMUNICATION_PATH,
  type SharedReadSettings,
} from './settings.ts'

export { FIXED_SHARED_OWNER, isSharedOwnerPath, NATIVE_COMMUNICATION_PATH }

export type SharedSourceInspection = {
  enabled: boolean
  sourceRoot: string | null
  sharedOwner: string
  valid: boolean
  pinnedSha: string | null
  diagnostics: string[]
  content: string | null
  document: MemoryDocument | null
}

export type Proposal = {
  id: string
  createdAt: string
  targetPath: string
  operation: 'write' | 'append' | 'replace' | 'delete'
  sourceSha: string | null
  nativeOrigin: {
    commitSha: string | null
    relativePath: string
    message?: string
  }
  content: string
  description?: string
  status: 'pending'
}

export type ProposalWithStale = Proposal & {
  isStale: boolean
  currentSourceSha: string | null
}

/** Check whether a directory is a Git repository without throwing. */
export function isGitRepository(dirPath: string): boolean {
  try {
    const res = execFileSync('git', ['-C', dirPath, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return res.trim() === 'true'
  } catch {
    return false
  }
}

/** Get the current HEAD SHA of a source repo. */
export function getSourceHeadSha(sourceRoot: string): string | null {
  try {
    const res = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const sha = res.trim()
    return /^[a-f0-9]{40}$/.test(sha) ? sha : null
  } catch {
    return null
  }
}

/** Inspects and validates the shared source Git repository. */
export function inspectSharedSource(
  settings: SharedReadSettings,
  memoryRoot?: string,
): SharedSourceInspection {
  const diagnostics: string[] = []

  if (!settings.enabled) {
    return {
      enabled: false,
      sourceRoot: settings.sourceRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics: [],
      content: null,
      document: null,
    }
  }

  if (!settings.sourceRoot?.trim()) {
    diagnostics.push('sharedRead is enabled but sourceRoot is not set.')
    return {
      enabled: true,
      sourceRoot: null,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const resolvedRoot = path.resolve(settings.sourceRoot.trim())

  if (!fs.existsSync(resolvedRoot)) {
    diagnostics.push(`Shared sourceRoot "${resolvedRoot}" does not exist.`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  let realRoot: string
  try {
    realRoot = fs.realpathSync(resolvedRoot)
  } catch (err) {
    diagnostics.push(`Failed to resolve real path for sourceRoot "${resolvedRoot}": ${err}`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  if (!fs.statSync(realRoot).isDirectory()) {
    diagnostics.push(`Shared sourceRoot "${resolvedRoot}" is not a directory.`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  // Validate that sourceRoot is distinct from memoryRoot (not self-referential or parent/subtree)
  if (memoryRoot) {
    let realMemRoot: string
    try {
      realMemRoot = fs.existsSync(memoryRoot)
        ? fs.realpathSync(memoryRoot)
        : path.resolve(memoryRoot)
    } catch {
      realMemRoot = path.resolve(memoryRoot)
    }

    if (realRoot === realMemRoot) {
      diagnostics.push(
        `Shared sourceRoot "${resolvedRoot}" is the same as the native memory root; sourceRoot must be a distinct source Git repository.`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha: null,
        diagnostics,
        content: null,
        document: null,
      }
    }

    if (isWithin(realMemRoot, realRoot) || isWithin(realRoot, realMemRoot)) {
      diagnostics.push(
        `Shared sourceRoot "${resolvedRoot}" must be an independent distinct Git repository, not a parent or subtree of native memory.`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha: null,
        diagnostics,
        content: null,
        document: null,
      }
    }
  }

  if (!isGitRepository(realRoot)) {
    diagnostics.push(`Shared sourceRoot "${resolvedRoot}" is not a Git repository.`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  // Validate that sourceRoot is the actual top-level Git root, not a subdirectory
  try {
    const toplevel = execFileSync('git', ['-C', realRoot, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    let realToplevel: string
    try {
      realToplevel = fs.realpathSync(toplevel)
    } catch {
      realToplevel = path.resolve(toplevel)
    }
    if (realToplevel !== realRoot) {
      diagnostics.push(
        `Shared sourceRoot "${resolvedRoot}" is not a Git repository root (toplevel is "${toplevel}").`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha: null,
        diagnostics,
        content: null,
        document: null,
      }
    }
  } catch (err) {
    diagnostics.push(`Failed to verify Git toplevel for "${resolvedRoot}": ${err}`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const pinnedSha = getSourceHeadSha(realRoot)
  if (!pinnedSha) {
    diagnostics.push(
      `Shared sourceRoot "${resolvedRoot}" has no committed HEAD revision or is empty.`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha: null,
      diagnostics,
      content: null,
      document: null,
    }
  }

  // Check if file is a symlink in Git commit:
  try {
    const lsTreeOut = execFileSync(
      'git',
      ['-C', realRoot, 'ls-tree', pinnedSha, FIXED_SHARED_OWNER],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()

    if (!lsTreeOut) {
      diagnostics.push(
        `Shared owner "${FIXED_SHARED_OWNER}" not found at committed revision ${pinnedSha.slice(0, 8)}.`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha,
        diagnostics,
        content: null,
        document: null,
      }
    }

    const mode = lsTreeOut.split(/\s+/)[0]
    if (mode === '120000') {
      diagnostics.push(
        `Shared owner "${FIXED_SHARED_OWNER}" at revision ${pinnedSha.slice(0, 8)} is a symbolic link; symlink escape is rejected.`,
      )
      return {
        enabled: true,
        sourceRoot: resolvedRoot,
        sharedOwner: FIXED_SHARED_OWNER,
        valid: false,
        pinnedSha,
        diagnostics,
        content: null,
        document: null,
      }
    }
  } catch (err) {
    diagnostics.push(`Failed to inspect Git tree in "${resolvedRoot}": ${err}`)
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  // Read committed source content only (never dirty working directory):
  let rawContent: string
  try {
    rawContent = execFileSync(
      'git',
      ['-C', realRoot, 'show', `${pinnedSha}:${FIXED_SHARED_OWNER}`],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch (err) {
    diagnostics.push(
      `Failed to read committed content for "${FIXED_SHARED_OWNER}" at revision ${pinnedSha.slice(0, 8)}: ${err}`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  if (rawContent.length > SYSTEM_FILE_MAX_CHARS) {
    diagnostics.push(
      `Shared owner "${FIXED_SHARED_OWNER}" exceeds ${SYSTEM_FILE_MAX_CHARS} characters (${rawContent.length}).`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const secrets = findSecretLikeContent(rawContent)
  if (secrets.length > 0) {
    diagnostics.push(
      `Shared owner "${FIXED_SHARED_OWNER}" contains secret-like content: ${secrets.join(', ')}.`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  const parsed = parseMemoryDocument(rawContent, FIXED_SHARED_OWNER)
  if (parsed.diagnostics.length > 0) {
    diagnostics.push(
      `Shared owner "${FIXED_SHARED_OWNER}" has malformed document frontmatter: ${parsed.diagnostics.join('; ')}.`,
    )
    return {
      enabled: true,
      sourceRoot: resolvedRoot,
      sharedOwner: FIXED_SHARED_OWNER,
      valid: false,
      pinnedSha,
      diagnostics,
      content: null,
      document: null,
    }
  }

  return {
    enabled: true,
    sourceRoot: resolvedRoot,
    sharedOwner: FIXED_SHARED_OWNER,
    valid: true,
    pinnedSha,
    diagnostics: [],
    content: rawContent,
    document: {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: parsed.description,
      body: parsed.body,
      readOnly: true,
      scope: 'global',
      tier: 'system',
    },
  }
}

const SEED_ONLY_LINE = /^- (?:Workspace: .*|\(.*\))$/

function isSeedOnly(body: string): boolean {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length === 0 || lines.every((l) => SEED_ONLY_LINE.test(l))
}

function stripImportPreamble(body: string): string {
  // Strip import-only provenance preamble, e.g.:
  // "Imported from Mahiro Code (`agent-local-...`) `human/prefs/communication.md`. Letta remains the source; this is the Cursor copy."
  return body
    .replace(/^\s*Imported from (?:Mahiro Code|Letta|agent-local).*?(?:\n\s*\n|$)/is, '')
    .trim()
}

const MD_HEADING_REGEX = /^(#{1,6})\s+([^\n]+)$/
const COLON_HEADING_REGEX = /^[A-Za-z0-9][A-Za-z0-9\s/—()'-]+:\s*$/

function isHeadingLine(line: string): { isHeading: boolean; headingText?: string } {
  const trimmed = line.trim()
  if (MD_HEADING_REGEX.test(trimmed)) {
    return { isHeading: true, headingText: trimmed }
  }
  if (
    COLON_HEADING_REGEX.test(trimmed) &&
    !/^\s*(?:[-*+]|\d+\.)\s+/.test(trimmed) &&
    trimmed.length < 100
  ) {
    return { isHeading: true, headingText: trimmed }
  }
  return { isHeading: false }
}

type Section = {
  heading?: string
  body: string
}

function parseSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/)
  const sections: Section[] = []
  let currentHeading: string | undefined
  let currentLines: string[] = []

  for (const line of lines) {
    const check = isHeadingLine(line)
    if (check.isHeading) {
      if (currentHeading !== undefined || currentLines.some((l) => l.trim())) {
        sections.push({
          heading: currentHeading,
          body: currentLines.join('\n').trim(),
        })
      }
      currentHeading = check.headingText
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  if (currentHeading !== undefined || currentLines.some((l) => l.trim())) {
    sections.push({
      heading: currentHeading,
      body: currentLines.join('\n').trim(),
    })
  }

  return sections
}

type ListItem = {
  raw: string
  normalized: string
}

function normalizeListItem(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function normalizeParagraph(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function parseListItems(body: string): { items: ListItem[]; introText?: string } {
  const lines = body.split(/\r?\n/)
  const listIndent = Math.min(
    ...lines.flatMap((line) => {
      const match = /^([ \t]*)(?:[-*+]|\d+\.)\s+/.exec(line)
      return match ? [match[1].replace(/\t/g, '    ').length] : []
    }),
  )
  const items: ListItem[] = []
  const introLines: string[] = []
  let currentItemLines: string[] = []
  let inList = false

  for (const line of lines) {
    const bullet = /^([ \t]*)(?:[-*+]|\d+\.)\s+/.exec(line)
    // A child belongs to its parent unit, even when another parent has identical text.
    const isBullet = bullet !== null && bullet[1].replace(/\t/g, '    ').length === listIndent
    if (isBullet) {
      inList = true
      if (currentItemLines.length > 0) {
        const raw = currentItemLines.join('\n').trimEnd()
        items.push({ raw, normalized: normalizeListItem(raw) })
        currentItemLines = []
      }
      currentItemLines.push(line)
    } else if (inList) {
      if (line.trim()) {
        currentItemLines.push(line)
      } else if (currentItemLines.length > 0) {
        currentItemLines.push(line)
      }
    } else {
      introLines.push(line)
    }
  }

  if (currentItemLines.length > 0) {
    const raw = currentItemLines.join('\n').trimEnd()
    items.push({ raw, normalized: normalizeListItem(raw) })
  }

  return {
    items,
    introText: introLines.join('\n').trim() || undefined,
  }
}

function annotateDeferredReferences(text: string, sourceRoot: string): string {
  // Annotate links like [text](reference/...) so they don't pretend to resolve in native root
  return text.replace(
    /(\[([^\]]+)\]\((reference\/[^)]+)\))/g,
    `$1 (shared reference in ${sourceRoot}, not in native root)`,
  )
}

/**
 * Deduplicates identical imported paragraphs and list items from source and native communication documents.
 * Retains all distinct native additions and native-only runtime instructions.
 * Explains any unresolved semantic conflicts rather than silently overriding.
 */
export function mergeCommunicationDocuments(
  sourceDoc: MemoryDocument,
  nativeDoc: MemoryDocument | null,
  inspection: SharedSourceInspection,
): { mergedDoc: MemoryDocument; diagnostics: string[] } {
  const diagnostics: string[] = []
  const sourceRoot = inspection.sourceRoot || 'source'
  const shortSha = inspection.pinnedSha ? inspection.pinnedSha.slice(0, 8) : 'unknown'

  const sourceBodyAnnotated = annotateDeferredReferences(sourceDoc.body, sourceRoot)
  const cleanedNativeBody = nativeDoc?.body ? stripImportPreamble(nativeDoc.body) : ''

  if (!cleanedNativeBody.trim() || isSeedOnly(cleanedNativeBody)) {
    const provenanceNotice = `<!-- Shared communication from ${sourceRoot} @ ${inspection.pinnedSha} (${FIXED_SHARED_OWNER}) -->\n`
    return {
      mergedDoc: {
        relativePath: NATIVE_COMMUNICATION_PATH,
        description: `${sourceDoc.description} (shared from ${path.basename(sourceRoot)} @ ${shortSha})`,
        body: `${provenanceNotice}${sourceBodyAnnotated.trim()}`,
        readOnly: true,
        scope: 'global',
        tier: 'system',
      },
      diagnostics,
    }
  }

  const sourceSections = parseSections(sourceBodyAnnotated)
  const nativeSections = parseSections(cleanedNativeBody)

  const usedNativeSectionIndices = new Set<number>()
  const mergedSections: string[] = []

  for (const sSec of sourceSections) {
    let matchedNativeIdx = -1
    if (sSec.heading !== undefined) {
      for (let i = 0; i < nativeSections.length; i++) {
        if (!usedNativeSectionIndices.has(i) && nativeSections[i].heading === sSec.heading) {
          matchedNativeIdx = i
          break
        }
      }
    }

    if (matchedNativeIdx === -1) {
      if (sSec.heading === undefined) {
        const unheadedNativeIdx = nativeSections.findIndex(
          (n, i) => !usedNativeSectionIndices.has(i) && n.heading === undefined,
        )
        if (unheadedNativeIdx !== -1) {
          usedNativeSectionIndices.add(unheadedNativeIdx)
          const nSec = nativeSections[unheadedNativeIdx]
          const sParas = sSec.body.split(/\n\s*\n+/).filter(Boolean)
          const nParas = nSec.body.split(/\n\s*\n+/).filter(Boolean)
          const usedNParas = new Set<number>()
          const sectionParas: string[] = []

          for (const sPara of sParas) {
            sectionParas.push(sPara)
            const sNorm = normalizeParagraph(sPara)
            for (let j = 0; j < nParas.length; j++) {
              if (!usedNParas.has(j) && normalizeParagraph(nParas[j]) === sNorm) {
                usedNParas.add(j)
                break
              }
            }
          }

          for (let j = 0; j < nParas.length; j++) {
            if (!usedNParas.has(j) && !isSeedOnly(nParas[j])) {
              sectionParas.push(nParas[j])
            }
          }
          mergedSections.push(sectionParas.join('\n\n'))
          continue
        }
      }

      if (sSec.heading) {
        mergedSections.push(sSec.body ? `${sSec.heading}\n\n${sSec.body}` : sSec.heading)
      } else if (sSec.body) {
        mergedSections.push(sSec.body)
      }
      continue
    }

    usedNativeSectionIndices.add(matchedNativeIdx)
    const nSec = nativeSections[matchedNativeIdx]

    const sList = parseListItems(sSec.body)
    const nList = parseListItems(nSec.body)

    if (sList.items.length > 0 || nList.items.length > 0) {
      const sectionLines: string[] = []
      if (sSec.heading) sectionLines.push(sSec.heading)
      if (sList.introText) sectionLines.push(sList.introText)

      const usedNativeBullets = new Set<number>()
      for (const sItem of sList.items) {
        sectionLines.push(sItem.raw)
        for (let j = 0; j < nList.items.length; j++) {
          if (!usedNativeBullets.has(j) && nList.items[j].normalized === sItem.normalized) {
            usedNativeBullets.add(j)
            break
          }
        }
      }

      if (
        nList.introText &&
        normalizeParagraph(nList.introText) !== normalizeParagraph(sList.introText || '')
      ) {
        sectionLines.push(nList.introText)
      }
      for (let j = 0; j < nList.items.length; j++) {
        if (!usedNativeBullets.has(j)) {
          sectionLines.push(nList.items[j].raw)
        }
      }

      mergedSections.push(sectionLines.join('\n'))
    } else {
      const sNorm = normalizeParagraph(sSec.body)
      const nNorm = normalizeParagraph(nSec.body)

      if (sNorm === nNorm || !nSec.body.trim()) {
        mergedSections.push(
          sSec.heading ? (sSec.body ? `${sSec.heading}\n\n${sSec.body}` : sSec.heading) : sSec.body,
        )
      } else {
        const headingLabel = sSec.heading || 'section'
        const conflictExplanation = [
          `> Unresolved semantic difference under ${headingLabel}:`,
          `> - Shared source: "${sSec.body}"`,
          `> - Native addition: "${nSec.body}"`,
          `> (Both preserved; source given canonical precedence for shared baseline.)`,
          '',
          `**Native instruction (${headingLabel}):**\n${nSec.body}`,
        ].join('\n')

        const sectionParts: string[] = []
        if (sSec.heading) sectionParts.push(sSec.heading)
        if (sSec.body) sectionParts.push(sSec.body)
        sectionParts.push(conflictExplanation)

        mergedSections.push(sectionParts.join('\n\n'))
      }
    }
  }

  const distinctAdditions: string[] = []
  for (let i = 0; i < nativeSections.length; i++) {
    if (!usedNativeSectionIndices.has(i)) {
      const nSec = nativeSections[i]
      if (isSeedOnly(nSec.body)) continue
      if (nSec.heading) {
        distinctAdditions.push(nSec.body ? `${nSec.heading}\n\n${nSec.body}` : nSec.heading)
      } else if (nSec.body) {
        distinctAdditions.push(nSec.body)
      }
    }
  }

  if (distinctAdditions.length > 0) {
    mergedSections.push(
      '### Native Runtime Additions\n_Distinct instructions recorded in native Cursor memory:_\n\n' +
        distinctAdditions.join('\n\n'),
    )
  }

  const provenanceNotice = `<!-- Shared communication from ${sourceRoot} @ ${inspection.pinnedSha} (${FIXED_SHARED_OWNER}) merged with native additions -->\n`
  const mergedBody = `${provenanceNotice}${mergedSections.join('\n\n').trim()}`

  return {
    mergedDoc: {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: `${sourceDoc.description} (shared from ${path.basename(sourceRoot)} @ ${shortSha} + native additions)`,
      body: mergedBody,
      readOnly: true,
      scope: 'global',
      tier: 'system',
    },
    diagnostics,
  }
}

// ---------------------------------------------------------------------------
// Proposal Queue
// ---------------------------------------------------------------------------

export function resolveGitAdministrativeDir(memoryRoot: string): string {
  try {
    const out = execFileSync('git', ['-C', memoryRoot, 'rev-parse', '--absolute-git-dir'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (out) return path.resolve(out)
  } catch {}

  const dotGit = path.join(memoryRoot, '.git')
  if (fs.existsSync(dotGit)) {
    try {
      const stat = fs.lstatSync(dotGit)
      if (stat.isDirectory()) {
        return dotGit
      }
      if (stat.isFile()) {
        const content = fs.readFileSync(dotGit, 'utf-8')
        const match = content.match(/^gitdir:\s*(.+)$/m)
        if (match) {
          return path.resolve(memoryRoot, match[1].trim())
        }
      }
    } catch {}
  }

  throw new Error(`Cannot resolve Git administrative directory for memory root: ${memoryRoot}`)
}

export function resolveProposalsDir(memoryRoot: string): string {
  const gitAdminDir = resolveGitAdministrativeDir(memoryRoot)
  return path.join(gitAdminDir, 'cursor-memory', 'proposals')
}

export function createProposal(options: {
  memoryRoot: string
  targetPath: string
  operation: 'write' | 'append' | 'replace' | 'delete'
  sourceRoot?: string | null
  sourceSha?: string | null
  nativeOriginPath?: string
  content: string
  description?: string
  message?: string
}): Proposal {
  if (
    options.targetPath !== FIXED_SHARED_OWNER &&
    options.targetPath !== NATIVE_COMMUNICATION_PATH &&
    !isSharedOwnerPath(options.targetPath)
  ) {
    throw new Error(
      `Invalid proposal targetPath: ${options.targetPath}; only ${FIXED_SHARED_OWNER} is supported.`,
    )
  }

  const dir = resolveProposalsDir(options.memoryRoot)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const sourceSha =
    options.sourceSha !== undefined
      ? options.sourceSha
      : options.sourceRoot
        ? getSourceHeadSha(options.sourceRoot)
        : null
  const nativeCommitSha = getMemoryHeadRevision(options.memoryRoot)
  const nativeRelativePath = options.nativeOriginPath || NATIVE_COMMUNICATION_PATH

  const proposal: Proposal = {
    id,
    createdAt: new Date().toISOString(),
    targetPath: FIXED_SHARED_OWNER,
    operation: options.operation,
    sourceSha,
    nativeOrigin: {
      commitSha: nativeCommitSha,
      relativePath: nativeRelativePath,
      message: options.message,
    },
    content: options.content,
    description: options.description,
    status: 'pending',
  }

  const targetFile = path.join(dir, `${id}.json`)
  const tempFile = `${targetFile}.tmp-${process.pid}`
  fs.writeFileSync(tempFile, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tempFile, targetFile)

  return proposal
}

function validateProposalRecord(raw: unknown): Proposal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>

  if (typeof p.id !== 'string' || !/^prop_[a-zA-Z0-9_-]+$/.test(p.id)) return null
  if (typeof p.createdAt !== 'string') return null
  if (p.targetPath !== FIXED_SHARED_OWNER) return null
  if (!['write', 'append', 'replace', 'delete'].includes(p.operation as string)) return null
  if (
    p.sourceSha !== null &&
    (typeof p.sourceSha !== 'string' || !/^[a-f0-9]{40}$/i.test(p.sourceSha))
  ) {
    return null
  }
  if (!p.nativeOrigin || typeof p.nativeOrigin !== 'object') return null
  const origin = p.nativeOrigin as Record<string, unknown>
  if (
    typeof origin.relativePath !== 'string' ||
    origin.relativePath.includes('..') ||
    path.isAbsolute(origin.relativePath)
  ) {
    return null
  }
  if (
    origin.commitSha !== null &&
    (typeof origin.commitSha !== 'string' || !/^[a-f0-9]{4,40}$/i.test(origin.commitSha))
  ) {
    return null
  }
  if (typeof p.content !== 'string') return null
  if (p.status !== 'pending') return null

  return p as Proposal
}

export function listProposals(memoryRoot: string, sourceRoot?: string | null): ProposalWithStale[] {
  let dir: string
  try {
    dir = resolveProposalsDir(memoryRoot)
  } catch {
    return []
  }
  if (!fs.existsSync(dir)) return []

  let realDir: string
  try {
    realDir = fs.realpathSync(dir)
  } catch {
    return []
  }

  const currentSourceSha = sourceRoot ? getSourceHeadSha(sourceRoot) : null
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('.tmp-'))
  const results: ProposalWithStale[] = []

  for (const file of files) {
    try {
      const filePath = path.join(dir, file)
      const lstat = fs.lstatSync(filePath)
      if (lstat.isSymbolicLink()) continue
      const realPath = fs.realpathSync(filePath)
      if (!isWithin(realDir, realPath)) continue

      const raw = fs.readFileSync(realPath, 'utf-8')
      const parsed = JSON.parse(raw)
      const prop = validateProposalRecord(parsed)
      if (!prop) continue

      const isStale = Boolean(
        !prop.sourceSha || (currentSourceSha && prop.sourceSha !== currentSourceSha),
      )
      results.push({ ...prop, isStale, currentSourceSha })
    } catch {}
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return results
}

export function getProposal(
  memoryRoot: string,
  id: string,
  sourceRoot?: string | null,
): ProposalWithStale | null {
  if (!/^prop_[a-zA-Z0-9_-]+$/.test(id)) return null
  const proposals = listProposals(memoryRoot, sourceRoot)
  return proposals.find((p) => p.id === id) || proposals.find((p) => p.id.startsWith(id)) || null
}

export function exportProposal(memoryRoot: string, id: string, sourceRoot?: string | null): string {
  const prop = getProposal(memoryRoot, id, sourceRoot)
  if (!prop) throw new Error(`Proposal not found or invalid: ${id}`)

  let baseStatus: string
  let revisionDisplay: string
  if (!prop.sourceSha) {
    baseStatus = 'UNGROUNDED (no source base revision recorded; missing source)'
    revisionDisplay = `none [${baseStatus}]`
  } else if (!prop.currentSourceSha) {
    baseStatus = `UNKNOWN (${prop.sourceSha.slice(0, 8)}; source repo unavailable)`
    revisionDisplay = `${prop.sourceSha} [${baseStatus}]`
  } else if (prop.sourceSha !== prop.currentSourceSha) {
    baseStatus = `STALE BASE (proposal created at ${prop.sourceSha.slice(0, 8)}, current source HEAD is ${prop.currentSourceSha.slice(0, 8)})`
    revisionDisplay = `${prop.sourceSha} [${baseStatus}]`
  } else {
    baseStatus = `CURRENT (${prop.sourceSha.slice(0, 8)})`
    revisionDisplay = `${prop.sourceSha} [${baseStatus}]`
  }

  return [
    `# Shared Memory Proposal: ${prop.id}`,
    '',
    `Status: ${prop.status} (requires human review; not committed to canonical source)`,
    `Target: ${prop.targetPath}`,
    `Operation: ${prop.operation}`,
    `Base Source Revision: ${revisionDisplay}`,
    `Native Origin Revision: ${prop.nativeOrigin.commitSha || 'none'} (${prop.nativeOrigin.relativePath})`,
    `Created: ${prop.createdAt}`,
    prop.description ? `Description: ${prop.description}` : '',
    prop.nativeOrigin.message ? `Origin Note: ${prop.nativeOrigin.message}` : '',
    '',
    '## Proposed Content',
    '',
    prop.content,
    '',
  ]
    .filter(Boolean)
    .join('\n')
}
