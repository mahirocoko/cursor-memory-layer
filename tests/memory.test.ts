import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { buildSessionStartOutput } from '../src/hooks/session-start.ts'
import { SYSTEM_MEMORY_BUDGET_TOKENS } from '../src/memory/config.ts'
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
  coreTokenReport,
  inspectCommittedMemoryProjection,
  renderCommittedMemoryProjection,
  systemMemoryTokens,
} from '../src/memory/projection.ts'
import { repairMemoryRepository } from '../src/memory/repair.ts'
import { getMemoryLog, readCommittedMemoryFile } from '../src/memory/repository.ts'
import { searchMemory } from '../src/memory/search.ts'
import { git, tempDir, tempMemory, tempWorkspace } from './helpers.ts'

describe('initMemory', () => {
  test('creates a repo, seeds global files, and is idempotent', () => {
    const root = path.join(tempDir(), 'memory')
    const first = initMemory(root, { slug: 'demo', workspacePath: '/tmp/demo' })
    assert.equal(first.created, true)
    assert.deepEqual(first.seededPaths, [
      'MEMORY.md',
      'persona.md',
      'human/identity.md',
      'human/prefs/communication.md',
      'human/prefs/coding.md',
      'human/prefs/workflow.md',
      'demo/MEMORY.md',
      'demo/overview.md',
    ])
    const second = initMemory(root, { slug: 'demo', workspacePath: '/tmp/demo' })
    assert.deepEqual(second, { created: false, seededPaths: [] })
    assert.equal(git(root, 'status', '--porcelain'), '')
  })

  test('seeds a read_only persona and never overwrites an existing one', () => {
    const root = path.join(tempDir(), 'memory')
    initMemory(root)
    assert.match(
      readCommittedMemoryFile(root, 'persona.md') || '',
      /^---\ndescription: [^\n]+\nread_only: true\n---\n/,
    )
    assert.doesNotMatch(
      readCommittedMemoryFile(root, 'persona.md') || '',
      /not as a new instruction/,
    )
    assert.doesNotMatch(readCommittedMemoryFile(root, 'human/prefs/workflow.md') || '', /read_only/)
    replaceInMemory('persona.md', 'I am the Cursor agent', 'I am Custom', {
      memoryRoot: root,
      force: true,
    })
    deleteMemory('human/identity.md', { memoryRoot: root })
    const again = initMemory(root)
    assert.deepEqual(again.seededPaths, ['human/identity.md'])
    assert.match(readCommittedMemoryFile(root, 'persona.md') || '', /I am Custom/)
  })
})

