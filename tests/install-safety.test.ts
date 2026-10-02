import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { buildOwnedHooks, isOwnedHook } from '../src/install/hooks-config.ts'
import { install, uninstall } from '../src/install/installer.ts'
import {
  buildStatusLine,
  isOwnedStatusLine,
  statusLineBackupPath,
} from '../src/install/statusline-config.ts'
import { tempDir } from './helpers.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const options = (cursorHome: string, root = repoRoot) => ({
  repoRoot: root,
  cursorHome,
  memoryRoot: path.join(cursorHome, 'memory'),
  nodePath: process.execPath,
  binDir: null,
})
const skillFile = (home: string) => path.join(home, 'skills', 'cursor-memory', 'SKILL.md')

describe('public install safety', () => {
  test('ownership marker alone does not claim a foreign command', () => {
    assert.equal(isOwnedHook({ command: 'true # cursor-memory-layer:hook' }), false)
    assert.equal(isOwnedHook({ command: 'echo /x/cursor-memory-layer/src/hooks/stop.ts' }), false)
    assert.equal(
      isOwnedHook({ command: 'node /x/cursor-memory-layer/src/hooks/stop.ts; true' }),
      false,
    )
    assert.equal(
      isOwnedStatusLine({ type: 'command', command: 'true # cursor-memory-layer:statusline' }),
      false,
    )
  })

  test('upgrades or directly uninstalls a pre-marker install in a renamed checkout', () => {
    const root = path.join(tempDir(), 'renamed checkout')
    fs.symlinkSync(repoRoot, root, 'dir')
    for (const upgrade of [false, true]) {
      const home = tempDir()
      const hooksFile = path.join(home, 'hooks.json')
      const configFile = path.join(home, 'cli-config.json')
      const foreignHook = { command: 'true # cursor-memory-layer:hook' }
      const originalStatus = { type: 'command', command: 'true # cursor-memory-layer:statusline' }
      const previousNode = '/old-node-install/bin/node'
      const legacy = buildOwnedHooks(root, previousNode, true)
      const hooks = Object.fromEntries(
        Object.entries(legacy).map(([event, hook]) => [event, [hook]]),
      )
      hooks.stop.unshift(foreignHook)
      fs.writeFileSync(hooksFile, JSON.stringify({ version: 1, hooks }))
      fs.writeFileSync(
        configFile,
        JSON.stringify({ statusLine: buildStatusLine(root, previousNode, true) }),
      )
      fs.writeFileSync(statusLineBackupPath(home), JSON.stringify(originalStatus))
      if (upgrade) {
        install(options(home, root))
        const updated = JSON.parse(fs.readFileSync(hooksFile, 'utf-8'))
        assert.equal(updated.hooks.stop.length, 2)
        assert.equal(updated.hooks.sessionStart.length, 1)
      }
      uninstall(options(home, root))
      assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile, 'utf-8')).hooks, {
        stop: [foreignHook],
      })
      assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf-8')).statusLine, originalStatus)
    }
  })

  test('hook and statusline shell commands preserve literal special characters in paths', () => {
    const root = path.join(tempDir(), "custom $HOME 'checkout'")
    fs.symlinkSync(repoRoot, root, 'dir')
    const home = tempDir()
    const env = {
      ...process.env,
      CURSOR_HOME: home,
      CURSOR_MEMORY_DIR: path.join(home, 'missing-memory'),
      CURSOR_MEMORY_REFLECTION: '0',
    }
    const hooks = buildOwnedHooks(root, process.execPath)
    const output = execFileSync('/bin/sh', ['-c', hooks.preToolUse.command], {
      input: JSON.stringify({ tool_name: 'Shell', tool_input: { command: 'echo ok' } }),
      env,
      encoding: 'utf-8',
    })
    assert.deepEqual(JSON.parse(output), {})
    const status = execFileSync(
      '/bin/sh',
      ['-c', buildStatusLine(root, process.execPath).command],
      {
        input: JSON.stringify({ cwd: home }),
        env,
        encoding: 'utf-8',
      },
    )
    assert.ok(status.trim().length > 0)
  })

  test('renamed checkout installs once and restores foreign hooks and statusline', () => {
    const root = path.join(tempDir(), 'custom checkout')
    fs.symlinkSync(repoRoot, root, 'dir')
    const home = tempDir()
    const hooksFile = path.join(home, 'hooks.json')
    const configFile = path.join(home, 'cli-config.json')
    const hooks = { version: 1, hooks: { stop: [{ command: 'foreign-stop' }] } }
    const config = { statusLine: { type: 'command', command: 'foreign-status' }, model: 'auto' }
    fs.writeFileSync(hooksFile, JSON.stringify(hooks))
    fs.writeFileSync(configFile, JSON.stringify(config))
    install(options(home, root))
    const once = fs.readFileSync(hooksFile, 'utf-8')
    install(options(home, root))
    assert.equal(fs.readFileSync(hooksFile, 'utf-8'), once)
    assert.equal(JSON.parse(once).hooks.stop.length, 2)
    uninstall(options(home, root))
    assert.deepEqual(JSON.parse(fs.readFileSync(hooksFile, 'utf-8')), hooks)
    assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf-8')), config)
  })

  test('does not overwrite or delete a foreign skill or its companion files', () => {
    const home = tempDir()
    const target = skillFile(home)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'foreign entry')
    const companion = path.join(path.dirname(target), 'notes.md')
    fs.writeFileSync(companion, 'foreign notes')
    const report = install(options(home))
    assert.equal(report.skillFile, null)
    assert.ok(report.notes.some((note) => note.includes('left it alone')))
    uninstall(options(home))
    assert.equal(fs.readFileSync(target, 'utf-8'), 'foreign entry')
    assert.equal(fs.readFileSync(companion, 'utf-8'), 'foreign notes')
  })

  test('does not write through linked skill entries or directories even with exact source content', () => {
    const content = fs.readFileSync(
      path.join(repoRoot, 'skills', 'cursor-memory', 'SKILL.md'),
      'utf-8',
    )
    for (const linkDirectory of [false, true]) {
      const home = tempDir()
      const target = skillFile(home)
      const external = path.join(tempDir(), 'SKILL.md')
      fs.writeFileSync(external, content)
      if (linkDirectory) {
        fs.mkdirSync(path.dirname(path.dirname(target)), { recursive: true })
        fs.symlinkSync(path.dirname(external), path.dirname(target), 'dir')
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.symlinkSync(external, target)
      }
      assert.equal(install(options(home)).skillFile, null)
      uninstall(options(home))
      assert.equal(fs.readFileSync(external, 'utf-8'), content)
      assert.equal(fs.existsSync(target), true)
    }
  })

  test('removes only the installed entry and preserves companions', () => {
    const home = tempDir()
    install(options(home))
    const target = skillFile(home)
    const companion = path.join(path.dirname(target), 'notes.md')
    fs.writeFileSync(companion, 'user notes')
    uninstall(options(home))
    assert.equal(fs.existsSync(target), false)
    assert.equal(fs.readFileSync(companion, 'utf-8'), 'user notes')
  })

  test('leaves a locally edited installed skill untouched on reinstall and uninstall', () => {
    const home = tempDir()
    install(options(home))
    const target = skillFile(home)
    const edited = `user edit\n${fs.readFileSync(target, 'utf-8')}`
    fs.writeFileSync(target, edited)
    assert.equal(install(options(home)).skillFile, null)
    uninstall(options(home))
    assert.equal(fs.readFileSync(target, 'utf-8'), edited)
  })

  test('adopts the exact shipped legacy skill without deleting added files', () => {
    const home = tempDir()
    const target = skillFile(home)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(repoRoot, 'skills', 'cursor-memory', 'SKILL.md'), target)
    const companion = path.join(path.dirname(target), 'notes.md')
    fs.writeFileSync(companion, 'user notes')
    assert.equal(install(options(home)).skillFile, target)
    uninstall(options(home))
    assert.equal(fs.existsSync(target), false)
    assert.equal(fs.readFileSync(companion, 'utf-8'), 'user notes')
  })
})
