import assert from 'node:assert/strict'
import * as path from 'node:path'
import { beforeEach, describe, test } from 'node:test'
import { planDreamOperations } from '../src/dream/apply.ts'
import { parseDreamResponse } from '../src/dream/prompt.ts'
import { type AgentRunInput, resolveDreamModel, runDream } from '../src/dream/runner.ts'
import {
  isBackedOff,
  markReflected,
  readDreamLog,
  readDreamState,
  reflectedMessageCount,
} from '../src/dream/state.ts'
import { evaluateDreamTrigger } from '../src/dream/trigger.ts'
import { handleStop } from '../src/hooks/stop.ts'
import { writeMemory } from '../src/memory/editor.ts'
import { getMemoryLog, readCommittedMemoryFile } from '../src/memory/repository.ts'
import { DEFAULT_SETTINGS, type ReflectionSettings } from '../src/memory/settings.ts'
import { tempDir, tempMemory, tempWorkspace, transcriptLine, writeTranscript } from './helpers.ts'

const settings = (overrides: Partial<ReflectionSettings> = {}): ReflectionSettings => ({
  ...DEFAULT_SETTINGS.reflection,
  ...overrides,
})

const reply = (value: unknown): string =>
  `Here you go.\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`

const chat = (turns: number, id = 'conv-1'): string =>
  writeTranscript(
    tempDir(),
    'proj',
    id,
    Array.from({ length: turns }, (_, index) => [
      transcriptLine('user', `Question ${index + 1}: from now on use pnpm, not npm.`),
      transcriptLine('assistant', `Answer ${index + 1}.`),
    ]).flat(),
  )

beforeEach(() => {
  process.env.CURSOR_MEMORY_DREAM_WORKSPACE = path.join(tempDir(), 'memory-dream')
})

describe('dream response contract', () => {
  test('parses the last fenced JSON block and validates operations', () => {
    const parsed = parseDreamResponse(
      reply({
        summary: '  Saved   pnpm preference ',
        operations: [
          { op: 'write', path: 'system/human/prefs/workflow.md', body: '- Uses pnpm.' },
          { op: 'delete', path: 'reference/old.md' },
        ],
      }),
    )
    assert.equal(parsed.summary, 'Saved pnpm preference')
    assert.equal(parsed.operations.length, 2)
    assert.throws(() => parseDreamResponse('no json here'), /no JSON/)
    assert.throws(
      () => parseDreamResponse(reply({ operations: [{ op: 'write', body: 'x' }] })),
      /has no path/,
    )
    assert.throws(
      () =>
        parseDreamResponse(
          reply({ operations: Array.from({ length: 9 }, () => ({ op: 'delete', path: 'a.md' })) }),
        ),
      /limit is 8/,
    )
  })
})

