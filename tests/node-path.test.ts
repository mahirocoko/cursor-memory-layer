import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { buildOwnedHooks } from '../src/install/hooks-config.ts'
import { stableNodePath } from '../src/install/node-path.ts'
import { buildStatusLine } from '../src/install/statusline-config.ts'
import { runDoctor } from '../src/memory/doctor.ts'
import { tempDir, tempMemory } from './helpers.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')

function homebrewPrefix(formula = 'node', version = '26.12.0'): { prefix: string; binary: string } {
  const prefix = path.join(tempDir(), 'homebrew prefix')
  const binary = path.join(prefix, 'Cellar', formula, version, 'bin', 'node')
  fs.mkdirSync(path.dirname(binary), { recursive: true })
  fs.writeFileSync(binary, '', { mode: 0o755 })
  return { prefix, binary }
}

const link = (target: string, file: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.symlinkSync(target, file)
}

describe('stable node path', () => {
  test('prefers the Homebrew launcher that resolves to the running Cellar binary', () => {
    const { prefix, binary } = homebrewPrefix()
    link(binary, path.join(prefix, 'bin', 'node'))
    assert.equal(stableNodePath(binary), path.join(prefix, 'bin', 'node'))
  })

  test('uses the opt launcher for a keg-only formula', () => {
    const { prefix, binary } = homebrewPrefix('node@22', '22.22.3')
    link(path.join(prefix, 'Cellar', 'node@22', '22.22.3'), path.join(prefix, 'opt', 'node@22'))
    assert.equal(stableNodePath(binary), path.join(prefix, 'opt', 'node@22', 'bin', 'node'))
  })

  test('keeps the versioned binary when no launcher points at it', () => {
    const { prefix, binary } = homebrewPrefix()
    const other = path.join(prefix, 'Cellar', 'node', '27.0.0', 'bin', 'node')
    fs.mkdirSync(path.dirname(other), { recursive: true })
    fs.writeFileSync(other, '')
    link(other, path.join(prefix, 'bin', 'node'))
    assert.equal(stableNodePath(binary), binary)
    assert.equal(
      stableNodePath('/Users/me/.nvm/versions/node/v22.22.3/bin/node'),
      '/Users/me/.nvm/versions/node/v22.22.3/bin/node',
    )
  })

  test('honors an explicit override and rejects unusable ones', () => {
    const { binary } = homebrewPrefix()
    assert.equal(stableNodePath('/elsewhere/bin/node', binary), binary)
    assert.throws(() => stableNodePath(binary, 'node'), /absolute path/)
    assert.throws(() => stableNodePath(binary, '/usr/bin/env'), /absolute path/)
    assert.throws(() => stableNodePath(binary, path.join(tempDir(), 'node')), /does not exist/)
  })
})

describe('doctor node binaries', () => {
  const nodeFindings = (nodePath: string) => {
    const cursorHome = tempDir()
    const hooks = Object.fromEntries(
      Object.entries(buildOwnedHooks(repoRoot, nodePath)).map(([event, hook]) => [event, [hook]]),
    )
    fs.writeFileSync(path.join(cursorHome, 'hooks.json'), JSON.stringify({ version: 1, hooks }))
    fs.writeFileSync(
      path.join(cursorHome, 'cli-config.json'),
      JSON.stringify({ statusLine: buildStatusLine(repoRoot, nodePath) }),
    )
    return runDoctor({ memoryRoot: tempMemory(), cursorHome, projectSlug: 'x' }).filter(
      (finding) => finding.check === 'install' && finding.detail.includes(nodePath),
    )
  }

  test('reports a removed Node binary with every hook and the status line that use it', () => {
    const missing = '/opt/homebrew/Cellar/node/0.0.0-removed/bin/node'
    const findings = nodeFindings(missing)
    assert.equal(findings.length, 1)
    assert.equal(findings[0].level, 'error')
    for (const user of ['sessionStart hook', 'preToolUse hook', 'status line']) {
      assert.ok(findings[0].detail.includes(user), user)
    }
  })

  test('stays quiet when the installed Node binary runs', () => {
    assert.deepEqual(nodeFindings(process.execPath), [])
  })
})
