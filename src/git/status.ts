/**
 * Read-only repository state: porcelain counts, remotes, and which actions apply.
 */
import { git } from './process.ts'
import { firstLine, outputOf } from './text.ts'
import type { ActionStatus, ChangeCounts, GitAction, GitContext, RepoStatus, StatusResult } from './types.ts'

/** Parse `git status --porcelain` v1 into staged/unstaged/untracked counts. */
function countChanges(output: string): ChangeCounts {
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of output.split('\n')) {
    if (line.length < 2) continue
    if (line.startsWith('??')) {
      untracked += 1
      continue
    }
    if (line.startsWith('!!')) continue
    const index = line[0]
    const worktree = line[1]
    if (index !== ' ' && index !== '?') staged += 1
    if (worktree !== ' ' && worktree !== '?') unstaged += 1
  }
  return { staged, unstaged, untracked, total: staged + unstaged + untracked }
}

/** Prefer `origin` over any other configured remote. */
export function preferredRemote(remotes: readonly string[]): string | undefined {
  if (remotes.includes('origin')) return 'origin'
  return remotes[0]
}

/** Suggest a fresh branch name for the current minute. */
function suggestBranch(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `dsh/update-${stamp}`
}

/** Whether the pill can offer each action in this repository state. */
export function availableActions(status: ActionStatus): GitAction[] {
  const hasChanges = status.changes.total > 0
  const hasRemote = status.remotes.length > 0
  const canPush =
    !status.detached &&
    Boolean(status.branch) &&
    hasRemote &&
    (status.hasUpstream ? status.ahead > 0 : status.hasCommits)
  const canCreatePr =
    !status.detached && Boolean(status.branch) && hasRemote && status.hasCommits && (canPush || status.hasUpstream)
  const actions: GitAction[] = []
  if (hasChanges) actions.push('commit')
  if (hasChanges && hasRemote) actions.push('commitPush')
  if (hasChanges && hasRemote) actions.push('commitPr')
  if (canPush) actions.push('push')
  if (canCreatePr) actions.push('createPr')
  actions.push('createBranch')
  if (hasChanges) actions.push('branchCommit')
  if (hasChanges && hasRemote) actions.push('branchCommitPush')
  return actions
}

/** The action the main button triggers. */
export function defaultActionOf(actions: readonly GitAction[]): GitAction | null {
  if (actions.includes('commitPush')) return 'commitPush'
  if (actions.includes('commit')) return 'commit'
  if (actions.includes('push')) return 'push'
  return null
}

/** Choose the default branch a pull request should target. */
export async function resolveBaseBranch(ctx: GitContext, root: string, remotes: readonly string[]): Promise<string> {
  const remote = preferredRemote(remotes)
  if (remote !== undefined) {
    const head = await git(ctx, root, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], {
      timeoutMs: 15_000,
    })
    if (head.ok) {
      const name = head.stdout.trim().split('/').slice(1).join('/')
      if (name.length > 0) return name
    }
  }
  for (const candidate of ['main', 'master']) {
    const exists = await git(ctx, root, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], {
      timeoutMs: 15_000,
    })
    if (exists.ok) return candidate
  }
  return 'main'
}

/** Read one working directory's git state. */
export async function readStatus(ctx: GitContext, cwd: string): Promise<StatusResult> {
  const rootResult = await git(ctx, cwd, ['rev-parse', '--show-toplevel'], { timeoutMs: 15_000 })
  if (!rootResult.ok) {
    return {
      isRepo: false,
      reason: rootResult.spawnError ? 'git-unavailable' : 'not-a-repository',
      detail: firstLine(outputOf(rootResult)),
    }
  }
  const root = rootResult.stdout.trim()
  const [symbolic, detachedName, remoteResult, upstreamResult, statusResult, headResult] = await Promise.all([
    git(ctx, root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeoutMs: 15_000 }),
    git(ctx, root, ['rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 15_000 }),
    git(ctx, root, ['remote'], { timeoutMs: 15_000 }),
    git(ctx, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { timeoutMs: 15_000 }),
    git(ctx, root, ['status', '--porcelain'], { timeoutMs: 30_000 }),
    git(ctx, root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { timeoutMs: 15_000 }),
  ])

  let branch = ''
  let detached = false
  if (symbolic.ok) {
    branch = symbolic.stdout.trim()
  } else if (detachedName.ok) {
    const name = detachedName.stdout.trim()
    detached = name === 'HEAD' || name.length === 0
    branch = detached ? '' : name
  } else {
    detached = true
  }

  const remotes = remoteResult.ok
    ? remoteResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : []
  const remote = preferredRemote(remotes)
  const hasUpstream = upstreamResult.ok && upstreamResult.stdout.trim().length > 0
  const upstream = hasUpstream ? upstreamResult.stdout.trim() : null
  let ahead = 0
  let behind = 0
  if (hasUpstream) {
    const counts = await git(ctx, root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], {
      timeoutMs: 30_000,
    })
    if (counts.ok) {
      const [left, right] = counts.stdout.trim().split(/\s+/)
      ahead = Number.parseInt(left ?? '0', 10) || 0
      behind = Number.parseInt(right ?? '0', 10) || 0
    }
  }
  const changes = countChanges(statusResult.ok ? statusResult.stdout : '')
  const status: Omit<RepoStatus, 'actions' | 'defaultAction'> = {
    isRepo: true,
    root,
    branch,
    detached,
    remotes,
    remote: remote ?? null,
    hasUpstream,
    upstream,
    ahead,
    behind,
    hasCommits: headResult.ok,
    changes,
    suggestedBranch: suggestBranch(),
  }
  const actions = availableActions(status)
  return { ...status, actions, defaultAction: defaultActionOf(actions) }
}
