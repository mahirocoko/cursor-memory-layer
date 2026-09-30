import * as fs from 'node:fs'
import { renderMemoryDocument } from './memory/document.ts'
import {
  commitMemoryPaths,
  getMemoryRepositoryStatus,
  resolveMemoryPath,
  writeMemoryFile,
} from './memory/repository.ts'
import { findSecretLikeContent } from './memory/secrets.ts'
import type { TranscriptMessage } from './recall/transcripts.ts'

export type ReflectionResult =
  | { status: 'written'; relativePath: string; intents: string[]; sha?: string }
  | { status: 'skipped'; reason: string }

const DURABLE_INTENT_PATTERNS = [
  /\bremember\b/i,
  /\bfrom now on\b/i,
  /\bgoing forward\b/i,
  /\b(?:always|never)\b/i,
  /\bI (?:prefer|want you to|don'?t want|do not want|like it when|hate it when)\b/i,
  /\bplease (?:don'?t|do not|stop)\b/i,
  /\bmy (?:name|role|preference|style) is\b/i,
  /จำ(?:ไว้|ว่า|ด้วย)/,
  /ต่อไปนี้/,
  /(?:ทุกครั้ง|เสมอ|ห้าม|อย่า)/,
  /(?:ฉัน|ผม)(?:ชอบ|ไม่ชอบ|อยากให้|ต้องการให้)/,
]

const MAX_INTENTS = 12
const MAX_INTENT_CHARS = 400

const splitSentences = (text: string): string[] =>
  text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

export function extractDurableIntents(messages: TranscriptMessage[]): string[] {
  const intents: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const sentence of splitSentences(message.text)) {
      if (sentence.startsWith('/') || sentence.startsWith('```')) continue
      if (!DURABLE_INTENT_PATTERNS.some((pattern) => pattern.test(sentence))) continue
      if (findSecretLikeContent(sentence).length > 0) continue
      const intent = sentence.replace(/\s+/g, ' ').slice(0, MAX_INTENT_CHARS)
      if (!intents.includes(intent)) intents.push(intent)
      if (intents.length >= MAX_INTENTS) return intents
    }
  }
  return intents
}

export function writeReflectionNote(options: {
  memoryRoot: string
  projectSlug: string
  conversationId: string
  messages: TranscriptMessage[]
  now?: Date
}): ReflectionResult {
  const userMessages = options.messages.filter((message) => message.role === 'user').length
  if (userMessages === 0) return { status: 'skipped', reason: 'no user messages' }
  const intents = extractDurableIntents(options.messages)
  if (intents.length === 0) return { status: 'skipped', reason: 'no durable intent found' }

  const status = getMemoryRepositoryStatus(options.memoryRoot)
  if (status.state !== 'clean') return { status: 'skipped', reason: status.summary }

  const now = options.now || new Date()
  const date = now.toISOString().slice(0, 10)
  const shortId = options.conversationId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || 'session'
  const relativePath = `archives/projects/${options.projectSlug}/learnings/${date}_${shortId}.md`
  if (fs.existsSync(resolveMemoryPath(options.memoryRoot, relativePath).absolutePath)) {
    return { status: 'skipped', reason: `${relativePath} already exists` }
  }

  const body = [
    `Conversation \`${options.conversationId}\` on ${now.toISOString()}.`,
    '',
    'Statements of lasting intent from the human, verbatim. Review them and promote confirmed ones into `human/` or the project directory with `cursor-memory`:',
    '',
    ...intents.map((intent) => `- ${intent}`),
  ].join('\n')
  writeMemoryFile(
    options.memoryRoot,
    relativePath,
    renderMemoryDocument({
      description: `Reflection candidates from Cursor chat ${shortId} (${options.projectSlug}).`,
      body,
    }),
  )
  const result = commitMemoryPaths({
    memoryRoot: options.memoryRoot,
    relativePaths: [relativePath],
    message: `memory: reflection from ${shortId}`,
  })
  return { status: 'written', relativePath, intents, sha: result.sha }
}
