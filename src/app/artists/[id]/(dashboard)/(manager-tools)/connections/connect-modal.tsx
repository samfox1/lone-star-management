'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import {
  SHOPIFY_KEY,
  connectInputError,
  connectionsAtoZ,
  methodOf,
  searchConnections,
  type ConnectInput,
  type ConnectionDef,
} from '@/lib/connections'
import { parseHandle } from '@/lib/connect-methods'
import { isShopDomain, normalizeShopDomain, shopifyInstallPath } from '@/lib/merch/shop-domain'
import { youtubeStartPath } from '@/lib/manager-tools/connections/services/youtube'
import { useLockBodyScroll } from '@/components/ui/use-lock-body-scroll'
import { ConnectionMark } from './connection-mark'
import { connectOneAction, type ConnectResult } from './actions'

/**
 * CONNECT (Sam, 2026-09-13): "an add button to add more which shows the socials as
 * cards in a grid that users can multi select… a search bar and the container with the
 * grid in it should be scrollable. They should be sorted alphabetically too."
 *
 * Three steps, no headings (Sam: "People know whats going on"):
 *   pick     — every connection we know, A to Z, socials and services in one grid; the
 *              ones already on the page dimmed with a grey tick; pick as many as you like
 *   details  — one row per pick, asking for as little as each platform can take (Sam,
 *              2026-09-28): a handle platform for the handle alone, its address in grey
 *              around the field (`x.com/` [skeenmusic]); a music service for its artist
 *              link, with Sync on unless switched off; a service for its own fields
 *              (Shopify: domain + token)
 *   run      — each row's ring turns in front of you: empty waits, spinning checks, ink
 *              means done, red means not — with the reason in one sentence under the
 *              value and the field still editable. Retry runs the failed ones only; Save
 *              keeps what worked (the footer word is Save everywhere, Sam 2026-09-23).
 *
 * SHOPIFY, WHEN THE APP IS SET UP (`shopifyApp`, Sam 2026-09-28): the row asks for the store
 * address alone, and the footer's action is a "Connect with Shopify" LINK to the install
 * route — the trip to Shopify IS the connect, so Shopify never goes through
 * `connectOneAction` here. With other picks, Connect runs those first and the link comes
 * after, so leaving for Shopify never strands a pick nobody ran. Without the app, Shopify is
 * the typed domain + token it always was.
 *
 * YOUTUBE, WHEN THE GOOGLE APP IS SET UP (`youtubeApp`, Sam 2026-09-28): the YouTube row
 * offers "Connect with YouTube" above its paste field — sign in to Google, we find the
 * channel (`src/lib/youtube-oauth.ts`). Pasting stays as the fallback. The same rule as
 * Shopify: the button shows only once nothing else is waiting to run, and a YouTube row left
 * blank waits for its trip instead of being run and refused.
 *
 * THE LATCH IS A REF (AGENTS.md rule 5). Two fast presses of Connect both read stale
 * state; the ref is what makes the second one a no-op.
 */
type Status = 'wait' | 'busy' | 'ok' | 'fail'
/** YouTube's connection key: the one pick with a Google sign-in. */
const YOUTUBE_KEY = 'youtube'
type Pick = { def: ConnectionDef; input: ConnectInput; status: Status; result?: ConnectResult }

const PAIR = 'min-w-[88px] justify-center'

