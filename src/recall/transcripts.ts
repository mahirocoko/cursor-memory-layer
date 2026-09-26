import * as fs from 'node:fs'
import * as path from 'node:path'

export type TranscriptMessage = {
  role: 'user' | 'assistant'
  text: string
}

export type Transcript = {
  id: string
  project: string
  filePath: string
  mtime: Date
  messages: TranscriptMessage[]
}

const WRAPPER_TAGS = [
  'attached_files',
  'system_reminder',
  'system_notification',
  'manually_attached_skills',
  'cursor_commands',
  'code_selection',
  'agent_skills',
]

export function cleanUserText(text: string): string {
  let cleaned = text
  for (const tag of WRAPPER_TAGS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'g'), ' ')
  }
  const query = cleaned.match(/<user_query>([\s\S]*?)<\/user_query>/)
  if (query) cleaned = query[1]
  return cleaned
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function parseTranscriptLines(raw: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line) as {
        role?: string
        message?: { content?: unknown }
      }
      if (record.role !== 'user' && record.role !== 'assistant') continue
      const content = record.message?.content
      const parts = Array.isArray(content)
        ? content.flatMap((part) =>
            part && typeof part === 'object' && (part as { type?: string }).type === 'text'
              ? [String((part as { text?: unknown }).text ?? '')]
              : [],
          )
        : typeof content === 'string'
          ? [content]
          : []
      const joined = parts.join('\n')
      const text = record.role === 'user' ? cleanUserText(joined) : joined.trim()
      if (text) messages.push({ role: record.role, text })
    } catch {}
  }
  return messages
}

export function readTranscript(filePath: string): Transcript | null {
  try {
    const stat = fs.statSync(filePath)
    const id = path.basename(filePath, '.jsonl')
    const project = path.basename(path.dirname(path.dirname(path.dirname(filePath))))
    return {
      id,
      project,
      filePath,
      mtime: stat.mtime,
      messages: parseTranscriptLines(fs.readFileSync(filePath, 'utf-8')),
    }
  } catch {
    return null
  }
}

export const cursorProjectKey = (workspacePath: string): string =>
  path
    .resolve(workspacePath)
    .replace(/^[/\\]+/, '')
    .replace(/[/\\.:\s]+/g, '-')

export function listTranscriptFiles(
  projectsDir: string,
  projectKey?: string,
  excludeId?: string,
): string[] {
  if (!fs.existsSync(projectsDir)) return []
  const projects = projectKey
    ? [projectKey]
    : fs
        .readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
  const files: string[] = []
  for (const project of projects) {
    const transcriptsDir = path.join(projectsDir, project, 'agent-transcripts')
    if (!fs.existsSync(transcriptsDir)) continue
    for (const entry of fs.readdirSync(transcriptsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === excludeId) continue
      const filePath = path.join(transcriptsDir, entry.name, `${entry.name}.jsonl`)
      if (fs.existsSync(filePath)) files.push(filePath)
    }
  }
  return files
}
