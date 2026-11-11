/**
 * Browser half of git-ship. The build wraps this module in the page's
 * module-loader factory. React stays external and is provided by that loader.
 */
import React, { type FormEvent, type ReactElement, type ReactNode } from 'react'

const NS = 'gitShip'

const zh: Record<string, string> = {
  'action.commit': '提交',
  'action.commitPush': '提交并推送',
  'action.commitPr': '提交并创建 PR',
  'action.push': '推送',
  'action.createPr': '创建 PR',
  'action.createBranch': '创建分支',
  'action.branchCommit': '创建分支并提交',
  'action.branchCommitPush': '创建分支、提交并推送',
  'pending.commit': '提交中',
  'pending.push': '推送中',
  'pending.pr': '创建 PR 中',
  'pending.branch': '创建分支中',
  'branch.placeholder': '分支名称',
  'branch.create': '创建',
  'branch.cancel': '取消',
  'state.clean': '暂无可提交的更改',
  'notice.committed': '已提交 {hash}',
  'notice.pushed': '已推送',
  'notice.branchCreated': '已创建分支 {branch}',
  'notice.prCreated': '已创建 PR',
  'notice.prExisting': '已存在 PR',
  'notice.failed': '操作失败',
  'notice.done': '已完成',
  'notice.openLink': '打开链接',
  'menu.label': 'Git 操作',
  'hint.menu': '选择 Git 操作',
  'hint.default': '提交并推送',
}

const en: Record<string, string> = {
  'action.commit': 'Commit',
  'action.commitPush': 'Commit & push',
  'action.commitPr': 'Commit & create PR',
  'action.push': 'Push',
  'action.createPr': 'Create PR',
  'action.createBranch': 'Create branch',
  'action.branchCommit': 'Create branch, commit',
  'action.branchCommitPush': 'Create branch, commit & push',
  'pending.commit': 'Committing…',
  'pending.push': 'Pushing…',
  'pending.pr': 'Creating PR…',
  'pending.branch': 'Creating branch…',
  'branch.placeholder': 'Branch name',
  'branch.create': 'Create',
  'branch.cancel': 'Cancel',
  'state.clean': 'Nothing to commit',
  'notice.committed': 'Committed {hash}',
  'notice.pushed': 'Pushed',
  'notice.branchCreated': 'Created branch {branch}',
  'notice.prCreated': 'Pull request created',
  'notice.prExisting': 'Pull request already exists',
  'notice.failed': 'Action failed',
  'notice.done': 'Done',
  'notice.openLink': 'Open link',
  'menu.label': 'Git actions',
  'hint.menu': 'Choose a Git action',
  'hint.default': 'Commit & push',
}

const LABEL_KEYS: Record<string, string> = {
  commit: 'action.commit',
  commitPush: 'action.commitPush',
  commitPr: 'action.commitPr',
  push: 'action.push',
  createPr: 'action.createPr',
  createBranch: 'action.createBranch',
  branchCommit: 'action.branchCommit',
  branchCommitPush: 'action.branchCommitPush',
}

const PENDING_KEYS: Record<string, string> = {
  commit: 'pending.commit',
  commitPush: 'pending.commit',
  commitPr: 'pending.commit',
  push: 'pending.push',
  createPr: 'pending.pr',
  createBranch: 'pending.branch',
  branchCommit: 'pending.commit',
  branchCommitPush: 'pending.commit',
}

const BRANCH_ACTIONS = new Set(['createBranch', 'branchCommit', 'branchCommitPush'])

const CSS = `
.gs-root {
  box-sizing: border-box;
  width: calc(100% - var(--dsh-composer-side-clearance, 8px) - var(--dsh-composer-side-clearance, 8px));
  max-width: var(--dsh-composer-card-max-width, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  font-family: var(--dsw-font-family, inherit);
}
.gs-anchor { position: relative; display: inline-flex; }
.gs-pill {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 8px 0 12px;
  gap: 2px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}
.gs-pill:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
}
.gs-main, .gs-arrow {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0;
  white-space: nowrap;
}
.gs-main { gap: 6px; }
.gs-arrow { width: 16px; justify-content: center; }
.gs-main:disabled, .gs-arrow:disabled { cursor: default; opacity: 0.55; }
.gs-main:focus-visible, .gs-arrow:focus-visible, .gs-item:focus-visible, .gs-confirm:focus-visible, .gs-cancel:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: -2px;
}
.gs-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 40;
  min-width: 224px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 12px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.16));
}
.gs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.gs-item:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.gs-glyph { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
.gs-branch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  margin-bottom: 4px;
}
.gs-input {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.gs-input:focus { border-color: var(--dsw-alias-brand-primary); }
.gs-confirm, .gs-cancel {
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.gs-confirm {
  border: 0;
  background: var(--dsw-alias-button-info-fill, var(--dsw-alias-brand-primary));
  color: #fff;
}
.gs-confirm:disabled { opacity: 0.5; cursor: default; }
.gs-cancel {
  border: 0.5px solid var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.gs-notice {
  max-width: 100%;
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.gs-notice[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
.gs-notice[data-kind="success"] { color: var(--dsw-alias-state-success-primary); }
.gs-notice-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gs-link { color: inherit; text-decoration: underline; white-space: nowrap; }
.gs-spin { animation: gs-rotate 0.8s linear infinite; }
@keyframes gs-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .gs-spin { animation-duration: 2.4s; }
}
`

