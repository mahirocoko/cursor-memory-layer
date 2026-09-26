#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { joinOptionValues } from './cli-args.ts'
import { runDream } from './dream/runner.ts'
import { readDreamLog } from './dream/state.ts'
import {
  createBackup,
  diffMemory,
  exportMemory,
  listBackups,
  restoreBackup,
} from './memory/backup.ts'
import {
  estimateTokens,
  getBackupDir,
  getCursorHome,
  getCursorProjectsDir,
  getDreamWorkspace,
  getMemoryRoot,
} from './memory/config.ts'
import { type DoctorFinding, runDoctor } from './memory/doctor.ts'
import {
  appendMemory,
  deleteMemory,
  type EditResult,
  moveMemory,
  replaceInMemory,
  revertMemory,
  writeMemory,
} from './memory/editor.ts'
import { resolveProjectSlug } from './memory/identity.ts'
import { initMemory } from './memory/init.ts'
import {
  inspectCommittedMemoryProjection,
  listCommittedSkills,
  renderCommittedMemoryProjection,
} from './memory/projection.ts'
import {
  getRemoteStatus,
  pullFromRemote,
  pushToRemote,
  setRemote,
  unsetRemote,
} from './memory/remote.ts'
import { getMemoryLog, readCommittedMemoryFile } from './memory/repository.ts'
import { searchMemory } from './memory/search.ts'
import { loadSettings } from './memory/settings.ts'
import { openInBrowser, writePalace } from './palace/generate.ts'
import { rankTranscripts } from './recall/rank.ts'
import { cursorProjectKey, listTranscriptFiles, readTranscript } from './recall/transcripts.ts'
import { writeReflectionNote } from './reflection.ts'

const USAGE = `cursor-memory — Letta-style, git-backed memory for Cursor

Usage:
  cursor-memory init [--workspace <dir>] [--no-project]
  cursor-memory status [--workspace <dir>] [--json]
  cursor-memory show [--workspace <dir>]          Print exactly what new chats receive
  cursor-memory read <path>
  cursor-memory write <path> [--description <text>] [--read-only] [--body <text>] [--drop <line>...]
  cursor-memory append <path> [--body <text>] [--description <text>]
  cursor-memory replace <path> --old <text> --new <text> [--drop <line>...]
  cursor-memory move <from> <to>
  cursor-memory delete <path> [--drop <line>...]
                                                  A system/ edit that loses 3+ lines found nowhere
                                                  else in memory is refused; --drop names each
                                                  line the human agreed to remove
  cursor-memory log [path] [--limit <n>]
  cursor-memory revert <sha>
  cursor-memory search <terms...> [--scope <prefix>] [--limit <n>]
  cursor-memory recall <terms...> [--project] [--workspace <dir>] [--limit <n>]
  cursor-memory slug [--workspace <dir>]
  cursor-memory skills                            List skills/<name>/SKILL.md

Reflection (Letta "dream"):
  cursor-memory dream [--transcript <file>] [--model <slug>] [--workspace <dir>]
                      [--dry-run] [--json]        Reflect now (default: latest chat here);
                                                  --dry-run shows the edits without committing
  cursor-memory dreams [--limit <n>]              Recent reflection runs
  cursor-memory reflect --transcript <file>       Heuristic archive note, no model

Care and history:
  cursor-memory doctor [--json] [--workspace <dir>]
  cursor-memory palace [--out <file>] [--no-open] [--workspace <dir>]
  cursor-memory diff [<rev> [<rev>]]
  cursor-memory export --out <dir>
  cursor-memory backup | backups | restore --from <name|path> --force
  cursor-memory remote set <url> | unset | status | push | pull

Write commands read the body from stdin when --body is absent. Every write is a
path-scoped git commit; add --message <text> to name it and --force to change a
read_only file. Memory root: $CURSOR_MEMORY_DIR or ~/.cursor/memory. Settings:
~/.cursor/cursor-memory.json.
`

const DOCTOR_ICONS: Record<DoctorFinding['level'], string> = {
  ok: 'ok  ',
  warn: 'warn',
  error: 'FAIL',
}

const latestTranscript = (workspace: string): string | null => {
  const files = listTranscriptFiles(getCursorProjectsDir(), cursorProjectKey(workspace))
  return (
    files
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)[0]?.file || null
  )
}

