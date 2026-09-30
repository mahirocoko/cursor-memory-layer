import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import {
  createBackup,
  diffMemory,
  exportMemory,
  listBackups,
  restoreBackup,
} from '../src/memory/backup.ts'
import { runDoctor } from '../src/memory/doctor.ts'
import { revertMemory, writeMemory } from '../src/memory/editor.ts'
import {
  inspectCommittedMemoryProjection,
  renderCommittedMemoryProjection,
} from '../src/memory/projection.ts'
import { getRemoteStatus, pullFromRemote, setRemote, unsetRemote } from '../src/memory/remote.ts'
import {
  getMemoryHeadRevision,
  getMemoryLog,
  readCommittedMemoryFile,
} from '../src/memory/repository.ts'
import { type collectPalaceData, writePalace } from '../src/palace/generate.ts'
import { git, tempDir, tempMemory } from './helpers.ts'

const waitFor = (check: () => boolean, timeoutMs = 8_000): boolean => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    execFileSync('sleep', ['0.2'])
  }
  return check()
}

describe('memory skills', () => {
  test('SKILL.md gets its name from the path and is indexed for new chats', () => {
    const memoryRoot = tempMemory()
    writeMemory('skills/deploy/SKILL.md', '1. Build.\n2. Ship.', {
      memoryRoot,
      description: 'Deploy the app safely.',
    })
    writeMemory('skills/deploy/run.sh', '#!/bin/sh\necho deploy\n', { memoryRoot })
    const skill = readCommittedMemoryFile(memoryRoot, 'skills/deploy/SKILL.md') || ''
    assert.match(skill, /^---\nname: deploy\ndescription: Deploy the app safely\.\n---/)
    assert.equal(
      readCommittedMemoryFile(memoryRoot, 'skills/deploy/run.sh'),
      '#!/bin/sh\necho deploy\n',
    )

    const rendered = renderCommittedMemoryProjection(
      inspectCommittedMemoryProjection(memoryRoot, 'x'),
    )
    assert.match(
      rendered,
      /## Memory skills\n[\s\S]*- skills\/deploy\/SKILL\.md — Deploy the app safely\./,
    )

    assert.throws(
      () => writeMemory('skills/Bad Name/SKILL.md', 'x', { memoryRoot, description: 'x' }),
      /skills\/<lowercase-name>/,
    )
    assert.throws(
      () =>
        writeMemory('skills/deploy/SKILL.md', '---\nname: other\ndescription: x\n---\n\nBody', {
          memoryRoot,
        }),
      /name must be "deploy"/,
    )
  })
})

describe('backup, restore, export, diff', () => {
  test('restore is a revertible commit back to the backup tree', () => {
    const memoryRoot = tempMemory()
    const backupDir = tempDir()
    writeMemory('reference/a.md', 'Original.', { memoryRoot, description: 'A.' })
    const backup = createBackup(memoryRoot, backupDir)
    assert.match(backup.name, /^memory-\d{8}-\d{6}\.bundle$/)
    assert.equal(listBackups(backupDir).length, 1)
    assert.equal((fs.statSync(backup.path).mode & 0o777).toString(8), '600')

    writeMemory('reference/a.md', 'Changed.', { memoryRoot })
    writeMemory('reference/b.md', 'New file.', { memoryRoot, description: 'B.' })
    const before = getMemoryHeadRevision(memoryRoot) || ''
    assert.match(diffMemory(memoryRoot, [before.slice(0, 8)]), /^$/)
    assert.match(diffMemory(memoryRoot, ['HEAD~2', 'HEAD']), /\+Changed\./)

    const restored = restoreBackup(memoryRoot, backupDir, backup.name)
    assert.equal(restored.committed, true)
    assert.match(getMemoryLog(memoryRoot, 1)[0].subject, /^memory: restore from memory-/)
    assert.match(readCommittedMemoryFile(memoryRoot, 'reference/a.md') || '', /Original\./)
    assert.equal(readCommittedMemoryFile(memoryRoot, 'reference/b.md'), null)
    assert.equal(git(memoryRoot, 'status', '--porcelain'), '')
    assert.equal(git(memoryRoot, 'for-each-ref', 'refs/cursor-memory'), '')

    revertMemory(restored.sha || '', { memoryRoot })
    assert.match(readCommittedMemoryFile(memoryRoot, 'reference/a.md') || '', /Changed\./)
    assert.throws(() => diffMemory(memoryRoot, ['main; rm -rf /']), /Invalid revision/)
  })

  test('export writes plain committed files without .git into an empty directory', () => {
    const memoryRoot = tempMemory()
    const out = path.join(tempDir(), 'export')
    const result = exportMemory(memoryRoot, out)
    assert.ok(result.files >= 3)
    assert.ok(fs.existsSync(path.join(out, 'persona.md')))
    assert.equal(fs.existsSync(path.join(out, '.git')), false)
    assert.throws(() => exportMemory(memoryRoot, out), /not empty/)
  })
})

