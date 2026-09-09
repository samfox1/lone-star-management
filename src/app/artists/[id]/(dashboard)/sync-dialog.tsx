'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { useLockBodyScroll } from './use-lock-body-scroll'
import { SECTION_SERVICE_NOUN, type SyncRunResult, type SyncSection, type SyncSource } from './sync-sections'

// The types and the section vocabulary live in sync-sections, and the arrow points ONE
// way: that module has no React and no 'use client', so this can read it while the pages
// read both. The reverse — sync-sections importing a type from here — was a cycle waiting
// for a value to be added to it.
export type { SyncRunResult, SyncSource } from './sync-sections'

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
  /** Which content this page holds. Passed straight back to `run`, and used to name the
   *  KIND of service missing when nothing is connected — derived here rather than passed,
   *  so no page can forget it and get "No service integrations". */
  section: SyncSection
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
            {connected.length === 0 ? (
              /* NOTHING CONNECTED. It used to list the section's services with a "not
                 connected" tag beside each and a dead Sync now underneath — a dialog
                 telling a manager about things they do not have and then refusing to act
                 (Sam, 2026-09-09, on a screenshot of exactly that). Name the KIND that is
                 missing and offer the one thing that helps. */
              <p className="text-[13px] leading-relaxed text-ink-muted">
                No {SECTION_SERVICE_NOUN[section]} integrations.
              </p>
            ) : (
              <ul className="space-y-1">
                {connected.map((s) => {
                  const result = results?.find((r) => r.key === s.key)
                  return (
                    <li key={s.key} className="flex items-start gap-3 py-1.5">
                      {/* Every row here IS connected — the list is `connected`, not
                          `sources`. A disconnected service is not a row at all. */}
                      <input
                        type="checkbox"
                        id={`sync-${s.key}`}
                        aria-label={s.label}
                        checked={picked.includes(s.key)}
                        onChange={() => toggle(s.key)}
                        className="mt-0.5 h-4 w-4 flex-none accent-accent"
                      />
                      <span className="min-w-0 flex-1">
                        <label htmlFor={`sync-${s.key}`} className="block text-[13px] text-ink">
                          {s.label}
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
              {/* The route to the hub. With nothing connected it IS the action, so it
                  says so; otherwise it stays the quiet way out to the other platforms. */}
              <Link
                href={integrationsHref}
                className={cx(
                  'font-space text-[11px] font-bold uppercase tracking-[0.06em]',
                  connected.length === 0
                    ? 'rounded-lg bg-ink px-3 py-2 text-paper'
                    : 'font-semibold normal-case tracking-normal text-ink-muted underline underline-offset-2 hover:text-ink',
                )}
              >
                {connected.length === 0 ? 'Connect a service' : 'Sync other platforms'}
              </Link>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:text-ink"
                >
                  Close
                </button>
                {/* No Sync now with nothing connected: a control that provably cannot work
                    reads as the dialog being broken rather than the store being unlinked. */}
                {connected.length > 0 && (
                  <button
                    type="button"
                    onClick={sync}
                    disabled={!picked.length || busy}
                    className="rounded-lg bg-ink px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-paper transition-opacity disabled:opacity-40"
                  >
                    {busy ? 'Syncing…' : 'Sync now'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