describe('runDream', () => {
  test('validates, commits, rejects unsafe operations, and advances state', () => {
    const memoryRoot = tempMemory()
    writeMemory('reference/locked.md', 'Pinned.', {
      memoryRoot,
      description: 'Pinned note.',
      readOnly: true,
    })
    const workspace = tempWorkspace('dream-app')
    const transcriptPath = chat(2)
    const prompts: AgentRunInput[] = []
    const outcome = runDream(
      {
        transcriptPath,
        conversationId: 'conv-1',
        workspace,
        trigger: 'session-end',
        model: 'auto',
      },
      {
        memoryRoot,
        settings: settings(),
        runAgent: (input) => {
          prompts.push(input)
          return {
            ok: true,
            text: reply({
              summary: 'Prefers pnpm',
              operations: [
                {
                  op: 'write',
                  path: 'system/human/prefs/workflow.md',
                  body: '- Uses pnpm, not npm.',
                },
                {
                  op: 'write',
                  path: 'skills/release/SKILL.md',
                  description: 'Cut a release.',
                  body: '1. Tag.\n2. Push.',
                },
                { op: 'write', path: 'archives/x.md', description: 'x', body: 'x' },
                { op: 'write', path: 'reference/locked.md', body: 'Changed.' },
                { op: 'write', path: 'reference/new.md', body: 'No description.' },
              ],
            }),
          }
        },
      },
    )

    assert.equal(outcome.status, 'committed')
    assert.equal(prompts.length, 1)
    assert.equal(prompts[0].model, 'auto')
    assert.equal(prompts[0].workspace, process.env.CURSOR_MEMORY_DREAM_WORKSPACE)
    assert.match(prompts[0].prompt, /Question 2: from now on use pnpm/)
    assert.match(prompts[0].prompt, /### system\/human\/prefs\/workflow\.md/)
    assert.match(prompts[0].prompt, /### reference\/locked\.md \(read_only\)/)
    assert.match(prompts[0].prompt, /### system\/persona\.md \(read_only\)/)
    assert.doesNotMatch(prompts[0].prompt, /`system\/persona\.md`: every chat/)
    assert.equal(outcome.rejected?.length, 3)

    const commit = getMemoryLog(memoryRoot, 1)[0]
    assert.equal(commit.subject, 'memory(reflection): Prefers pnpm')
    assert.deepEqual(commit.paths.sort(), [
      'skills/release/SKILL.md',
      'system/human/prefs/workflow.md',
    ])
    assert.match(
      readCommittedMemoryFile(memoryRoot, 'system/human/prefs/workflow.md') || '',
      /Uses pnpm/,
    )
    assert.match(
      readCommittedMemoryFile(memoryRoot, 'skills/release/SKILL.md') || '',
      /^---\nname: release\n/,
    )
    assert.equal(reflectedMessageCount(memoryRoot, 'conv-1'), 4)
    assert.equal(readDreamLog(memoryRoot, 1)[0].status, 'committed')

    let called = false
    const again = runDream(
      { transcriptPath, conversationId: 'conv-1', workspace, trigger: 'stop', model: 'auto' },
      {
        memoryRoot,
        settings: settings(),
        runAgent: () => {
          called = true
          return { ok: true, text: reply({ summary: 'x', operations: [] }) }
        },
      },
    )
    assert.equal(again.status, 'skipped')
    assert.equal(called, false)
  })

  test('dry run validates proposals without committing, logging, or marking', () => {
    const memoryRoot = tempMemory()
    const head = getMemoryLog(memoryRoot, 1)[0].sha
    const outcome = runDream(
      {
        transcriptPath: chat(2, 'dry'),
        conversationId: 'dry',
        workspace: tempWorkspace('dry'),
        trigger: 'manual',
        model: 'auto',
      },
      {
        memoryRoot,
        settings: settings(),
        availableModels: () => ['auto'],
        dryRun: true,
        runAgent: () => ({
          ok: true,
          text: reply({
            summary: 'Prefers pnpm',
            operations: [
              { op: 'write', path: 'system/human/prefs/workflow.md', body: '- Uses pnpm.' },
              { op: 'write', path: 'archives/x.md', body: '- nope' },
            ],
          }),
        }),
      },
    )
    assert.equal(outcome.status, 'dry-run')
    assert.deepEqual(outcome.planned, ['system/human/prefs/workflow.md'])
    assert.equal(outcome.operations?.length, 2)
    assert.equal(outcome.rejected?.length, 1)
    assert.equal(getMemoryLog(memoryRoot, 1)[0].sha, head)
    assert.equal(readDreamLog(memoryRoot).length, 0)
    assert.equal(reflectedMessageCount(memoryRoot, 'dry'), 0)
  })

  test('rejects persona edits and still applies the rest of the batch', () => {
    const memoryRoot = tempMemory()
    const baseRevision = getMemoryLog(memoryRoot, 1)[0].sha
    const plan = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [
        { op: 'append', path: 'system/persona.md', body: '- Drifted.' },
        { op: 'append', path: 'system/human/prefs/workflow.md', body: '- Uses pnpm.' },
      ],
    })
    assert.deepEqual(plan.rejected, ['system/persona.md: read_only'])
    assert.deepEqual(
      plan.pending.map((change) => change.relativePath),
      ['system/human/prefs/workflow.md'],
    )
  })

  test('rejects writes that drop most of a file unless the lines move elsewhere', () => {
    const memoryRoot = tempMemory()
    const lines = ['- Uses pnpm.', '- Replies in Thai.', '- Small commits.', '- Tabs, not spaces.']
    writeMemory('system/human/prefs/workflow.md', lines.join('\n'), { memoryRoot })
    const baseRevision = getMemoryLog(memoryRoot, 1)[0].sha
    const shrink = { op: 'write' as const, path: 'system/human/prefs/workflow.md', body: lines[0] }

    const dropped = planDreamOperations({ memoryRoot, baseRevision, operations: [shrink] })
    assert.equal(dropped.pending.length, 0)
    assert.match(dropped.rejected[0], /would drop 3 of 4 existing lines/)

    const moved = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [
        shrink,
        {
          op: 'write',
          path: 'reference/style.md',
          description: 'Style details.',
          body: lines.slice(1).join('\n'),
        },
      ],
    })
    assert.deepEqual(moved.rejected, [])
    assert.equal(moved.pending.length, 2)

    const rewritten = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [{ ...shrink, body: [...lines.slice(0, 3), '- Spaces, not tabs.'].join('\n') }],
    })
    assert.deepEqual(rewritten.rejected, [])
  })

  test('replace and append apply in order, and system growth per reflection is capped', () => {
    const memoryRoot = tempMemory()
    writeMemory('system/human/prefs/workflow.md', '- Uses npm.\n- Replies in Thai.', { memoryRoot })
    const baseRevision = getMemoryLog(memoryRoot, 1)[0].sha
    const path = 'system/human/prefs/workflow.md'
    const plan = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [
        { op: 'replace', path, old: 'npm', new: 'pnpm' },
        { op: 'append', path, body: '- Small commits.' },
        { op: 'replace', path, old: 'missing', new: 'x' },
        { op: 'append', path, body: `- ${'long detail '.repeat(200)}` },
      ],
    })
    assert.equal(plan.pending.length, 1)
    assert.match(
      plan.pending[0].content ?? '',
      /- Uses pnpm\.\n- Replies in Thai\.\n- Small commits\.\n$/,
    )
    assert.match(plan.rejected[0], /old text matched 0 times/)
    assert.match(plan.rejected[1], /would grow system\/ by \d+ characters/)

    const reference = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [
        {
          op: 'append',
          path: 'reference/detail.md',
          description: 'Detail.',
          body: `- ${'long detail '.repeat(200)}`,
        },
      ],
    })
    assert.deepEqual(reference.rejected, [])
  })

  test('rejects a system trim that loses unique lines unless they move in the same batch', () => {
    const memoryRoot = tempMemory()
    const facts = [
      '- Reviews happen in the afternoon.',
      '- Screenshots go to the temp evidence dir.',
      '- Thai to the human, English to agents.',
      '- Never push without being asked.',
      '- Commit messages use Conventional Commits.',
      '- Visual acceptance stays with the human.',
    ]
    const path = 'system/human/prefs/workflow.md'
    writeMemory(path, facts.join('\n'), { memoryRoot })
    const baseRevision = getMemoryLog(memoryRoot, 1)[0].sha
    const trim = { op: 'replace' as const, path, old: facts.slice(3).join('\n'), new: '' }
    const lost = planDreamOperations({ memoryRoot, baseRevision, operations: [trim] })
    assert.match(lost.rejected[0], /would lose 3 lines/)

    const moved = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [
        trim,
        {
          op: 'write',
          path: 'reference/workflow-detail.md',
          description: 'Workflow detail.',
          body: facts.slice(3).join('\n'),
        },
      ],
    })
    assert.deepEqual(moved.rejected, [])
  })

  test('replacing the seed placeholder is not counted as dropping lines', () => {
    const memoryRoot = tempMemory()
    const baseRevision = getMemoryLog(memoryRoot, 1)[0].sha
    const plan = planDreamOperations({
      memoryRoot,
      baseRevision,
      operations: [{ op: 'write', path: 'system/human/prefs/workflow.md', body: '- Uses pnpm.' }],
    })
    assert.deepEqual(plan.rejected, [])
  })

  test('skips operations on files that changed after the snapshot', () => {
    const memoryRoot = tempMemory()
    const outcome = runDream(
      {
        transcriptPath: chat(1),
        conversationId: 'c',
        workspace: tempWorkspace('race'),
        trigger: 'manual',
        model: 'auto',
      },
      {
        memoryRoot,
        settings: settings(),
        runAgent: () => {
          writeMemory('system/human/prefs/workflow.md', '- Written by the live chat.', {
            memoryRoot,
          })
          return {
            ok: true,
            text: reply({
              summary: 'late',
              operations: [
                { op: 'write', path: 'system/human/prefs/workflow.md', body: '- Stale.' },
              ],
            }),
          }
        },
      },
    )
    assert.equal(outcome.status, 'no-change')
    assert.match(outcome.rejected?.[0] || '', /changed in memory after the reflection snapshot/)
    assert.match(
      readCommittedMemoryFile(memoryRoot, 'system/human/prefs/workflow.md') || '',
      /live chat/,
    )
  })

  test('failures back off and leave the transcript unreflected', () => {
    const memoryRoot = tempMemory()
    const outcome = runDream(
      {
        transcriptPath: chat(1),
        conversationId: 'f',
        workspace: tempWorkspace('fail'),
        trigger: 'manual',
        model: 'auto',
      },
      { memoryRoot, settings: settings(), runAgent: () => ({ ok: false, error: 'boom' }) },
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(reflectedMessageCount(memoryRoot, 'f'), 0)
    assert.equal(isBackedOff(readDreamState(memoryRoot)), true)
  })

  test('inherit falls back when cursor-agent does not know the chat model', () => {
    const available = () => ['composer-2.5', 'auto']
    assert.equal(resolveDreamModel('composer-2.5', settings(), available), 'composer-2.5')
    assert.equal(resolveDreamModel('mystery-model', settings(), available), 'auto')
    assert.equal(
      resolveDreamModel('auto', settings({ fallbackModel: 'composer-2.5' }), available),
      'composer-2.5',
    )
  })
})