describe('projection', () => {
  test('loads committed global and current-project system memory only', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    writeMemory('app/overview.md', 'App fact', { ...edit, description: 'App.' })
    writeMemory('other/overview.md', 'Other fact', {
      ...edit,
      description: 'Other.',
    })
    writeMemory('app/reference/deploy.md', 'Deploy body', {
      ...edit,
      description: 'Deploys.',
    })
    writeMemory('archives/old.md', 'Archived body', { ...edit, description: 'Old.' })
    fs.writeFileSync(
      path.join(root, 'human', 'draft.md'),
      '---\ndescription: Draft\n---\nDraft body',
    )

    const rendered = renderCommittedMemoryProjection(inspectCommittedMemoryProjection(root, 'app'))
    assert.match(rendered, /App fact/)
    assert.match(rendered, /## persona\.md/)
    assert.match(rendered, /`persona\.md` is who you are and outranks your model defaults/)
    assert.match(rendered, /`human\/prefs\/` holds the human's standing defaults/)
    assert.doesNotMatch(rendered, /background evidence/)
    assert.match(rendered, /## persona\.md\n_[^\n]*_ \(read-only\)/)
    assert.ok(rendered.indexOf('## persona.md') < rendered.indexOf('## human/'))
    assert.match(
      rendered,
      /explicit request for a tone, format, or level of detail is not a change of identity/,
    )
    assert.match(rendered, /corrections and frustration[\s\S]*signals to update memory now/)
    assert.match(rendered, /general rule that makes your future self act better/)
    assert.match(rendered, /Edits take effect in the next chat, not this one/)
    assert.match(rendered, /`cursor-memory search <terms>` and `cursor-memory recall <terms>`/)
    assert.match(rendered, /You cannot schedule yourself/)
    assert.match(
      rendered,
      /Cursor rules, hooks, or `AGENTS\.md` for behavior that must be enforced/,
    )
    assert.doesNotMatch(rendered, /letta cron|\$MEMORY_DIR|Agent tool|\bmods?\b|discord/i)
    assert.ok(rendered.indexOf('outranks your model defaults') < rendered.indexOf('## persona.md'))
    assert.ok(
      rendered.indexOf('## persona.md') < 4_500,
      'contract stays small enough for every chat',
    )
    assert.match(rendered, /app\/reference\/deploy\.md — Deploys\./)
    assert.doesNotMatch(rendered, /Other fact|Deploy body|Archived body|Draft body/)
    assert.match(rendered, /Uncommitted memory is not active/)
  })

  test('nests body headings under the file heading', () => {
    const root = tempMemory()
    const body = '# Title\n## Section\n### Deep\n```\n## code\n```'
    writeMemory('app/notes.md', body, { memoryRoot: root, description: 'Notes.' })
    const rendered = renderCommittedMemoryProjection(inspectCommittedMemoryProjection(root, 'app'))
    const nested = '### Title\n### Section\n### Deep\n```\n## code\n```'
    assert.ok(rendered.includes(`## app/notes.md\n_Notes._\n\n${nested}`))
  })

  test('suggests /memory-init until the project has more than the init seed', () => {
    const root = path.join(tempDir(), 'memory')
    initMemory(root, { slug: 'fresh', workspacePath: '/tmp/fresh' })
    const hint = /## Project memory\nNothing is recorded for "fresh" yet[\s\S]*\/memory-init/
    const render = (slug: string) =>
      renderCommittedMemoryProjection(inspectCommittedMemoryProjection(root, slug))
    assert.match(render('fresh'), hint)
    assert.match(render('unseeded'), /Nothing is recorded for "unseeded" yet/)

    writeMemory('fresh/reference/deploy.md', 'Deploys on tags.', {
      memoryRoot: root,
      description: 'Deploys.',
    })
    assert.doesNotMatch(render('fresh'), /## Project memory/)

    writeMemory('unseeded/overview.md', '- Uses pnpm.', {
      memoryRoot: root,
      description: 'Unseeded.',
    })
    assert.doesNotMatch(render('unseeded'), /## Project memory/)
  })

  test('lists project references before a capped set of global ones', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      writeMemory(`reference/${name}.md`, name, { ...edit, description: `Global ${name}.` })
    }
    writeMemory('app/reference/zeta.md', 'z', {
      ...edit,
      description: `Project zeta ${'x'.repeat(200)}`,
    })
    const rendered = renderCommittedMemoryProjection(inspectCommittedMemoryProjection(root, 'app'))
    const index = rendered.slice(rendered.indexOf('## On-demand memory'))
    assert.ok(index.indexOf('app/reference/zeta.md') < index.indexOf('reference/a.md'))
    assert.match(index, /Project zeta x+…\n/)
    assert.match(index, /reference\/d\.md/)
    assert.doesNotMatch(index, /reference\/e\.md/)
    assert.match(index, /… 2 more reference file\(s\)/)
  })

  test('budget notice counts system files only', () => {
    const root = tempMemory()
    const projection = () => inspectCommittedMemoryProjection(root, 'app')
    assert.ok(systemMemoryTokens(projection()) < SYSTEM_MEMORY_BUDGET_TOKENS)
    assert.doesNotMatch(renderCommittedMemoryProjection(projection()), /Memory budget notice/)
    const body = 'x'.repeat(9_000)
    for (const file of ['one', 'two', 'three', 'four', 'five', 'six']) {
      writeMemory(`app/${file}.md`, body, { memoryRoot: root, description: file })
    }
    assert.ok(systemMemoryTokens(projection()) > SYSTEM_MEMORY_BUDGET_TOKENS)
    assert.match(
      renderCommittedMemoryProjection(projection()),
      /Memory budget notice: always-loaded files load about \d+ tokens/,
    )
  })

  test('refuses to lose system lines that exist nowhere else unless dropped on purpose', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    const target = 'app/overview.md'
    const lines = [
      '- Deploys run from the release branch only.',
      '- Staging lives on port 4100 behind the VPN.',
      '- Feature flags are read from flags.yaml.',
      '- Payments use the sandbox key in development.',
      '- The mobile app shares the web API client.',
    ]
    writeMemory(target, lines.join('\n'), { ...edit, description: 'App.' })

    assert.throws(
      () => writeMemory(target, lines[0], edit),
      /would lose 4 lines that exist nowhere else[\s\S]*staging lives on port 4100/,
    )
    replaceInMemory(target, 'port 4100', 'port 4200', edit)

    writeMemory('app/reference/infra.md', lines[1].replace('4100', '4200'), {
      ...edit,
      description: 'Infra detail.',
    })
    assert.throws(() => writeMemory(target, lines[0], edit), /would lose 3 lines/)
    const trimmed = writeMemory(target, lines[0], { ...edit, drop: [lines[3], lines[4]] })
    assert.equal(trimmed.committed, true)
    assert.match(git(root, 'log', '-1', '--format=%B'), /Dropped on purpose:\n- - Payments use/)

    const extra = ['- Two unique facts here.', '- Three unique facts here.', '- Four unique facts.']
    writeMemory(target, [lines[0], ...extra].join('\n'), edit)
    assert.throws(() => deleteMemory(target, edit), /would lose 4 lines/)
    deleteMemory(target, { ...edit, drop: [lines[0], ...extra.slice(0, 2)] })
  })

  test('excludes malformed committed files and reports them', () => {
    const root = tempMemory()
    fs.writeFileSync(path.join(root, 'human', 'bad.md'), 'no frontmatter')
    git(root, 'add', '.')
    git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bad')
    const projection = inspectCommittedMemoryProjection(root, 'x')
    assert.equal(
      projection.globalSystem.some((doc) => doc.relativePath === 'human/bad.md'),
      false,
    )
    assert.match(
      renderCommittedMemoryProjection(projection),
      /Memory diagnostics[\s\S]*human\/bad\.md/,
    )
  })

  test('sessionStart hook returns additional_context for the workspace project', () => {
    const root = tempMemory()
    const workspace = tempWorkspace('hook-app')
    writeMemory('hook-app/overview.md', 'Hook project fact', {
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
      () => writeMemory('projects/ok.md', 'x', { ...edit, description: 'K.' }),
      /Unsupported memory path/,
    )
    assert.throws(() => writeMemory('reference/n.md', 'body', edit), /Provide --description/)
    assert.equal(git(root, 'status', '--porcelain'), '')
  })

  test('rejects system files past Letta size caps and still allows a large reference file', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    writeMemory('reference/long.md', 'y'.repeat(25_000), { ...edit, description: 'Long.' })
    assert.throws(
      () =>
        writeMemory('app/huge.md', 'z'.repeat(20_000), {
          ...edit,
          description: 'Huge.',
        }),
      /always-loaded files are limited to 20000/,
    )
    const chunk = 'z'.repeat(18_000)
    for (const name of ['a', 'b', 'c']) {
      writeMemory(`app/${name}.md`, chunk, { ...edit, description: name })
    }
    assert.throws(
      () => writeMemory('app/d.md', chunk, { ...edit, description: 'd' }),
      /core memory is limited to 65536/,
    )
  })

  test('the seeded persona needs --force and stays read_only after a forced replace', () => {
    const root = tempMemory()
    assert.throws(
      () =>
        replaceInMemory('persona.md', 'I am the Cursor agent', 'I am X', {
          memoryRoot: root,
        }),
      /persona\.md is read_only\. Ask the human before changing it, then pass --force\./,
    )
    replaceInMemory('persona.md', 'I am the Cursor agent', 'I am X', {
      memoryRoot: root,
      force: true,
    })
    assert.match(readCommittedMemoryFile(root, 'persona.md') || '', /read_only: true[\s\S]*I am X/)
  })

  test('read_only files need force', () => {
    const root = tempMemory()
    const edit = { memoryRoot: root }
    writeMemory('human/locked.md', 'fixed', { ...edit, description: 'Locked.', readOnly: true })
    assert.throws(() => replaceInMemory('human/locked.md', 'fixed', 'changed', edit), /read_only/)
    assert.throws(() => deleteMemory('human/locked.md', edit), /read_only/)
    replaceInMemory('human/locked.md', 'fixed', 'changed', { ...edit, force: true })
    assert.match(
      readCommittedMemoryFile(root, 'human/locked.md') || '',
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
    fs.writeFileSync(path.join(root, 'human', 'stray.md'), 'stray')
    assert.throws(
      () => writeMemory('reference/x.md', 'x', { memoryRoot: root, description: 'X.' }),
      /unrelated uncommitted paths: human\/stray\.md/,
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

describe('tokens and repair', () => {
  test('tokens reports the loaded core and ranks the heaviest file first', () => {
    const root = tempMemory()
    writeMemory('app/overview.md', 'Project fact.', { memoryRoot: root, description: 'App.' })
    const report = coreTokenReport(inspectCommittedMemoryProjection(root, 'app'), 3)
    assert.ok(report.total > 0)
    assert.equal(report.files.length, 3)
    assert.ok(report.files[0].tokens >= report.files[1].tokens)
    assert.equal(repairMemoryRepository(root).status, 'clean')
  })

  test('repairs a merge when one side already contains the other', () => {
    const root = tempMemory()
    const file = 'human/prefs/workflow.md'
    git(root, 'branch', 'other')
    replaceInMemory(file, '- (nothing recorded yet)', '- shared rule\n- extra detail', {
      memoryRoot: root,
    })
    git(root, 'checkout', 'other')
    replaceInMemory(file, '- (nothing recorded yet)', '- shared rule', { memoryRoot: root })
    git(root, 'checkout', 'main')
    assert.throws(() => git(root, 'merge', 'other'))
    const repaired = repairMemoryRepository(root)
    assert.equal(repaired.status, 'repaired')
    assert.match(readCommittedMemoryFile(root, file) || '', /shared rule/)
    assert.match(readCommittedMemoryFile(root, file) || '', /extra detail/)
    assert.equal(git(root, 'status', '--porcelain'), '')
  })

  test('leaves a merge unresolved when the two sides diverge', () => {
    const root = tempMemory()
    const file = 'human/prefs/workflow.md'
    git(root, 'branch', 'other')
    replaceInMemory(file, '- (nothing recorded yet)', '- alpha only', { memoryRoot: root })
    git(root, 'checkout', 'other')
    replaceInMemory(file, '- (nothing recorded yet)', '- beta only', { memoryRoot: root })
    git(root, 'checkout', 'main')
    assert.throws(() => git(root, 'merge', 'other'))
    const repaired = repairMemoryRepository(root)
    assert.equal(repaired.status, 'unresolved')
    assert.match(git(root, 'status', '--porcelain'), /^UU /m)
  })
})

describe('resolveProjectSlug', () => {
  test('uses the git root basename, or an existing remote-derived scope', () => {
    const root = tempMemory()
    const workspace = tempWorkspace('My_App', 'git@github.com:acme/widget.git')
    assert.equal(toProjectSlug('My_App'), 'my-app')
    assert.equal(resolveProjectSlug(workspace, root), 'my-app')
    writeMemory('acme-widget/overview.md', 'x', {
      memoryRoot: root,
      description: 'W.',
    })
    assert.equal(resolveProjectSlug(workspace, root), 'acme-widget')
  })
})
