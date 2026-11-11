/**
 * Git operations for the git-ship bundle.
 *
 * The host resolves one Session's working directory and passes it here.
 * Nothing in this module accepts a path from the browser.
 */
export { GitOperationError } from './error.ts'
export { availableActions, defaultActionOf, preferredRemote, readStatus } from './status.ts'
export { normalizeCommitMessage, webRepositoryUrl } from './text.ts'
export { runAction } from './actions.ts'
export { ACTION_ORDER } from './types.ts'
export type {
  ActionOutcome,
  ActionProgress,
  ActionRequest,
  ActionStatus,
  GitAction,
  GitContext,
  RepoStatus,
  StatusResult,
} from './types.ts'
