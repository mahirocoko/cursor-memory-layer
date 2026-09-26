import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { install, uninstall } from '../src/install/installer.ts'
import { isOwnedStatusLine, statusLineBackupPath } from '../src/install/statusline-config.ts'
import { tempDir, tempMemory } from './helpers.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
const script = path.join(repoRoot, 'statusline', 'statusline.mjs')

const render = (memoryRoot: string): string =>
  execFileSync(process.execPath, [script], {
    input: JSON.stringify({ cwd: tempDir(), render_width_chars: 120 }),
    env: { ...process.env, CURSOR_MEMORY_DIR: memoryRoot },
    encoding: 'utf-8',
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colors
  }).replace(/\u001b\[[0-9;]*m/g, '')

describe('status line memory segment', () => {
  test('shows clean, dirty, reflecting, failed, and reflections today', () => {
    const memoryRoot = tempMemory()
    const stateDir = path.join(memoryRoot, '.git', 'cursor-memory')
    fs.mkdirSync(stateDir, { recursive: true })
    assert.match(render(memoryRoot), /🧠✓(?! ↻)/)

    fs.writeFileSync(path.join(memoryRoot, 'system', 'scratch.md'), 'x')
    assert.match(render(memoryRoot), /🧠\+1/)
    fs.rmSync(path.join(memoryRoot, 'system', 'scratch.md'))

    fs.writeFileSync(
      path.join(stateDir, 'dream.log'),
      `${JSON.stringify({ at: new Date().toISOString(), status: 'committed' })}\n${JSON.stringify({ at: '2020-01-01T00:00:00Z', status: 'committed' })}\n`,
    )
    assert.match(render(memoryRoot), /🧠✓ ↻1/)

    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({ failures: 2 }))
    assert.match(render(memoryRoot), /🧠! ↻1/)

    fs.writeFileSync(
      path.join(stateDir, 'dream.lock'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    )
    assert.match(render(memoryRoot), /🧠… ↻1/)
  })

  test('omits the segment when there is no memory repo', () => {
    assert.doesNotMatch(render(path.join(tempDir(), 'missing')), /🧠/)
  })
})

describe('install: status line and commands', () => {
  const options = (cursorHome: string) => ({
    repoRoot,
    cursorHome,
    memoryRoot: path.join(cursorHome, 'memory'),
    nodePath: process.execPath,
    binDir: null,
  })

  test('swaps in our status line, keeps other settings, and restores on uninstall', () => {
    const cursorHome = tempDir()
    const cliConfig = path.join(cursorHome, 'cli-config.json')
    const original = {
      display: { mode: 'zen' },
      statusLine: { type: 'command', command: '~/.cursor/statusline.mjs', padding: 1 },
    }
    fs.writeFileSync(cliConfig, JSON.stringify(original), { mode: 0o600 })
    const foreign = path.join(cursorHome, 'commands', 'memory-palace.md')
    fs.mkdirSync(path.dirname(foreign), { recursive: true })
    fs.writeFileSync(foreign, '# someone else\n')

    const report = install(options(cursorHome))
    assert.equal(report.statusLine, 'installed')
    const installed = JSON.parse(fs.readFileSync(cliConfig, 'utf-8'))
    assert.deepEqual(installed.display, original.display)
    assert.equal(isOwnedStatusLine(installed.statusLine), true)
    assert.equal(fs.statSync(cliConfig).mode & 0o777, 0o600)
    assert.deepEqual(report.commands.map((file) => path.basename(file)).sort(), [
      'memory-doctor.md',
      'memory-dream.md',
      'memory-groom.md',
      'memory-init.md',
      'memory-recall.md',
      'memory-skill.md',
      'memory.md',
    ])
    assert.equal(fs.readFileSync(foreign, 'utf-8'), '# someone else\n')
    assert.ok(report.notes.some((note) => note.includes('memory-palace.md')))

    install(options(cursorHome))
    assert.deepEqual(JSON.parse(fs.readFileSync(cliConfig, 'utf-8')), installed)
    assert.deepEqual(
      JSON.parse(fs.readFileSync(statusLineBackupPath(cursorHome), 'utf-8')),
      original.statusLine,
    )

    uninstall(options(cursorHome))
    assert.deepEqual(JSON.parse(fs.readFileSync(cliConfig, 'utf-8')), original)
    assert.equal(fs.existsSync(statusLineBackupPath(cursorHome)), false)
    assert.equal(fs.existsSync(path.join(cursorHome, 'commands', 'memory-doctor.md')), false)
    assert.equal(fs.readFileSync(foreign, 'utf-8'), '# someone else\n')
  })

  test('never creates cli-config.json and honours statusLine: false', () => {
    const cursorHome = tempDir()
    assert.equal(install(options(cursorHome)).statusLine, 'no-cli-config')
    assert.equal(fs.existsSync(path.join(cursorHome, 'cli-config.json')), false)

    fs.writeFileSync(path.join(cursorHome, 'cli-config.json'), '{}')
    assert.equal(install({ ...options(cursorHome), statusLine: false }).statusLine, 'disabled')
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(cursorHome, 'cli-config.json'), 'utf-8')),
      {},
    )
  })
})
