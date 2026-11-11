import type { ActionProgress, StatusResult } from './types.ts'

/** A failed git-ship operation with a stable code and an optional partial result. */
export class GitOperationError extends Error {
  readonly code: string
  readonly detail: string
  result?: ActionProgress
  status?: StatusResult

  constructor(
    code: string,
    detail: string,
    extra: { result?: ActionProgress; status?: StatusResult } = {},
  ) {
    super(detail || code)
    this.name = 'GitOperationError'
    this.code = code
    this.detail = detail || ''
    this.result = extra.result
    this.status = extra.status
  }
}
