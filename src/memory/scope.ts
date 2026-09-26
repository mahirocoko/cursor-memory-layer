import { normalizeMemoryRelativePath, validateProjectSlug } from './repository.ts'

export type MemoryPathScope = {
  relativePath: string
  tier: 'system' | 'reference' | 'archive' | 'skill'
  projectSlug: string | null
}

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/
const SKILL_FILE_EXTENSIONS = ['.md', '.txt', '.sh', '.py', '.ts', '.js', '.mjs', '.json']

export const isSkillEntryPath = (relativePath: string): boolean =>
  /^skills\/[^/]+\/SKILL\.md$/.test(relativePath)

/** Free-form files (skill scripts and references) carry no frontmatter. */
export const requiresFrontmatter = (relativePath: string): boolean =>
  !relativePath.startsWith('skills/') || isSkillEntryPath(relativePath)

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
  if (top === 'system' && segments.length >= 2) {
    return { relativePath, tier: 'system', projectSlug: null }
  }
  if (top === 'reference' && segments.length >= 2) {
    return { relativePath, tier: 'reference', projectSlug: null }
  }
  if (top === 'archives' && segments.length >= 2) {
    return { relativePath, tier: 'archive', projectSlug: null }
  }
  if (top === 'projects' && segments.length >= 4) {
    const projectSlug = validateProjectSlug(segments[1])
    if (projectSlug !== segments[1]) {
      throw new Error(`Project slug in path must be lowercase: ${relativePath}`)
    }
    if (segments[2] === 'system') return { relativePath, tier: 'system', projectSlug }
    if (segments[2] === 'reference') return { relativePath, tier: 'reference', projectSlug }
  }
  throw new Error(
    `Unsupported memory path: ${relativePath}. Use system/, reference/, archives/, skills/<name>/, or projects/<slug>/{system,reference}/.`,
  )
}
