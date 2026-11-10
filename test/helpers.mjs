import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Minimal subprocess service over the host's child_process. */
export function createSubprocess({ withoutGh = false } = {}) {
  return {
    spawn(spec) {
      if (withoutGh && spec.argv[0] === 'gh') throw new Error('spawn gh ENOENT')
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const stdout = []
      const stderr = []
      child.stdout.on('data', (chunk) => stdout.push(chunk))
      child.stderr.on('data', (chunk) => stderr.push(chunk))
      let settled = false
      const done = new Promise((resolve, reject) => {
        child.on('error', (error) => {
          settled = true
          reject(error)
        })
        child.on('close', (code, signal) => {
          settled = true
          resolve({ exitCode: code, signal })
        })
      })
      const reader = (chunks) => ({
        readFrom() {
          return { text: Buffer.concat(chunks).toString('utf8'), nextOffset: 0, lossy: false }
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
    async resolveExecutable(name) {
      if (name === 'gh' && withoutGh) throw new Error('not found')
      execFileSync('which', [name], { stdio: 'ignore' })
      return name
    },
  }
}

/** Create a temporary repository with a local bare remote. */
export function setupRepo() {
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
export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Remove a temporary test directory. */
export function cleanup(base) {
  rmSync(base, { recursive: true, force: true })
}
