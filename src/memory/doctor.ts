/**
 * Deterministic memory audit. Letta's `/doctor` hands the audit to an LLM
 * skill (`context-doctor`); this covers the mechanical checks from its
 * checklist (structure, organization, discoverability, core-memory size) and
 * the installation, leaving judgment calls to the agent via the skill.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveAgentCommand } from '../dream/runner.ts'
import { isBackedOff, isDreamLocked, readDreamLog, readDreamState } from '../dream/state.ts'
import { type HooksConfig, isOwnedHook } from '../install/hooks-config.ts'
import { buildVectorProfile, cosineSimilarity } from '../recall/rank.ts'
import { ACTIVE_MEMORY_BUDGET_TOKENS, estimateTokens, SYSTEM_DOCUMENT_MAX_CHARS } from './config.ts'
import { parseMemoryDocument } from './document.ts'
import { inspectCommittedMemoryProjection, renderCommittedMemoryProjection } from './projection.ts'
import { getRemoteStatus } from './remote.ts'
import {
  getMemoryRepositoryStatus,
  isMemoryRepository,
  listCommittedMemoryFiles,
  readCommittedMemoryFile,
  runGit,
} from './repository.ts'
import { classifyMemoryPath, requiresFrontmatter } from './scope.ts'
import { findSecretLikeContent } from './secrets.ts'
import { loadSettings } from './settings.ts'

export type DoctorLevel = 'ok' | 'warn' | 'error'
export type DoctorFinding = { level: DoctorLevel; check: string; detail: string }

const EXPECTED_HOOKS = ['sessionStart', 'sessionEnd', 'stop', 'preCompact', 'preToolUse']
const DUPLICATE_LINE_MIN_CHARS = 24
const SIMILAR_FILE_THRESHOLD = 0.85
const SIMILAR_FILE_MIN_CHARS = 200
const PATH_REFERENCE = /\b(?:system|reference|projects|skills)\/[\w./-]+\.md\b/g

type LoadedFile = { relativePath: string; content: string; body: string; tier: string }

const normalizeLine = (line: string): string =>
  line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

function loadFiles(memoryRoot: string, findings: DoctorFinding[]): LoadedFile[] {
  const loaded: LoadedFile[] = []
  for (const relativePath of listCommittedMemoryFiles(memoryRoot, '')) {
    const content = readCommittedMemoryFile(memoryRoot, relativePath) ?? ''
    let tier: string
    try {
      tier = classifyMemoryPath(relativePath).tier
    } catch (error) {
      findings.push({
        level: 'warn',
        check: 'structure',
        detail: `${relativePath} is outside the supported layout and is never loaded (${error instanceof Error ? error.message : error}).`,
      })
      continue
    }
    const secrets = findSecretLikeContent(content)
    if (secrets.length > 0) {
      findings.push({
        level: 'error',
        check: 'secrets',
        detail: `${relativePath} looks like it contains ${secrets.join(', ')}. Remove it and revert or rewrite history if it was pushed.`,
      })
    }
    let body = content
    if (requiresFrontmatter(relativePath)) {
      const parsed = parseMemoryDocument(content, relativePath)
      for (const diagnostic of parsed.diagnostics) {
        findings.push({ level: 'error', check: 'frontmatter', detail: diagnostic })
      }
      body = parsed.body
    }
    loaded.push({ relativePath, content, body, tier })
  }
  return loaded
}

function checkSize(
  memoryRoot: string,
  projectSlug: string,
  files: LoadedFile[],
  findings: DoctorFinding[],
) {
  for (const file of files) {
    if (file.tier === 'system' && file.content.length > SYSTEM_DOCUMENT_MAX_CHARS) {
      findings.push({
        level: 'error',
        check: 'core size',
        detail: `${file.relativePath} is ${file.content.length} chars (limit ${SYSTEM_DOCUMENT_MAX_CHARS}); it cannot be rewritten until trimmed.`,
      })
    }
  }
  const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
  const tokens = estimateTokens(renderCommittedMemoryProjection(projection))
  const heaviest = [...projection.globalSystem, ...projection.projectSystem]
    .sort((left, right) => right.body.length - left.body.length)
    .slice(0, 3)
    .map((doc) => `${doc.relativePath} ~${estimateTokens(doc.body)}t`)
    .join(', ')
  findings.push({
    level: tokens > ACTIVE_MEMORY_BUDGET_TOKENS ? 'warn' : 'ok',
    check: 'core size',
    detail: `Every chat in "${projectSlug}" loads ~${tokens} tokens (budget ${ACTIVE_MEMORY_BUDGET_TOKENS}).${heaviest ? ` Largest: ${heaviest}.` : ''}`,
  })
}

function checkOrganization(files: LoadedFile[], findings: DoctorFinding[]) {
  const candidates = files.filter((file) => file.tier === 'system' || file.tier === 'reference')
  const seen = new Map<string, Set<string>>()
  for (const file of candidates) {
    for (const line of file.body.split('\n')) {
      const normalized = normalizeLine(line)
      if (normalized.length < DUPLICATE_LINE_MIN_CHARS) continue
      const places = seen.get(normalized) || new Set<string>()
      places.add(file.relativePath)
      seen.set(normalized, places)
    }
  }
  const duplicates = [...seen].filter(([, places]) => places.size > 1).slice(0, 5)
  for (const [line, places] of duplicates) {
    findings.push({
      level: 'warn',
      check: 'duplicates',
      detail: `"${line.slice(0, 80)}" appears in ${[...places].join(', ')}. Keep one source.`,
    })
  }

  const profiles = candidates
    .filter((file) => file.body.length >= SIMILAR_FILE_MIN_CHARS)
    .map((file) => ({ file, profile: buildVectorProfile(file.body) }))
  for (let left = 0; left < profiles.length; left++) {
    for (let right = left + 1; right < profiles.length; right++) {
      const score = cosineSimilarity(profiles[left].profile, profiles[right].profile)
      if (score >= SIMILAR_FILE_THRESHOLD) {
        findings.push({
          level: 'warn',
          check: 'duplicates',
          detail: `${profiles[left].file.relativePath} and ${profiles[right].file.relativePath} are ${Math.round(score * 100)}% similar; consider merging.`,
        })
      }
    }
  }

  for (const file of candidates) {
    const lines = file.body.split('\n').filter((line) => /^\s*[-*+]\s/.test(line))
    if (lines.length > 1 && lines.some((line) => line.includes('(nothing recorded yet)'))) {
      findings.push({
        level: 'warn',
        check: 'stale placeholder',
        detail: `${file.relativePath} still has "(nothing recorded yet)" next to real entries.`,
      })
    }
  }
}

function checkDiscoverability(files: LoadedFile[], findings: DoctorFinding[]) {
  const existing = new Set(files.map((file) => file.relativePath))
  for (const file of files) {
    if (file.tier === 'archive') continue
    for (const reference of new Set(file.body.match(PATH_REFERENCE) || [])) {
      if (!existing.has(reference) && !reference.includes('<')) {
        findings.push({
          level: 'warn',
          check: 'broken link',
          detail: `${file.relativePath} mentions ${reference}, which does not exist.`,
        })
      }
    }
  }
  const notes = files.filter((file) => /^archives\/.*\/learnings\//.test(file.relativePath)).length
  if (notes > 0) {
    findings.push({
      level: 'ok',
      check: 'archives',
      detail: `${notes} reflection note(s) in archives/; promote confirmed ones into system/ or delete stale ones.`,
    })
  }
}

function checkReflection(memoryRoot: string, findings: DoctorFinding[]) {
  const settings = loadSettings().reflection
  if (!settings.enabled) {
    findings.push({
      level: 'warn',
      check: 'reflection',
      detail: 'Model-driven reflection is disabled.',
    })
    return
  }
  const agent = resolveAgentCommand(settings.agentCommand)
  if (!agent.includes('/')) {
    findings.push({
      level: 'error',
      check: 'reflection',
      detail: `${settings.agentCommand} was not found; background reflection cannot run.`,
    })
  }
  const state = readDreamState(memoryRoot)
  if (isBackedOff(state)) {
    findings.push({
      level: 'warn',
      check: 'reflection',
      detail: `Backing off after ${state.failures} consecutive failure(s).`,
    })
  }
  if (isDreamLocked(memoryRoot)) {
    findings.push({ level: 'ok', check: 'reflection', detail: 'A reflection is running now.' })
  }
  const last = readDreamLog(memoryRoot, 1)[0]
  findings.push({
    level: last?.status === 'failed' ? 'warn' : 'ok',
    check: 'reflection',
    detail: last
      ? `Last run ${last.at.slice(0, 16)} (${last.trigger}): ${last.status} — ${last.detail.slice(0, 160)}`
      : `Triggers: ${settings.triggers.join(', ') || 'none'}; no reflection has run yet.`,
  })
}

function checkInstall(memoryRoot: string, cursorHome: string, findings: DoctorFinding[]) {
  const hooksFile = path.join(cursorHome, 'hooks.json')
  let config: HooksConfig = {}
  try {
    config = JSON.parse(fs.readFileSync(hooksFile, 'utf-8')) as HooksConfig
  } catch {}
  const missing = EXPECTED_HOOKS.filter(
    (event) => !(config.hooks?.[event] || []).some((entry) => isOwnedHook(entry)),
  )
  findings.push({
    level: missing.length > 0 ? 'warn' : 'ok',
    check: 'install',
    detail:
      missing.length > 0
        ? `Hooks missing from ${hooksFile}: ${missing.join(', ')}. Run \`pnpm memory:install\`.`
        : `All ${EXPECTED_HOOKS.length} hooks are installed.`,
  })
  if (!fs.existsSync(path.join(cursorHome, 'skills', 'cursor-memory', 'SKILL.md'))) {
    findings.push({
      level: 'warn',
      check: 'install',
      detail: 'The cursor-memory skill is not installed.',
    })
  }
  const remote = getRemoteStatus(memoryRoot)
  const lastPush = remote.recentLog.at(-1)
  findings.push({
    level: lastPush?.includes('failed') ? 'warn' : 'ok',
    check: 'remote',
    detail: remote.url
      ? `Mirroring to ${remote.url}${lastPush ? `; last: ${lastPush}` : ''}.`
      : 'Local only (no mirror set).',
  })
}

export function runDoctor(options: {
  memoryRoot: string
  cursorHome: string
  projectSlug: string
}): DoctorFinding[] {
  const { memoryRoot } = options
  const findings: DoctorFinding[] = []
  if (!isMemoryRepository(memoryRoot)) {
    return [{ level: 'error', check: 'repository', detail: `${memoryRoot} is not initialized.` }]
  }
  const status = getMemoryRepositoryStatus(memoryRoot)
  findings.push({
    level: status.state === 'clean' ? 'ok' : status.state === 'dirty' ? 'warn' : 'error',
    check: 'repository',
    detail: `${status.summary}${status.changedPaths.length > 0 ? ` (${status.changedPaths.slice(0, 5).join(', ')})` : ''}`,
  })
  const branch = runGit(memoryRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], {
    allowFailure: true,
  })
  if (branch.stdout.trim() !== 'main') {
    findings.push({
      level: 'warn',
      check: 'repository',
      detail: `HEAD is on "${branch.stdout.trim() || 'detached'}", not main.`,
    })
  }
  const files = loadFiles(memoryRoot, findings)
  checkSize(memoryRoot, options.projectSlug, files, findings)
  checkOrganization(files, findings)
  checkDiscoverability(files, findings)
  checkReflection(memoryRoot, findings)
  checkInstall(memoryRoot, options.cursorHome, findings)
  return findings
}
