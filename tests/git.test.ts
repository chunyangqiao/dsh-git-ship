import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GitOperationError,
  availableActions,
  normalizeCommitMessage,
  readStatus,
  runAction,
  webRepositoryUrl,
  type RepoStatus,
  type StatusResult,
} from '../src/git/index.ts'
import { cleanup, createSubprocess, git, setupRepo } from './helpers.ts'

const createContext = (options?: { withoutGh?: boolean }) => ({ subprocess: createSubprocess(options) })

function assertRepo(status: StatusResult): RepoStatus {
  assert.equal(status.isRepo, true)
  if (!status.isRepo) throw new Error('expected a repository')
  return status
}

const tests: { name: string; fn: () => Promise<void> | void }[] = []
function test(name: string, fn: () => Promise<void> | void): void {
  tests.push({ name, fn })
}

test('clean pushed repository offers only PR and branch creation', async () => {
  const { base, repo } = setupRepo()
  try {
    const status = assertRepo(await readStatus(createContext(), repo))
    assert.deepEqual(status.changes, { staged: 0, unstaged: 0, untracked: 0, total: 0 })
    assert.deepEqual(status.actions, ['createPr', 'createBranch'])
    assert.equal(status.defaultAction, null)
    assert.equal(status.hasUpstream, true)
    assert.equal(status.ahead, 0)
  } finally {
    cleanup(base)
  }
})

test('unstaged and untracked changes unlock commit variants', async () => {
  const { base, repo } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    writeFileSync(join(repo, 'b.txt'), 'new\n')
    const status = assertRepo(await readStatus(createContext(), repo))
    assert.equal(status.changes.unstaged, 1)
    assert.equal(status.changes.untracked, 1)
    assert.equal(status.changes.total, 2)
    assert.ok(status.actions.includes('commit'))
    assert.ok(status.actions.includes('commitPush'))
    assert.ok(status.actions.includes('commitPr'))
    assert.ok(status.actions.includes('branchCommitPush'))
    assert.equal(status.defaultAction, 'commitPush')
  } finally {
    cleanup(base)
  }
})

test('commit stages everything and leaves a pushable commit', async () => {
  const { base, repo } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    writeFileSync(join(repo, 'b.txt'), 'new\n')
    const outcome = await runAction(createContext(), repo, {
      action: 'commit',
      message: 'feat: capture the change',
    })
    const commit = outcome.result.commit
    assert.ok(commit)
    const status = assertRepo(outcome.status)
    assert.match(commit.hash, /^[0-9a-f]+$/u)
    assert.equal(commit.subject, 'feat: capture the change')
    assert.equal(status.changes.total, 0)
    assert.ok(status.actions.includes('push'))
    assert.equal(status.ahead, 1)
    assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']), status.branch)
  } finally {
    cleanup(base)
  }
})

test('commit honors an existing index instead of staging the whole worktree', async () => {
  const { base, repo } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'staged change\n')
    git(repo, ['add', 'a.txt'])
    writeFileSync(join(repo, 'b.txt'), 'left unstaged\n')
    const outcome = await runAction(createContext(), repo, {
      action: 'commit',
      message: 'feat: only the staged file',
    })
    const status = assertRepo(outcome.status)
    assert.equal(git(repo, ['show', 'HEAD:a.txt']), 'staged change')
    assert.throws(() => git(repo, ['show', 'HEAD:b.txt']))
    assert.equal(status.changes.staged, 0)
    assert.equal(status.changes.untracked, 1)
    assert.ok(status.actions.includes('commit'))
  } finally {
    cleanup(base)
  }
})

test('commit then push reaches the remote', async () => {
  const { base, repo, remote, branch } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'change for push\n')
    const outcome = await runAction(createContext(), repo, {
      action: 'commitPush',
      message: 'fix: push this',
    })
    const status = assertRepo(outcome.status)
    assert.equal(outcome.result.commit?.subject, 'fix: push this')
    assert.equal(outcome.result.push?.branch, branch)
    assert.equal(status.ahead, 0)
    const remoteHead = git(remote, ['rev-parse', branch])
    const localHead = git(repo, ['rev-parse', 'HEAD'])
    assert.equal(remoteHead, localHead)
  } finally {
    cleanup(base)
  }
})

test('create branch, commit and push sets a new upstream', async () => {
  const { base, repo } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'branch work\n')
    const outcome = await runAction(createContext(), repo, {
      action: 'branchCommitPush',
      branchName: 'feature/ship',
      message: 'feat: branch work',
    })
    const status = assertRepo(outcome.status)
    assert.equal(outcome.result.branch, 'feature/ship')
    assert.equal(status.branch, 'feature/ship')
    assert.equal(status.hasUpstream, true)
    assert.match(status.upstream ?? '', /feature\/ship$/u)
    assert.equal(status.ahead, 0)
    assert.equal(status.changes.total, 0)
  } finally {
    cleanup(base)
  }
})

