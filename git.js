/**
 * Git operations for the git-ship bundle.
 *
 * The Host half resolves one Session's working directory and passes it here;
 * nothing in this module accepts a path from the browser. Every command runs
 * through the `subprocess` service with a bounded timeout and collected output.
 */

const GIT_TIMEOUT_MS = 120_000
const NETWORK_TIMEOUT_MS = 180_000
const MAX_DETAIL = 800

/** Canonical order of the actions the pill can offer. */
export const ACTION_ORDER = [
  'commit',
  'commitPush',
  'commitPr',
  'push',
  'createPr',
  'createBranch',
  'branchCommit',
  'branchCommitPush',
]

/** A failed git-ship operation with a stable code and an optional partial result. */
export class GitOperationError extends Error {
  /**
   * @param {string} code - stable failure code.
   * @param {string} detail - user-facing detail, usually git's own output.
   * @param {{ result?: unknown, status?: unknown }} [extra] - partial progress.
   */
  constructor(code, detail, extra = {}) {
    super(detail || code)
    this.name = 'GitOperationError'
    this.code = code
    this.detail = detail || ''
    this.result = extra.result
    this.status = extra.status
  }
}

/**
 * Run one argv without a shell, collecting stdout and stderr.
 * @param {{ subprocess: { spawn: Function } }} ctx - Host context.
 * @param {string} cwd - command working directory.
 * @param {string[]} argv - exact argv.
 * @param {{ timeoutMs?: number, env?: Record<string, string> }} [options] - bounds and overrides.
 */
