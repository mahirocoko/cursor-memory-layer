import * as path from 'node:path'

/** Quote a literal argument for the POSIX shell used by local Cursor hooks. */
export const quoteShellArgument = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

/** Read only our literal Node invocation shapes; never evaluate shell input. */
export const nodeScriptPath = (command: string, marker: string): string | null => {
  const literal = command.endsWith(marker) ? command.slice(0, -marker.length) : command
  const words: string[] = []
  let word = ''
  let quote = ''
  let active = false
  for (let index = 0; index < literal.length; index++) {
    const char = literal[index]
    if (quote) {
      if (char === quote) quote = ''
      else {
        if (quote === '"' && /[$`\\]/.test(char)) return null
        word += char
      }
    } else if (char === "'" || char === '"') {
      quote = char
      active = true
    } else if (char === '\\') {
      if (literal[index + 1] !== "'") return null
      word += literal[++index]
      active = true
    } else if (char === ' ' || char === '\t') {
      if (active) words.push(word)
      word = ''
      active = false
    } else {
      if (/[\n\r;$`|&<>#]/.test(char)) return null
      word += char
      active = true
    }
  }
  if (quote) return null
  if (active) words.push(word)
  if (!words.length || path.basename(words[0]) !== 'node') return null
  const args = words.slice(1)
  if (args.length === 1 && path.isAbsolute(args[0])) return args[0]
  if (
    args.length === 3 &&
    args[0] === '--experimental-strip-types' &&
    args[1] === '--disable-warning=ExperimentalWarning' &&
    path.isAbsolute(args[2])
  )
    return args[2]
  return null
}
