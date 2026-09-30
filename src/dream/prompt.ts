/**
 * Reflection ("dream") prompt and response contract. The instructions follow
 * Letta Code's reflection subagent (`src/agent/subagents/builtin/reflection.md`):
 * extract durable knowledge, fix contradictions at the source, deduplicate, and
 * skip one-off task state. Unlike Letta, the child here has no tools; it returns
 * JSON operations that the harness validates and commits.
 */

import { DREAM_SYSTEM_GROWTH_MAX_CHARS } from '../memory/config.ts'
import { parseMemoryDocument } from '../memory/document.ts'
import { listCommittedMemoryFiles, readCommittedMemoryFile } from '../memory/repository.ts'
import { isSkillEntryPath, requiresFrontmatter } from '../memory/scope.ts'
import type { TranscriptMessage } from '../recall/transcripts.ts'

export type DreamOperation =
  | { op: 'write'; path: string; description?: string; body: string }
  | { op: 'replace'; path: string; old: string; new: string }
  | { op: 'append'; path: string; description?: string; body: string }
  | { op: 'delete'; path: string }

export type DreamResponse = {
  summary: string
  operations: DreamOperation[]
}

export const MAX_DREAM_OPERATIONS = 8
const SNAPSHOT_MAX_CHARS = 160_000
const TRANSCRIPT_MAX_CHARS = 60_000
const USER_MESSAGE_MAX_CHARS = 4_000
const ASSISTANT_MESSAGE_MAX_CHARS = 1_500

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)} …[clipped ${text.length - max} chars]` : text

export function buildMemorySnapshot(memoryRoot: string, projectSlug: string): string {
  const all = listCommittedMemoryFiles(memoryRoot, '')
  const inlineOrder = [
    (file: string) => file.startsWith(`projects/${projectSlug}/system/`),
    (file: string) => file.startsWith('system/'),
    (file: string) => file.startsWith(`projects/${projectSlug}/reference/`),
    (file: string) => isSkillEntryPath(file),
    (file: string) => file.startsWith('reference/'),
  ]
  const ordered = inlineOrder.flatMap((matches) => all.filter(matches))
  const sections: string[] = []
  const listed: string[] = []
  let used = 0
  for (const file of ordered) {
    const content = readCommittedMemoryFile(memoryRoot, file)
    if (content === null) continue
    const readOnly =
      requiresFrontmatter(file) && parseMemoryDocument(content, file).readOnly ? ' (read_only)' : ''
    const block = `### ${file}${readOnly}\n${content.trim()}\n`
    if (used + block.length > SNAPSHOT_MAX_CHARS) {
      listed.push(`- ${file}${readOnly} (not shown; budget reached)`)
      continue
    }
    sections.push(block)
    used += block.length
  }
  const other = all.filter(
    (file) => !ordered.includes(file) && !file.startsWith('archives/') && file.endsWith('.md'),
  )
  for (const file of other) listed.push(`- ${file} (other project; not shown)`)
  if (listed.length > 0) sections.push(`### Files not shown\n${listed.join('\n')}\n`)
  return sections.join('\n') || '(memory is empty)'
}

export function renderTranscriptSlice(messages: TranscriptMessage[], startIndex: number): string {
  const rendered = messages.map((message, offset) => {
    const limit = message.role === 'user' ? USER_MESSAGE_MAX_CHARS : ASSISTANT_MESSAGE_MAX_CHARS
    return `[${startIndex + offset + 1}] ${message.role}: ${clip(message.text, limit)}`
  })
  const kept: string[] = []
  let used = 0
  for (let index = rendered.length - 1; index >= 0; index--) {
    if (used + rendered[index].length > TRANSCRIPT_MAX_CHARS) {
      kept.unshift(`[… ${index + 1} earlier message(s) omitted for length]`)
      break
    }
    kept.unshift(rendered[index])
    used += rendered[index].length
  }
  return kept.join('\n\n')
}

