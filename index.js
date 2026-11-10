/**
 * Host half of git-ship: authenticated request/response for the composer pill.
 *
 * The browser page calls the exact Fetch route mounted on the shared `/api`
 * channel. Connection admits the request and the shared handler only serves
 * the owner Peer, so the route never needs its own bearer token. The browser
 * names a live Session; this module resolves that Session's effective working
 * directory itself and never accepts a path from the request.
 */
import { GitOperationError, readStatus, runAction } from './git.js'

/** Service dependencies: transport, session lookup, directory policy, process execution. */
export const inject = ['connection', 'sessions', 'workingDirectory', 'subprocess']

/** Exact Fetch route on the `/api` channel. */
const ROUTE_PATH = '/api/git-ship'

/** One action at a time per Session. */
const busy = new Set()

/** Build a JSON response. */
function json(value, status = 200) {
  return Response.json(value, { status })
}

/** Render an unknown thrown value without leaking a stack. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve the live Session named by the browser. */
function resolveSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
  return ctx.sessions.get(sessionId)
}

/** Collect text from one message's content blocks. */
function textOfContent(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join(' ').trim()
}

/** Read the latest human prompt, used as the automatic commit subject. */
function lastUserText(session) {
  let events
  try {
    events = session.ownEvents()
  } catch {
    return ''
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const data = event.data
    const message = data?.message ?? data
    const text = textOfContent(message?.content ?? data?.content)
    if (text.length > 0) return text
  }
  return ''
}

/** Read the Session's git status, or a non-repository marker. */
async function statusFor(ctx, session) {
  const cwd = ctx.workingDirectory.get(session)
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { isRepo: false, reason: 'no-working-directory' }
  }
  return await readStatus(ctx, cwd)
}

/** Answer one authenticated request. */
async function handleRequest(ctx, request) {
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

    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, error: { code: 'bad-request', detail: 'The request body is not JSON.' } }, 400)
    }
    if (body === null || typeof body !== 'object' || typeof body.sessionId !== 'string' || typeof body.action !== 'string') {
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

/**
 * Mount the Git route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const fetch = ctx.connection.fetch
  if (fetch === undefined) throw new Error('git-ship: connection.fetch is unavailable in this profile')
  fetch.register({
    path: ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: (request) => handleRequest(ctx, request),
  })
}
