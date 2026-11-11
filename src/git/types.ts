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
] as const

/** One action the pill can offer. */
export type GitAction = (typeof ACTION_ORDER)[number]

/** Whether a string is one of the pill actions. */
export function isGitAction(action: string): action is GitAction {
  return (ACTION_ORDER as readonly string[]).includes(action)
}

/** Collected output of one subprocess invocation. */
export interface CommandResult {
  ok: boolean
  timedOut?: boolean
  spawnError?: boolean
  exitCode: number | null
  stdout: string
  stderr: string
}

/** Staged, unstaged, and untracked file counts. */
export interface ChangeCounts {
  staged: number
  unstaged: number
  untracked: number
  total: number
}

/**
 * Repository fields the action menu reads.
 * Callers may omit the rest of a full status snapshot.
 */
export interface ActionStatus {
  branch: string
  detached: boolean
  remotes: readonly string[]
  hasUpstream: boolean
  ahead: number
  hasCommits: boolean
  changes: {
    total: number
    staged?: number
    unstaged?: number
    untracked?: number
  }
}

/** A working directory that is not a usable Git repository. */
export interface AbsentRepo {
  isRepo: false
  reason: string
  detail: string
}

/** A repository the pill can offer actions for. */
export interface RepoStatus extends ActionStatus {
  isRepo: true
  root: string
  remote: string | null
  upstream: string | null
  behind: number
  changes: ChangeCounts
  suggestedBranch: string
  actions: GitAction[]
  defaultAction: GitAction | null
}

/** Either a repository snapshot or a reason the directory cannot be used. */
export type StatusResult = AbsentRepo | RepoStatus

/** One action request from the host route. */
export interface ActionRequest {
  action: string
  branchName?: string
  message?: string
}

/** Progress already made by an action, including a partial failure. */
export interface ActionProgress {
  commit?: { hash: string; subject: string }
  push?: { branch: string; remote: string }
  branch?: string
  pr?: { url: string | null; created: boolean; existing?: boolean }
  manualUrl?: string | null
}

/** The progress of one action plus the repository state after it. */
export interface ActionOutcome {
  result: ActionProgress
  status: StatusResult
}

/** Bounds and environment overrides for one command. */
export interface RunOptions {
  timeoutMs?: number
  env?: Record<string, string>
}

/** Arguments passed to the host subprocess service. */
export interface SpawnSpec {
  argv: string[]
  cwd: string
  stdio: {
    stdin: 'ignore'
    stdout: { maxBytes: number }
    stderr: { maxBytes: number }
  }
  graceMs: number
  env: Record<string, string>
}

/** A slice of collected stdout or stderr. */
export interface CollectedText {
  readFrom(offset: number): { text: string }
}

/** A running command owned by the subprocess service. */
export interface SubprocessHandle {
  collected: {
    stdout?: CollectedText
    stderr?: CollectedText
  }
  done: Promise<{ exitCode: number | null }>
  terminate(): void
}

/** The host capability this module needs: spawn a process and collect its output. */
export interface GitContext {
  subprocess: {
    spawn(spec: SpawnSpec): SubprocessHandle
  }
}