async function run(ctx, cwd, argv, options = {}) {
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS
  let handle
  try {
    handle = ctx.subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4 * 1024 * 1024 },
        stderr: { maxBytes: 1024 * 1024 },
      },
      graceMs: 3_000,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        NO_COLOR: '1',
        TERM: 'dumb',
        ...options.env,
      },
    })
  } catch (error) {
    return { ok: false, spawnError: true, exitCode: null, stdout: '', stderr: messageOf(error) }
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      handle.terminate()
    } catch {}
  }, timeoutMs)
  try {
    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      return { ok: false, spawnError: true, exitCode: null, stdout: '', stderr: messageOf(error) }
    }
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return {
      ok: outcome.exitCode === 0 && !timedOut,
      timedOut,
      exitCode: outcome.exitCode,
      stdout,
      stderr,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run one git command in a directory.
 * @returns {Promise<{ ok: boolean, timedOut?: boolean, spawnError?: boolean, exitCode: number | null, stdout: string, stderr: string }>}
 */
function git(ctx, cwd, args, options = {}) {
  return run(ctx, cwd, ['git', ...args], options)
}

/** Render one command's combined output for a failure notice. */
function outputOf(result) {
  return [result.stderr, result.stdout].filter((text) => text.trim().length > 0).join('\n').trim()
}

/** Keep a failure detail short and on one logical line. */
function firstLine(text, max = MAX_DETAIL) {
  const trimmed = String(text ?? '').trim()
  if (trimmed.length === 0) return ''
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** Extract a message from an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Parse `git status --porcelain` v1 into staged/unstaged/untracked counts. */
function countChanges(output) {
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

/** Choose the default branch a pull request should target. */
async function resolveBaseBranch(ctx, root, remotes) {
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

/** Prefer `origin` over any other configured remote. */
export function preferredRemote(remotes) {
  if (remotes.includes('origin')) return 'origin'
  return remotes[0]
}

/** Suggest a fresh branch name for the current minute. */
function suggestBranch(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `dsh/update-${stamp}`
}

/** Whether the pill can offer each action in this repository state. */
export function availableActions(status) {
  const hasChanges = status.changes.total > 0
  const hasRemote = status.remotes.length > 0
  const canPush =
    !status.detached &&
    Boolean(status.branch) &&
    hasRemote &&
    (status.hasUpstream ? status.ahead > 0 : status.hasCommits)
  const canCreatePr =
    !status.detached && Boolean(status.branch) && hasRemote && status.hasCommits && (canPush || status.hasUpstream)
  const actions = []
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
export function defaultActionOf(actions) {
  if (actions.includes('commitPush')) return 'commitPush'
  if (actions.includes('commit')) return 'commit'
  if (actions.includes('push')) return 'push'
  return null
}

/**
 * Read one working directory's git state.
 * @param {{ subprocess: { spawn: Function, resolveExecutable: Function } }} ctx - Host context.
 * @param {string} cwd - Session working directory.
 */
export async function readStatus(ctx, cwd) {
  const rootResult = await git(ctx, cwd, ['rev-parse', '--show-toplevel'], { timeoutMs: 15_000 })
  if (!rootResult.ok) {
    return {
      isRepo: false,
      reason: rootResult.spawnError ? 'git-unavailable' : 'not-a-repository',
      detail: firstLine(outputOf(rootResult)),
    }
  }
  const root = rootResult.stdout.trim()
  const [symbolic, detachedName, remoteResult, upstreamResult, statusResult, headResult] =
    await Promise.all([
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
  const status = {
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

/** Turn the last user message into a compact commit subject. */
export function normalizeCommitMessage(text) {
  let subject = String(text ?? '')
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  subject = subject
    .replace(/^[#>*\-\s]+/u, '')
    .replace(/`+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (subject.length === 0) return 'chore: update files'
  return subject.length > 72 ? `${subject.slice(0, 72)}…` : subject
}

/**
 * Commit the index. When nothing is staged yet, stage the whole worktree first
 * so the button still works for agent edits that were never added.
 * @param {boolean} stageAll - run `git add -A` before committing.
 */
async function commitAll(ctx, root, message, stageAll) {
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
async function pushBranch(ctx, root, status) {
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

/** Extract the first http(s) URL from a command's output. */
function firstUrl(text) {
  const match = /https?:\/\/[^\s<>"']+/u.exec(String(text ?? ''))
  return match === null ? null : match[0].replace(/[.,;:)]+$/u, '')
}

/** Read a Git remote URL as a browsable repository URL. */
export function webRepositoryUrl(remoteUrl) {
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

/** Build a host compare link for a pull request that gh could not create. */
async function compareUrl(ctx, root, status) {
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
async function createPullRequest(ctx, root, status, progress) {
  const gh = await run(ctx, root, ['gh', 'pr', 'create', '--fill', '--head', status.branch], {
    timeoutMs: NETWORK_TIMEOUT_MS,
    env: { GH_PROMPT_DISABLED: '1' },
  })
  const text = outputOf(gh)
  const url = firstUrl(gh.stdout) ?? firstUrl(gh.stderr)
  if (gh.ok) return { pr: { url, created: true } }
  if (url !== null && /already exists/iu.test(text)) return { pr: { url, created: false, existing: true } }
  const manualUrl = await compareUrl(ctx, root, status)
  const partial = { ...progress, manualUrl }
  if (gh.spawnError || /command not found|no such file|not recognized|ENOENT|exec: "gh"/iu.test(text)) {
    throw new GitOperationError(
      'gh-missing',
      'The GitHub CLI (gh) is not installed, so the pull request could not be created automatically.',
      { result: partial },
    )
  }
  throw new GitOperationError('pr-failed', firstLine(text, 500), { result: partial })
}

/**
 * Create a branch from the current HEAD.
 * @returns {Promise<string>} the new branch name.
 */
async function createBranch(ctx, root, rawName) {
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

/**
 * Execute one action against a repository and return its progress plus fresh state.
 * @param {{ subprocess: { spawn: Function, resolveExecutable: Function } }} ctx - Host context.
 * @param {string} cwd - Session working directory.
 * @param {{ action: string, branchName?: string, message?: string }} request - the action.
 */
export async function runAction(ctx, cwd, request) {
  const action = request.action
  if (!ACTION_ORDER.includes(action)) {
    throw new GitOperationError('unknown-action', `Unknown action "${String(action)}".`)
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
  const result = {}
  try {
    switch (action) {
      case 'commit': {
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        break
      }
      case 'commitPush': {
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        const afterCommit = await readStatus(ctx, cwd)
        result.push = await pushBranch(ctx, root, afterCommit)
        break
      }
      case 'commitPr': {
        result.commit = await commitAll(ctx, root, request.message, stageAll)
        const afterCommit = await readStatus(ctx, cwd)
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
        const afterPush = await readStatus(ctx, cwd)
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
        const afterCommit = await readStatus(ctx, cwd)
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
  let status
  try {
    status = await readStatus(ctx, cwd)
  } catch {
    status = before
  }
  return { result, status }
}
