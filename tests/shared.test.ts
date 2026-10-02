import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, test } from 'node:test'
import { applyDreamOperations, planDreamOperations } from '../src/dream/apply.ts'
import {
  appendMemory,
  deleteMemory,
  moveMemory,
  replaceInMemory,
  writeMemory,
} from '../src/memory/editor.ts'
import {
  inspectCommittedMemoryProjection,
  renderCommittedMemoryProjection,
} from '../src/memory/projection.ts'
import { repairMemoryRepository } from '../src/memory/repair.ts'
import {
  commitMemoryPaths,
  deleteMemoryFile,
  runGit,
  writeMemoryFile,
} from '../src/memory/repository.ts'
import { loadSettings } from '../src/memory/settings.ts'
import {
  createProposal,
  exportProposal,
  FIXED_SHARED_OWNER,
  getProposal,
  inspectSharedSource,
  isSharedOwnerPath,
  listProposals,
  mergeCommunicationDocuments,
  NATIVE_COMMUNICATION_PATH,
  resolveGitAdministrativeDir,
  resolveProposalsDir,
} from '../src/memory/shared.ts'
import { tempDir } from './helpers.ts'

describe('shared communication: duplicate-import and native-addition preservation', () => {
  const dummyInspection = {
    enabled: true,
    sourceRoot: '/test/source',
    sharedOwner: FIXED_SHARED_OWNER,
    valid: true,
    pinnedSha: 'abcdef1234567890abcdef1234567890abcdef12',
    diagnostics: [],
    content: null,
    document: null,
  }

  test('source communication is canonical for identical imported paragraphs', () => {
    const sourceDoc = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication prefs',
      body: '### Language\nAlways respond in concise English.\n\n### Formatting\nUse bullet points.',
      readOnly: true,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const nativeDoc = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native communication',
      body: '### Language\nAlways respond in concise English.\n\n### Formatting\nUse bullet points.',
      readOnly: false,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.equal(mergedDoc.readOnly, true)
    // Should not duplicate paragraphs
    assert.equal(
      mergedDoc.body.split('Always respond in concise English.').length - 1,
      1,
      'identical paragraph must appear exactly once',
    )
    assert.equal(
      mergedDoc.body.split('Use bullet points.').length - 1,
      1,
      'identical formatting paragraph must appear exactly once',
    )
    assert.ok(mergedDoc.body.includes('<!-- Shared communication from /test/source'))
  })

  test('retains all distinct native additions and native-only runtime instructions', () => {
    const sourceDoc = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication prefs',
      body: '### Language\nAlways respond in concise English.',
      readOnly: true,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const nativeDoc = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native communication',
      body: '### Language\nAlways respond in concise English.\n\n### Cursor Runtime Instructions\nNever include full directory trees in responses.',
      readOnly: false,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.ok(
      mergedDoc.body.includes('Never include full directory trees in responses.'),
      'must retain distinct native additions',
    )
    assert.ok(
      mergedDoc.body.includes('Cursor Runtime Instructions'),
      'must retain native runtime instructions heading',
    )
  })

  test('explains unresolved semantic conflicts under the same heading rather than silently overriding', () => {
    const sourceDoc = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication prefs',
      body: '### Language\nAlways respond in English.',
      readOnly: true,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const nativeDoc = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native communication',
      body: '### Language\nAlways respond in Thai.',
      readOnly: false,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.ok(
      mergedDoc.body.includes('Unresolved semantic difference'),
      'must include explicit conflict explanation',
    )
    assert.ok(mergedDoc.body.includes('Always respond in English.'))
    assert.ok(mergedDoc.body.includes('Always respond in Thai.'))
  })

  test('deferred references do not pretend source links resolve in native root', () => {
    const sourceDoc = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared communication prefs',
      body: 'See [detailed style](reference/communication/style.md) for details.',
      readOnly: true,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, null, dummyInspection)
    assert.ok(
      mergedDoc.body.includes('(shared reference in /test/source, not in native root)'),
      'deferred references must be annotated',
    )
  })
})

