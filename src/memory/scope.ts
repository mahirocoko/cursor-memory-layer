import { normalizeMemoryRelativePath, validateProjectSlug } from './repository.ts'

export type MemoryPathScope = {
  relativePath: string
  tier: 'system' | 'reference' | 'archive' | 'skill'
  projectSlug: string | null
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const SKILL_FILE_EXTENSIONS = ['.md', '.txt', '.sh', '.py', '.ts', '.js', '.mjs', '.json']
const RESERVED_ROOTS = new Set(['human', 'skills', 'archives', 'reference', 'projects'])

export const isSkillEntryPath = (relativePath: string): boolean =>
  /^skills\/[^/]+\/SKILL\.md$/.test(relativePath)

export const isMemoryIndexPath = (relativePath: string): boolean =>
  relativePath === 'MEMORY.md' || relativePath.endsWith('/MEMORY.md')

/** Free-form files (skill scripts and references) and memory indexes carry no frontmatter. */
export const requiresFrontmatter = (relativePath: string): boolean => {
  if (isMemoryIndexPath(relativePath)) return false
  return !relativePath.startsWith('skills/') || isSkillEntryPath(relativePath)
}

export function classifyMemoryPath(input: string): MemoryPathScope {
  const relativePath = normalizeMemoryRelativePath(input)
  const segments = relativePath.split('/')
  const [top] = segments

  if (top === 'skills') {
    if (segments.length < 3 || !SKILL_NAME.test(segments[1])) {
      throw new Error(`Skill paths look like skills/<lowercase-name>/SKILL.md: ${relativePath}`)
    }
    if (!SKILL_FILE_EXTENSIONS.some((extension) => relativePath.endsWith(extension))) {
      throw new Error(
        `Skill files must be one of ${SKILL_FILE_EXTENSIONS.join(', ')}: ${relativePath}`,
      )
    }
    return { relativePath, tier: 'skill', projectSlug: null }
  }

  if (!relativePath.endsWith('.md')) {
    throw new Error(`Memory files must be Markdown (.md): ${relativePath}`)
  }
  if (relativePath === 'MEMORY.md' || relativePath === 'persona.md') {
    return { relativePath, tier: 'system', projectSlug: null }
  }
  if (top === 'human' && segments.length >= 2) {
    return { relativePath, tier: 'system', projectSlug: null }
  }
  if (top === 'reference' && segments.length >= 2) {
    return { relativePath, tier: 'reference', projectSlug: null }
  }
  if (top === 'archives' && segments.length >= 2) {
    return { relativePath, tier: 'archive', projectSlug: null }
  }
  if (!RESERVED_ROOTS.has(top) && segments.length >= 2) {
    const projectSlug = validateProjectSlug(top)
    if (segments.length === 2) return { relativePath, tier: 'system', projectSlug }
    return { relativePath, tier: 'reference', projectSlug }
  }
  throw new Error(
    `Unsupported memory path: ${relativePath}. Use persona.md, human/, MEMORY.md, reference/, archives/, skills/<name>/, or <project>/.`,
  )
}
