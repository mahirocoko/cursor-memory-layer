#!/usr/bin/env node
// Cursor CLI status line, laid out like the Agy / Letta footer:
// folder · git · session · context · memory on the left, model on the right.
// Installed by cursor-memory-layer; plain JS with no imports from src/ so it
// starts fast on every update.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const COLORS = {
  folder: '#8C8CF9',
  git: '#64CF64',
  dirty: '#FEE19C',
  conversation: '#A5A8AB',
  activity: '#20B2AA',
  context: '#BEBEEE',
  contextWarn: '#FEE19C',
  contextCrit: '#F1689F',
  model: '#A5A8AB',
  reasoning: '#FEE19C',
  backend: '#A5A8AB',
  separator: '#46484A',
  memClean: '#64CF64',
  memDirty: '#FEE19C',
  memDreaming: '#20B2AA',
  memFailed: '#F1689F',
}

const DREAM_LOCK_STALE_MS = 20 * 60_000
const DREAM_LOG_TAIL_BYTES = 64 * 1024

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
    if (process.stdin.isTTY) resolve('')
  })
}

function hexColor(hex, text) {
  if (!hex || !text) return text || ''
  const match = hex.replace('#', '').match(/.{2}/g)
  if (!match || match.length < 3) return text
  const [r, g, b] = match.map((part) => parseInt(part, 16))
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

function stripAnsi(value) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colors
  return (value || '').replace(/\u001b\[[0-9;]*m/g, '')
}

function isWideCodePoint(codePoint) {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff))
  )
}

function isZeroWidthCodePoint(codePoint) {
  return (
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  )
}

