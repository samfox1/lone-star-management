'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { useLockBodyScroll } from './use-lock-body-scroll'

/** One data source this page's content can be pulled from, resolved by the PAGE — an id
 *  column for the platform integrations, Vault for Shopify. This component never decides
 *  who is connected; it chooses among what it is given and reports what happened. */
export type SyncSource = { key: string; label: string; connected: boolean }

/** What one source did on this run. `syncOutcome` (lib/sync) writes both strings. */
export type SyncRunResult = { key: string; label: string; ok: boolean; message?: string; error?: string }

/**
 * SYNC, IN PLACE (Sam, 2026-09-09: "I dont want the sync button to redirect the user to
 * the integrations page").
 *
 * What it replaced: on Merch, Sync was a LINK to /tools/integrations — a manager who
 * wanted their products refreshed was sent to a settings page to find a button. On Music
 * it pulled every connected source at once with no say in which, and reported the lot as
 * one joined string.
 *
 * So: a dialog listing this section's sources, each connected one ticked (the common
 * press is "refresh what I have"), a per-source result line after the run, and the route
 * to the integrations page kept as a LINK, out of the way of the press everyone came for.
 *
 * A disconnected source is NAMED but has no checkbox: syncing it can only fail, and
 * hiding it would leave a manager wondering where Deezer went.
 */
export function SyncDialog({
  artistId,
  section,
  sources,
  run,
  integrationsHref,
  disabled = false,
}: {
  artistId: string
  /** Which content this page holds — passed straight back to `run`, never interpreted. */
  section: string
  sources: SyncSource[]
  run: (artistId: string, section: string, keys: string[]) => Promise<{ results: SyncRunResult[] }>
  integrationsHref: string
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const connected = sources.filter((s) => s.connected)
  const [picked, setPicked] = useState<string[]>(() => connected.map((s) => s.key))
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<SyncRunResult[] | null>(null)

  useLockBodyScroll(open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  async function sync() {
    if (!picked.length || busy) return
    setBusy(true)
    setResults(null)
    try {
      const res = await run(artistId, section, picked)
      setResults(res.results)
      // Refresh even on a partial failure: rows DID land, and showing a stale list beside
      // "4 added" tells the manager two contradictory things at once.
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label="Sync"
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-60"
      >
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[90px] group-hover:pl-1 group-hover:pr-1.5">
          Sync
        </span>
        <Icon name="refresh" size={15} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sync content"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className={modalCardClass}>
            {sources.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Nothing connected for this yet.</p>
            ) : (
              <ul className="space-y-1">
                {sources.map((s) => {
                  const result = results?.find((r) => r.key === s.key)
                  return (
                    <li key={s.key} className="flex items-start gap-3 py-1.5">
                      {s.connected ? (
                        <input
                          type="checkbox"
                          id={`sync-${s.key}`}
                          aria-label={s.label}
                          checked={picked.includes(s.key)}
                          onChange={() => toggle(s.key)}
                          className="mt-0.5 h-4 w-4 flex-none accent-accent"
                        />
                      ) : (
                        // Space where the box would be, so the labels line up and a
                        // disconnected source reads as one of the same list.
                        <span className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <label
                          htmlFor={s.connected ? `sync-${s.key}` : undefined}
                          className={cx('block text-[13px]', s.connected ? 'text-ink' : 'text-ink-faint')}
                        >
                          {s.label}
                          {!s.connected && <span className="ml-2 font-space text-[10px] uppercase tracking-[0.08em]">Not connected</span>}
                        </label>
                        {result && (
                          <span
                            className={cx(
                              'mt-0.5 block font-space text-[11px] leading-snug',
                              result.ok ? 'text-ink-faint' : 'text-accent-red',
                            )}
                          >
                            {result.ok ? result.message : result.error}
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              {/* The route to the hub stays — as a LINK, which is what it always should
                  have been, rather than the thing the Sync button did. */}
              <Link
                href={integrationsHref}
                className="font-space text-[11px] font-semibold text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                Sync other platforms
              </Link>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:text-ink"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={sync}
                  disabled={!picked.length || busy}
                  className="rounded-lg bg-ink px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-paper transition-opacity disabled:opacity-40"
                >
                  {busy ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