describe('remote mirror', () => {
  test('mirrors commits without force, pulls fast-forward, and refuses credentials', () => {
    const memoryRoot = tempMemory()
    const bare = path.join(tempDir(), 'mirror.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    assert.throws(
      () => setRemote(memoryRoot, 'https://user:hunter2hunter2@example.com/x.git'),
      /credentials/,
    )

    assert.equal(setRemote(memoryRoot, bare).ok, true)
    assert.equal(git(bare, 'rev-parse', 'main'), getMemoryHeadRevision(memoryRoot))
    assert.equal(getRemoteStatus(memoryRoot).hookInstalled, true)

    writeMemory('reference/mirror.md', 'Mirrored.', { memoryRoot, description: 'Mirror test.' })
    const head = getMemoryHeadRevision(memoryRoot)
    assert.ok(
      waitFor(() => git(bare, 'rev-parse', 'main') === head),
      'post-commit mirror push',
    )

    const clone = path.join(tempDir(), 'clone')
    execFileSync('git', ['clone', '-q', bare, clone])
    fs.writeFileSync(
      path.join(clone, 'reference', 'mirror.md'),
      '---\ndescription: Mirror test.\n---\n\nFrom elsewhere.\n',
    )
    git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'remote edit')
    git(clone, 'push', '-q', 'origin', 'main')
    assert.equal(pullFromRemote(memoryRoot).updated, true)
    assert.match(readCommittedMemoryFile(memoryRoot, 'reference/mirror.md') || '', /From elsewhere/)

    assert.deepEqual(unsetRemote(memoryRoot), [
      'Removed the remote URL.',
      'Removed the post-commit mirror hook.',
    ])
    assert.equal(getRemoteStatus(memoryRoot).url, null)
  })
})

describe('doctor and palace', () => {
  test('doctor reports secrets, duplicates, broken links, and missing hooks', () => {
    const memoryRoot = tempMemory()
    const line = '- Always run the full test suite before pushing.'
    writeMemory('reference/one.md', `${line}\nSee reference/missing.md.`, {
      memoryRoot,
      description: 'One.',
    })
    writeMemory('reference/two.md', line, { memoryRoot, description: 'Two.' })
    fs.writeFileSync(
      path.join(memoryRoot, 'reference', 'leak.md'),
      '---\ndescription: Leak.\n---\n\npassword = hunter2hunter2\n',
    )
    git(memoryRoot, 'add', '.')
    git(memoryRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'leak')

    const findings = runDoctor({ memoryRoot, cursorHome: tempDir(), projectSlug: 'x' })
    const has = (level: string, check: string, pattern: RegExp) =>
      findings.some((f) => f.level === level && f.check === check && pattern.test(f.detail))
    assert.ok(has('error', 'secrets', /reference\/leak\.md/))
    assert.ok(has('warn', 'duplicates', /reference\/one\.md, reference\/two\.md/))
    assert.ok(has('warn', 'broken link', /reference\/missing\.md/))
    assert.ok(has('warn', 'install', /Hooks missing/))
    assert.ok(has('ok', 'core size', /loads ~\d+ tokens/))
  })

  test('doctor flags shared wording, not files that merely share a language', () => {
    const memoryRoot = tempMemory()
    const words = (seed: string) =>
      Array.from({ length: 60 }, (_, index) => `${seed}${index}`).join(' ')
    const shared = words('deploy')
    writeMemory('reference/deploy.md', shared, { memoryRoot, description: 'Deploy.' })
    writeMemory('reference/deploy-copy.md', `${shared} ${words('extra')}`, {
      memoryRoot,
      description: 'Copy.',
    })
    writeMemory(
      'reference/css.md',
      'The stylesheet uses kebab-case class names and keeps every color in a semantic token so the dark theme can swap them without touching the components that read those tokens at runtime.',
      { memoryRoot, description: 'CSS.' },
    )
    writeMemory(
      'reference/db.md',
      'The database runs migrations in a single transaction and the team reviews each schema change before it reaches production because a failed rollback once left the orders table locked for an hour.',
      { memoryRoot, description: 'DB.' },
    )

    const details = runDoctor({ memoryRoot, cursorHome: tempDir(), projectSlug: 'x' })
      .filter((f) => f.check === 'duplicates')
      .map((f) => f.detail)
    assert.ok(
      details.some((d) =>
        /of reference\/deploy\.md is worded the same as reference\/deploy-copy\.md/.test(d),
      ),
    )
    assert.ok(!details.some((d) => /css\.md.*db\.md|db\.md.*css\.md/.test(d)))
  })

  test('palace embeds files and history as safe JSON in one private HTML file', () => {
    const memoryRoot = tempMemory()
    writeMemory('reference/html.md', 'Contains </script><b>tags</b>.', {
      memoryRoot,
      description: 'HTML.',
    })
    writeMemory('x/overview.md', 'X fact', { memoryRoot, description: 'X.' })
    writeMemory('y/overview.md', 'Y fact', { memoryRoot, description: 'Y.' })
    const out = writePalace(memoryRoot, 'x', path.join(tempDir(), 'palace.html'))
    const html = fs.readFileSync(out, 'utf-8')
    assert.equal((fs.statSync(out).mode & 0o777).toString(8), '600')
    assert.equal(html.split('</script>').length, 2)
    const json = html.slice(html.indexOf('const DATA = ') + 13, html.indexOf(';\nconst PAGE'))
    const data = JSON.parse(json) as ReturnType<typeof collectPalaceData>
    const file = (filePath: string) => data.files.find((entry) => entry.path === filePath)
    assert.equal(file('reference/html.md')?.loaded, false)
    assert.equal(file('x/overview.md')?.loaded, true)
    assert.equal(file('y/overview.md')?.loaded, false)
    assert.ok(data.files.some((entry) => entry.loaded && entry.path === 'persona.md'))
    assert.match(file('reference/html.md')?.lastCommit?.subject ?? '', /reference\/html\.md/)
    assert.ok(data.commits.length >= 2)
    assert.ok(data.commits.some((commit) => commit.diff?.includes('Contains')))
  })
})