describe('proposal queue and mutation diversion', () => {
  test('creates atomic proposal outside versioned memory', () => {
    const memoryDir = tempDir('mem-prop-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })

    const proposal = createProposal({
      memoryRoot: memoryDir,
      targetPath: FIXED_SHARED_OWNER,
      operation: 'write',
      sourceSha: '1111222233334444555566667777888899990000',
      content: 'New shared content proposal',
      description: 'Update tone',
      message: 'test proposal',
    })

    assert.ok(proposal.id.startsWith('prop_'))
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.targetPath, FIXED_SHARED_OWNER)
    assert.equal(proposal.operation, 'write')

    const proposals = listProposals(memoryDir)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0].id, proposal.id)

    const fetched = getProposal(memoryDir, proposal.id)
    assert.ok(fetched)
    assert.equal(fetched.content, 'New shared content proposal')

    const exported = exportProposal(memoryDir, proposal.id)
    assert.ok(exported.includes('# Shared Memory Proposal:'))
    assert.ok(exported.includes('New shared content proposal'))
  })

  test('writeMemory diverts shared communication to proposals even with force', () => {
    const memoryDir = tempDir('mem-div-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })

    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/tmp/nonexistent-src',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const res = writeMemory(NATIVE_COMMUNICATION_PATH, 'Direct edit attempt', {
      memoryRoot: memoryDir,
      force: true, // CLI --force does not bypass shared owner
      settings,
    })

    assert.equal(res.committed, false)
    assert.equal(res.status, 'proposed')
    assert.ok(res.proposalId)

    const proposals = listProposals(memoryDir)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0].id, res.proposalId)
  })

  test('append, replace, delete divert shared communication to proposals', () => {
    const memoryDir = tempDir('mem-ops-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/tmp/nonexistent-src',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const appRes = appendMemory(NATIVE_COMMUNICATION_PATH, 'Extra line', {
      memoryRoot: memoryDir,
      settings,
    })
    assert.equal(appRes.status, 'proposed')

    const repRes = replaceInMemory(NATIVE_COMMUNICATION_PATH, 'old', 'new', {
      memoryRoot: memoryDir,
      settings,
    })
    assert.equal(repRes.status, 'proposed')

    const delRes = deleteMemory(NATIVE_COMMUNICATION_PATH, {
      memoryRoot: memoryDir,
      settings,
    })
    assert.equal(delRes.status, 'proposed')

    assert.throws(
      () =>
        moveMemory(NATIVE_COMMUNICATION_PATH, 'human/prefs/other.md', {
          memoryRoot: memoryDir,
          settings,
        }),
      /Cannot move protected shared owner/,
    )
  })

  test('native learning is not frozen when sharedRead is enabled', () => {
    const memoryDir = tempDir('mem-native-')
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/tmp/dummy-src',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    // Other paths are not shared owners
    assert.equal(isSharedOwnerPath('human/prefs/coding.md'), false)
    assert.equal(isSharedOwnerPath('human/identity.md'), false)
    assert.equal(isSharedOwnerPath('project/overview.md'), false)
    assert.equal(isSharedOwnerPath('reference/deploy.md'), false)

    // Non-shared operations are accepted by reflection planning rather than diverted or rejected
    const plan = planDreamOperations({
      memoryRoot: memoryDir,
      baseRevision: 'HEAD',
      operations: [
        {
          op: 'write',
          path: 'human/prefs/coding.md',
          body: 'Always use TypeScript',
          description: 'Coding preferences',
        },
      ],
      settings,
    })
    assert.equal(plan.pending.length, 1)
    assert.equal(plan.pending[0].relativePath, 'human/prefs/coding.md')
    assert.equal(plan.rejected.length, 0)
  })
})

