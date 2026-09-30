import * as path from 'node:path'

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

const OWNED_COMMAND = /cursor-memory-layer[/\\]src[/\\]hooks[/\\]/

export const isOwnedHook = (entry: HookEntry): boolean =>
  typeof entry.command === 'string' && OWNED_COMMAND.test(entry.command)

export function buildOwnedHooks(repoRoot: string, nodePath: string): Record<string, HookEntry> {
  const command = (script: string) =>
    `"${nodePath}" --experimental-strip-types --disable-warning=ExperimentalWarning "${path.join(repoRoot, 'src', 'hooks', script)}"`
  return {
    sessionStart: { command: command('session-start.ts'), timeout: 10 },
    sessionEnd: { command: command('session-end.ts'), timeout: 15 },
    stop: { command: command('stop.ts'), timeout: 10 },
    preCompact: { command: command('pre-compact.ts'), timeout: 10 },
    preToolUse: { command: command('pre-tool-use.ts'), matcher: 'Shell', timeout: 5 },
  }
}

export function removeOwnedHooks(config: HooksConfig): HooksConfig {
  const hooks: Record<string, HookEntry[]> = {}
  for (const [event, entries] of Object.entries(config.hooks || {})) {
    const kept = (Array.isArray(entries) ? entries : []).filter((entry) => !isOwnedHook(entry))
    if (kept.length > 0) hooks[event] = kept
  }
  return { ...config, version: config.version ?? 1, hooks }
}

const replaceOwnedHook = (entries: HookEntry[], entry: HookEntry): HookEntry[] => {
  const index = entries.findIndex(isOwnedHook)
  if (index === -1) return [...entries, entry]
  return entries.flatMap((current, currentIndex) => {
    if (currentIndex === index) return [entry]
    return isOwnedHook(current) ? [] : [current]
  })
}

/** Keeps an existing memory hook in place. A first install still appends. */
export function mergeOwnedHooks(
  config: HooksConfig,
  owned: Record<string, HookEntry>,
): HooksConfig {
  const hooks = { ...(config.hooks || {}) }
  for (const [event, entry] of Object.entries(owned))
    hooks[event] = replaceOwnedHook(hooks[event] || [], entry)
  return { ...config, version: config.version ?? 1, hooks }
}
