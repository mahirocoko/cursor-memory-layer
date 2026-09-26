import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { uninstall } from '../src/install/installer.ts'
import { getCursorHome, getMemoryRoot } from '../src/memory/config.ts'

const actions = uninstall({
  repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  cursorHome: getCursorHome(),
  memoryRoot: getMemoryRoot(),
  nodePath: process.execPath,
  binDir: process.env.CURSOR_MEMORY_BIN_DIR || path.join(os.homedir(), '.local', 'bin'),
})
for (const action of actions) console.log(action)