type Translate = (key: string, values?: Record<string, string>) => string

interface PageTransport {
  fetch?: (path: string, init?: RequestInit) => Promise<Response>
}

interface DockStatus {
  isRepo?: unknown
  actions?: unknown
  defaultAction?: unknown
  suggestedBranch?: unknown
}

interface Notice {
  kind: 'success' | 'error'
  text: string
  url: string | null
}

interface BranchDraft {
  action: string
  name: string
}

type GlyphKind = 'branch' | 'push' | 'pr' | 'commit'

interface SessionRuntime {
  running?: boolean
}

interface SessionSnapshot {
  get(sessionId: string): SessionRuntime | undefined
}

interface DockProps {
  sessionId?: string
  useSessionStatus: (select: (snapshot: SessionSnapshot) => boolean) => boolean
  t?: Translate
}

interface SlotMeta {
  name: string
  id: string
  order: number
  locale: string
}

interface ClientContext {
  effect(setup: () => void | (() => void), label?: string): void
  locale: {
    register(namespace: string, catalogs: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: {
    inject(name: string, register: () => void): void
    register(meta: SlotMeta, component: (props: DockProps) => ReactElement | null): void
  }
}

const h = React.createElement

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/**
 * Send one Host request through the page transport when the native shell
 * provides one, and through the same-origin HTTP route otherwise.
 */
function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  const transport = (globalThis as typeof globalThis & { __DSH_TRANSPORT__?: PageTransport }).__DSH_TRANSPORT__
  if (transport !== undefined && typeof transport.fetch === 'function') {
    return transport.fetch(path.replace(/^\//u, ''), init)
  }
  return globalThis.fetch(path, init)
}

function thrownText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isRecord(error) && error.message !== undefined) return String(error.message)
  return String(error)
}

/** Small spinner shown while an action runs. */
function Spinner(): ReactElement {
  return h(
    'svg',
    { className: 'gs-spin', width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true },
    h('circle', {
      cx: 8,
      cy: 8,
      r: 6,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeDasharray: '28 10',
    }),
  )
}

/** Line glyph used in the pill and the menu. */
function Glyph({ kind }: { kind: GlyphKind }): ReactElement {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const
  if (kind === 'branch') {
    return h(
      'svg',
      { className: 'gs-glyph', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
      h('circle', { cx: 4.5, cy: 3.5, r: 1.6, ...stroke }),
      h('circle', { cx: 4.5, cy: 12.5, r: 1.6, ...stroke }),
      h('circle', { cx: 11.5, cy: 6.5, r: 1.6, ...stroke }),
      h('path', { d: 'M4.5 5.1v5.8M6.1 6.5h3.8', ...stroke }),
    )
  }
  if (kind === 'push') {
    return h(
      'svg',
      { className: 'gs-glyph', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
      h('path', { d: 'M8 10.5V2.8M5 5.8 8 2.8l3 3M3 11.2v1.4a.6.6 0 0 0 .6.6h8.8a.6.6 0 0 0 .6-.6v-1.4', ...stroke }),
    )
  }
  if (kind === 'pr') {
    return h(
      'svg',
      { className: 'gs-glyph', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
      h('circle', { cx: 4.5, cy: 3.5, r: 1.6, ...stroke }),
      h('circle', { cx: 4.5, cy: 12.5, r: 1.6, ...stroke }),
      h('circle', { cx: 11.5, cy: 12.5, r: 1.6, ...stroke }),
      h('path', { d: 'M4.5 5.1v5.8M11.5 10.9V7.2a2 2 0 0 0-2-2H7.4', ...stroke }),
      h('path', { d: 'm8.9 3.7-1.6 1.5 1.6 1.5', ...stroke }),
    )
  }
  return h(
    'svg',
    { className: 'gs-glyph', width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
    h('circle', { cx: 8, cy: 8, r: 6, ...stroke }),
    h('path', { d: 'm5.4 8.2 1.8 1.8 3.6-3.8', ...stroke }),
  )
}

/** Downward chevron for the menu trigger. */
function Chevron(): ReactElement {
  return h(
    'svg',
    { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
    h('path', {
      d: 'M3 4.5 6 7.5 9 4.5',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function resultRecord(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.result)) return {}
  return payload.result
}

/** Compose the success notice from the Host's structured progress. */
function successNotice(t: Translate, payload: unknown): { text: string; url: string | null } {
  const result = resultRecord(payload)
  const parts: string[] = []
  let url: string | null = null
  if (typeof result.branch === 'string' && result.branch.length > 0) {
    parts.push(t('notice.branchCreated', { branch: result.branch }))
  }
  if (isRecord(result.commit)) {
    const hash = result.commit.hash
    parts.push(t('notice.committed', { hash: typeof hash === 'string' && hash.length > 0 ? hash : 'HEAD' }))
  }
  if (result.push !== undefined && result.push !== null) parts.push(t('notice.pushed'))
  if (isRecord(result.pr)) {
    parts.push(result.pr.existing ? t('notice.prExisting') : t('notice.prCreated'))
    if (typeof result.pr.url === 'string' && result.pr.url.length > 0) url = result.pr.url
  }
  if (parts.length === 0) parts.push(t('notice.done'))
  return { text: parts.join(' · '), url }
}

/** Compose the failure notice, including any progress that already landed. */
function failureNotice(t: Translate, payload: unknown, response: Response): { text: string; url: string | null } {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined
  const detail = typeof error?.detail === 'string' ? error.detail : ''
  const parts = [t('notice.failed')]
  if (detail.length > 0) parts.push(detail.length > 400 ? `${detail.slice(0, 400)}…` : detail)
  else if (typeof error?.code === 'string') parts.push(error.code)
  else parts.push(`HTTP ${response.status}`)
  const result = resultRecord(payload)
  if (isRecord(result.commit)) {
    const hash = result.commit.hash
    parts.push(t('notice.committed', { hash: typeof hash === 'string' && hash.length > 0 ? hash : 'HEAD' }))
  }
  if (result.push !== undefined && result.push !== null) parts.push(t('notice.pushed'))
  const manualUrl = result.manualUrl
  const url = typeof manualUrl === 'string' && manualUrl.length > 0 ? manualUrl : null
  return { text: parts.join(' · '), url }
}

function glyphKind(action: string): GlyphKind {
  if (action === 'push' || action === 'commitPush' || action === 'branchCommitPush') return 'push'
  if (action === 'commitPr' || action === 'createPr') return 'pr'
  if (action === 'createBranch') return 'branch'
  return 'commit'
}

/** The floating Git action pill above the composer. */
function GitShipDock(props: DockProps): ReactElement | null {
  const { sessionId, useSessionStatus, t } = props
  const translate: Translate = typeof t === 'function' ? t : (key) => key
  const running = useSessionStatus((snapshot) =>
    typeof sessionId === 'string' ? snapshot.get(sessionId)?.running === true : false,
  )

  const [status, setStatus] = React.useState<DockStatus | null>(null)
  const [open, setOpen] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [branchDraft, setBranchDraft] = React.useState<BranchDraft | null>(null)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const branchInputRef = React.useRef<HTMLInputElement | null>(null)

  const refresh = React.useCallback(async () => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    try {
      const response = await hostFetch(`/api/git-ship?sessionId=${encodeURIComponent(sessionId)}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      const payload: unknown = await response.json().catch(() => null)
      if (isRecord(payload) && payload.ok === true && payload.status !== undefined) setStatus(payload.status as DockStatus)
      else setStatus(null)
    } catch {
      /* Keep the previous reading when the transport hiccups. */
    }
  }, [sessionId])

  React.useEffect(() => {
    if (running) return
    void refresh()
  }, [running, refresh])

  React.useEffect(() => {
    if (!running) return
    setOpen(false)
    setBranchDraft(null)
  }, [running])

  React.useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 20000)
    return () => clearTimeout(timer)
  }, [notice])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target
      if (rootRef.current !== null && target instanceof Node && !rootRef.current.contains(target)) {
        setOpen(false)
        setBranchDraft(null)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setBranchDraft(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  React.useEffect(() => {
    if (branchDraft === null || branchInputRef.current === null) return
    branchInputRef.current.focus()
    branchInputRef.current.select()
  }, [branchDraft])

  const run = React.useCallback(
    async (action: string, branchName?: string) => {
      if (pendingAction !== null) return
      setPendingAction(action)
      setOpen(false)
      setBranchDraft(null)
      setNotice(null)
      try {
        const response = await hostFetch('/api/git-ship', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sessionId,
            action,
            ...(branchName === undefined ? {} : { branchName }),
          }),
        })
        const payload: unknown = await response.json().catch(() => null)
        if (isRecord(payload) && isRecord(payload.status) && payload.status.isRepo === true) {
          setStatus(payload.status as DockStatus)
        }
        if (isRecord(payload) && payload.ok === true) {
          const next = successNotice(translate, payload)
          setNotice({ kind: 'success', text: next.text, url: next.url })
        } else {
          const next = failureNotice(translate, payload, response)
          setNotice({ kind: 'error', text: next.text, url: next.url })
        }
      } catch (error) {
        setNotice({
          kind: 'error',
          text: `${translate('notice.failed')} · ${thrownText(error)}`,
          url: null,
        })
      } finally {
        setPendingAction(null)
      }
    },
    [pendingAction, sessionId, translate],
  )

  const actions = Array.isArray(status?.actions) ? status.actions.filter((item): item is string => typeof item === 'string') : []
  const defaultAction = typeof status?.defaultAction === 'string' ? status.defaultAction : null
  const pendingLabel = pendingAction === null ? null : translate(PENDING_KEYS[pendingAction] ?? 'pending.commit')
  const mainLabel = pendingLabel ?? (defaultAction === null ? translate('state.clean') : translate(LABEL_KEYS[defaultAction] ?? 'hint.default'))
  const mainDisabled = pendingAction !== null || defaultAction === null

  const pick = (action: string) => {
    if (BRANCH_ACTIONS.has(action)) {
      const suggested = typeof status?.suggestedBranch === 'string' ? status.suggestedBranch : ''
      setBranchDraft({ action, name: suggested })
      return
    }
    void run(action)
  }

  const submitBranch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (branchDraft === null) return
    const name = branchDraft.name.trim()
    if (name.length === 0) return
    void run(branchDraft.action, name)
  }

  if (running || status === null || status.isRepo !== true) return null

  const menu: ReactNode = open && pendingAction === null
    ? h(
        'div',
        { className: 'gs-menu', role: 'menu', 'aria-label': translate('menu.label') },
        branchDraft !== null
          ? h(
              'form',
              { className: 'gs-branch', onSubmit: submitBranch },
              h('input', {
                ref: branchInputRef,
                className: 'gs-input',
                value: branchDraft.name,
                placeholder: translate('branch.placeholder'),
                'aria-label': translate('branch.placeholder'),
                spellCheck: false,
                onChange: (event: FormEvent<HTMLInputElement>) => {
                  const name = event.currentTarget.value
                  setBranchDraft((current) => (current === null ? current : { ...current, name }))
                },
              }),
              h(
                'button',
                { type: 'submit', className: 'gs-confirm', disabled: branchDraft.name.trim().length === 0 },
                translate('branch.create'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'gs-cancel',
                  onClick: () => setBranchDraft(null),
                },
                translate('branch.cancel'),
              ),
            )
          : null,
        actions.length === 0
          ? h('div', { className: 'gs-item' }, translate('state.clean'))
          : actions.map((action) =>
              h(
                'button',
                {
                  key: action,
                  type: 'button',
                  className: 'gs-item',
                  role: 'menuitem',
                  onClick: () => pick(action),
                },
                h(Glyph, { kind: glyphKind(action) }),
                h('span', null, translate(LABEL_KEYS[action] ?? action)),
              ),
            ),
      )
    : null

  return h(
    'div',
    { className: 'gs-root' },
    h('style', { 'data-git-ship-style': '', dangerouslySetInnerHTML: { __html: CSS } }),
    notice !== null
      ? h(
          'div',
          { className: 'gs-notice', 'data-kind': notice.kind, role: 'status' },
          h('span', { className: 'gs-notice-text', title: notice.text }, notice.text),
          notice.url !== null
            ? h(
                'a',
                { className: 'gs-link', href: notice.url, target: '_blank', rel: 'noreferrer' },
                translate('notice.openLink'),
              )
            : null,
        )
      : null,
    h(
      'div',
      { className: 'gs-anchor', ref: rootRef },
      h(
        'div',
        { className: 'gs-pill' },
        h(
          'button',
          {
            type: 'button',
            className: 'gs-main',
            disabled: mainDisabled,
            title: defaultAction === null ? translate('state.clean') : translate(LABEL_KEYS[defaultAction] ?? 'hint.default'),
            onClick: () => {
              if (defaultAction !== null) void run(defaultAction)
            },
          },
          pendingAction === null ? null : h(Spinner),
          h('span', null, mainLabel),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'gs-arrow',
            disabled: pendingAction !== null,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': translate('hint.menu'),
            title: translate('hint.menu'),
            onClick: () => {
              const next = !open
              setOpen(next)
              setBranchDraft(null)
              if (next) void refresh()
            },
          },
          h(Chevron),
        ),
      ),
      menu,
    ),
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-ship: locale')
  ctx.slots.inject('conversation.input.dock', () => {
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'git-ship',
        order: 15,
        locale: NS,
      },
      GitShipDock,
    )
  })
}
