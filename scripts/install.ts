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
  statusLine: !process.argv.includes('--no-statusline'),
})

console.log(
  report.memory.created
    ? `Created memory repository (${report.memory.seededPaths.length} seed file(s)).`
    : 'Memory repository already exists.',
)
console.log(
  `Hooks: ${report.hooksFile}${report.hooksBackup ? ` (backup: ${report.hooksBackup})` : ''}`,
)
if (report.skillFile) console.log(`Skill: ${report.skillFile}`)
console.log(
  `Commands: ${report.commands.map((file) => `/${path.basename(file, '.md')}`).join(', ')}`,
)
if (report.statusLine === 'installed') console.log('Status line: cli-config.json statusLine')
if (report.binLink) console.log(`CLI: ${report.binLink}`)
for (const note of report.notes) console.log(`Note: ${note}`)
console.log('Open a new Cursor chat to load memory.')
