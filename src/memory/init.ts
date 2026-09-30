import * as fs from 'node:fs'
import { renderMemoryDocument } from './document.ts'
import { resolveGitRoot } from './identity.ts'
import {
  commitMemoryPaths,
  initMemoryRepository,
  resolveMemoryPath,
  writeMemoryFile,
} from './repository.ts'

export type InitMemoryResult = {
  created: boolean
  seededPaths: string[]
  sha?: string
}

type Seed = { path: string; description: string; body: string; readOnly?: boolean; index?: boolean }

const rootIndex = `# MEMORY.md

Deferred notes live under \`reference/\` and under each project's nested files. Read a file when its description matches the task.
`

const globalSeeds: Seed[] = [
  {
    path: 'MEMORY.md',
    description: '',
    index: true,
    body: rootIndex.trim(),
  },
  {
    path: 'persona.md',
    description: 'Who I am as the Cursor agent.',
    readOnly: true,
    body: 'I am the Cursor agent for this human. I carry this memory across chats and keep it accurate myself.',
  },
  {
    path: 'human/identity.md',
    description: 'Stable facts the human has told me about themselves.',
    body: '- (nothing recorded yet)',
  },
  {
    path: 'human/prefs/communication.md',
    description: 'How the human wants me to talk to them: language, length, tone, and format.',
    body: '- (nothing recorded yet)',
  },
  {
    path: 'human/prefs/coding.md',
    description: 'How the human wants code written and reviewed when the repository is silent.',
    body: '- (nothing recorded yet)',
  },
  {
    path: 'human/prefs/workflow.md',
    description: 'How the human wants work run: approvals, verification, tools, and handoffs.',
    body: '- (nothing recorded yet)',
  },
]

const projectSeeds = (projectSlug: string, workspacePath: string): Seed[] => [
  {
    path: `${projectSlug}/MEMORY.md`,
    description: '',
    index: true,
    body: `# MEMORY.md\n\nFiles in this directory load every chat in ${projectSlug}. Nested files load on demand.\n`,
  },
  {
    path: `${projectSlug}/overview.md`,
    description: `What the ${projectSlug} project is and the facts that matter in every chat about it.`,
    body: [
      `- Workspace: ${resolveGitRoot(workspacePath) || workspacePath}`,
      '- (add architecture, conventions, and gotchas as they are confirmed)',
    ].join('\n'),
  },
]

export function initMemory(
  memoryRoot: string,
  project?: { slug: string; workspacePath: string },
): InitMemoryResult {
  const created = initMemoryRepository(memoryRoot)
  const seeds = project
    ? [...globalSeeds, ...projectSeeds(project.slug, project.workspacePath)]
    : globalSeeds
  const seededPaths: string[] = []
  for (const seed of seeds) {
    if (fs.existsSync(resolveMemoryPath(memoryRoot, seed.path).absolutePath)) continue
    const content = seed.index ? `${seed.body.trim()}\n` : renderMemoryDocument(seed)
    writeMemoryFile(memoryRoot, seed.path, content)
    seededPaths.push(seed.path)
  }
  if (seededPaths.length === 0) return { created, seededPaths }
  const result = commitMemoryPaths({
    memoryRoot,
    relativePaths: seededPaths,
    message: created ? 'memory: initialize' : 'memory: seed missing files',
  })
  return { created, seededPaths, sha: result.sha }
}