describe('dream triggers', () => {
  const input = (transcriptPath: string, workspace: string) => ({
    transcript_path: transcriptPath,
    conversation_id: 'conv-1',
    workspace_roots: [workspace],
    model: 'composer-2.5',
  })

  test('session-end waits for enough new user messages and inherits the chat model', () => {
    const memoryRoot = tempMemory()
    const workspace = tempWorkspace('trig')
    const options = { memoryRoot, settings: settings() }
    assert.equal(
      evaluateDreamTrigger(input(chat(3), workspace), 'session-end', options).fire,
      false,
    )
    const ready = evaluateDreamTrigger(input(chat(4), workspace), 'session-end', options)
    assert.equal(ready.fire, true)
    if (ready.fire) {
      assert.equal(ready.job.model, 'composer-2.5')
      assert.equal(ready.job.trigger, 'session-end')
    }
  })

  test('step-count counts only unreflected assistant messages', () => {
    const memoryRoot = tempMemory()
    const workspace = tempWorkspace('steps')
    const transcriptPath = chat(3)
    const options = { memoryRoot, settings: settings({ stepCount: 3 }) }
    assert.equal(
      evaluateDreamTrigger(input(transcriptPath, workspace), 'step-count', options).fire,
      true,
    )
    markReflected(memoryRoot, 'conv-1', 6)
    assert.equal(
      evaluateDreamTrigger(input(transcriptPath, workspace), 'step-count', options).fire,
      false,
    )
  })

  test('compaction reflects with the chat model the stop hook saw, not the summarizer', () => {
    const memoryRoot = tempMemory()
    const workspace = tempWorkspace('compact')
    const transcriptPath = chat(1)
    handleStop({ ...input(transcriptPath, workspace), model: 'composer-2.5' }, memoryRoot)
    const decision = evaluateDreamTrigger(
      { ...input(transcriptPath, workspace), model: 'gemini-3.7-flash-low' },
      'compaction',
      { memoryRoot, settings: settings() },
    )
    assert.equal(decision.fire, true)
    if (decision.fire) assert.equal(decision.job.model, 'composer-2.5')
    markReflected(memoryRoot, 'conv-1', 2)
    assert.equal(readDreamState(memoryRoot).conversations['conv-1']?.chatModel, 'composer-2.5')
  })

  test('never fires inside the reflection workspace, when disabled, or with the trigger off', () => {
    const memoryRoot = tempMemory()
    const transcriptPath = chat(5)
    const dreamWorkspace = process.env.CURSOR_MEMORY_DREAM_WORKSPACE || ''
    const decision = evaluateDreamTrigger(input(transcriptPath, dreamWorkspace), 'compaction', {
      memoryRoot,
      settings: settings(),
    })
    assert.deepEqual(decision, { fire: false, reason: 'reflection session' })
    const workspace = tempWorkspace('off')
    assert.equal(
      evaluateDreamTrigger(input(transcriptPath, workspace), 'compaction', {
        memoryRoot,
        settings: settings({ enabled: false }),
      }).fire,
      false,
    )
    assert.equal(
      evaluateDreamTrigger(input(transcriptPath, workspace), 'compaction', {
        memoryRoot,
        settings: settings({ triggers: ['session-end'] }),
      }).fire,
      false,
    )
  })
})
