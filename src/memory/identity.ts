/**
 * Project slug resolution. Ported from agy-memory-layer `workspace-identity.ts`.
 */

import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { listCommittedMemoryFiles, validateProjectSlug } from './repository.ts'

export const toProjectSlug = (value: string): string => {
  const candidate = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  return validateProjectSlug(candidate || 'workspace')
}

const runGitIn = (cwd: string, args: string[]): string | null => {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return output || null
  } catch {
    return null
  }
}

export const resolveGitRoot = (workspacePath: string): string | null =>
  runGitIn(workspacePath, ['rev-parse', '--show-toplevel'])

const remoteCanonicalSlug = (workspacePath: string): string | null => {
  const remote = runGitIn(workspacePath, ['config', '--get', 'remote.origin.url'])
  const match = remote?.match(/[:/]([^/:]+)\/([^/:]+?)(?:\.git)?$/)
  return match ? toProjectSlug(`${match[1]}-${match[2]}`) : null
}

export const projectScopeExists = (memoryRoot: string, slug: string): boolean =>
  listCommittedMemoryFiles(memoryRoot, slug).some((file) => file.endsWith('.md'))

export function resolveProjectSlug(workspacePath: string, memoryRoot: string): string {
  const gitRoot = resolveGitRoot(workspacePath)
  const rootSlug = toProjectSlug(path.basename(gitRoot || workspacePath))
  const workspaceSlug = toProjectSlug(path.basename(workspacePath))
  const remoteSlug = remoteCanonicalSlug(gitRoot || workspacePath)
  const candidates = [...new Set([workspaceSlug, rootSlug, remoteSlug])].filter(
    (slug): slug is string => Boolean(slug),
  )
  return candidates.find((slug) => projectScopeExists(memoryRoot, slug)) || rootSlug
}