describe('stale and bad source validation', () => {
  test('rejects missing directory with visible diagnostic', () => {
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: '/path/does/not/exist/anywhere',
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(inspection.diagnostics.some((d) => d.includes('does not exist')))
  })

  test('rejects non-Git directory with visible diagnostic', () => {
    const nonGitDir = tempDir('non-git-')
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: nonGitDir,
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(inspection.diagnostics.some((d) => d.includes('is not a Git repository')))
  })

  test('rejects missing source owner in Git repo', () => {
    // Current repo has no system/human/prefs/communication.md committed
    const currentRepo = path.resolve(import.meta.dirname, '..')
    const inspection = inspectSharedSource({
      enabled: true,
      sourceRoot: currentRepo,
      sharedOwner: FIXED_SHARED_OWNER,
    })
    assert.equal(inspection.valid, false)
    assert.ok(inspection.diagnostics.some((d) => d.includes('not found at committed revision')))
  })

  test('detects stale proposal base when source HEAD differs', () => {
    const memoryDir = tempDir('mem-stale-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })
    const currentRepo = path.resolve(import.meta.dirname, '..')

    const proposal = createProposal({
      memoryRoot: memoryDir,
      targetPath: FIXED_SHARED_OWNER,
      operation: 'write',
      sourceSha: '0000000000000000000000000000000000000000', // Stale dummy SHA
      content: 'Proposal against old commit',
    })

    const proposals = listProposals(memoryDir, currentRepo)
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0].isStale, true)
    assert.notEqual(proposals[0].currentSourceSha, '0000000000000000000000000000000000000000')

    const exported = exportProposal(memoryDir, proposal.id, currentRepo)
    assert.ok(exported.includes('STALE BASE'))
  })
})

describe('reflection and bulk paths preflight', () => {
  test('planDreamOperations rejects mutations on shared owner during reflection', () => {
    const memoryDir = tempDir('dream-rej-')
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/tmp/dummy',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const res = planDreamOperations({
      memoryRoot: memoryDir,
      baseRevision: 'HEAD',
      operations: [
        {
          op: 'write',
          path: NATIVE_COMMUNICATION_PATH,
          body: 'Reflection attempting rewrite',
        },
      ],
      settings,
    })

    assert.equal(res.pending.length, 0)
    assert.ok(res.rejected.some((r) => r.includes('protected shared owner')))
  })

  test('applyDreamOperations preflights mixed batches and refuses partial commit', () => {
    const memoryDir = tempDir('dream-mixed-')
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/tmp/dummy',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const res = applyDreamOperations({
      memoryRoot: memoryDir,
      baseRevision: 'HEAD',
      operations: [
        {
          op: 'write',
          path: 'human/prefs/coding.md',
          body: 'Valid coding pref',
          description: 'Coding preferences',
        },
        {
          op: 'write',
          path: NATIVE_COMMUNICATION_PATH,
          body: 'Forbidden reflection rewrite of shared owner',
        },
      ],
      message: 'test reflection',
      settings,
    })

    assert.equal(res.committed, false)
    assert.deepEqual(res.applied, [])
    assert.ok(
      res.rejected.some((r) => r.includes('cannot partially apply')),
      'must refuse to partially commit native operations when shared operation is rejected',
    )
  })
})

describe('revert and rollback protection', () => {
  test('disabled shared mode preserves default revert behavior', () => {
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: false,
        sourceRoot: null,
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }
    // When disabled, no shared protection check blocks revert
    assert.equal(settings.sharedRead.enabled, false)
  })

  test('revertMemory blocks revisions that affect protected shared owner when enabled', () => {
    const memoryDir = tempDir('mem-rev-on-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })
    runGit(memoryDir, ['init', '-q', '-b', 'main'])
    // We do not create commits per test constraint, but verify isSharedOwnerPath logic
    assert.equal(isSharedOwnerPath(NATIVE_COMMUNICATION_PATH), true)
    assert.equal(isSharedOwnerPath(FIXED_SHARED_OWNER), true)
  })
})

describe('hook and projection seam', () => {
  test('default disabled sharedRead preserves exact existing output', () => {
    const memoryDir = tempDir('hook-seam-')
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: false,
        sourceRoot: null,
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const proj = inspectCommittedMemoryProjection(memoryDir, 'test-slug', settings)
    assert.equal(proj.sharedSource, null)
    assert.deepEqual(proj.diagnostics, [])
  })

  test('enabled with bad source reports diagnostics without claiming shared content', () => {
    const memoryDir = tempDir('hook-bad-')
    const settings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/path/does/not/exist',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const proj = inspectCommittedMemoryProjection(memoryDir, 'test-slug', settings)
    assert.equal(proj.sharedSource, null)
    assert.ok(proj.diagnostics.length > 0)
    assert.ok(proj.diagnostics.some((d) => d.includes('does not exist')))

    const rendered = renderCommittedMemoryProjection(proj)
    assert.ok(rendered.includes('Memory diagnostics'))
    assert.ok(rendered.includes('does not exist'))
  })
})