test('create branch alone switches branches and rejects invalid names', async () => {
  const { base, repo } = setupRepo()
  try {
    const outcome = await runAction(createContext(), repo, { action: 'createBranch', branchName: 'feature/empty' })
    const status = assertRepo(outcome.status)
    assert.equal(outcome.result.branch, 'feature/empty')
    assert.equal(status.branch, 'feature/empty')
    await assert.rejects(
      runAction(createContext(), repo, { action: 'createBranch', branchName: 'bad name' }),
      (error: unknown) => error instanceof GitOperationError && error.code === 'invalid-branch',
    )
  } finally {
    cleanup(base)
  }
})

test('create PR without gh reports the compare link after pushing', async () => {
  const { base, repo, remote } = setupRepo()
  try {
    git(repo, ['config', `url.${remote}.insteadOf`, 'git@github.com:owner/repo.git'])
    git(repo, ['remote', 'set-url', 'origin', 'git@github.com:owner/repo.git'])
    writeFileSync(join(repo, 'a.txt'), 'create pr work\n')
    await runAction(createContext(), repo, { action: 'commit', message: 'feat: prepare a pr' })
    await assert.rejects(
      runAction(createContext({ withoutGh: true }), repo, { action: 'createPr' }),
      (error: unknown) => {
        assert.ok(error instanceof GitOperationError)
        assert.equal(error.code, 'gh-missing')
        const manualUrl = error.result?.manualUrl
        if (typeof manualUrl !== 'string') return false
        assert.match(manualUrl, /^https:\/\/github\.com\/owner\/repo\/compare\//u)
        assert.equal(typeof error.result?.push?.branch, 'string')
        return true
      },
    )
  } finally {
    cleanup(base)
  }
})

test('unavailable actions are refused before touching the worktree', async () => {
  const { base, repo } = setupRepo()
  try {
    await assert.rejects(
      runAction(createContext(), repo, { action: 'commit', message: 'nope' }),
      (error: unknown) => error instanceof GitOperationError && error.code === 'not-applicable',
    )
    await assert.rejects(
      runAction(createContext(), repo, { action: 'nonsense' }),
      (error: unknown) => error instanceof GitOperationError && error.code === 'unknown-action',
    )
  } finally {
    cleanup(base)
  }
})

test('pull-request fallback reports the compare link when gh is missing', async () => {
  const { base, repo, remote } = setupRepo()
  try {
    // Keep pushes local while reporting a GitHub URL, so the compare link is buildable.
    git(repo, ['config', `url.${remote}.insteadOf`, 'git@github.com:owner/repo.git'])
    git(repo, ['remote', 'set-url', 'origin', 'git@github.com:owner/repo.git'])
    writeFileSync(join(repo, 'a.txt'), 'pr work\n')
    await assert.rejects(
      runAction(createContext({ withoutGh: true }), repo, {
        action: 'commitPr',
        message: 'feat: pull request',
      }),
      (error: unknown) => {
        assert.ok(error instanceof GitOperationError)
        assert.equal(error.code, 'gh-missing')
        const manualUrl = error.result?.manualUrl
        if (typeof manualUrl !== 'string') return false
        assert.match(manualUrl, /\/compare\//u)
        assert.equal(typeof error.result?.commit?.hash, 'string')
        assert.equal(typeof error.result?.push?.branch, 'string')
        return true
      },
    )
  } finally {
    cleanup(base)
  }
})

test('helpers normalize messages, classify actions and rewrite remote URLs', () => {
  assert.equal(normalizeCommitMessage('## Fix the thing\n\nmore detail'), 'Fix the thing')
  assert.equal(normalizeCommitMessage('\n\n'), 'chore: update files')
  assert.equal(
    availableActions({
      branch: 'main',
      detached: false,
      remotes: ['origin'],
      hasUpstream: true,
      ahead: 0,
      hasCommits: true,
      changes: { staged: 0, unstaged: 0, untracked: 0, total: 0 },
    }).join(','),
    'createPr,createBranch',
  )
  assert.equal(webRepositoryUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo')
  assert.equal(webRepositoryUrl('https://gitlab.com/owner/repo.git'), 'https://gitlab.com/owner/repo')
  assert.equal(webRepositoryUrl('ssh://git@github.com/owner/repo.git'), 'https://github.com/owner/repo')
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL - ${name}`)
    console.error(error)
  }
}
if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log(`all ${tests.length} tests passed`)