function visibleWidth(value) {
  let width = 0
  for (const char of stripAnsi(value)) {
    const codePoint = char.codePointAt(0) ?? 0
    if (isZeroWidthCodePoint(codePoint)) continue
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

function shortId(value, max = 18) {
  if (!value) return ''
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(4, max - 1))}…`
}

function pick(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

async function getGitStatus(cwd) {
  const empty = {
    branch: null,
    dirtyCount: 0,
    untrackedCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    ahead: 0,
    behind: 0,
  }
  if (!cwd) return empty

  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v2', '--branch'], {
      cwd,
      encoding: 'utf8',
      timeout: 700,
    })
    const status = { ...empty }
    for (const line of stdout.split('\n')) {
      if (!line) continue
      if (line.startsWith('# branch.head ')) {
        const branch = line.slice('# branch.head '.length).trim()
        status.branch = branch === '(detached)' ? null : branch
        continue
      }
      if (line.startsWith('# branch.ab ')) {
        const match = line.match(/\+(\d+)\s+-(\d+)/)
        if (match) {
          status.ahead = Number(match[1] ?? 0)
          status.behind = Number(match[2] ?? 0)
        }
        continue
      }
      if (line.startsWith('? ')) {
        status.untrackedCount += 1
        continue
      }
      if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
        const xy = line.split(/\s+/, 3)[1] ?? ''
        if (xy.includes('A')) status.untrackedCount += 1
        else if (xy.includes('D')) status.deletedCount += 1
        else status.modifiedCount += 1
      }
    }
    status.dirtyCount = status.untrackedCount + status.modifiedCount + status.deletedCount
    return status
  } catch {
    return empty
  }
}

function memoryRoot() {
  const cursorHome = process.env.CURSOR_HOME || join(homedir(), '.cursor')
  return process.env.CURSOR_MEMORY_DIR || join(cursorHome, 'memory')
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function localDay(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function committedDreamsToday(logFile) {
  let text = ''
  try {
    const buffer = readFileSync(logFile)
    text = buffer.subarray(Math.max(0, buffer.length - DREAM_LOG_TAIL_BYTES)).toString('utf8')
  } catch {
    return 0
  }
  const today = localDay(new Date())
  let count = 0
  for (const line of text.split('\n')) {
    if (!line.includes('"committed"')) continue
    try {
      const entry = JSON.parse(line)
      if (entry.status === 'committed' && localDay(new Date(entry.at)) === today) count += 1
    } catch {}
  }
  return count
}

async function getMemoryStatus() {
  const root = memoryRoot()
  let dirtyCount
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 700,
    })
    dirtyCount = stdout.split('\n').filter(Boolean).length
  } catch {
    return null
  }
  const stateDir = join(root, '.git', 'cursor-memory')
  const lock = readJson(join(stateDir, 'dream.lock'))
  const dreaming =
    typeof lock?.pid === 'number' &&
    processAlive(lock.pid) &&
    Date.now() - Date.parse(lock.startedAt) < DREAM_LOCK_STALE_MS
  const failures = readJson(join(stateDir, 'state.json'))?.failures || 0
  return {
    dirtyCount,
    dreaming,
    failed: failures > 0,
    dreamsToday: committedDreamsToday(join(stateDir, 'dream.log')),
  }
}

// 🧠✓ clean · 🧠+N uncommitted files · 🧠… reflecting · 🧠! last reflection failed; ↻N = reflections committed today.
function formatMemory(status) {
  if (!status) return null
  const today = status.dreamsToday > 0 ? ` ↻${status.dreamsToday}` : ''
  if (status.dreaming) return { text: `🧠…${today}`, color: COLORS.memDreaming }
  if (status.failed) return { text: `🧠!${today}`, color: COLORS.memFailed }
  if (status.dirtyCount > 0) {
    return { text: `🧠+${status.dirtyCount}${today}`, color: COLORS.memDirty }
  }
  return { text: `🧠✓${today}`, color: COLORS.memClean }
}

function formatGit(status) {
  if (!status.branch) return null
  const parts = [`🌿 ${shortId(status.branch, 18)}`]
  if (status.ahead > 0) parts.push(`↑${status.ahead}`)
  if (status.behind > 0) parts.push(`↓${status.behind}`)
  if (status.dirtyCount === 0) parts.push('✓')
  else {
    if (status.untrackedCount > 0) parts.push(`+${status.untrackedCount}`)
    if (status.modifiedCount > 0) parts.push(`~${status.modifiedCount}`)
    if (status.deletedCount > 0) parts.push(`-${status.deletedCount}`)
  }
  return parts.join(' ')
}

function compactModel(name) {
  if (!name) return null
  return shortId(name.replace(/\s+/g, ' ').trim(), 32)
}

function cursorModelLabel(model, param, maxMode) {
  const name = model || ''
  const extras = []
  const haystack = name.toLowerCase()
  if (param && !haystack.includes(param.toLowerCase())) extras.push(param)
  if (maxMode && !haystack.includes('max')) extras.push('max')
  if (!name && extras.length === 0) return null
  if (!name) return `[${extras.join(' ')}]`
  if (extras.length === 0) return `[${name}]`
  return `[${name} · ${extras.join(' ')}]`
}

function compactParam(summary) {
  if (!summary) return null
  const text = summary.replace(/[()]/g, '').trim()
  if (!text || text.toLowerCase() === 'none') return null
  if (text.toLowerCase() === 'medium') return 'med'
  return shortId(text, 12)
}

function renderSegments(segments) {
  return segments
    .map((segment, index) => {
      const sep = index > 0 ? hexColor(COLORS.separator, ' · ') : ''
      return `${sep}${hexColor(segment.color, segment.text)}`
    })
    .join('')
}

function fitPrefix(segments, maxWidth) {
  if (maxWidth <= 0) return []
  const fitted = []
  for (const segment of segments) {
    const next = [...fitted, segment]
    if (visibleWidth(renderSegments(next)) > maxWidth) break
    fitted.push(segment)
  }
  return fitted
}

function formatRow(left, right, width) {
  if (!right) return left
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right))
  return `${left}${' '.repeat(gap)}${right}`
}

function sessionLabel(payload) {
  const name = pick(payload.session_name)
  if (name) return shortId(name, 22)
  const id = pick(payload.session_id)
  if (!id) return null
  const match = id.match(/^([0-9a-fA-F]{8})/)
  return match ? match[1] : shortId(id, 10)
}

async function main() {
  const raw = await readStdin()
  let payload = {}
  try {
    if (raw.trim()) payload = JSON.parse(raw)
  } catch {
    payload = {}
  }

  const width = Math.max(40, pickNumber(payload.render_width_chars) || 100)
  const cwd = pick(payload.cwd, payload.workspace?.current_dir, payload.workspace?.project_dir)
  const folder = !cwd ? 'workspace' : cwd === homedir() ? '~' : basename(cwd)
  const [git, memory] = await Promise.all([getGitStatus(cwd), getMemoryStatus()])
  const used = pickNumber(payload.context_window?.used_percentage)
  const model = compactModel(pick(payload.model?.display_name, payload.model?.id))
  const param = compactParam(pick(payload.model?.param_summary))
  const maxMode = payload.model?.max_mode === true

  const left = []
  if (folder) left.push({ text: `📁 ${shortId(folder, 18)}`, color: COLORS.folder })
  const gitText = formatGit(git)
  if (gitText) {
    left.push({
      text: gitText,
      color: git.dirtyCount > 0 ? COLORS.dirty : COLORS.git,
    })
  }
  const session = sessionLabel(payload)
  if (session) left.push({ text: `💬 ${shortId(session, 14)}`, color: COLORS.conversation })
  if (used != null) {
    const pct = Number.isInteger(used) ? String(used) : used.toFixed(1).replace(/\.0$/, '')
    const color = used >= 85 ? COLORS.contextCrit : used >= 65 ? COLORS.contextWarn : COLORS.context
    left.push({ text: `ctx ${pct}%`, color })
  }
  const memorySegment = formatMemory(memory)
  if (memorySegment) left.push(memorySegment)

  const rightParts = []
  const modelText = cursorModelLabel(model, param, maxMode)
  if (modelText) {
    rightParts.push({
      text: modelText,
      color: COLORS.model,
    })
  }
  if (width >= 90) rightParts.push({ text: 'CURSOR', color: COLORS.backend })

  const rightOptions = [rightParts, rightParts.filter((part) => part.text.startsWith('[')), []]
  let selectedLeft = ''
  let selectedRight = ''
  for (const parts of rightOptions) {
    const renderedRight = renderSegments(parts)
    const available = Math.max(0, width - visibleWidth(renderedRight) - (renderedRight ? 3 : 0))
    const fitted = fitPrefix(left, available)
    if (fitted.length > 0 || parts.length === 0) {
      selectedLeft = renderSegments(fitted)
      selectedRight = renderedRight
      break
    }
  }

  process.stdout.write(
    formatRow(selectedLeft || hexColor(COLORS.folder, 'CURSOR'), selectedRight, width),
  )
}

main().catch(() => {
  process.stdout.write(hexColor(COLORS.folder, 'CURSOR'))
})
