import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export type HookInput = Record<string, unknown>

export function parseHookInput(raw: string): HookInput {
  try {
    const parsed: unknown = JSON.parse(raw.trim() || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HookInput)
      : {}
  } catch {
    return {}
  }
}

export const firstWorkspaceRoot = (input: HookInput): string | null => {
  const roots = input.workspace_roots
  if (!Array.isArray(roots)) return null
  const first = roots.find((root): root is string => typeof root === 'string' && root.length > 0)
  return first || null
}

export const stringField = (input: HookInput, key: string): string | null => {
  const value = input[key]
  return typeof value === 'string' && value ? value : null
}

export const isDirectInvocation = (moduleUrl: string): boolean => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(moduleUrl))
  } catch {
    return false
  }
}

export function runHook(handler: (input: HookInput) => object): void {
  let raw = ''
  process.stdin.setEncoding('utf-8')
  process.stdin.on('data', (chunk) => {
    raw += chunk
  })
  process.stdin.on('end', () => {
    let output: object = {}
    try {
      output = handler(parseHookInput(raw))
    } catch (error) {
      process.stderr.write(
        `cursor-memory hook error: ${error instanceof Error ? error.message : error}\n`,
      )
    }
    process.stdout.write(`${JSON.stringify(output)}\n`)
  })
}
