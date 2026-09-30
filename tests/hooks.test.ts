import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { removeDreamTranscripts } from '../src/dream/runner.ts'
import { readActiveConversation } from '../src/dream/state.ts'
import { resolveTranscriptPath } from '../src/dream/trigger.ts'
import { evaluateShellCommand } from '../src/hooks/pre-tool-use.ts'
import { reflectOnSession } from '../src/hooks/session-end.ts'
import { buildSessionStartOutput } from '../src/hooks/session-start.ts'
import { mergeOwnedHooks, removeOwnedHooks } from '../src/install/hooks-config.ts'
import { install, uninstall } from '../src/install/installer.ts'
import { getMemoryLog, readCommittedMemoryFile } from '../src/memory/repository.ts'
import { rankTranscripts } from '../src/recall/rank.ts'
import {
  cleanUserText,
  cursorProjectKey,
  listTranscriptFiles,
  readTranscript,
} from '../src/recall/transcripts.ts'
import { extractDurableIntents } from '../src/reflection.ts'
import { tempDir, tempMemory, tempWorkspace, transcriptLine, writeTranscript } from './helpers.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')

describe('hooks.json merge', () => {
  const existing = {
    hooks: {
      sessionStart: [{ command: 'bash other.sh' }],
      preToolUse: [{ command: './rtk.sh', matcher: 'Shell' }],
    },
    version: 1,
  }
  const owned = {
    sessionStart: { command: 'node /x/cursor-memory-layer/src/hooks/session-start.ts' },
    preToolUse: {
      command: 'node /x/cursor-memory-layer/src/hooks/pre-tool-use.ts',
      matcher: 'Shell',
    },
  }

  test('appends owned entries, keeps others, and is idempotent', () => {
    const once = mergeOwnedHooks(existing, owned)
    assert.deepEqual(mergeOwnedHooks(once, owned), once)
    assert.deepEqual(once.hooks?.sessionStart, [{ command: 'bash other.sh' }, owned.sessionStart])
    assert.deepEqual(removeOwnedHooks(once), existing)
  })

  test('install and uninstall round-trip a real hooks file', () => {
    const cursorHome = tempDir()
    const binDir = tempDir()
    const hooksFile = path.join(cursorHome, 'hooks.json')
    const original = `${JSON.stringify(existing, null, 2)}\n`
    fs.writeFileSync(hooksFile, original, { mode: 0o600 })
    const options = {
      repoRoot,
      cursorHome,
      memoryRoot: path.join(cursorHome, 'memory'),
      nodePath: process.execPath,
      binDir,
    }

    const report = install(options)
    assert.equal(report.memory.created, true)
    assert.equal(fs.readFileSync(`${hooksFile}.cursor-memory.bak`, 'utf-8'), original)
    const installed = JSON.parse(fs.readFileSync(hooksFile, 'utf-8'))
    assert.equal(installed.hooks.sessionStart.length, 2)
    assert.equal(installed.hooks.sessionEnd.length, 1)
    assert.equal(fs.statSync(hooksFile).mode & 0o777, 0o600)
    assert.ok(fs.existsSync(path.join(cursorHome, 'skills', 'cursor-memory', 'SKILL.md')))
    assert.equal(
      fs.readlinkSync(path.join(binDir, 'cursor-memory')),
      path.join(repoRoot, 'bin', 'cursor-memory'),
    )

    install(options)
    assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile, 'utf-8')), installed)

    uninstall(options)
    assert.equal(fs.readFileSync(hooksFile, 'utf-8'), original)
    assert.equal(fs.existsSync(path.join(binDir, 'cursor-memory')), false)
    assert.ok(fs.existsSync(path.join(cursorHome, 'memory', '.git')))
  })
})

describe('preToolUse guard', () => {
  const memoryRoot = path.join(os.homedir(), '.cursor', 'memory')
  const shell = (command: string, workingDirectory?: string) => ({
    tool_name: 'Shell',
    tool_input: { command, working_directory: workingDirectory },
  })

  test('asks before destructive commands against memory', () => {
    for (const input of [
      shell(`git -C ${memoryRoot} reset --hard HEAD~1`),
      shell('rm -rf ~/.cursor/memory'),
      shell('git push --force origin main', memoryRoot),
      shell('git filter-repo --path system', memoryRoot),
      shell('git -C "$HOME/.cursor/memory" clean -fd'),
    ]) {
      assert.equal(
        (evaluateShellCommand(input, memoryRoot) as { permission?: string }).permission,
        'ask',
      )
    }
  })

  test('stays neutral otherwise', () => {
    for (const input of [
      shell('git -C ~/.cursor/memory log --oneline'),
      shell('git reset --hard', '/tmp/project'),
      shell('cursor-memory revert abc1234'),
      { tool_name: 'Read', tool_input: { path: memoryRoot } },
    ]) {
      assert.deepEqual(evaluateShellCommand(input, memoryRoot), {})
    }
  })
})

