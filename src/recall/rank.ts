/**
 * Hybrid BM25 + character n-gram ranking. Ported from agy-memory-layer
 * `recall-engine.ts`; zero runtime dependencies.
 */

import type { Transcript } from './transcripts.ts'

export type RecallHit = {
  id: string
  project: string
  filePath: string
  mtime: Date
  score: number
  matched: string[]
  firstPrompt: string
  snippet: string
  messageCount: number
}

type VectorProfile = Map<string, number>

const VECTOR_TEXT_LIMIT = 8_000

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2)
}

const nGrams = (word: string, size = 3): string[] => {
  if (word.length <= size) return [word]
  const grams: string[] = []
  for (let index = 0; index <= word.length - size; index++)
    grams.push(word.slice(index, index + size))
  return grams
}

export function buildVectorProfile(text: string): VectorProfile {
  const vector: VectorProfile = new Map()
  for (const word of tokenize(text)) {
    for (const gram of nGrams(word)) vector.set(gram, (vector.get(gram) || 0) + 1)
    vector.set(`w_${word}`, (vector.get(`w_${word}`) || 0) + 2)
  }
  let sumSquares = 0
  for (const value of vector.values()) sumSquares += value * value
  const norm = Math.sqrt(sumSquares) || 1
  for (const [key, value] of vector) vector.set(key, value / norm)
  return vector
}

export function cosineSimilarity(left: VectorProfile, right: VectorProfile): number {
  let dot = 0
  for (const [key, value] of left) dot += value * (right.get(key) || 0)
  return dot
}

const middleTruncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit / 2)} ${text.slice(-limit / 2)}`

const snippetFor = (transcript: Transcript, terms: string[]): string => {
  for (const message of transcript.messages) {
    const lower = message.text.toLowerCase()
    for (const term of terms) {
      const index = lower.indexOf(term)
      if (index < 0) continue
      const start = Math.max(0, index - 100)
      const end = Math.min(message.text.length, index + 220)
      return `${message.role}: …${message.text.slice(start, end).replace(/\s+/g, ' ')}…`
    }
  }
  return ''
}

export function rankTranscripts(
  transcripts: Transcript[],
  query: string,
  options: { limit?: number } = {},
): RecallHit[] {
  const queryTerms = [...new Set(tokenize(query))]
  if (queryTerms.length === 0) throw new Error('Recall query must not be empty.')
  const queryVector = buildVectorProfile(query)

  const documents = transcripts
    .filter((transcript) => transcript.messages.length > 0)
    .map((transcript) => {
      const text = transcript.messages.map((message) => message.text).join('\n')
      return { transcript, text, tokens: tokenize(text) }
    })
  if (documents.length === 0) return []

  const documentFrequency = new Map<string, number>()
  let totalTokens = 0
  for (const document of documents) {
    totalTokens += document.tokens.length
    for (const token of new Set(document.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)
    }
  }
  const averageLength = totalTokens / documents.length || 1

  const hits: RecallHit[] = []
  for (const document of documents) {
    const termFrequency = new Map<string, number>()
    for (const token of document.tokens)
      termFrequency.set(token, (termFrequency.get(token) || 0) + 1)

    let bm25 = 0
    const matched: string[] = []
    for (const term of queryTerms) {
      const frequency = termFrequency.get(term) || 0
      if (frequency === 0) continue
      matched.push(term)
      const df = documentFrequency.get(term) || 1
      const idf = Math.log((documents.length - df + 0.5) / (df + 0.5) + 1)
      const denominator =
        frequency + 1.5 * (1 - 0.75 + 0.75 * (document.tokens.length / averageLength))
      bm25 += idf * ((frequency * 2.5) / denominator)
    }

    const lowerText = document.text.toLowerCase()
    const substringMatches = queryTerms.filter(
      (term) => !matched.includes(term) && lowerText.includes(term),
    )
    matched.push(...substringMatches)

    const vectorScore = cosineSimilarity(
      queryVector,
      buildVectorProfile(middleTruncate(document.text, VECTOR_TEXT_LIMIT)),
    )
    const keywordScore = Math.min(1, bm25 / 15) + Math.min(0.3, substringMatches.length * 0.1)
    const score = vectorScore * 0.6 + keywordScore * 0.4
    if (matched.length === 0 && score <= 0.08) continue

    const firstUser = document.transcript.messages.find((message) => message.role === 'user')
    hits.push({
      id: document.transcript.id,
      project: document.transcript.project,
      filePath: document.transcript.filePath,
      mtime: document.transcript.mtime,
      score: Number(score.toFixed(3)),
      matched,
      firstPrompt: (firstUser?.text || '').replace(/\s+/g, ' ').slice(0, 160),
      snippet: snippetFor(document.transcript, matched.length > 0 ? matched : queryTerms),
      messageCount: document.transcript.messages.length,
    })
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, options.limit || 5)
}
