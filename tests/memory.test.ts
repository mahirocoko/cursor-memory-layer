import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { buildSessionStartOutput } from '../src/hooks/session-start.ts'
import {
  appendMemory,
  deleteMemory,
  moveMemory,
  replaceInMemory,
  revertMemory,
  writeMemory,
} from '../src/memory/editor.ts'
import { resolveProjectSlug, toProjectSlug } from '../src/memory/identity.ts'
import { initMemory } from '../src/memory/init.ts'
import {
  inspectCommittedMemoryProjection,
  renderCommittedMemoryProjection,
} from '../src/memory/projection.ts'
import { getMemoryLog, readCommittedMemoryFile } from '../src/memory/repository.ts'
import { searchMemory } from '../src/memory/search.ts'
import { git, tempDir, tempMemory, tempWorkspace } from './helpers.ts'

describe('initMemory', () => {
  test('creates a repo, seeds global files, and is idempotent', () => {
    const root = path.join(tempDir(), 'memory')
    const first = initMemory(root, { slug: 'demo', workspacePath: '/tmp/demo' })
    assert.equal(first.created, true)
    assert.deepEqual(first.seededPaths, [
      'system/persona.md',
      'system/human/identity.md',
      'system/human/preferences.md',
      'projects/demo/system/overview.md',
    ])
    const second = initMemory(root, { slug: 'demo', workspacePath: '/tmp/demo' })
    assert.deepEqual(second, { created: false, seededPaths: [] })
    assert.equal(git(root, 'status', '--porcelain'), '')
  })
})

