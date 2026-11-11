const MAX_DETAIL = 800

/** Extract a message from an unknown thrown value. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Render one command's combined output for a failure notice. */
export function outputOf(result: { stderr: string; stdout: string }): string {
  return [result.stderr, result.stdout].filter((text) => text.trim().length > 0).join('\n').trim()
}

/** Keep a failure detail short. */
export function firstLine(text: string, max = MAX_DETAIL): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return ''
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** Extract the first http(s) URL from a command's output. */
export function firstUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/u.exec(text)
  return match === null ? null : match[0].replace(/[.,;:)]+$/u, '')
}

/** Turn the last user message into a compact commit subject. */
export function normalizeCommitMessage(text: string | undefined): string {
  const subject = String(text ?? '')
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  const cleaned = subject
    .replace(/^[#>*\-\s]+/u, '')
    .replace(/`+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (cleaned.length === 0) return 'chore: update files'
  return cleaned.length > 72 ? `${cleaned.slice(0, 72)}…` : cleaned
}

/** Read a Git remote URL as a browsable repository URL. */
export function webRepositoryUrl(remoteUrl: string | null | undefined): string | null {
  const value = String(remoteUrl ?? '').trim()
  if (value.length === 0) return null
  if (value.startsWith('git@')) {
    const [host, path] = value.slice(4).split(':')
    if (host === undefined || path === undefined) return null
    return `https://${host}/${path.replace(/\.git$/u, '')}`
  }
  if (value.startsWith('ssh://')) {
    try {
      const url = new URL(value)
      return `https://${url.hostname}${url.pathname.replace(/\.git$/u, '')}`
    } catch {
      return null
    }
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value.replace(/\.git$/u, '')
  }
  return null
}
