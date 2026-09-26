const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    label: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  { label: 'OpenAI/Anthropic-style API key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    label: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
  {
    label: 'credential assignment',
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[^\s"'`]{8,}/i,
  },
  {
    label: 'URL with embedded credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
]

export function findSecretLikeContent(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label)
}

export function assertNoSecrets(text: string, context: string): void {
  const findings = findSecretLikeContent(text)
  if (findings.length > 0) {
    throw new Error(
      `Refusing to store ${context}: it looks like it contains a secret (${findings.join(', ')}). Remove it and describe the fact without the value.`,
    )
  }
}