const readStdin = (): string => (process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf-8'))

const printEdit = (result: EditResult): void => {
  if (!result.committed) {
    console.log('No change; memory already matches.')
    return
  }
  const paths = result.paths.length > 0 ? ` ${result.paths.join(', ')}` : ''
  console.log(`Committed ${result.sha?.slice(0, 8)}${paths}. Active from the next chat.`)
}

function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: joinOptionValues(argv),
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
      message: { type: 'string', short: 'm' },
      old: { type: 'string' },
      new: { type: 'string' },
      scope: { type: 'string' },
      limit: { type: 'string' },
      transcript: { type: 'string' },
      model: { type: 'string' },
      out: { type: 'string' },
      from: { type: 'string' },
      drop: { type: 'string', multiple: true },
      'no-open': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'read-only': { type: 'boolean' },
      'no-project': { type: 'boolean' },
      project: { type: 'boolean' },
      force: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command, ...rest] = positionals
  const memoryRoot = getMemoryRoot()
  const workspace = values.workspace || process.cwd()
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined
  const edit = { memoryRoot, message: values.message, force: values.force, drop: values.drop }
  const requirePath = (index = 0): string => {
    const value = rest[index]
    if (!value) throw new Error(`Missing path.\n\n${USAGE}`)
    return value
  }

  switch (command) {
    case undefined:
    case 'help':
      console.log(USAGE)
      return
    case 'init': {
      const project = values['no-project']
        ? undefined
        : { slug: resolveProjectSlug(workspace, memoryRoot), workspacePath: workspace }
      const result = initMemory(memoryRoot, project)
      console.log(
        `${result.created ? 'Created' : 'Found'} memory repository at ${memoryRoot}.` +
          (result.seededPaths.length > 0
            ? ` Seeded ${result.seededPaths.join(', ')} (${result.sha?.slice(0, 8)}).`
            : ' Nothing to seed.'),
      )
      return
    }
    case 'status': {
      const projectSlug = resolveProjectSlug(workspace, memoryRoot)
      const projection = inspectCommittedMemoryProjection(memoryRoot, projectSlug)
      const rendered = renderCommittedMemoryProjection(projection)
      const summary = {
        memoryRoot: projection.memoryRoot,
        revision: projection.revision,
        projectSlug,
        repository: projection.repository,
        estimatedTokens: estimateTokens(rendered),
        system: [...projection.globalSystem, ...projection.projectSystem].map(
          (doc) => doc.relativePath,
        ),
        references: projection.references.map((doc) => doc.relativePath),
        diagnostics: projection.diagnostics,
        recent: getMemoryLog(memoryRoot, 5).map(
          (entry) => `${entry.sha.slice(0, 8)} ${entry.subject}`,
        ),
      }
      if (values.json) {
        console.log(JSON.stringify(summary, null, 2))
        return
      }
      console.log(`Memory root: ${summary.memoryRoot}`)
      console.log(`Repository: ${summary.repository.summary}`)
      console.log(`Revision: ${summary.revision?.slice(0, 8) || 'none'}  Project: ${projectSlug}`)
      console.log(`Loaded every chat: ~${summary.estimatedTokens} tokens`)
      console.log(`System: ${summary.system.join(', ') || '(none)'}`)
      console.log(`Reference: ${summary.references.join(', ') || '(none)'}`)
      if (summary.diagnostics.length > 0)
        console.log(`Diagnostics:\n  ${summary.diagnostics.join('\n  ')}`)
      if (summary.recent.length > 0) console.log(`Recent:\n  ${summary.recent.join('\n  ')}`)
      return
    }
    case 'show': {
      const projection = inspectCommittedMemoryProjection(
        memoryRoot,
        resolveProjectSlug(workspace, memoryRoot),
      )
      process.stdout.write(renderCommittedMemoryProjection(projection))
      return
    }
    case 'slug':
      console.log(resolveProjectSlug(workspace, memoryRoot))
      return
    case 'read': {
      const content = readCommittedMemoryFile(memoryRoot, requirePath())
      if (content === null) throw new Error(`${rest[0]} is not in committed memory.`)
      process.stdout.write(content)
      return
    }
    case 'write':
      printEdit(
        writeMemory(requirePath(), values.body ?? readStdin(), {
          ...edit,
          description: values.description,
          readOnly: values['read-only'],
        }),
      )
      return
    case 'append':
      printEdit(
        appendMemory(requirePath(), values.body ?? readStdin(), {
          ...edit,
          description: values.description,
        }),
      )
      return
    case 'replace':
      if (values.old === undefined || values.new === undefined) {
        throw new Error('replace needs --old and --new.')
      }
      printEdit(replaceInMemory(requirePath(), values.old, values.new, edit))
      return
    case 'move':
      printEdit(moveMemory(requirePath(0), requirePath(1), edit))
      return
    case 'delete':
      printEdit(deleteMemory(requirePath(), edit))
      return
    case 'revert':
      printEdit(revertMemory(requirePath(), edit))
      return
    case 'log': {
      const entries = getMemoryLog(memoryRoot, limit || 20, rest[0])
      if (entries.length === 0) console.log('No memory history yet.')
      for (const entry of entries) {
        console.log(`${entry.sha.slice(0, 8)} ${entry.date} ${entry.subject}`)
        if (entry.paths.length > 0) console.log(`  ${entry.paths.join(', ')}`)
      }
      return
    }
    case 'search': {
      const matches = searchMemory(memoryRoot, rest.join(' '), { scope: values.scope, limit })
      if (matches.length === 0) console.log('No matching memory.')
      for (const match of matches)
        console.log(`${match.relativePath}:${match.lineNumber}  ${match.line}`)
      return
    }
    case 'recall': {
      const projectKey = values.project ? cursorProjectKey(workspace) : undefined
      const dreamKey = cursorProjectKey(getDreamWorkspace())
      const transcripts = listTranscriptFiles(
        getCursorProjectsDir(),
        projectKey,
        process.env.CURSOR_CONVERSATION_ID,
      )
        .filter(
          (file) => path.basename(path.dirname(path.dirname(path.dirname(file)))) !== dreamKey,
        )
        .map(readTranscript)
        .filter((transcript) => transcript !== null)
      const hits = rankTranscripts(transcripts, rest.join(' '), { limit })
      if (hits.length === 0)
        console.log(`No matching chats among ${transcripts.length} transcript(s).`)
      hits.forEach((hit, index) => {
        console.log(
          `[${index + 1}] ${hit.id.slice(0, 8)}  ${hit.mtime.toISOString().slice(0, 16)}  score ${hit.score}  ${hit.project}`,
        )
        console.log(`    opening: ${hit.firstPrompt}`)
        if (hit.snippet) console.log(`    match: ${hit.snippet}`)
        console.log(`    file: ${hit.filePath}`)
      })
      return
    }
    case 'reflect': {
      if (!values.transcript) throw new Error('reflect needs --transcript <file>.')
      const transcript = readTranscript(values.transcript)
      if (!transcript) throw new Error(`Cannot read transcript ${values.transcript}.`)
      const result = writeReflectionNote({
        memoryRoot,
        projectSlug: resolveProjectSlug(workspace, memoryRoot),
        conversationId: transcript.id,
        messages: transcript.messages,
      })
      console.log(
        result.status === 'written'
          ? `Wrote ${result.relativePath} (${result.intents.length} candidate(s), ${result.sha?.slice(0, 8)}).`
          : `Skipped: ${result.reason}.`,
      )
      return
    }
    case 'skills': {
      const skills = listCommittedSkills(memoryRoot)
      if (skills.length === 0) console.log('No memory skills yet. Write skills/<name>/SKILL.md.')
      for (const skill of skills) console.log(`${skill.relativePath}  ${skill.description}`)
      return
    }
    case 'dream': {
      const transcriptPath = values.transcript || latestTranscript(workspace)
      if (!transcriptPath)
        throw new Error(`No Cursor chat found for ${workspace}; pass --transcript.`)
      const transcript = readTranscript(transcriptPath)
      if (!transcript) throw new Error(`Cannot read transcript ${transcriptPath}.`)
      const settings = loadSettings().reflection
      const startedAt = Date.now()
      const outcome = runDream(
        {
          transcriptPath,
          conversationId: transcript.id,
          workspace,
          trigger: 'manual',
          model: values.model || (settings.model === 'inherit' ? 'auto' : settings.model),
        },
        { memoryRoot, settings, dryRun: values['dry-run'] },
      )
      const seconds = Math.round((Date.now() - startedAt) / 1000)
      if (values.json) {
        console.log(JSON.stringify({ ...outcome, seconds }, null, 2))
      } else {
        console.log(
          `${outcome.status}: ${outcome.detail}${outcome.sha ? ` (${outcome.sha.slice(0, 8)})` : ''}`,
        )
        console.log(`Model: ${outcome.model || 'n/a'}, ${seconds}s`)
        for (const operation of outcome.operations || []) {
          if (operation.op === 'delete') {
            console.log(`\n- delete ${operation.path}`)
            continue
          }
          const status = outcome.planned?.includes(operation.path) ? '' : ' (no change or rejected)'
          console.log(`\n- ${operation.op} ${operation.path}${status}`)
          if (operation.op === 'replace') {
            console.log(`  old:\n${operation.old.replace(/^/gm, '    ')}`)
            console.log(`  new:\n${operation.new.replace(/^/gm, '    ')}`)
            continue
          }
          if (operation.description) console.log(`  description: ${operation.description}`)
          console.log(operation.body.replace(/^/gm, '    '))
        }
        if (outcome.rejected) console.log(`Rejected:\n  ${outcome.rejected.join('\n  ')}`)
      }
      if (outcome.status === 'failed') process.exitCode = 1
      return
    }
    case 'dreams': {
      const runs = readDreamLog(memoryRoot, limit || 10)
      if (runs.length === 0) console.log('No reflection has run yet.')
      for (const run of runs) {
        console.log(
          `${run.at.slice(0, 16)} ${run.trigger.padEnd(11)} ${run.status.padEnd(9)} ${run.sha ? `${run.sha.slice(0, 8)} ` : ''}${run.detail}`,
        )
        if (run.rejected) console.log(`  rejected: ${run.rejected.join('; ')}`)
      }
      return
    }
    case 'doctor': {
      const findings = runDoctor({
        memoryRoot,
        cursorHome: getCursorHome(),
        projectSlug: resolveProjectSlug(workspace, memoryRoot),
      })
      if (values.json) console.log(JSON.stringify(findings, null, 2))
      else
        for (const finding of findings)
          console.log(`${DOCTOR_ICONS[finding.level]}  ${finding.check}: ${finding.detail}`)
      if (findings.some((finding) => finding.level === 'error')) process.exitCode = 2
      return
    }
    case 'palace': {
      const outFile = path.resolve(values.out || path.join(getCursorHome(), 'memory-palace.html'))
      writePalace(memoryRoot, resolveProjectSlug(workspace, memoryRoot), outFile)
      const opened = !values['no-open'] && openInBrowser(outFile)
      console.log(`Wrote ${outFile}${opened ? ' and opened it' : ''}.`)
      return
    }
    case 'diff':
      process.stdout.write(diffMemory(memoryRoot, rest) || 'No changes.\n')
      return
    case 'export': {
      if (!values.out) throw new Error('export needs --out <dir>.')
      const result = exportMemory(memoryRoot, values.out)
      console.log(
        JSON.stringify({
          exportedFrom: memoryRoot,
          exportedTo: result.outDir,
          files: result.files,
        }),
      )
      return
    }
    case 'backup':
      console.log(JSON.stringify(createBackup(memoryRoot, getBackupDir())))
      return
    case 'backups':
      console.log(JSON.stringify({ backups: listBackups(getBackupDir()) }, null, 2))
      return
    case 'restore': {
      if (!values.from) throw new Error('restore needs --from <backup name or path>.')
      if (!values.force)
        throw new Error('restore replaces the committed memory tree; pass --force to confirm.')
      const result = restoreBackup(memoryRoot, getBackupDir(), values.from)
      console.log(
        result.committed
          ? `Restored ${result.source} as ${result.sha?.slice(0, 8)}; \`cursor-memory revert ${result.sha?.slice(0, 8)}\` undoes it.`
          : `Memory already matches ${result.source}.`,
      )
      return
    }
    case 'remote': {
      const [action, url] = rest
      if (action === 'set') {
        if (!url) throw new Error('remote set needs a URL.')
        const result = setRemote(memoryRoot, url)
        console.log(
          `Mirror set. Initial push ${result.ok ? 'succeeded' : `failed: ${result.detail}`}.`,
        )
      } else if (action === 'unset') {
        console.log(unsetRemote(memoryRoot).join('\n'))
      } else if (action === 'push') {
        const result = pushToRemote(memoryRoot)
        console.log(result.ok ? 'Pushed main.' : `Push failed: ${result.detail}`)
        if (!result.ok) process.exitCode = 1
      } else if (action === 'pull') {
        console.log(pullFromRemote(memoryRoot).detail)
      } else if (action === 'status' || action === undefined) {
        const status = getRemoteStatus(memoryRoot)
        if (values.json) console.log(JSON.stringify(status, null, 2))
        else {
          console.log(status.url ? `Mirror: ${status.url}` : 'Local only (no mirror set).')
          if (status.url && !status.hookInstalled)
            console.log('Warning: post-commit mirror hook is missing.')
          if (status.recentLog.length > 0)
            console.log(`Recent pushes:\n  ${status.recentLog.join('\n  ')}`)
        }
      } else {
        throw new Error('remote takes set <url>, unset, status, push, or pull.')
      }
      return
    }
    default:
      throw new Error(`Unknown command: ${command}\n\n${USAGE}`)
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
