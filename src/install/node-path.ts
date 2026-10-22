import * as fs from 'node:fs'
import * as path from 'node:path'

const HOMEBREW_CELLAR_NODE =
  /^(.+)[/\\]Cellar[/\\](node(?:@[^/\\]+)?)[/\\][^/\\]+[/\\]bin[/\\]node$/

const realpath = (file: string): string | null => {
  try {
    return fs.realpathSync(file)
  } catch {
    return null
  }
}

/**
 * Homebrew deletes the versioned Cellar binary on upgrade, so installed hooks
 * use a launcher symlink that resolves to the same binary today.
 */
export function stableNodePath(execPath: string, override?: string): string {
  if (override) {
    if (!path.isAbsolute(override) || path.basename(override) !== 'node') {
      throw new Error(`CURSOR_MEMORY_NODE must be an absolute path to a node binary: ${override}`)
    }
    if (!fs.existsSync(override)) throw new Error(`CURSOR_MEMORY_NODE does not exist: ${override}`)
    return override
  }
  const cellar = HOMEBREW_CELLAR_NODE.exec(execPath)
  const target = cellar && realpath(execPath)
  if (!cellar || !target) return execPath
  const [, prefix, formula] = cellar
  const launchers = [
    path.join(prefix, 'bin', 'node'),
    path.join(prefix, 'opt', formula, 'bin', 'node'),
  ]
  return launchers.find((launcher) => realpath(launcher) === target) ?? execPath
}
