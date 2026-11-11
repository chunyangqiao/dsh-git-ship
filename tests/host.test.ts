import { strict as assert } from 'node:assert'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { apply, type HostContext } from '../src/index.ts'
import { cleanup, createSubprocess, git, setupRepo } from './helpers.ts'

interface ApiBody {
  ok?: boolean
  error?: { code?: string; detail?: string }
  status?: {
    isRepo?: boolean
    branch?: string
    changes?: { unstaged?: number; total?: number }
    defaultAction?: string | null
    actions?: string[]
  }
  result?: {
    commit?: { subject?: string; hash?: string }
    manualUrl?: string
    push?: { branch?: string }
  }
}

interface RegisteredRoute {
  path: string
  methods: string[]
  requestBody: string
  fetch: (request: Request) => Promise<Response>
}

/** Build the Host plugin context the route needs. */
function mount(repo: string, { sessionId = 'session-1', withoutGh = false }: { sessionId?: string; withoutGh?: boolean } = {}): RegisteredRoute {
  const routes: RegisteredRoute[] = []
  const session = {
    id: sessionId,
    ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } },
      {
        type: 'user/message',
        data: { content: [{ type: 'text', text: '## feat: add the ship button\n\nPlease add it.' }] },
      },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: 'Done.' }] } },
    ],
  }
  const ctx: HostContext = {
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return undefined
        },
      },
    },
    sessions: { get: (id) => (id === sessionId ? session : undefined) },
    workingDirectory: { get: () => repo },
    subprocess: createSubprocess({ withoutGh }),
  }
  apply(ctx)
  assert.equal(routes.length, 1)
  const route = routes[0]
  if (route === undefined) throw new Error('git-ship route was not registered')
  return route
}

async function readJson(response: Response): Promise<ApiBody> {
  return await response.json() as ApiBody
}

async function getStatus(route: RegisteredRoute, sessionId = 'session-1'): Promise<{ response: Response; body: ApiBody }> {
  const response = await route.fetch(
    new Request(`http://localhost/api/git-ship?sessionId=${encodeURIComponent(sessionId)}`),
  )
  return { response, body: await readJson(response) }
}

async function postAction(route: RegisteredRoute, payload: unknown): Promise<{ response: Response; body: ApiBody }> {
  const response = await route.fetch(
    new Request('http://localhost/api/git-ship', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
  return { response, body: await readJson(response) }
}

const tests: { name: string; fn: () => Promise<void> | void }[] = []
function test(name: string, fn: () => Promise<void> | void): void {
  tests.push({ name, fn })
}

test('the Host route registers the expected exact Fetch route', async () => {
  const { base, repo } = setupRepo()
  try {
    const route = mount(repo)
    assert.equal(route.path, '/api/git-ship')
    assert.deepEqual(route.methods, ['GET', 'POST'])
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  } finally {
    cleanup(base)
  }
})

test('GET reports repository state for the live session', async () => {
  const { base, repo, branch } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    const route = mount(repo)
    const { response, body } = await getStatus(route)
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.status?.isRepo, true)
    assert.equal(body.status?.branch, branch)
    assert.equal(body.status?.changes?.unstaged, 1)
    assert.equal(body.status?.defaultAction, 'commitPush')
    assert.ok(body.status?.actions?.includes('commitPr'))
  } finally {
    cleanup(base)
  }
})

test('GET hides the control outside a repository and for a closed session', async () => {
  const { base, repo } = setupRepo()
  try {
    const route = mount(repo)
    const missing = await getStatus(route, 'session-404')
    assert.equal(missing.response.status, 409)
    assert.equal(missing.body.error?.code, 'session-closed')

    const outside = join(base, 'outside')
    const foreign = mountRouteOutside(outside)
    const foreignStatus = await getStatus(foreign)
    assert.equal(foreignStatus.body.ok, true)
    assert.equal(foreignStatus.body.status?.isRepo, false)
  } finally {
    cleanup(base)
  }
})

function mountRouteOutside(_directory?: string): RegisteredRoute {
  // Reuse the normal mount shape but point the working directory at a non-repository.
  const routes: RegisteredRoute[] = []
  const ctx: HostContext = {
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
        },
      },
    },
    sessions: { get: () => ({ id: 'session-1', ownEvents: () => [] }) },
    workingDirectory: { get: () => '/tmp' },
    subprocess: createSubprocess(),
  }
  apply(ctx)
  const route = routes[0]
  if (route === undefined) throw new Error('git-ship route was not registered')
  return route
}

test('POST commits with the latest user prompt as its subject', async () => {
  const { base, repo } = setupRepo()
  try {
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    const route = mount(repo)
    const { response, body } = await postAction(route, { sessionId: 'session-1', action: 'commit' })
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.result?.commit?.subject, 'feat: add the ship button')
    assert.equal((body.result?.commit?.hash?.length ?? 0) > 0, true)
    assert.equal(body.status?.changes?.total, 0)
    assert.equal(git(repo, ['log', '-1', '--pretty=%s']), 'feat: add the ship button')
  } finally {
    cleanup(base)
  }
})

test('POST rejects malformed bodies and unavailable actions', async () => {
  const { base, repo } = setupRepo()
  try {
    const route = mount(repo)
    const malformed = await route.fetch(
      new Request('http://localhost/api/git-ship', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    )
    assert.equal(malformed.status, 400)
    assert.equal((await readJson(malformed)).error?.code, 'bad-request')

    const invalid = await postAction(route, { sessionId: 'session-1', action: 'nonsense' })
    assert.equal(invalid.body.ok, false)
    assert.equal(invalid.body.error?.code, 'unknown-action')

    const notApplicable = await postAction(route, { sessionId: 'session-1', action: 'commit' })
    assert.equal(notApplicable.body.ok, false)
    assert.equal(notApplicable.body.error?.code, 'not-applicable')
  } finally {
    cleanup(base)
  }
})

test('POST creates the branch, commits, pushes and reports a compare link when gh is missing', async () => {
  const { base, repo, remote } = setupRepo()
  try {
    git(repo, ['config', `url.${remote}.insteadOf`, 'git@github.com:owner/repo.git'])
    git(repo, ['remote', 'set-url', 'origin', 'git@github.com:owner/repo.git'])
    writeFileSync(join(repo, 'a.txt'), 'pr work\n')
    const route = mount(repo, { withoutGh: true })
    const { body } = await postAction(route, {
      sessionId: 'session-1',
      action: 'commitPr',
    })
    assert.equal(body.ok, false)
    assert.equal(body.error?.code, 'gh-missing')
    assert.match(body.result?.manualUrl ?? '', /^https:\/\/github\.com\/owner\/repo\/compare\//u)
    assert.ok(body.result?.commit?.hash)
    assert.ok(body.result?.push?.branch)
  } finally {
    cleanup(base)
  }
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