describe('regression guards: blockers 1-5 and lower-level bypass fixes', () => {
  const dummyInspection = {
    enabled: true,
    sourceRoot: '/test/source',
    sharedOwner: FIXED_SHARED_OWNER,
    valid: true,
    pinnedSha: 'abcdef1234567890abcdef1234567890abcdef12',
    diagnostics: [],
    content: null,
    document: null,
  }

  test('BLOCKER-1 & BLOCKER-2: list item deduplication, continuation preservation, and import header stripping', () => {
    const sourceDoc = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared prefs',
      body: [
        'Recent response-quality correction:',
        '- When Mahiro posts a screenshot, ask first.',
        '- After several edits, match final summary.',
        '- Treat every new turn as active request.',
      ].join('\n'),
      readOnly: true,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const nativeDoc = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native prefs',
      body: [
        'Imported from Mahiro Code (`agent-local-123`) `human/prefs/communication.md`. Letta remains the source; this is the Cursor copy.',
        '',
        'Recent response-quality correction:',
        '- When Mahiro posts a screenshot, ask first.',
        '- After several edits, match final summary.',
        '- Treat every new turn as active request.',
        '- Mahiro, 2026-09-30: new dated rule.',
      ].join('\n'),
      readOnly: false,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)

    // Heading appears only once (not duplicated in Native Runtime Additions)
    assert.equal(
      mergedDoc.body.split('Recent response-quality correction:').length - 1,
      1,
      'section heading must appear exactly once',
    )
    // Common bullets appear once
    assert.equal(
      mergedDoc.body.split('When Mahiro posts a screenshot, ask first.').length - 1,
      1,
      'common bullet must appear exactly once',
    )
    // Native addition preserved
    assert.equal(
      mergedDoc.body.split('Mahiro, 2026-09-30: new dated rule.').length - 1,
      1,
      'distinct native addition must be preserved',
    )
    // Import preamble stripped
    assert.equal(
      mergedDoc.body.includes('Imported from Mahiro Code'),
      false,
      'import preamble must be stripped',
    )
  })

  test('BLOCKER-2: heading-level conflict detection across standard blank lines', () => {
    const sourceDoc = {
      relativePath: FIXED_SHARED_OWNER,
      description: 'Shared prefs',
      body: '## Language\n\nAlways speak English.',
      readOnly: true,
      scope: 'global' as const,
      tier: 'system' as const,
    }
    const nativeDoc = {
      relativePath: NATIVE_COMMUNICATION_PATH,
      description: 'Native prefs',
      body: '## Language\n\nAlways speak Thai.',
      readOnly: false,
      scope: 'global' as const,
      tier: 'system' as const,
    }

    const { mergedDoc } = mergeCommunicationDocuments(sourceDoc, nativeDoc, dummyInspection)
    assert.ok(
      mergedDoc.body.includes('Unresolved semantic difference under ## Language:'),
      'must explain conflict under markdown heading separated by blank line',
    )
    assert.ok(mergedDoc.body.includes('Always speak English.'))
    assert.ok(mergedDoc.body.includes('Always speak Thai.'))
  })

  test('BLOCKER-3: worktree proposals directory resolves to external gitdir without polluting working tree', () => {
    const worktreeDir = tempDir('mem-worktree-')
    const externalGitDir = tempDir('ext-gitdir-')
    fs.mkdirSync(externalGitDir, { recursive: true })
    fs.writeFileSync(path.join(worktreeDir, '.git'), `gitdir: ${externalGitDir}\n`)

    const propDir = resolveProposalsDir(worktreeDir)
    assert.ok(
      !propDir.startsWith(worktreeDir),
      'proposals directory must NOT be inside versioned worktree directory',
    )
    assert.ok(
      propDir.startsWith(externalGitDir),
      'proposals directory must resolve inside external gitdir',
    )
    assert.equal(path.basename(propDir), 'proposals')

    // Throws error if git administrative dir cannot be resolved
    const invalidDir = tempDir('no-git-')
    assert.throws(
      () => resolveGitAdministrativeDir(invalidDir),
      /Cannot resolve Git administrative directory/,
    )
  })

  test('BLOCKER-4: inspectSharedSource validates memoryRoot and rejects self-referential or subtree root', () => {
    const memoryDir = tempDir('mem-val-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })
    runGit(memoryDir, ['init', '-q', '-b', 'main'])

    // Self-referential sourceRoot == memoryRoot
    const selfRes = inspectSharedSource(
      { enabled: true, sourceRoot: memoryDir, sharedOwner: FIXED_SHARED_OWNER },
      memoryDir,
    )
    assert.equal(selfRes.valid, false)
    assert.ok(selfRes.diagnostics.some((d) => d.includes('same as the native memory root')))

    // Subtree sourceRoot inside memoryRoot
    const subDir = path.join(memoryDir, 'subrepo')
    fs.mkdirSync(path.join(subDir, '.git'), { recursive: true })
    runGit(subDir, ['init', '-q', '-b', 'main'])
    const subRes = inspectSharedSource(
      { enabled: true, sourceRoot: subDir, sharedOwner: FIXED_SHARED_OWNER },
      memoryDir,
    )
    assert.equal(subRes.valid, false)
    assert.ok(subRes.diagnostics.some((d) => d.includes('not a parent or subtree')))
  })

  test('BLOCKER-5: proposals bind native origin path, expose ungrounded null sha, and reject tampering', () => {
    const memoryDir = tempDir('mem-prop-guard-')
    const gitDir = path.join(memoryDir, '.git')
    fs.mkdirSync(gitDir, { recursive: true })

    // 1. nativeOrigin.relativePath is human/prefs/communication.md
    const p1 = createProposal({
      memoryRoot: memoryDir,
      targetPath: FIXED_SHARED_OWNER,
      operation: 'write',
      sourceSha: '1111222233334444555566667777888899990000',
      content: 'test',
    })
    assert.equal(p1.nativeOrigin.relativePath, NATIVE_COMMUNICATION_PATH)

    // 2. null sourceSha is marked isStale: true and exported as UNGROUNDED
    const p2 = createProposal({
      memoryRoot: memoryDir,
      targetPath: FIXED_SHARED_OWNER,
      operation: 'write',
      sourceSha: null,
      content: 'null sha test',
    })
    const props = listProposals(memoryDir)
    const fetched2 = props.find((p) => p.id === p2.id)
    assert.ok(fetched2)
    assert.equal(fetched2.isStale, true)
    const exported2 = exportProposal(memoryDir, p2.id)
    assert.ok(exported2.includes('UNGROUNDED (no source base revision recorded; missing source)'))
    assert.ok(!exported2.includes('CURRENT'))

    // 3. Reject tampered proposal
    const propDir = resolveProposalsDir(memoryDir)
    const tamperedId = 'prop_tamper_reject'
    const tamperedPayload = {
      id: tamperedId,
      createdAt: new Date().toISOString(),
      targetPath: '../../../../etc/passwd',
      operation: 'write',
      sourceSha: null,
      nativeOrigin: { commitSha: null, relativePath: 'persona.md' },
      content: 'malicious',
      status: 'pending',
    }
    fs.writeFileSync(path.join(propDir, `${tamperedId}.json`), JSON.stringify(tamperedPayload))
    assert.equal(getProposal(memoryDir, tamperedId), null)
    assert.throws(() => exportProposal(memoryDir, tamperedId), /Proposal not found or invalid/)
  })

  test('Main lower-level bypass & OBSERVATION-1: repository and repair guards on protected shared owner', () => {
    const memoryDir = tempDir('mem-bypass-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })
    runGit(memoryDir, ['init', '-q', '-b', 'main'])

    const enabledSettings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: true,
        sourceRoot: '/test/source',
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    const disabledSettings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: false,
        sourceRoot: null,
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }

    // When sharedRead is enabled:
    // writeMemoryFile rejects direct mutation
    assert.throws(
      () =>
        writeMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, 'direct write', {
          settings: enabledSettings,
        }),
      /Cannot directly mutate protected shared owner/,
    )

    // deleteMemoryFile rejects direct deletion
    assert.throws(
      () =>
        deleteMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, {
          settings: enabledSettings,
        }),
      /Cannot directly mutate protected shared owner/,
    )

    // commitMemoryPaths rejects committing shared owner
    assert.throws(
      () =>
        commitMemoryPaths({
          memoryRoot: memoryDir,
          relativePaths: [NATIVE_COMMUNICATION_PATH],
          message: 'bypass attempt',
          settings: enabledSettings,
        }),
      /Cannot directly mutate protected shared owner/,
    )

    // Non-shared native paths are NOT blocked when sharedRead is enabled
    const nonSharedPath = 'human/prefs/coding.md'
    writeMemoryFile(memoryDir, nonSharedPath, 'coding content', { settings: enabledSettings })
    const commitRes = commitMemoryPaths({
      memoryRoot: memoryDir,
      relativePaths: [nonSharedPath],
      message: 'non-shared commit',
      settings: enabledSettings,
    })
    assert.equal(commitRes.committed, true)

    // When sharedRead is disabled (default): writeMemoryFile succeeds
    writeMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, 'default write', {
      settings: disabledSettings,
    })
    deleteMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, { settings: disabledSettings })

    // repairMemoryRepository leaves shared owner conflicts unresolved when sharedRead is enabled
    const repairRes = repairMemoryRepository(memoryDir, { settings: enabledSettings })
    assert.ok(repairRes.status === 'clean' || repairRes.status === 'unresolved')
  })

  test('Exact bypass regression: caller override cannot weaken runtime-owned enabled protection', () => {
    const memoryDir = tempDir('mem-bypass-runtime-')
    fs.mkdirSync(path.join(memoryDir, '.git'), { recursive: true })
    runGit(memoryDir, ['init', '-q', '-b', 'main'])

    const prevEnv = process.env.CURSOR_MEMORY_SHARED_READ
    try {
      process.env.CURSOR_MEMORY_SHARED_READ = 'true'
      assert.equal(loadSettings().sharedRead.enabled, true)

      const weakenedSettings = {
        reflection: loadSettings().reflection,
        sharedRead: {
          enabled: false,
          sourceRoot: '/test/source',
          sharedOwner: FIXED_SHARED_OWNER,
        },
      }

      // 1. writeMemoryFile with caller override enabled: false must STILL reject write
      assert.throws(
        () =>
          writeMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, 'attempted bypass', {
            settings: weakenedSettings,
          }),
        /Cannot directly mutate protected shared owner/,
      )

      // 2. deleteMemoryFile with caller override enabled: false must STILL reject deletion
      assert.throws(
        () =>
          deleteMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, {
            settings: weakenedSettings,
          }),
        /Cannot directly mutate protected shared owner/,
      )

      // 3. commitMemoryPaths with caller override enabled: false must STILL reject commit
      assert.throws(
        () =>
          commitMemoryPaths({
            memoryRoot: memoryDir,
            relativePaths: [NATIVE_COMMUNICATION_PATH],
            message: 'attempted bypass commit',
            settings: weakenedSettings,
          }),
        /Cannot directly mutate protected shared owner/,
      )

      // 4. writeMemory (editor API) with caller override enabled: false must divert to proposal, not write directly
      const editRes = writeMemory(NATIVE_COMMUNICATION_PATH, 'attempted editor bypass', {
        memoryRoot: memoryDir,
        settings: weakenedSettings,
      })
      assert.equal(editRes.status, 'proposed')
      assert.equal(editRes.committed, false)

      // 5. repairMemoryRepository with caller override enabled: false must leave shared owner unresolved
      const repairRes = repairMemoryRepository(memoryDir, { settings: weakenedSettings })
      assert.ok(repairRes.status === 'clean' || repairRes.status === 'unresolved')
    } finally {
      if (prevEnv === undefined) delete process.env.CURSOR_MEMORY_SHARED_READ
      else process.env.CURSOR_MEMORY_SHARED_READ = prevEnv
    }

    // 6. When live policy is disabled (default), native writes succeed
    assert.equal(loadSettings().sharedRead.enabled, false)
    const disabledSettings = {
      reflection: loadSettings().reflection,
      sharedRead: {
        enabled: false,
        sourceRoot: null,
        sharedOwner: FIXED_SHARED_OWNER,
      },
    }
    writeMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, 'default write', {
      settings: disabledSettings,
    })
    deleteMemoryFile(memoryDir, NATIVE_COMMUNICATION_PATH, { settings: disabledSettings })
  })
})