export function ConnectModal({
  artistId,
  taken,
  defs,
  onClose,
  onDone,
  shopifyApp = false,
  youtubeApp = false,
  createPages,
}: {
  artistId: string
  /** Keys already on the page — dimmed in the grid, not addable twice. */
  taken: string[]
  /** What the grid offers; every connection by default. The editor's Add button passes
   *  the socials alone — a service is never a site button. */
  defs?: readonly ConnectionDef[]
  onClose: () => void
  /** Called once when the manager leaves with at least one connection made. */
  onDone: () => void
  /** The Shopify app's credentials are set (a server-made boolean — never the secret):
   *  Shopify connects by going to Shopify, not by a pasted token. */
  shopifyApp?: boolean
  /** The Google app's credentials are set (a server-made boolean): the YouTube row offers
   *  Connect with YouTube above its paste field. */
  youtubeApp?: boolean
  /** By connection key, a link that MAKES the page on that platform, for one the artist has
   *  none of yet (MusicBrainz: its own artist editor, pre-filled; built on the server). */
  createPages?: Partial<Record<string, string>>
}) {
  useLockBodyScroll(true)
  const [step, setStep] = useState<'pick' | 'details' | 'run'>('pick')
  const [query, setQuery] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [running, setRunning] = useState(false)
  const busyRef = useRef(false)
  const madeOne = useRef(false)
  /** Why the typed store address can't be used, shown under it until it changes. */
  const [shopError, setShopError] = useState<string | null>(null)
  /** A pick that connects by the trip to Shopify, not by `connectOneAction`. */
  const viaApp = (p: Pick) => shopifyApp && p.def.key === SHOPIFY_KEY
  /** A YouTube pick left blank: it connects by the trip to Google, not by `connectOneAction`. */
  const viaGoogle = (p: Pick) => youtubeApp && p.def.key === YOUTUBE_KEY && !(p.input.handle ?? '').trim()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, running])

  function leave() {
    if (running) return
    if (madeOne.current) onDone()
    onClose()
  }

  const takenSet = new Set(taken)
  const shown = searchConnections(query, connectionsAtoZ(defs))

  function togglePick(def: ConnectionDef) {
    setPicks((all) => (all.some((p) => p.def.key === def.key) ? all.filter((p) => p.def.key !== def.key) : [...all, { def, input: seed(def), status: 'wait' }]))
  }

  function setInput(key: string, patch: ConnectInput) {
    if (key === SHOPIFY_KEY) setShopError(null)
    setPicks((all) => all.map((p) => (p.def.key === key ? { ...p, input: { ...p.input, ...patch } } : p)))
  }

  async function run(only?: Set<string>) {
    if (busyRef.current) return
    busyRef.current = true
    setRunning(true)
    setStep('run')
    // Reset the rows about to run; leave the ones that already worked alone. A Shopify pick
    // in app mode never runs here: its connect is the trip to Shopify.
    const runs = (p: Pick) => !viaApp(p) && !viaGoogle(p) && (!only || only.has(p.def.key))
    setPicks((all) => all.map((p) => (runs(p) ? { ...p, status: 'wait', result: undefined } : p)))
    const queue = picks.filter(runs)
    for (const p of queue) {
      const problem = connectInputError(p.def, p.input)
      if (problem) {
        // Refused before a request is made — but shown the same way a server refusal is.
        setPicks((all) => all.map((x) => (x.def.key === p.def.key ? { ...x, status: 'fail', result: { ok: false, error: problem } } : x)))
        continue
      }
      setPicks((all) => all.map((x) => (x.def.key === p.def.key ? { ...x, status: 'busy' } : x)))
      let result: ConnectResult
      try {
        result = await connectOneAction(artistId, p.def.key, p.input)
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : 'Couldn’t connect.' }
      }
      if (result.ok) madeOne.current = true
      setPicks((all) => all.map((x) => (x.def.key === p.def.key ? { ...x, status: result.ok ? 'ok' : 'fail', result } : x)))
    }
    setRunning(false)
    busyRef.current = false
  }

  const failed = picks.filter((p) => p.status === 'fail')
  const done = picks.filter((p) => p.status === 'ok')
  const finished = step === 'run' && !running
  const toRun = picks.filter((p) => !viaApp(p) && !viaGoogle(p))
  /** The Google button, on the YouTube row: in details only when nothing else is waiting to
   *  run (leaving would strand it), and after a run on a row that has not connected. */
  const nothingElseToRun = picks.every((p) => p.def.key === YOUTUBE_KEY || viaApp(p))
  const googleTrip = (p: Pick, now: 'details' | 'run') =>
    youtubeApp && p.def.key === YOUTUBE_KEY && (now === 'details' ? nothingElseToRun : finished && p.status !== 'ok') ? (
      <YouTubeTrip artistId={artistId} sync={p.input.sync !== false} />
    ) : null
  const appPick = picks.find(viaApp)
  const shopifyLink = appPick ? (
    <ShopifyLink artistId={artistId} domain={appPick.input.domain} onBad={setShopError} className={buttonClass('solid', cx(PAIR, 'whitespace-nowrap'))} />
  ) : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Connect" className={modalOverlayClass} onMouseDown={(e) => e.target === e.currentTarget && leave()}>
      <div className={cx(modalCardClass, 'gap-0')}>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={leave}
            disabled={running}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-30"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {step === 'pick' && (
          <>
            <label className="mt-1 flex items-center gap-2.5 border-b border-hairline px-0.5 pb-2.5 text-ink-faint">
              <Icon name="search" size={15} />
              <input
                autoFocus
                aria-label="Search"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent font-space text-[13px] text-ink outline-none placeholder:text-hairline"
              />
            </label>
            {/* The grid scrolls INSIDE the card; the fade says there is more below. */}
            <div className="relative mt-3.5 max-h-[372px] overflow-y-auto pr-1">
              <div className="grid grid-cols-4 gap-2">
                {shown.map((d) => {
                  const already = takenSet.has(d.key)
                  const on = picks.some((p) => p.def.key === d.key)
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={already}
                      aria-pressed={on}
                      aria-label={already ? `${d.label} (connected)` : d.label}
                      onClick={() => togglePick(d)}
                      className={cx(
                        'relative flex min-h-[82px] flex-col items-start justify-end gap-2.5 rounded-xl border p-3 text-left text-[13px] font-semibold transition-colors',
                        already ? 'cursor-default border-hairline text-ink opacity-35' : on ? 'border-ink text-ink shadow-[inset_0_0_0_1px_#111]' : 'border-hairline text-ink hover:border-ink-faint',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          'absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full border text-paper',
                          on ? 'border-ink bg-ink' : already ? 'border-ink-faint bg-ink-faint' : 'border-hairline bg-paper',
                        )}
                      >
                        {(on || already) && <Icon name="check" size={10} strokeWidth={2.4} />}
                      </span>
                      <ConnectionMark def={d} size={22} />
                      <span className="truncate">{d.label}</span>
                    </button>
                  )
                })}
              </div>
              <div aria-hidden className="pointer-events-none sticky bottom-0 -mt-7 h-7 bg-gradient-to-b from-transparent to-paper" />
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="font-space text-[11px] text-ink-muted">{picks.length ? `${picks.length} selected` : ''}</span>
              <div className="flex gap-2">
                <button type="button" onClick={leave} className={buttonClass('confirm', PAIR)}>Cancel</button>
                <button type="button" disabled={!picks.length} onClick={() => setStep('details')} className={buttonClass('solid', cx(PAIR, 'disabled:opacity-40'))}>
                  Continue
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'details' && (
          <>
            <div className="mt-1">
              {picks.map((p) => (
                <DetailRow
                  key={p.def.key}
                  pick={p}
                  app={viaApp(p)}
                  error={viaApp(p) ? shopError : null}
                  trip={googleTrip(p, 'details')}
                  createPage={createPages?.[p.def.key]}
                  onChange={(patch) => setInput(p.def.key, patch)}
                />
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button type="button" onClick={() => setStep('pick')} className={buttonClass('confirm', PAIR)}>Back</button>
              {toRun.length > 0 ? (
                <button type="button" onClick={() => void run()} className={buttonClass('solid', PAIR)}>
                  Connect{toRun.length > 1 ? ` ${toRun.length}` : ''}
                </button>
              ) : (
                shopifyLink
              )}
            </div>
          </>
        )}

        {step === 'run' && (
          <>
            <div className="mt-1">
              {picks.map((p) => (
                <RunRow
                  key={p.def.key}
                  pick={p}
                  app={viaApp(p)}
                  error={viaApp(p) ? shopError : null}
                  trip={googleTrip(p, 'run')}
                  editable={finished && (p.status === 'fail' || viaApp(p))}
                  onChange={(patch) => setInput(p.def.key, patch)}
                />
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <span className="font-space text-[11px] text-ink-muted">
                {running
                  ? `${picks.filter((p) => p.status === 'ok' || p.status === 'fail').length} of ${picks.length}`
                  : `${done.length} connected${failed.length ? ` · ${failed.length} didn’t` : ''}`}
              </span>
              <div className="flex gap-2">
                {running ? (
                  <button type="button" disabled className={buttonClass('solid', cx(PAIR, 'opacity-55'))}>Connecting…</button>
                ) : (
                  <>
                    <button type="button" onClick={leave} className={buttonClass('confirm', PAIR)}>Save</button>
                    {failed.length > 0 && (
                      <button type="button" onClick={() => void run(new Set(failed.map((p) => p.def.key)))} className={buttonClass('solid', PAIR)}>
                        Retry
                      </button>
                    )}
                    {shopifyLink}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A pick's empty input: the handle or the link it asks for, and Sync on where it can pull. */
function seed(def: ConnectionDef): ConnectInput {
  if (!def.social) return {}
  const sync = def.source ? { sync: true } : {}
  return methodOf(def)?.kind === 'handle' ? { handle: '', ...sync } : { url: '', ...sync }
}

/** The switch's words, by what the source feeds. */
const SYNC_WORD: Partial<Record<string, string>> = { music: 'Sync music', videos: 'Import videos' }

const FIELD = 'block h-6 min-w-0 w-full border-b bg-transparent p-0 font-space text-[13px] leading-6 text-ink outline-none placeholder:text-hairline'
/** The input inside a handle field: the border belongs to the row around it. */
const BARE = 'block h-6 min-w-0 flex-1 bg-transparent p-0 font-space text-[13px] leading-6 text-ink outline-none placeholder:text-hairline'

/** What a pick's value reads as once it is not being edited: a handle as the link it became
 *  (`x.com/skeenmusic`), anything else as typed. */
function shownValue(def: ConnectionDef, input: ConnectInput): string {
  if (def.key === SHOPIFY_KEY) return input.domain ?? ''
  const method = methodOf(def)
  if (method?.kind === 'handle') {
    const parsed = parseHandle(method, input.handle ?? '')
    return 'error' in parsed ? (input.handle ?? '') : parsed.url.replace(/^https:\/\//, '')
  }
  return def.social ? (input.url ?? '') : (input.id ?? '')
}

/**
 * The one place a pick is typed into, in both steps (details, and a failed row in run):
 * the handle between its address, the artist link, the service's fields. `failed` paints the
 * field's line red.
 */
function ConnectField({
  def,
  input,
  failed,
  app,
  onChange,
}: {
  def: ConnectionDef
  input: ConnectInput
  failed?: boolean
  /** Shopify via the app: the store address alone. */
  app?: boolean
  onChange: (patch: ConnectInput) => void
}) {
  const line = failed ? 'border-accent-red focus:border-accent-red' : 'border-hairline focus:border-ink'
  const m = methodOf(def)
  if (def.key === SHOPIFY_KEY && app)
    return (
      <input
        aria-label="Shopify store domain"
        placeholder="store.myshopify.com"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={input.domain ?? ''}
        onChange={(e) => onChange({ domain: e.target.value })}
        className={cx(FIELD, line)}
      />
    )
  if (def.key === SHOPIFY_KEY)
    return (
      <>
        <input aria-label="Shopify store domain" placeholder="store.myshopify.com" value={input.domain ?? ''} onChange={(e) => onChange({ domain: e.target.value })} className={cx(FIELD, line)} />
        <input aria-label="Shopify storefront token" type="password" placeholder="Storefront access token" value={input.token ?? ''} onChange={(e) => onChange({ token: e.target.value })} className={cx(FIELD, line)} />
      </>
    )
  if (m?.kind === 'handle') {
    const typed = input.handle ?? ''
    // A pasted link becomes its handle at once, and leaving the field drops a typed @ — so
    // the field reads `x.com/` skeenmusic, never `x.com/https://twitter.com/…`. Anything
    // that is not a handle stays exactly as typed, for the manager to fix.
    const tidy = (raw: string) => {
      const parsed = parseHandle(m, raw)
      return 'error' in parsed || parsed.handle === null ? raw : parsed.handle
    }
    // A link kept whole (a YouTube channel id) shows without the address around it.
    const whole = typed.includes('/')
    return (
      <div className={cx('flex min-w-0 items-baseline border-b', failed ? 'border-accent-red' : 'border-hairline focus-within:border-ink')}>
        {m.before && !whole && <span aria-hidden className="flex-none font-space text-[13px] leading-6 text-ink-faint">{m.before}</span>}
        <input
          aria-label={`${def.label} ${m.noun}`}
          placeholder={m.noun}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => onChange({ handle: e.target.value })}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            const handle = tidy(text)
            if (handle === text) return
            e.preventDefault()
            onChange({ handle })
          }}
          onBlur={(e) => {
            const handle = tidy(e.target.value)
            if (handle !== e.target.value) onChange({ handle })
          }}
          // With an address AFTER it (`.bandcamp.com`), the field is as wide as its text, so
          // the address follows the name instead of waiting at the far edge. Space Mono is
          // monospaced, so `ch` is exact.
          className={cx(BARE, m.after && !whole && 'max-w-full flex-none')}
          style={m.after && !whole ? { width: `${Math.max(typed.length, m.noun.length) + 0.5}ch` } : undefined}
        />
        {m.after && !whole && <span aria-hidden className="flex-none font-space text-[13px] leading-6 text-ink-faint">{m.after}</span>}
      </div>
    )
  }
  if (def.social)
    return (
      <input
        aria-label={`${def.label} link`}
        placeholder={`Paste your ${def.label} artist link`}
        value={input.url ?? ''}
        onChange={(e) => onChange({ url: e.target.value })}
        className={cx(FIELD, line)}
      />
    )
  return (
    <input aria-label={`${def.label} ${def.source?.placeholder ?? 'id'}`} placeholder={def.source?.placeholder} value={input.id ?? ''} onChange={(e) => onChange({ id: e.target.value })} className={cx(FIELD, line)} />
  )
}

/** Link only, or link AND pull: shown on a profile that can also feed the dashboard. */
function SyncSwitch({ def, input, onChange }: { def: ConnectionDef; input: ConnectInput; onChange: (patch: ConnectInput) => void }) {
  if (!def.social || !def.source) return null
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-[12px] text-ink-muted">
      <input type="checkbox" checked={input.sync !== false} onChange={(e) => onChange({ sync: e.target.checked })} className="h-3.5 w-3.5 accent-ink" />
      {SYNC_WORD[def.source.section] ?? 'Sync'}
    </label>
  )
}

/**
 * "Create the MusicBrainz page" (AI_VISIBILITY_AUDIT.md 4.1): the platform's own form, opened
 * in a new tab already filled in. Nothing is sent from here: the artist signs in there and
 * submits it, then pastes the new page's link into the field above. https only.
 */
function CreatePage({ def, href }: { def: ConnectionDef; href?: string }) {
  if (!href?.startsWith('https://')) return null
  return (
    <div className="flex flex-col gap-0.5 text-[12px] leading-snug text-ink-muted">
      <a href={href} target="_blank" rel="noopener noreferrer" className="w-fit font-semibold text-ink underline underline-offset-2">
        Create the {def.label} page
      </a>
      <span>It opens filled in. Sign in there and submit it yourself.</span>
    </div>
  )
}

/** The reason a store address can't be used, under its field. */
function ShopError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div role="alert" className="text-[12.5px] leading-snug text-accent-red">
      {error}
    </div>
  )
}

function DetailRow({
  pick,
  app,
  error,
  trip,
  createPage,
  onChange,
}: {
  pick: Pick
  app?: boolean
  error?: string | null
  /** A sign-in button that connects this pick instead of typing (YouTube), above the field. */
  trip?: ReactNode
  createPage?: string
  onChange: (patch: ConnectInput) => void
}) {
  const { def, input } = pick
  return (
    <div className="flex items-center gap-3.5 py-3">
      <span className="flex w-5 flex-none justify-center text-ink"><ConnectionMark def={def} size={16} /></span>
      <span className="w-28 flex-none truncate text-sm font-semibold">{def.label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {trip}
        <ConnectField def={def} input={input} app={app} failed={!!error} onChange={onChange} />
        <SyncSwitch def={def} input={input} onChange={onChange} />
        <CreatePage def={def} href={createPage} />
        <ShopError error={error ?? null} />
      </div>
    </div>
  )
}

function RunRow({
  pick,
  app,
  error,
  trip,
  editable,
  onChange,
}: {
  pick: Pick
  app?: boolean
  error?: string | null
  trip?: ReactNode
  editable: boolean
  onChange: (patch: ConnectInput) => void
}) {
  const { def, input, status, result } = pick
  const value = shownValue(def, input)
  return (
    <div className={cx('flex items-start gap-3.5 py-3', (status === 'wait' || status === 'busy') && 'text-ink-muted')}>
      <span className={cx('mt-0.5 flex w-5 flex-none justify-center', status === 'ok' ? 'text-ink' : 'text-ink-faint')}><ConnectionMark def={def} size={16} /></span>
      <span className="w-28 flex-none truncate pt-0.5 text-sm font-semibold">{def.label}</span>
      <div className="min-w-0 flex-1">
        {/* A blank YouTube row that waited for its trip is the button alone. */}
        {trip && <div className={cx((editable || value) && 'mb-2')}>{trip}</div>}
        {editable ? (
          <div className="flex flex-col gap-2">
            <ConnectField def={def} input={input} app={app} failed={!app || !!error} onChange={onChange} />
            <ShopError error={error ?? null} />
          </div>
        ) : (
          (value || !trip) && (
            <span className={cx('block h-6 truncate font-space text-[13px] leading-6', status === 'ok' ? 'text-ink' : 'text-ink-muted')}>{value}</span>
          )
        )}
        {status === 'ok' && result?.message && (
          <div className="mt-1 text-[12.5px] leading-snug text-ink-muted">{result.message}</div>
        )}
        {status === 'fail' && result?.error && (
          <div role="alert" className="mt-1 text-[12.5px] leading-snug text-accent-red">
            {result.error}
            {result.detail ? ` ${result.detail}` : ''}
          </div>
        )}
      </div>
      <span
        aria-label={{ wait: 'waiting', busy: 'connecting', ok: 'connected', fail: 'failed' }[status]}
        className={cx(
          'mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-paper',
          status === 'wait' && 'border border-hairline',
          status === 'busy' && 'animate-spin border-2 border-hairline border-t-ink',
          status === 'ok' && 'bg-ink',
          status === 'fail' && 'bg-accent-red',
        )}
      >
        {status === 'ok' && <Icon name="check" size={11} strokeWidth={2.4} />}
        {status === 'fail' && <Icon name="close" size={11} strokeWidth={2.4} />}
      </span>
    </div>
  )
}

/** What a bad store address says. One sentence, the fix in it. */
const SHOP_ADDRESS_ERROR = 'Use the store address that ends in .myshopify.com.'

/**
 * "Connect with Shopify": a real link to the install route, which checks the manager and the
 * store and sends the browser on to Shopify. The address is tidied first (case, https://, the
 * admin.shopify.com/store/… link people have open); one that still isn't a store stops here,
 * with the reason, instead of leaving.
 */
export function ShopifyLink({ artistId, domain, onBad, className }: { artistId: string; domain?: string; onBad: (error: string) => void; className?: string }) {
  const shop = normalizeShopDomain(domain ?? '')
  return (
    <a
      href={shopifyInstallPath(artistId, shop)}
      onClick={(e) => {
        if (isShopDomain(shop)) return
        e.preventDefault()
        onBad(SHOP_ADDRESS_ERROR)
      }}
      className={className}
    >
      Connect with Shopify
    </a>
  )
}

/**
 * "Connect with YouTube": a real link to the start route, which checks the manager and sends
 * the browser on to Google's sign-in. The Sync choice rides along (`sync=0` when off). While
 * the Google app is in testing, Google shows an "unverified app" screen first: one line says
 * that is expected, so nobody turns back at it.
 */
function YouTubeTrip({ artistId, sync }: { artistId: string; sync: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <a href={youtubeStartPath(artistId, sync)} className={buttonClass('solid', 'w-fit whitespace-nowrap')}>
        Connect with YouTube
      </a>
      <span className="text-[12px] leading-snug text-ink-muted">Google shows a warning while Tapir is in testing: that’s expected.</span>
    </div>
  )
}
