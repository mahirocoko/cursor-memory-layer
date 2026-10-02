const VALUE_OPTIONS = new Set([
  '--workspace',
  '--description',
  '--body',
  '--message',
  '-m',
  '--old',
  '--new',
  '--scope',
  '--limit',
  '--transcript',
  '--model',
  '--out',
  '--from',
  '--drop',
  '--source',
])

/**
 * `util.parseArgs` rejects option values that start with `-`, which breaks
 * Markdown bullets such as `--body "- item"`. Join them as `--flag=value`.
 */
export function joinOptionValues(argv: string[]): string[] {
  const joined: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (VALUE_OPTIONS.has(arg) && index + 1 < argv.length) {
      joined.push(`${arg === '-m' ? '--message' : arg}=${argv[++index]}`)
    } else {
      joined.push(arg)
    }
  }
  return joined
}