describe('reflection', () => {
  test('extracts only the human statements of lasting intent', () => {
    assert.deepEqual(
      extractDurableIntents([
        { role: 'user', text: 'Fix the bug. From now on, run tests before committing.' },
        { role: 'assistant', text: 'I will always remember that.' },
        { role: 'user', text: 'ต่อไปนี้ตอบเป็นภาษาไทยนะ\nแล้วก็ช่วยดู log หน่อย' },
        { role: 'user', text: 'Remember my token is ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
      ]),
      ['From now on, run tests before committing.', 'ต่อไปนี้ตอบเป็นภาษาไทยนะ'],
    )
  })

  test('sessionEnd writes a committed archive note and skips when nothing durable', () => {
    const memoryRoot = tempMemory()
    const workspace = tempWorkspace('reflect-app')
    const projectsDir = tempDir()
    const quiet = writeTranscript(projectsDir, 'p', 'aaaa1111', [
      transcriptLine('user', 'What time is it?'),
    ])
    assert.deepEqual(
      reflectOnSession({ transcript_path: quiet, workspace_roots: [workspace] }, memoryRoot),
      {
        status: 'skipped',
        reason: 'no durable intent found',
      },
    )

    const durable = writeTranscript(projectsDir, 'p', 'bbbb2222', [
      transcriptLine(
        'user',
        '<timestamp>now</timestamp>\n<user_query>\nPlease never use npm here.\n</user_query>',
      ),
    ])
    const result = reflectOnSession(
      { transcript_path: durable, workspace_roots: [workspace], conversation_id: 'bbbb2222-xyz' },
      memoryRoot,
    )
    assert.equal(result.status, 'written')
    const relativePath = result.status === 'written' ? result.relativePath : ''
    assert.match(
      relativePath,
      /^archives\/projects\/reflect-app\/learnings\/\d{4}-\d{2}-\d{2}_bbbb2222\.md$/,
    )
    assert.match(
      readCommittedMemoryFile(memoryRoot, relativePath) || '',
      /- Please never use npm here\./,
    )
    assert.equal(getMemoryLog(memoryRoot, 1)[0].subject, 'memory: reflection from bbbb2222')
  })
})

describe('session and dream bookkeeping', () => {
  test('sessionStart remembers the conversation when the shell cannot', () => {
    const memoryRoot = tempMemory()
    buildSessionStartOutput(
      { workspace_roots: [tempWorkspace('app')], conversation_id: 'chat-1' },
      memoryRoot,
    )
    assert.equal(readActiveConversation(memoryRoot), 'chat-1')
  })

  test('preCompact finds the transcript when Cursor sends a null path', () => {
    const projectsDir = tempDir()
    const workspace = '/Users/me/app'
    const previous = process.env.CURSOR_PROJECTS_DIR
    process.env.CURSOR_PROJECTS_DIR = projectsDir
    try {
      const file = writeTranscript(projectsDir, cursorProjectKey(workspace), 'conv-9', [
        transcriptLine('user', '<user_query>\nRemember the staging port.\n</user_query>'),
      ])
      assert.equal(
        resolveTranscriptPath({
          conversation_id: 'conv-9',
          workspace_roots: [workspace],
          transcript_path: null,
        }),
        file,
      )
    } finally {
      if (previous === undefined) delete process.env.CURSOR_PROJECTS_DIR
      else process.env.CURSOR_PROJECTS_DIR = previous
    }
  })

  test('dream transcripts are removed so recall cannot index them', () => {
    const projectsDir = tempDir()
    const workspace = tempDir()
    const previousProjects = process.env.CURSOR_PROJECTS_DIR
    const previousDream = process.env.CURSOR_MEMORY_DREAM_WORKSPACE
    process.env.CURSOR_PROJECTS_DIR = projectsDir
    process.env.CURSOR_MEMORY_DREAM_WORKSPACE = workspace
    try {
      const file = writeTranscript(projectsDir, cursorProjectKey(workspace), 'dream-chat', [
        transcriptLine('user', 'reflector scratch'),
      ])
      removeDreamTranscripts()
      assert.equal(fs.existsSync(file), false)
    } finally {
      if (previousProjects === undefined) delete process.env.CURSOR_PROJECTS_DIR
      else process.env.CURSOR_PROJECTS_DIR = previousProjects
      if (previousDream === undefined) delete process.env.CURSOR_MEMORY_DREAM_WORKSPACE
      else process.env.CURSOR_MEMORY_DREAM_WORKSPACE = previousDream
    }
  })
})

describe('recall', () => {
  test('parses Cursor transcripts and ranks the relevant chat first', () => {
    const projectsDir = tempDir()
    const project = cursorProjectKey('/Users/me/ghq/github.com/acme/widget')
    assert.equal(project, 'Users-me-ghq-github-com-acme-widget')
    writeTranscript(projectsDir, project, 'chat-deploy', [
      transcriptLine(
        'user',
        '<user_query>\nHow do we deploy the widget to staging?\n</user_query>',
      ),
      transcriptLine('assistant', 'Deploys go through the staging pipeline with a tagged release.'),
    ])
    writeTranscript(projectsDir, 'Users-me-other', 'chat-css', [
      transcriptLine('user', 'Center this div with flexbox'),
    ])

    assert.equal(listTranscriptFiles(projectsDir).length, 2)
    assert.equal(listTranscriptFiles(projectsDir, project).length, 1)
    assert.equal(listTranscriptFiles(projectsDir, project, 'chat-deploy').length, 0)
    const transcripts = listTranscriptFiles(projectsDir).map((file) => readTranscript(file))
    const hits = rankTranscripts(
      transcripts.filter((transcript) => transcript !== null),
      'staging deploy',
    )
    assert.equal(hits[0].id, 'chat-deploy')
    assert.equal(hits[0].project, project)
    assert.equal(hits[0].firstPrompt, 'How do we deploy the widget to staging?')
    assert.match(hits[0].snippet, /staging/)
  })

  test('cleanUserText keeps only the user query', () => {
    assert.equal(
      cleanUserText(
        '<attached_files>big</attached_files>\n<timestamp>t</timestamp>\n<user_query>\nhello\n</user_query>',
      ),
      'hello',
    )
  })
})
