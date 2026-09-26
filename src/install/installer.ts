import * as fs from 'node:fs'
import * as path from 'node:path'
import { type InitMemoryResult, initMemory } from '../memory/init.ts'
import {
  buildOwnedHooks,
  type HooksConfig,
  mergeOwnedHooks,
  removeOwnedHooks,
} from './hooks-config.ts'

export type InstallOptions = {
  repoRoot: string
  cursorHome: string
  memoryRoot: string
  nodePath: string
  binDir: string | null
}

export type InstallReport = {
  memory: InitMemoryResult
  hooksFile: string
  hooksBackup: string | null
  skillFile: string
  binLink: string | null
  notes: string[]
}

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

  return { memory, hooksFile, hooksBackup, skillFile: skill.target, binLink, notes }
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
