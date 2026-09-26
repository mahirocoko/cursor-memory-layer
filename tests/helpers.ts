import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { initMemory } from '../src/memory/init.ts'

export function tempDir(prefix = 'cml-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export function tempMemory(): string {
  const root = path.join(tempDir(), 'memory')
  initMemory(root)
  return root
}

export function tempWorkspace(name: string, remote?: string): string {
  const workspace = path.join(tempDir(), name)
  fs.mkdirSync(workspace, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main', workspace])
  if (remote) execFileSync('git', ['-C', workspace, 'remote', 'add', 'origin', remote])
  return workspace
}

export const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8' }).trim()

export const transcriptLine = (role: 'user' | 'assistant', text: string): string =>
  JSON.stringify({ role, message: { content: [{ type: 'text', text }] } })

export function writeTranscript(
  projectsDir: string,
  project: string,
  id: string,
  lines: string[],
): string {
  const dir = path.join(projectsDir, project, 'agent-transcripts', id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.jsonl`)
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}