export function buildDreamPrompt(options: {
  snapshot: string
  transcript: string
  projectSlug: string
  conversationId: string
  revision: string
}): string {
  const slug = options.projectSlug
  return `You are the background reflection pass ("dream") for Cursor Memory, a Letta-style persistent memory that an AI coding agent carries across chats. You have no tools and cannot ask questions. Do not try to read files or run commands; everything you need is below. Reply only with the JSON described at the end.

Review the new conversation excerpt against the current memory and decide what, if anything, should change so future chats go better.

## What to capture
- Stable preferences and corrections the human gave about how to communicate or work.
- Facts the human stated about themselves.
- Confirmed project conventions, decisions, gotchas, and commands for project "${slug}".
- A repeatable multi-step procedure worth reusing, as a skill.

## Rules
- Most conversations need no change. Zero operations is a normal, good answer.
- Record only what the human said or confirmed, or what the repository evidently established. Never record the assistant's guesses.
- Skip one-off task state: progress, current bugs, temporary plans, file lists for today's task.
- Record commands, ports, versions, and paths exactly as the human stated them or as the conversation showed them working. Never derive one the conversation did not show.
- Resolve contradictions at the source: rewrite the stale line instead of appending a conflicting one. If the new facts make part of a line wrong and the correct value is unknown, remove that part rather than keep or guess it. Deduplicate.
- Prefer updating an existing file on the same subject over creating a new one; create a file only for a clearly separate topic.
- Everything in \`system/\` and \`projects/${slug}/system/\` is loaded into every chat, so each line there costs every future chat. One reflection may grow \`system/\` by at most ${DREAM_SYSTEM_GROWTH_MAX_CHARS} characters in total; put longer additions in \`reference/\` with a precise description.
- To change an existing file, prefer \`replace\` (an exact \`old\` passage that appears once, and its \`new\` text) or \`append\`. Use \`write\` only for a new file or to rewrite a short one.
- Never store secrets, credentials, tokens, private URLs, or long transcript quotes.
- Never touch files marked (read_only), including \`system/persona.md\` (the agent's identity). Never write under \`archives/\`.
- Write in the language the existing memory uses for that file; English when new.

## Where things go
- \`system/human/prefs/communication.md\`, \`system/human/prefs/coding.md\`, \`system/human/prefs/workflow.md\`, \`system/human/identity.md\`: every chat, every project. Do not edit \`system/persona.md\`; identity changes happen in chat with the human.
- \`projects/${slug}/system/<topic>.md\`: every chat in this project.
- \`reference/<topic>.md\`, \`projects/${slug}/reference/<topic>.md\`: loaded on demand by description.
- \`skills/<lowercase-name>/SKILL.md\`: a procedure the agent should follow when its description matches.

## Current memory (committed revision ${options.revision.slice(0, 8)})
${options.snapshot}

## New conversation excerpt (conversation ${options.conversationId})
${options.transcript}

## Output
Reply with exactly one fenced json block and nothing else:
\`\`\`json
{
  "summary": "one line, at most 80 characters: what changed, or no changes",
  "operations": [
    { "op": "replace", "path": "<an existing path>", "old": "exact existing text, found once", "new": "replacement text (empty to remove)" },
    { "op": "append", "path": "<a path>", "body": "markdown to add at the end", "description": "only when creating the file" },
    { "op": "write", "path": "<a path from the layout above>", "description": "one-line purpose of the file", "body": "the complete new markdown body without frontmatter" },
    { "op": "delete", "path": "<an existing path>" }
  ]
}
\`\`\`
\`write\` replaces the whole file, so include every line you keep; a change that drops most of an existing file is rejected. Several operations may target the same file; they apply in order. Reuse the existing description unless it is wrong. At most ${MAX_DREAM_OPERATIONS} operations.`
}

const extractJson = (text: string): string | null => {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1)
  if (fenced) return fenced[1]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : null
}

export function parseDreamResponse(text: string): DreamResponse {
  const json = extractJson(text)
  if (!json) throw new Error('Reflection reply had no JSON block.')
  const parsed = JSON.parse(json) as { summary?: unknown; operations?: unknown }
  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.replace(/\s+/g, ' ').trim().slice(0, 100)
      : 'reflection'
  if (!Array.isArray(parsed.operations))
    throw new Error('Reflection reply has no operations array.')
  if (parsed.operations.length > MAX_DREAM_OPERATIONS) {
    throw new Error(
      `Reflection proposed ${parsed.operations.length} operations; the limit is ${MAX_DREAM_OPERATIONS}.`,
    )
  }
  const operations = parsed.operations.map((raw, index): DreamOperation => {
    const operation = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    if (typeof operation.path !== 'string' || !operation.path.trim()) {
      throw new Error(`Operation ${index + 1} has no path.`)
    }
    if (operation.op === 'delete') return { op: 'delete', path: operation.path.trim() }
    if (
      operation.op === 'replace' &&
      typeof operation.old === 'string' &&
      operation.old &&
      typeof operation.new === 'string'
    ) {
      return { op: 'replace', path: operation.path.trim(), old: operation.old, new: operation.new }
    }
    if (
      (operation.op === 'write' || operation.op === 'append') &&
      typeof operation.body === 'string'
    ) {
      return {
        op: operation.op,
        path: operation.path.trim(),
        body: operation.body,
        ...(typeof operation.description === 'string' && operation.description.trim()
          ? { description: operation.description.trim() }
          : {}),
      }
    }
    throw new Error(
      `Operation ${index + 1} must be replace (with old and new), append or write (with body), or delete.`,
    )
  })
  return { summary, operations }
}
