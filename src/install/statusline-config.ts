import * as fs from 'node:fs'
import * as path from 'node:path'
import { nodeScriptPath, quoteShellArgument } from './shell.ts'

export type StatusLineConfig = {
  type: 'command'
  command: string
  padding?: number
  updateIntervalMs?: number
  timeoutMs?: number
  [key: string]: unknown
}

type CliConfig = { statusLine?: unknown; [key: string]: unknown }

const OWNED_STATUSLINE =
  /[/\\]cursor-memory-layer(?:[/\\]\.letta[/\\]worktrees[/\\][^/\\]+)?[/\\]statusline[/\\]statusline\.mjs$/
const STATUSLINE_MARKER = ' # cursor-memory-layer:statusline'

export const cliConfigPath = (cursorHome: string): string =>
  path.join(cursorHome, 'cli-config.json')

/** The statusLine that was configured before install, restored on uninstall. */
export const statusLineBackupPath = (cursorHome: string): string =>
  path.join(cursorHome, 'cli-config.statusline.pre-cursor-memory.json')

export const isOwnedStatusLine = (value: unknown, expectedCommands: string[] = []): boolean => {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as StatusLineConfig).command !== 'string'
  ) {
    return false
  }
  const script = nodeScriptPath((value as StatusLineConfig).command, STATUSLINE_MARKER)
  if (!script) return false
  return (
    OWNED_STATUSLINE.test(script) ||
    expectedCommands.some((command) => nodeScriptPath(command, STATUSLINE_MARKER) === script)
  )
}

export function buildStatusLine(
  repoRoot: string,
  nodePath: string,
  legacy = false,
): StatusLineConfig {
  const script = path.join(repoRoot, 'statusline', 'statusline.mjs')
  const legacyQuote = (value: string) => (/\s/.test(value) ? `"${value}"` : value)
  return {
    type: 'command',
    command: legacy
      ? `${legacyQuote(nodePath)} ${legacyQuote(script)}`
      : `${quoteShellArgument(nodePath)} ${quoteShellArgument(script)}${STATUSLINE_MARKER}`,
    padding: 0,
    updateIntervalMs: 2000,
    timeoutMs: 2000,
  }
}

export function readCliConfig(cursorHome: string): CliConfig | null {
  const file = cliConfigPath(cursorHome)
  if (!fs.existsSync(file)) return null
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object; refusing to rewrite it.`)
  }
  return parsed as CliConfig
}

function writeCliConfig(cursorHome: string, config: CliConfig): void {
  const file = cliConfigPath(cursorHome)
  const mode = fs.statSync(file).mode & 0o777
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode })
  fs.renameSync(temp, file)
}

/**
 * Points the CLI status line at this repo's script. Returns false when the CLI
 * has not created cli-config.json yet, so the installer never invents one.
 */
export function installStatusLine(
  cursorHome: string,
  statusLine: StatusLineConfig,
  legacyCommand?: string,
): boolean {
  const config = readCliConfig(cursorHome)
  if (!config) return false
  const expectedCommands = [statusLine.command, ...(legacyCommand ? [legacyCommand] : [])]
  if (config.statusLine !== undefined && !isOwnedStatusLine(config.statusLine, expectedCommands)) {
    fs.writeFileSync(
      statusLineBackupPath(cursorHome),
      `${JSON.stringify(config.statusLine, null, 2)}\n`,
    )
  }
  if (JSON.stringify(config.statusLine) !== JSON.stringify(statusLine)) {
    writeCliConfig(cursorHome, { ...config, statusLine })
  }
  return true
}

/** Restores the previous status line, or removes ours when there was none. */
export function uninstallStatusLine(cursorHome: string, expectedCommands: string[] = []): boolean {
  const config = readCliConfig(cursorHome)
  if (!config || !isOwnedStatusLine(config.statusLine, expectedCommands)) return false
  const backup = statusLineBackupPath(cursorHome)
  const { statusLine: _owned, ...rest } = config
  const restored = fs.existsSync(backup)
    ? { ...rest, statusLine: JSON.parse(fs.readFileSync(backup, 'utf-8')) as unknown }
    : rest
  writeCliConfig(cursorHome, restored)
  fs.rmSync(backup, { force: true })
  return true
}
