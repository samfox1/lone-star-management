'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { buttonClass, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import {
  SHOPIFY_KEY,
  connectInputError,
  connectionByKey,
  connectionsAtoZ,
  searchConnections,
  type ConnectInput,
  type ConnectionDef,
} from '@/lib/connections'
import { useLockBodyScroll } from '../use-lock-body-scroll'
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
 *   details  — one row per pick with the platform's address prefilled in grey, so the
 *              manager pastes a handle, not a whole URL; Shopify wants domain + token
 *   run      — each row's ring turns in front of you: empty waits, spinning checks, ink
 *              means done, red means not — with the reason in one sentence under the
 *              value and the field still editable. Retry runs the failed ones only; Done
 *              keeps what worked.
 *
 * THE LATCH IS A REF (AGENTS.md rule 5). Two fast presses of Connect both read stale
 * state; the ref is what makes the second one a no-op.
 */
type Status = 'wait' | 'busy' | 'ok' | 'fail'
type Pick = { def: ConnectionDef; input: ConnectInput; status: Status; result?: ConnectResult }

const PAIR = 'min-w-[88px] justify-center'

export function ConnectModal({
  artistId,
  taken,
  preselect,
  onClose,
  onDone,
}: {
  artistId: string
  /** Keys already on the page — dimmed in the grid, not addable twice. */
  taken: string[]
  /** Open straight on the details step for ONE connection (a row's "+ Connect"). */
  preselect?: { key: string; url?: string }
  onClose: () => void
  /** Called once when the manager leaves with at least one connection made. */
  onDone: () => void
}) {
  useLockBodyScroll(true)
  const pre = preselect ? connectionByKey(preselect.key) : undefined
  const [step, setStep] = useState<'pick' | 'details' | 'run'>(pre ? 'details' : 'pick')
  const [query, setQuery] = useState('')
  const [picks, setPicks] = useState<Pick[]>(pre ? [{ def: pre, input: seed(pre, preselect?.url), status: 'wait' }] : [])
  const [running, setRunning] = useState(false)
  const busyRef = useRef(false)
  const madeOne = useRef(false)

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
  const shown = searchConnections(query, connectionsAtoZ())

  function togglePick(def: ConnectionDef) {
    setPicks((all) => (all.some((p) => p.def.key === def.key) ? all.filter((p) => p.def.key !== def.key) : [...all, { def, input: seed(def), status: 'wait' }]))
  }

  function setInput(key: string, patch: ConnectInput) {
    setPicks((all) => all.map((p) => (p.def.key === key ? { ...p, input: { ...p.input, ...patch } } : p)))
  }

  async function run(only?: Set<string>) {
    if (busyRef.current) return
    busyRef.current = true
    setRunning(true)
    setStep('run')
    // Reset the rows about to run; leave the ones that already worked alone.
    setPicks((all) => all.map((p) => (!only || only.has(p.def.key) ? { ...p, status: 'wait', result: undefined } : p)))
    const queue = picks.filter((p) => !only || only.has(p.def.key))
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
                <DetailRow key={p.def.key} pick={p} onChange={(patch) => setInput(p.def.key, patch)} />
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between">
              {pre ? <span /> : <button type="button" onClick={() => setStep('pick')} className={buttonClass('confirm', PAIR)}>Back</button>}
              <button type="button" onClick={() => void run()} className={buttonClass('solid', PAIR)}>
                Connect{picks.length > 1 ? ` ${picks.length}` : ''}
              </button>
            </div>
          </>
        )}

        {step === 'run' && (
          <>
            <div className="mt-1">
              {picks.map((p) => (
                <RunRow key={p.def.key} pick={p} editable={finished && p.status === 'fail'} onChange={(patch) => setInput(p.def.key, patch)} />
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
                    <button type="button" onClick={leave} className={buttonClass('confirm', PAIR)}>Done</button>
                    {failed.length > 0 && (
                      <button type="button" onClick={() => void run(new Set(failed.map((p) => p.def.key)))} className={buttonClass('solid', PAIR)}>
                        Retry
                      </button>
                    )}
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

/** The first thing in the field: the platform's address, so a handle is all that's left to type. */
function seed(def: ConnectionDef, url?: string): ConnectInput {
  if (def.social) return { url: url ?? def.urlHint ?? '' }
  return {}
}

const FIELD = 'block h-6 min-w-0 w-full border-b bg-transparent p-0 font-space text-[13px] leading-6 text-ink outline-none placeholder:text-hairline'

function DetailRow({ pick, onChange }: { pick: Pick; onChange: (patch: ConnectInput) => void }) {
  const { def, input } = pick
  return (
    <div className="flex items-center gap-3.5 py-3">
      <span className="flex w-5 flex-none justify-center text-ink"><ConnectionMark def={def} size={16} /></span>
      <span className="w-28 flex-none truncate text-sm font-semibold">{def.label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {def.key === SHOPIFY_KEY ? (
          <>
            <input aria-label="Shopify store domain" placeholder="store.myshopify.com" value={input.domain ?? ''} onChange={(e) => onChange({ domain: e.target.value })} className={cx(FIELD, 'border-hairline focus:border-ink')} />
            <input aria-label="Shopify storefront token" type="password" placeholder="Storefront access token" value={input.token ?? ''} onChange={(e) => onChange({ token: e.target.value })} className={cx(FIELD, 'border-hairline focus:border-ink')} />
          </>
        ) : def.social ? (
          <input aria-label={`${def.label} link`} value={input.url ?? ''} onChange={(e) => onChange({ url: e.target.value })} className={cx(FIELD, 'border-hairline focus:border-ink')} />
        ) : (
          <input aria-label={`${def.label} ${def.source?.placeholder ?? 'id'}`} placeholder={def.source?.placeholder} value={input.id ?? ''} onChange={(e) => onChange({ id: e.target.value })} className={cx(FIELD, 'border-hairline focus:border-ink')} />
        )}
      </div>
    </div>
  )
}

function RunRow({ pick, editable, onChange }: { pick: Pick; editable: boolean; onChange: (patch: ConnectInput) => void }) {
  const { def, input, status, result } = pick
  const value = def.key === SHOPIFY_KEY ? input.domain ?? '' : def.social ? input.url ?? '' : input.id ?? ''
  return (
    <div className={cx('flex items-start gap-3.5 py-3', (status === 'wait' || status === 'busy') && 'text-ink-muted')}>
      <span className={cx('mt-0.5 flex w-5 flex-none justify-center', status === 'ok' ? 'text-ink' : 'text-ink-faint')}><ConnectionMark def={def} size={16} /></span>
      <span className="w-28 flex-none truncate pt-0.5 text-sm font-semibold">{def.label}</span>
      <div className="min-w-0 flex-1">
        {editable ? (
          <input
            aria-label={`${def.label} ${def.social ? 'link' : def.key === SHOPIFY_KEY ? 'store domain' : 'id'}`}
            value={value}
            onChange={(e) => onChange(def.key === SHOPIFY_KEY ? { domain: e.target.value } : def.social ? { url: e.target.value } : { id: e.target.value })}
            className={cx(FIELD, 'border-accent-red focus:border-accent-red')}
          />
        ) : (
          <span className={cx('block h-6 truncate font-space text-[13px] leading-6', status === 'ok' ? 'text-ink' : 'text-ink-muted')}>{value}</span>
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
