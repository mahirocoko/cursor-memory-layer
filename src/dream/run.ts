#!/usr/bin/env node
import * as fs from 'node:fs'
import { isDirectInvocation } from '../hooks/io.ts'
import { getMemoryRoot } from '../memory/config.ts'
import { loadSettings } from '../memory/settings.ts'
import { type DreamJob, runDream } from './runner.ts'

if (isDirectInvocation(import.meta.url)) {
  const jobFile = process.argv[2]
  try {
    const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8')) as DreamJob
    const outcome = runDream(job, {
      memoryRoot: getMemoryRoot(),
      settings: loadSettings().reflection,
    })
    console.log(`${new Date().toISOString()} ${outcome.status}: ${outcome.detail}`)
  } catch (error) {
    console.error(
      `${new Date().toISOString()} dream runner error: ${error instanceof Error ? error.message : error}`,
    )
    process.exitCode = 1
  } finally {
    if (jobFile) fs.rmSync(jobFile, { force: true })
  }
}