describe('projection', () => {
  test('loads committed global and current-project system memory only', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    writeMemory('projects/app/system/overview.md', 'App fact', { ...edit, description: 'App.' })
    writeMemory('projects/other/system/overview.md', 'Other fact', {
      ...edit,
      description: 'Other.',
    })
    writeMemory('projects/app/reference/deploy.md', 'Deploy body', {
      ...edit,
      description: 'Deploys.',
    })
    writeMemory('archives/old.md', 'Archived body', { ...edit, description: 'Old.' })
    fs.writeFileSync(
      path.join(root, 'system', 'draft.md'),
      '---\ndescription: Draft\n---\nDraft body',
    )

    const rendered = renderCommittedMemoryProjection(inspectCommittedMemoryProjection(root, 'app'))
    assert.match(rendered, /App fact/)
    assert.match(rendered, /## system\/persona\.md/)
    assert.match(rendered, /projects\/app\/reference\/deploy\.md — Deploys\./)
    assert.doesNotMatch(rendered, /Other fact|Deploy body|Archived body|Draft body/)
    assert.match(rendered, /Uncommitted memory is not active/)
  })

  test('suggests /memory-init until the project has more than the init seed', () => {
    const root = path.join(tempDir(), 'memory')
    initMemory(root, { slug: 'fresh', workspacePath: '/tmp/fresh' })
    const hint = /## Project memory\nNothing is recorded for "fresh" yet[\s\S]*\/memory-init/
    const render = (slug: string) =>
      renderCommittedMemoryProjection(inspectCommittedMemoryProjection(root, slug))
    assert.match(render('fresh'), hint)
    assert.match(render('unseeded'), /Nothing is recorded for "unseeded" yet/)

    writeMemory('projects/fresh/reference/deploy.md', 'Deploys on tags.', {
      memoryRoot: root,
      description: 'Deploys.',
    })
    assert.doesNotMatch(render('fresh'), /## Project memory/)

    writeMemory('projects/unseeded/system/overview.md', '- Uses pnpm.', {
      memoryRoot: root,
      description: 'Unseeded.',
    })
    assert.doesNotMatch(render('unseeded'), /## Project memory/)
  })

  test('excludes malformed committed files and reports them', () => {
    const root = tempMemory()
    fs.writeFileSync(path.join(root, 'system', 'bad.md'), 'no frontmatter')
    git(root, 'add', '.')
    git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bad')
    const projection = inspectCommittedMemoryProjection(root, 'x')
    assert.equal(
      projection.globalSystem.some((doc) => doc.relativePath === 'system/bad.md'),
      false,
    )
    assert.match(
      renderCommittedMemoryProjection(projection),
      /Memory diagnostics[\s\S]*system\/bad\.md/,
    )
  })

  test('sessionStart hook returns additional_context for the workspace project', () => {
    const root = tempMemory()
    const workspace = tempWorkspace('hook-app')
    writeMemory('projects/hook-app/system/overview.md', 'Hook project fact', {
      memoryRoot: root,
      description: 'Hook app.',
    })
    const output = buildSessionStartOutput({ workspace_roots: [workspace] }, root)
    assert.deepEqual(Object.keys(output), ['additional_context'])
    assert.match(output.additional_context || '', /Hook project fact/)
    assert.match(output.additional_context || '', /Project slug: hook-app/)
  })
})

describe('editor', () => {
  test('write, append, replace, move, delete each make one scoped commit', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    const start = getMemoryLog(root).length

    writeMemory('reference/a.md', '- one', { ...edit, description: 'A.' })
    appendMemory('reference/a.md', '- two', edit)
    assert.equal(
      readCommittedMemoryFile(root, 'reference/a.md'),
      '---\ndescription: A.\n---\n\n- one\n- two\n',
    )
    replaceInMemory('reference/a.md', '- one', '- uno', edit)
    moveMemory('reference/a.md', 'reference/b.md', edit)
    assert.equal(readCommittedMemoryFile(root, 'reference/a.md'), null)
    deleteMemory('reference/b.md', edit)

    const log = getMemoryLog(root)
    assert.equal(log.length - start, 5)
    assert.deepEqual(log[1].paths, ['reference/a.md', 'reference/b.md'])
    assert.equal(git(root, 'status', '--porcelain'), '')
  })

  test('write accepts a full document from stdin', () => {
    const root = tempMemory()
    writeMemory('reference/full.md', '---\ndescription: Full.\n---\nBody\n', { memoryRoot: root })
    assert.equal(
      readCommittedMemoryFile(root, 'reference/full.md'),
      '---\ndescription: Full.\n---\nBody\n',
    )
  })

  test('refuses secrets, bad scope, oversize system files, and missing descriptions', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    assert.throws(
      () =>
        writeMemory('reference/k.md', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789', {
          ...edit,
          description: 'K.',
        }),
      /looks like it contains a secret/,
    )
    assert.throws(
      () => writeMemory('notes/k.md', 'x', { ...edit, description: 'K.' }),
      /Unsupported memory path/,
    )
    assert.throws(
      () => writeMemory('system/big.md', 'x'.repeat(5000), { ...edit, description: 'Big.' }),
      /limited to 4000/,
    )
    assert.throws(() => writeMemory('reference/n.md', 'body', edit), /Provide --description/)
    assert.equal(git(root, 'status', '--porcelain'), '')
  })

  test('read_only files need force', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    writeMemory('system/locked.md', 'fixed', { ...edit, description: 'Locked.', readOnly: true })
    assert.throws(() => replaceInMemory('system/locked.md', 'fixed', 'changed', edit), /read_only/)
    assert.throws(() => deleteMemory('system/locked.md', edit), /read_only/)
    replaceInMemory('system/locked.md', 'fixed', 'changed', { ...edit, force: true })
    assert.match(
      readCommittedMemoryFile(root, 'system/locked.md') || '',
      /read_only: true[\s\S]*changed/,
    )
  })

  test('replace needs exactly one match', () => {
    const root = tempMemory()
    writeMemory('reference/r.md', 'same same', { memoryRoot: root, description: 'R.' })
    assert.throws(
      () => replaceInMemory('reference/r.md', 'same', 'x', { memoryRoot: root }),
      /matched 2/,
    )
  })

  test('refuses to commit over unrelated uncommitted changes', () => {
    const root = tempMemory()
    fs.writeFileSync(path.join(root, 'system', 'stray.md'), 'stray')
    assert.throws(
      () => writeMemory('reference/x.md', 'x', { memoryRoot: root, description: 'X.' }),
      /unrelated uncommitted paths: system\/stray\.md/,
    )
    assert.equal(fs.existsSync(path.join(root, 'reference', 'x.md')), false)
  })

  test('revert undoes a memory commit', () => {
    const root = tempMemory()
    const result = writeMemory('reference/v.md', 'v1', { memoryRoot: root, description: 'V.' })
    revertMemory(result.sha || '', { memoryRoot: root })
    assert.equal(readCommittedMemoryFile(root, 'reference/v.md'), null)
    assert.match(getMemoryLog(root, 1)[0].subject, /^Revert/)
  })

  test('search finds committed lines', () => {
    const root = tempMemory()
    writeMemory('reference/s.md', '- Prefers pnpm', { memoryRoot: root, description: 'Tools.' })
    assert.deepEqual(
      searchMemory(root, 'pnpm').map((match) => `${match.relativePath}:${match.lineNumber}`),
      ['reference/s.md:5'],
    )
  })
})

describe('resolveProjectSlug', () => {
  test('uses the git root basename, or an existing remote-derived scope', () => {
    const root = tempMemory()
    const workspace = tempWorkspace('My_App', 'git@github.com:acme/widget.git')
    assert.equal(toProjectSlug('My_App'), 'my-app')
    assert.equal(resolveProjectSlug(workspace, root), 'my-app')
    writeMemory('projects/acme-widget/system/overview.md', 'x', {
      memoryRoot: root,
      description: 'W.',
    })
    assert.equal(resolveProjectSlug(workspace, root), 'acme-widget')
  })
})
