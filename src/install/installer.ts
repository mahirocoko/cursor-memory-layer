import * as fs from 'node:fs'
import * as path from 'node:path'
import { type InitMemoryResult, initMemory } from '../memory/init.ts'
import {
  buildOwnedHooks,
  type HooksConfig,
  mergeOwnedHooks,
  removeOwnedHooks,
} from './hooks-config.ts'
import { buildStatusLine, installStatusLine, uninstallStatusLine } from './statusline-config.ts'

export type InstallOptions = {
  repoRoot: string
  cursorHome: string
  memoryRoot: string
  nodePath: string
  binDir: string | null
  /** Point the CLI status line at statusline/statusline.mjs. Default true. */
  statusLine?: boolean
}

export type InstallReport = {
  memory: InitMemoryResult
  hooksFile: string
  hooksBackup: string | null
  skillFile: string
  commands: string[]
  statusLine: 'installed' | 'no-cli-config' | 'disabled'
  binLink: string | null
  notes: string[]
}

/** The CLI shows a command's first line as its description, so ownership is a trailing comment. */
const COMMAND_MARKER = '<!-- installed by cursor-memory-layer -->'

const ownedCommands = (options: Pick<InstallOptions, 'repoRoot' | 'cursorHome'>) => {
  const sourceDir = path.join(options.repoRoot, 'commands')
  const targetDir = path.join(options.cursorHome, 'commands')
  return fs
    .readdirSync(sourceDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ source: path.join(sourceDir, name), target: path.join(targetDir, name) }))
}

const isOwnedCommandFile = (file: string): boolean =>
  fs.existsSync(file) && fs.readFileSync(file, 'utf-8').includes(COMMAND_MARKER)

const readHooksConfig = (hooksFile: string): HooksConfig => {
  if (!fs.existsSync(hooksFile)) return { version: 1, hooks: {} }
  const parsed: unknown = JSON.parse(fs.readFileSync(hooksFile, 'utf-8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${hooksFile} is not a JSON object; refusing to rewrite it.`)
  }
  return parsed as HooksConfig
}

const writeHooksConfig = (hooksFile: string, config: HooksConfig): string | null => {
  const next = `${JSON.stringify(config, null, 2)}\n`
  let backup: string | null = null
  let mode = 0o600
  if (fs.existsSync(hooksFile)) {
    const current = fs.readFileSync(hooksFile, 'utf-8')
    if (current === next) return null
    mode = fs.statSync(hooksFile).mode & 0o777
    backup = `${hooksFile}.cursor-memory.bak`
    fs.writeFileSync(backup, current, { mode })
  }
  fs.mkdirSync(path.dirname(hooksFile), { recursive: true })
  const temp = `${hooksFile}.tmp-${process.pid}`
  fs.writeFileSync(temp, next, { mode })
  fs.renameSync(temp, hooksFile)
  return backup
}

const skillPaths = (options: Pick<InstallOptions, 'repoRoot' | 'cursorHome'>) => ({
  source: path.join(options.repoRoot, 'skills', 'cursor-memory', 'SKILL.md'),
  target: path.join(options.cursorHome, 'skills', 'cursor-memory', 'SKILL.md'),
})

const binTarget = (repoRoot: string): string => path.join(repoRoot, 'bin', 'cursor-memory')

export function install(options: InstallOptions): InstallReport {
  const notes: string[] = []
  const memory = initMemory(options.memoryRoot)

  const hooksFile = path.join(options.cursorHome, 'hooks.json')
  const hooksBackup = writeHooksConfig(
    hooksFile,
    mergeOwnedHooks(
      readHooksConfig(hooksFile),
      buildOwnedHooks(options.repoRoot, options.nodePath),
    ),
  )

  const skill = skillPaths(options)
  fs.mkdirSync(path.dirname(skill.target), { recursive: true })
  fs.copyFileSync(skill.source, skill.target)

  const commands: string[] = []
  for (const command of ownedCommands(options)) {
    if (fs.existsSync(command.target) && !isOwnedCommandFile(command.target)) {
      notes.push(`${command.target} already exists and is not ours; left it alone.`)
      continue
    }
    fs.mkdirSync(path.dirname(command.target), { recursive: true })
    fs.copyFileSync(command.source, command.target)
    commands.push(command.target)
  }

  let statusLine: InstallReport['statusLine'] = 'disabled'
  if (options.statusLine !== false) {
    statusLine = installStatusLine(
      options.cursorHome,
      buildStatusLine(options.repoRoot, options.nodePath),
    )
      ? 'installed'
      : 'no-cli-config'
    if (statusLine === 'no-cli-config') {
      notes.push(
        'No cli-config.json yet; run cursor-agent once, then install again for the status line.',
      )
    }
  }

  let binLink: string | null = null
  if (options.binDir && fs.existsSync(options.binDir)) {
    const link = path.join(options.binDir, 'cursor-memory')
    const target = binTarget(options.repoRoot)
    const existing = fs.lstatSync(link, { throwIfNoEntry: false })
    if (!existing) {
      fs.symlinkSync(target, link)
      binLink = link
    } else if (existing.isSymbolicLink() && fs.readlinkSync(link) === target) {
      binLink = link
    } else {
      notes.push(`${link} already exists and is not this repo's CLI; left it alone.`)
    }
  } else {
    notes.push(`Add ${path.dirname(binTarget(options.repoRoot))} to PATH to use cursor-memory.`)
  }

  return {
    memory,
    hooksFile,
    hooksBackup,
    skillFile: skill.target,
    commands,
    statusLine,
    binLink,
    notes,
  }
}

export function uninstall(options: InstallOptions): string[] {
  const actions: string[] = []
  const hooksFile = path.join(options.cursorHome, 'hooks.json')
  if (fs.existsSync(hooksFile)) {
    const backup = writeHooksConfig(hooksFile, removeOwnedHooks(readHooksConfig(hooksFile)))
    actions.push(
      backup ? `Removed memory hooks from ${hooksFile}.` : `No memory hooks in ${hooksFile}.`,
    )
  }
  const skillDir = path.dirname(skillPaths(options).target)
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true })
    actions.push(`Removed ${skillDir}.`)
  }
  for (const command of ownedCommands(options)) {
    if (!isOwnedCommandFile(command.target)) continue
    fs.rmSync(command.target)
    actions.push(`Removed ${command.target}.`)
  }
  if (uninstallStatusLine(options.cursorHome)) {
    actions.push('Restored the previous CLI status line.')
  }
  if (options.binDir) {
    const link = path.join(options.binDir, 'cursor-memory')
    const existing = fs.lstatSync(link, { throwIfNoEntry: false })
    if (existing?.isSymbolicLink() && fs.readlinkSync(link) === binTarget(options.repoRoot)) {
      fs.unlinkSync(link)
      actions.push(`Removed ${link}.`)
    }
  }
  actions.push(`Kept memory repository at ${options.memoryRoot}.`)
  return actions
}
