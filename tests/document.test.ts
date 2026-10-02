import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { joinOptionValues } from '../src/cli-args.ts'
import { parseMemoryDocument, renderMemoryDocument } from '../src/memory/document.ts'
import { classifyMemoryPath } from '../src/memory/scope.ts'
import { findSecretLikeContent } from '../src/memory/secrets.ts'

describe('parseMemoryDocument', () => {
  test('reads description, read_only, and body', () => {
    const parsed = parseMemoryDocument(
      '---\ndescription: "Prefs"\nread_only: true\n---\n\n- a\n',
      'system/p.md',
    )
    assert.deepEqual(parsed, { description: 'Prefs', body: '- a', readOnly: true, diagnostics: [] })
  })

  test('rejects missing frontmatter, unknown keys, and bad booleans', () => {
    assert.match(parseMemoryDocument('body', 'x.md').diagnostics[0], /missing required description/)
    assert.match(
      parseMemoryDocument('---\ndescription: a\ntags: b\n---\nx', 'x.md').diagnostics[0],
      /unknown frontmatter key "tags"/,
    )
    assert.match(
      parseMemoryDocument('---\ndescription: a\nread_only: yes\n---\nx', 'x.md').diagnostics[0],
      /read_only must be true or false/,
    )
    assert.match(parseMemoryDocument('---\ndescription: a\nx', 'x.md').diagnostics[0], /not closed/)
  })

  test('round-trips through renderMemoryDocument', () => {
    const content = renderMemoryDocument({ description: 'Desc', body: 'Body', readOnly: true })
    assert.deepEqual(parseMemoryDocument(content, 'r.md'), {
      description: 'Desc',
      body: 'Body',
      readOnly: true,
      diagnostics: [],
    })
  })
})

describe('classifyMemoryPath', () => {
  test('accepts the supported tiers', () => {
    assert.equal(classifyMemoryPath('persona.md').tier, 'system')
    assert.equal(classifyMemoryPath('MEMORY.md').tier, 'system')
    assert.equal(classifyMemoryPath('human/prefs.md').tier, 'system')
    assert.equal(classifyMemoryPath('app/reference/deploy.md').tier, 'reference')
    assert.equal(classifyMemoryPath('reference/a.md').tier, 'reference')
    assert.equal(classifyMemoryPath('archives/x/y.md').tier, 'archive')
    assert.deepEqual(classifyMemoryPath('my-app/overview.md'), {
      relativePath: 'my-app/overview.md',
      tier: 'system',
      projectSlug: 'my-app',
    })
  })

  test('rejects unsafe or unsupported paths', () => {
    for (const bad of [
      '../x.md',
      '/abs/system/a.md',
      'system/a.txt',
      'system',
      '.git/config.md',
      'projects/My-App/system/a.md',
      'projects/app/learnings/a.md',
    ]) {
      assert.throws(() => classifyMemoryPath(bad), Error, bad)
    }
  })
})

describe('findSecretLikeContent', () => {
  test('flags common credential shapes', () => {
    for (const secret of [
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIA0000000000000000',
      'key sk-ant-abcdefghijklmnopqrstuvwxyz',
      'password: hunter2hunter2',
      'https://user:pass@example.com/repo.git',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
    ]) {
      assert.ok(findSecretLikeContent(secret).length > 0, secret)
    }
  })

  test('leaves ordinary preferences alone', () => {
    assert.deepEqual(
      findSecretLikeContent('- Prefers pnpm and Biome; the password manager is 1Password.'),
      [],
    )
  })
})

describe('joinOptionValues', () => {
  test('keeps dash-leading values attached to their flag', () => {
    assert.deepEqual(
      joinOptionValues(['append', 'p.md', '--body', '- item', '-m', 'msg', '--force']),
      ['append', 'p.md', '--body=- item', '--message=msg', '--force'],
    )
  })
})
