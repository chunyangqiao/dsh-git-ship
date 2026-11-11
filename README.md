# dsh-git-ship

English | [中文](README.zh.md)

A DeepSeek Harness Web UI plugin that floats a Git action pill above the conversation composer.

- Package: repository root (bundle name `dsh-git-ship`; the local development install links it into the `desktop` profile)
- Slot: `conversation.input.dock`; renders only when a session is open and idle
- Host route: `/api/git-ship` (an exact Fetch route on `connection`, available only to the owner Peer)

## Behavior

| Situation | Behavior |
| --- | --- |
| No open session | Hidden (the slot itself only renders inside a conversation) |
| Session is running | Hidden |
| Session idle | Shown; the state comes from the Git repository in the session working directory |
| Git action in progress | Main button disabled; a spinner appears on the left and the label becomes "Committing… / Pushing… / Creating branch… / Creating PR…" |
| Working directory is not a Git repository | Hidden |

The main button runs `commit & push` by default; when there are no changes to commit but there are unpushed commits, it falls back to `push`. The arrow opens the actions available in the current state:

- `commit`, `commit & push`, `commit & create PR`: when there are uncommitted changes
- `push`: when there are unpushed commits
- `create PR`: when the branch is pushed or can be pushed (available even when there are no changes)
- `create branch`: always available inside a repository; prompts for a branch name
- `create branch, commit`, `create branch, commit & push`: when there are uncommitted changes

After an action, a result strip (commit hash, pushed, PR link, etc.) appears and disappears after 20 seconds.

### Action semantics

- `commit` commits only the staged changes; only when the index is empty does it run `git add -A` and then commit. The subject is the first non-empty line of the latest user message (truncated to 72 characters; `chore: update files` when there is no user message). Automatic staging also commits untracked files, so use a `.gitignore`.
- `commit & create PR` / `create PR` push first (setting an upstream when needed), then run `gh pr create --fill --head <branch>`.
- If `gh` is missing or PR creation fails, a GitHub compare link is returned and can be opened from the result strip; commits and pushes already made are preserved.
- Pushes set `GIT_TERMINAL_PROMPT=0`. If interactive credentials are required, the action fails and shows the Git output instead of hanging.

## Boundaries

- The browser sends only `sessionId` and the action name; the Host resolves the repository path from the live Session's effective working directory and never accepts a path in the request.
- The Fetch route uses the shared `/api` channel: `connection` checks the cookie/Origin, then the shared handler requires `peer.principal.kind === 'owner'`.
- One Git action at a time per session.

## Install from GitHub

In DSH, open **Plugins** → **Add plugin** → **Install third-party plugin** and enter:

```text
https://github.com/chunyangqiao/dsh-git-ship
```

or `github:chunyangqiao/dsh-git-ship`.

`lib/` is not committed: the package builds it with `prepare` when installed from Git. pnpm 11 blocks build scripts of Git-hosted packages by default, so the first install stops with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. Choose **Allow these scripts and retry** in the install dialog; DSH records the exact commit in the profile's `allowBuilds`. A new commit needs the approval again.

The build also needs `npm` on `PATH` and a reachable npm registry, because pnpm runs `npm install` in the checkout before `prepare`. Do not install from a GitHub archive (`.tar.gz`) URL: tarballs do not run `prepare`, and `lib/` is absent.

After installation, restart the Host if DSH asks and refresh the page for the client bundle. If the same profile already has the local `link:` version, remove or update it first.

## Development and verification

```bash
npm test        # Git core flows and the /api/git-ship route
npm run build   # Emit lib/index.js and the browser client bundle
```

Installation and verification:

- The `desktop` profile links `dsh-git-ship` to the repository root; `import('dsh-git-ship')` resolves `apply` / `inject`.
- 17 automated tests pass (commands above).

After changing the install path, the Host must be restarted for DSH to load from the new path; confirm `application: applied` and the Client slot after the restart.

Not verified: actual rendering in the browser, menu positioning, and light/dark theme behavior (the current session has no browser control). Client bundle changes take effect after a page refresh; Host changes require restarting DSH.

## License

[MIT](LICENSE) © 2026 chunyangqiao
