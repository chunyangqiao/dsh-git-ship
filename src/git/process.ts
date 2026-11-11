/**
 * Run git and gh through the host subprocess service.
 * Nothing here accepts a path from the browser.
 */
import { messageOf } from './text.ts'
import type { CommandResult, GitContext, RunOptions, SubprocessHandle } from './types.ts'

export const GIT_TIMEOUT_MS = 120_000
export const NETWORK_TIMEOUT_MS = 180_000

/**
 * Run one argv without a shell, collecting stdout and stderr.
 * A spawn failure or a rejected completion is reported as output, not thrown.
 */
export async function run(
  ctx: GitContext,
  cwd: string,
  argv: readonly string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS
  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [...argv],
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
    } catch {
      // The process may already have exited.
    }
  }, timeoutMs)
  try {
    let outcome: { exitCode: number | null }
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

/** Run one git command in a directory. */
export function git(
  ctx: GitContext,
  cwd: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return run(ctx, cwd, ['git', ...args], options)
}
