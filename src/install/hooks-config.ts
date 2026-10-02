import * as path from 'node:path'
import { nodeScriptPath, quoteShellArgument } from './shell.ts'

export type HookEntry = {
  command: string
  matcher?: string
  timeout?: number
  [key: string]: unknown
}

export type HooksConfig = {
  version?: number
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

const OWNED_SCRIPT =
  /[/\\]cursor-memory-layer(?:[/\\]\.letta[/\\]worktrees[/\\][^/\\]+)?[/\\]src[/\\]hooks[/\\](?:session-start|session-end|stop|pre-compact|pre-tool-use)\.ts$/
const HOOK_MARKER = ' # cursor-memory-layer:hook'

export const isOwnedHook = (entry: HookEntry, expectedCommands: string[] = []): boolean => {
  if (typeof entry.command !== 'string') return false
  const script = nodeScriptPath(entry.command, HOOK_MARKER)
  if (!script) return false
  return (
    OWNED_SCRIPT.test(script) ||
    expectedCommands.some((command) => nodeScriptPath(command, HOOK_MARKER) === script)
  )
}

export function buildOwnedHooks(
  repoRoot: string,
  nodePath: string,
  legacy = false,
): Record<string, HookEntry> {
  const command = (script: string) =>
    legacy
      ? `"${nodePath}" --experimental-strip-types --disable-warning=ExperimentalWarning "${path.join(repoRoot, 'src', 'hooks', script)}"`
      : `${quoteShellArgument(nodePath)} --experimental-strip-types --disable-warning=ExperimentalWarning ${quoteShellArgument(path.join(repoRoot, 'src', 'hooks', script))}${HOOK_MARKER}`
  return {
    sessionStart: { command: command('session-start.ts'), timeout: 10 },
    sessionEnd: { command: command('session-end.ts'), timeout: 15 },
    stop: { command: command('stop.ts'), timeout: 10 },
    preCompact: { command: command('pre-compact.ts'), timeout: 10 },
    preToolUse: { command: command('pre-tool-use.ts'), matcher: 'Shell', timeout: 5 },
  }
}

export function removeOwnedHooks(
  config: HooksConfig,
  expectedCommands: string[] = [],
): HooksConfig {
  const hooks: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(config.hooks || {})) {
    const kept = (Array.isArray(entries) ? entries : []).filter(
      (entry) => !isOwnedHook(entry, expectedCommands),
    )
    if (kept.length > 0) hooks[event] = kept
  }
  return { ...config, version: config.version ?? 1, hooks }
}

const replaceOwnedHook = (
  entries: HookEntry[],
  entry: HookEntry,
  expectedCommands: string[],
): HookEntry[] => {
  const index = entries.findIndex((current) => isOwnedHook(current, expectedCommands))
  if (index === -1) return [...entries, entry]
  return entries.flatMap((current, currentIndex) => {
    if (currentIndex === index) return [entry]
    return isOwnedHook(current, expectedCommands) ? [] : [current]
  })
}

/** Keeps an existing memory hook in place. A first install still appends. */
export function mergeOwnedHooks(
  config: HooksConfig,
  owned: Record<string, HookEntry>,
  legacyCommands: string[] = [],
): HooksConfig {
  const hooks = { ...(config.hooks || {}) }
  const expectedCommands = [
    ...Object.values(owned).map((entry) => entry.command),
    ...legacyCommands,
  ]
  for (const [event, entry] of Object.entries(owned))
    hooks[event] = replaceOwnedHook(hooks[event] || [], entry, expectedCommands)
  return { ...config, version: config.version ?? 1, hooks }
}
