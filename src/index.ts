/**
 * Host half of git-ship: authenticated request/response for the composer pill.
 *
 * The browser page calls the exact Fetch route mounted on the shared `/api`
 * channel. Connection admits the request and the shared handler only serves
 * the owner Peer, so the route never needs its own bearer token. The browser
 * names a live Session; this module resolves that Session's effective working
 * directory itself and never accepts a path from the request.
 */
import { GitOperationError, readStatus, runAction } from './git/index.ts'
import type { GitContext, StatusResult } from './git/index.ts'

/** Service dependencies: transport, session lookup, directory policy, process execution. */
export const inject = ['connection', 'sessions', 'workingDirectory', 'subprocess']

/** Exact Fetch route on the `/api` channel. */
const ROUTE_PATH = '/api/git-ship'

/** One action at a time per Session. */
const busy = new Set<string>()

interface SessionEvent {
  type?: string
  data?: unknown
}

interface Session {
  ownEvents(): SessionEvent[]
}

interface FetchRoute {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

/** Host services this plugin actually calls. */
export interface HostContext extends GitContext {
  connection: {
    fetch?: {
      register(route: FetchRoute): void
    }
  }
  sessions: {
    get(sessionId: string): Session | undefined
  }
  workingDirectory: {
    get(session: Session): string | undefined
  }
}

/** A directory the route can describe without calling Git. */
interface MissingDirectory {
  isRepo: false
  reason: 'no-working-directory'
}

type RouteStatus = StatusResult | MissingDirectory

/** Build a JSON response. */
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

/** Render an unknown thrown value without leaking a stack. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Resolve the live Session named by the browser. */
function resolveSession(ctx: HostContext, sessionId: string): Session | undefined {
  if (sessionId.length === 0) return undefined
  return ctx.sessions.get(sessionId)
}

/** Collect text from one message's content blocks. */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue
    parts.push(block.text)
  }
  return parts.join(' ').trim()
}

/** Read the latest human prompt, used as the automatic commit subject. */
function lastUserText(session: Session): string {
  let events: SessionEvent[]
  try {
    events = session.ownEvents()
  } catch {
    return ''
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const data = isRecord(event.data) ? event.data : undefined
    const message = data !== undefined && isRecord(data.message) ? data.message : data
    const content = message !== undefined && isRecord(message) ? message.content : undefined
    const text = textOfContent(content ?? data?.content)
    if (text.length > 0) return text
  }
  return ''
}

/** Read the Session's git status, or a non-repository marker. */
async function statusFor(ctx: HostContext, session: Session): Promise<RouteStatus> {
  const cwd = ctx.workingDirectory.get(session)
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { isRepo: false, reason: 'no-working-directory' }
  }
  return await readStatus(ctx, cwd)
}

/** Answer one authenticated request. */
async function handleRequest(ctx: HostContext, request: Request): Promise<Response> {
  try {
    if (request.method === 'GET') {
      const sessionId = new URL(request.url).searchParams.get('sessionId') ?? ''
      const session = resolveSession(ctx, sessionId)
      if (session === undefined) {
        return json({ ok: false, error: { code: 'session-closed', detail: 'No open session for this id.' } }, 409)
      }
      const status = await statusFor(ctx, session)
      return json({ ok: true, status })
    }

    if (request.method !== 'POST') return json({ ok: false, error: { code: 'method' } }, 405)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: { code: 'bad-request', detail: 'The request body is not JSON.' } }, 400)
    }
    if (!isRecord(body) || typeof body.sessionId !== 'string' || typeof body.action !== 'string') {
      return json({ ok: false, error: { code: 'bad-request', detail: 'sessionId and action are required.' } }, 400)
    }
    const session = resolveSession(ctx, body.sessionId)
    if (session === undefined) {
      return json({ ok: false, error: { code: 'session-closed', detail: 'No open session for this id.' } }, 409)
    }
    if (busy.has(body.sessionId)) {
      return json({ ok: false, error: { code: 'busy', detail: 'Another Git action is still running for this session.' } }, 409)
    }
    const cwd = ctx.workingDirectory.get(session)
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return json({ ok: false, error: { code: 'no-working-directory' } }, 409)
    }
    busy.add(body.sessionId)
    try {
      const outcome = await runAction(ctx, cwd, {
        action: body.action,
        branchName: typeof body.branchName === 'string' ? body.branchName : undefined,
        message: lastUserText(session),
      })
      return json({ ok: true, action: body.action, result: outcome.result, status: outcome.status })
    } catch (error) {
      if (error instanceof GitOperationError) {
        return json({
          ok: false,
          action: body.action,
          error: { code: error.code, detail: error.detail },
          result: error.result ?? null,
          status: error.status ?? null,
        })
      }
      return json({ ok: false, action: body.action, error: { code: 'internal', detail: messageOf(error) } }, 500)
    } finally {
      busy.delete(body.sessionId)
    }
  } catch (error) {
    return json({ ok: false, error: { code: 'internal', detail: messageOf(error) } }, 500)
  }
}

/** Mount the Git route. */
export function apply(ctx: HostContext): void {
  const fetch = ctx.connection.fetch
  if (fetch === undefined) throw new Error('git-ship: connection.fetch is unavailable in this profile')
  fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: (request) => handleRequest(ctx, request),
  })
}
