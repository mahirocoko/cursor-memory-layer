import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { install } from '../src/install/installer.ts'
import { getCursorHome, getMemoryRoot } from '../src/memory/config.ts'

const report = install({
  repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  cursorHome: getCursorHome(),
  memoryRoot: getMemoryRoot(),
  nodePath: process.execPath,
  binDir: process.env.CURSOR_MEMORY_BIN_DIR || path.join(os.homedir(), '.local', 'bin'),
})

console.log(
  report.memory.created
    ? `Created memory repository (${report.memory.seededPaths.length} seed file(s)).`
    : 'Memory repository already exists.',
)
console.log(
  `Hooks: ${report.hooksFile}${report.hooksBackup ? ` (backup: ${report.hooksBackup})` : ''}`,
)
console.log(`Skill: ${report.skillFile}`)
if (report.binLink) console.log(`CLI: ${report.binLink}`)
for (const note of report.notes) console.log(`Note: ${note}`)
console.log('Open a new Cursor chat to load memory.')
