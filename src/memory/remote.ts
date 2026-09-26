/**
 * Optional mirror, modeled on Letta's `/memory-repository`: memory stays local
 * unless a URL is set. The URL lives in git config, not as a named remote.
 * A post-commit hook pushes `main` in the background, never with --force.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { dreamStateDir } from '../dream/state.ts'
import {
  assertNoUnrelatedChanges,
  getMemoryHeadRevision,
  isMemoryRepository,
  runGit,
} from './repository.ts'
import { findSecretLikeContent } from './secrets.ts'

const CONFIG_KEY = 'cursor-memory.remote.url'
const HOOK_MARKER = '# cursor-memory mirror'
const PUSH_TIMEOUT_NOTE = 'Pushes run in the background after each commit on main.'

export type RemoteStatus = {
  url: string | null
  hookInstalled: boolean
  recentLog: string[]
}

export const pushLogPath = (memoryRoot: string): string =>
  path.join(dreamStateDir(memoryRoot), 'push.log')

const hookPath = (memoryRoot: string): string =>
  path.join(memoryRoot, '.git', 'hooks', 'post-commit')

export const redactUrl = (url: string): string => url.replace(/\/\/[^/@\s]+@/, '//***@')

const requireRepository = (memoryRoot: string): void => {
  if (!isMemoryRepository(memoryRoot)) throw new Error('Memory repository is not initialized.')
}

export function getRemoteUrl(memoryRoot: string): string | null {
  if (!isMemoryRepository(memoryRoot)) return null
  const result = runGit(memoryRoot, ['config', '--local', '--get', CONFIG_KEY], {
    allowFailure: true,
  })
  return result.status === 0 ? result.stdout.trim() || null : null
}

const hookScript = (): string => `#!/bin/sh
${HOOK_MARKER}. ${PUSH_TIMEOUT_NOTE}
url=$(git config --local --get ${CONFIG_KEY}) || exit 0
[ "$(git symbolic-ref --short -q HEAD)" = main ] || exit 0
log="$(git rev-parse --git-dir)/cursor-memory/push.log"
mkdir -p "$(dirname "$log")"
(
  if git push --quiet "$url" main:main; then status=ok; else status=failed; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) push $status $(git rev-parse --short HEAD)"
) </dev/null >>"$log" 2>&1 &
exit 0
`

function installHook(memoryRoot: string): void {
  const target = hookPath(memoryRoot)
  if (fs.existsSync(target) && !fs.readFileSync(target, 'utf-8').includes(HOOK_MARKER)) {
    throw new Error(`${target} already exists and is not ours; add the mirror push to it manually.`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, hookScript(), { mode: 0o755 })
}

function removeHook(memoryRoot: string): boolean {
  const target = hookPath(memoryRoot)
  if (!fs.existsSync(target) || !fs.readFileSync(target, 'utf-8').includes(HOOK_MARKER))
    return false
  fs.rmSync(target)
  return true
}

const appendPushLog = (memoryRoot: string, line: string): void => {
  fs.mkdirSync(dreamStateDir(memoryRoot), { recursive: true })
  fs.appendFileSync(pushLogPath(memoryRoot), `${new Date().toISOString()} ${line}\n`)
}

export function pushToRemote(memoryRoot: string): { ok: boolean; detail: string } {
  const url = getRemoteUrl(memoryRoot)
  if (!url) throw new Error('No remote set. Use `cursor-memory remote set <url>`.')
  if (!getMemoryHeadRevision(memoryRoot)) throw new Error('Nothing to push yet.')
  const result = runGit(memoryRoot, ['push', '--quiet', url, 'main:main'], { allowFailure: true })
  const detail = (result.stderr || result.stdout).trim()
  appendPushLog(
    memoryRoot,
    `push ${result.status === 0 ? 'ok' : 'failed'} (manual) ${detail}`.trim(),
  )
  return { ok: result.status === 0, detail: detail || 'pushed main' }
}

export function setRemote(memoryRoot: string, url: string): { ok: boolean; detail: string } {
  requireRepository(memoryRoot)
  const trimmed = url.trim()
  if (!trimmed) throw new Error('Remote URL must not be empty.')
  if (/\/\/[^/@\s]+:[^/@\s]+@/.test(trimmed) || findSecretLikeContent(trimmed).length > 0) {
    throw new Error(
      'Remote URL must not embed credentials; use your normal git credential helper or SSH.',
    )
  }
  runGit(memoryRoot, ['config', '--local', CONFIG_KEY, trimmed])
  installHook(memoryRoot)
  return pushToRemote(memoryRoot)
}

export function unsetRemote(memoryRoot: string): string[] {
  requireRepository(memoryRoot)
  const actions: string[] = []
  if (getRemoteUrl(memoryRoot)) {
    runGit(memoryRoot, ['config', '--local', '--unset', CONFIG_KEY])
    actions.push('Removed the remote URL.')
  }
  if (removeHook(memoryRoot)) actions.push('Removed the post-commit mirror hook.')
  return actions.length > 0 ? actions : ['No remote was set.']
}

export function getRemoteStatus(memoryRoot: string): RemoteStatus {
  const url = getRemoteUrl(memoryRoot)
  const target = hookPath(memoryRoot)
  let recentLog: string[] = []
  try {
    recentLog = fs.readFileSync(pushLogPath(memoryRoot), 'utf-8').trim().split('\n').slice(-10)
  } catch {}
  return {
    url: url ? redactUrl(url) : null,
    hookInstalled: fs.existsSync(target) && fs.readFileSync(target, 'utf-8').includes(HOOK_MARKER),
    recentLog,
  }
}

/** Fast-forward when possible; otherwise rebase local commits, aborting on conflict. */
export function pullFromRemote(memoryRoot: string): { updated: boolean; detail: string } {
  const url = getRemoteUrl(memoryRoot)
  if (!url) throw new Error('No remote set. Use `cursor-memory remote set <url>`.')
  assertNoUnrelatedChanges(memoryRoot, [])
  const before = getMemoryHeadRevision(memoryRoot)
  runGit(memoryRoot, ['fetch', '--quiet', '--no-tags', url, 'main'])
  const merged = runGit(memoryRoot, ['merge', '--ff-only', '--quiet', 'FETCH_HEAD'], {
    allowFailure: true,
  })
  if (merged.status !== 0) {
    const rebased = runGit(memoryRoot, ['rebase', '--quiet', 'FETCH_HEAD'], { allowFailure: true })
    if (rebased.status !== 0) {
      runGit(memoryRoot, ['rebase', '--abort'], { allowFailure: true })
      throw new Error(
        'Local and remote memory diverged and the rebase conflicted; nothing was changed. Resolve by hand in the memory repository.',
      )
    }
  }
  const after = getMemoryHeadRevision(memoryRoot)
  return {
    updated: before !== after,
    detail:
      before === after
        ? 'Already up to date.'
        : `Updated ${before?.slice(0, 8)} -> ${after?.slice(0, 8)}.`,
  }
}
