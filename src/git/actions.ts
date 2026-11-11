/**
 * Mutating Git actions. Each one reports progress already made when a later step fails.
 */
import { GitOperationError } from './error.ts'
import { GIT_TIMEOUT_MS, NETWORK_TIMEOUT_MS, git, run } from './process.ts'
import { preferredRemote, readStatus, resolveBaseBranch } from './status.ts'
import { firstLine, firstUrl, normalizeCommitMessage, outputOf, webRepositoryUrl } from './text.ts'
import type { ActionOutcome, ActionProgress, ActionRequest, GitContext, RepoStatus } from './types.ts'
import { isGitAction } from './types.ts'

/** Commit the index. When nothing is staged yet, stage the whole worktree first. */
async function commitAll(
  ctx: GitContext,
  root: string,
  message: string | undefined,
  stageAll: boolean,
): Promise<{ hash: string; subject: string }> {
  if (stageAll) {
    const add = await git(ctx, root, ['add', '-A'], { timeoutMs: 60_000 })
    if (!add.ok) throw new GitOperationError('stage-failed', firstLine(outputOf(add)))
  }
  const subject = normalizeCommitMessage(message)
  const commit = await git(ctx, root, ['commit', '-m', subject], { timeoutMs: GIT_TIMEOUT_MS })
  if (!commit.ok) {
    const text = outputOf(commit)
    if (/nothing to commit|no changes added/iu.test(text)) {
      throw new GitOperationError('nothing-to-commit', 'There is nothing to commit.')
    }
    throw new GitOperationError('commit-failed', firstLine(text))
  }
  const hash = await git(ctx, root, ['rev-parse', '--short', 'HEAD'], { timeoutMs: 15_000 })
  return { hash: hash.ok ? hash.stdout.trim() : '', subject }
}

/** Push the current branch, setting an upstream when it has none. */
async function pushBranch(
  ctx: GitContext,
  root: string,
  status: RepoStatus,
): Promise<{ branch: string; remote: string }> {
  if (status.detached || status.branch.length === 0) {
    throw new GitOperationError('detached-head', 'Cannot push from a detached HEAD. Create a branch first.')
  }
  const remote = status.remote ?? preferredRemote(status.remotes)
  if (remote === undefined) throw new GitOperationError('no-remote', 'The repository has no Git remote to push to.')
  const args = status.hasUpstream ? ['push'] : ['push', '--set-upstream', remote, status.branch]
  const pushed = await git(ctx, root, args, { timeoutMs: NETWORK_TIMEOUT_MS })
  if (!pushed.ok) throw new GitOperationError('push-failed', firstLine(outputOf(pushed)))
  return { branch: status.branch, remote }
}

/** Build a host compare link for a pull request that gh could not create. */
async function compareUrl(ctx: GitContext, root: string, status: RepoStatus): Promise<string | null> {
  const remote = status.remote ?? preferredRemote(status.remotes)
  if (remote === undefined || status.branch.length === 0) return null
  const remoteUrl = await git(ctx, root, ['config', '--get', `remote.${remote}.url`], { timeoutMs: 15_000 })
  if (!remoteUrl.ok) return null
  const base = webRepositoryUrl(remoteUrl.stdout)
  if (base === null) return null
  const baseBranch = await resolveBaseBranch(ctx, root, status.remotes)
  return `${base}/compare/${encodeURIComponent(baseBranch)}...${encodeURIComponent(status.branch)}?expand=1`
}

/** Create the pull request with gh, falling back to a compare link. */
async function createPullRequest(
  ctx: GitContext,
  root: string,
  status: RepoStatus,
  progress: ActionProgress,
): Promise<Pick<ActionProgress, 'pr'>> {
  const gh = await run(ctx, root, ['gh', 'pr', 'create', '--fill', '--head', status.branch], {
    timeoutMs: NETWORK_TIMEOUT_MS,
    env: { GH_PROMPT_DISABLED: '1' },
  })
  const text = outputOf(gh)
  const url = firstUrl(gh.stdout) ?? firstUrl(gh.stderr)
  if (gh.ok) return { pr: { url, created: true } }
  if (url !== null && /already exists/iu.test(text)) return { pr: { url, created: false, existing: true } }
  const manualUrl = await compareUrl(ctx, root, status)
  const partial: ActionProgress = { ...progress, manualUrl }
  if (gh.spawnError || /command not found|no such file|not recognized|ENOENT|exec: "gh"/iu.test(text)) {
    throw new GitOperationError(
      'gh-missing',
      'The GitHub CLI (gh) is not installed, so the pull request could not be created automatically.',
      { result: partial },
    )
  }
  throw new GitOperationError('pr-failed', firstLine(text, 500), { result: partial })
}

