import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitContext } from '../src/git/index.ts'

/** Minimal subprocess service over the host's child_process. */
export function createSubprocess({ withoutGh = false } = {}): GitContext['subprocess'] {
  return {
    spawn(spec) {
      const command = spec.argv[0]
      if (command === undefined) throw new Error('missing argv')
      if (withoutGh && command === 'gh') throw new Error('spawn gh ENOENT')
      const child = spawn(command, spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      if (child.stdout === null || child.stderr === null) throw new Error('expected piped stdio')
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      let settled = false
      const done = new Promise<{ exitCode: number | null }>((resolve, reject) => {
        child.on('error', (error) => {
          settled = true
          reject(error)
        })
        child.on('close', (code) => {
          settled = true
          resolve({ exitCode: code })
        })
      })
      const reader = (chunks: Buffer[]) => ({
        readFrom() {
          return { text: Buffer.concat(chunks).toString('utf8') }
        },
      })
      return {
        collected: { stdout: reader(stdout), stderr: reader(stderr) },
        done,
        terminate() {
          if (!settled) child.kill('SIGTERM')
        },
      }
    },
  }
}

/** Create a temporary repository with a local bare remote. */
export function setupRepo(): { base: string; repo: string; remote: string; branch: string } {
  const base = mkdtempSync(join(tmpdir(), 'git-ship-test-'))
  const repo = join(base, 'repo')
  const remote = join(base, 'remote.git')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'initial'])
  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  execFileSync('git', ['init', '-q', '--bare', remote])
  git(repo, ['remote', 'add', 'origin', remote])
  git(repo, ['push', '-q', '-u', 'origin', branch])
  return { base, repo, remote, branch }
}

/** Run git and return trimmed stdout. */
export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Remove a temporary test directory. */
export function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true })
}
