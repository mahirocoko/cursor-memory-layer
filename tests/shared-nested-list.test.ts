import * as assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MemoryDocument } from '../src/memory/projection.ts'
import {
  FIXED_SHARED_OWNER,
  mergeCommunicationDocuments,
  NATIVE_COMMUNICATION_PATH,
  type SharedSourceInspection,
} from '../src/memory/shared.ts'

const document = (body: string, relativePath: string): MemoryDocument => ({
  body,
  relativePath,
  description: 'Isolated structural regression',
  readOnly: true,
  scope: 'global',
  tier: 'system',
})

const inspection: SharedSourceInspection = {
  enabled: true,
  sourceRoot: '/isolated-structural-source',
  sharedOwner: FIXED_SHARED_OWNER,
  valid: true,
  pinnedSha: 'a'.repeat(40),
  diagnostics: [],
  content: null,
  document: null,
}

test('nested children stay with distinct native parents inside a shared section', () => {
  const { mergedDoc } = mergeCommunicationDocuments(
    document('## Topics\n\n- Topic A\n  - Details', FIXED_SHARED_OWNER),
    document('## Topics\n\n- Topic B\n  - Details', NATIVE_COMMUNICATION_PATH),
    inspection,
  )
  assert.ok(mergedDoc.body.includes('- Topic B\n  - Details'))
  assert.equal(mergedDoc.body.split('  - Details').length - 1, 2)
})

test('identical parent subtrees deduplicate without dropping their child', () => {
  const body = '## Topics\n\n- Topic A\n  - Details\n    continuation'
  const { mergedDoc } = mergeCommunicationDocuments(
    document(body, FIXED_SHARED_OWNER),
    document(body, NATIVE_COMMUNICATION_PATH),
    inspection,
  )
  assert.equal(mergedDoc.body.split('- Topic A').length - 1, 1)
  assert.ok(mergedDoc.body.includes('  - Details\n    continuation'))
})

test('native paragraph survives when the shared section is a list', () => {
  const paragraph = 'Distinct native paragraph that must stay.'
  const { mergedDoc } = mergeCommunicationDocuments(
    document('## Rules\n\n- Shared rule', FIXED_SHARED_OWNER),
    document(`## Rules\n\n${paragraph}`, NATIVE_COMMUNICATION_PATH),
    inspection,
  )
  assert.ok(mergedDoc.body.includes('- Shared rule'))
  assert.ok(mergedDoc.body.includes(paragraph))
})

test('distinct native list introduction is retained alongside both lists', () => {
  const { mergedDoc } = mergeCommunicationDocuments(
    document('## Rules\n\nShared introduction.\n\n- Shared rule', FIXED_SHARED_OWNER),
    document('## Rules\n\nNative introduction.\n\n- Native rule', NATIVE_COMMUNICATION_PATH),
    inspection,
  )
  for (const clause of [
    'Shared introduction.',
    'Native introduction.',
    '- Shared rule',
    '- Native rule',
  ]) {
    assert.ok(mergedDoc.body.includes(clause))
  }
})