/** Create a branch from the current HEAD. */
async function createBranch(ctx: GitContext, root: string, rawName: string | undefined): Promise<string> {
  const name = String(rawName ?? '').trim()
  if (name.length === 0 || name.startsWith('-') || name.length > 200) {
    throw new GitOperationError('invalid-branch', 'Enter a valid branch name.')
  }
  const check = await git(ctx, root, ['check-ref-format', '--branch', name], { timeoutMs: 15_000 })
  if (!check.ok) throw new GitOperationError('invalid-branch', `"${name}" is not a valid branch name.`)
  const created = await git(ctx, root, ['checkout', '-b', name], { timeoutMs: 60_000 })
  if (!created.ok) throw new GitOperationError('branch-failed', firstLine(outputOf(created)))
  return name
}

/** Read status again and keep only a repository snapshot. */
async function requireRepo(ctx: GitContext, cwd: string, progress: ActionProgress): Promise<RepoStatus> {
  const status = await readStatus(ctx, cwd)
  if (!status.isRepo) {
    throw new GitOperationError(
      'not-a-repository',
      status.detail || 'The working directory is not a Git repository.',
      { result: progress },
    )
  }
  return status
}

/**
 * Execute one action against a repository and return its progress plus fresh state.
 */
export async function runAction(ctx: GitContext, cwd: string, request: ActionRequest): Promise<ActionOutcome> {
  const action = request.action
  if (!isGitAction(action)) {
    throw new GitOperationError('unknown-action', `Unknown action "${action}".`)
  }
  const before = await readStatus(ctx, cwd)
  if (!before.isRepo) {
    throw new GitOperationError('not-a-repository', before.detail || 'The working directory is not a Git repository.')
  }
  if (!before.actions.includes(action)) {
    throw new GitOperationError(
      'not-applicable',
      'That Git action is not available in the current repository state.',
      { status: before },
    )
  }
  const root = before.root
  const stageAll = before.changes.staged === 0
  const result: ActionProgress = {}
  try {
    switch (action) {
      case 'commit': {
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        break
      }
      case 'commitPush': {
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        const afterCommit = await requireRepo(ctx, cwd, result)
        result.push = await pushBranch(ctx, root, afterCommit)
        break
      }
      case 'commitPr': {
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        const afterCommit = await requireRepo(ctx, cwd, result)
        result.push = await pushBranch(ctx, root, afterCommit)
        Object.assign(result, await createPullRequest(ctx, root, afterCommit, result))
        break
      }
      case 'push': {
        result.push = await pushBranch(ctx, root, before)
        break
      }
      case 'createPr': {
        if (!before.hasUpstream || before.ahead > 0) {
          result.push = await pushBranch(ctx, root, before)
        }
        const afterPush = await requireRepo(ctx, cwd, result)
        Object.assign(result, await createPullRequest(ctx, root, afterPush, result))
        break
      }
      case 'createBranch': {
        result.branch = await createBranch(ctx, root, request.branchName)
        break
      }
      case 'branchCommit': {
        result.branch = await createBranch(ctx, root, request.branchName)
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        break
      }
      case 'branchCommitPush': {
        result.branch = await createBranch(ctx, root, request.branchName)
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        const afterCommit = await requireRepo(ctx, cwd, result)
        result.push = await pushBranch(ctx, root, afterCommit)
        break
      }
      default: {
        throw new GitOperationError('unknown-action', `Unknown action "${String(action)}".`)
      }
    }
  } catch (error) {
    if (error instanceof GitOperationError) {
      error.result = { ...result, ...(error.result ?? {}) }
      error.status = await readStatus(ctx, cwd).catch(() => before)
      throw error
    }
    throw error
  }
  let status: RepoStatus | Awaited<ReturnType<typeof readStatus>>
  try {
    status = await readStatus(ctx, cwd)
  } catch {
    status = before
  }
  return { result, status }
}
