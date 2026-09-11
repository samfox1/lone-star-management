'use client'

import { useEffect, useState, type KeyboardEvent } from 'react'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import type { SupportAct } from '@/lib/content'
import { setSupportActsAction } from '../actions'
import { toast } from '../toast'

/**
 * A tour date's lineup as CHIPS (prototype G, Sam, 2026-09-11). A chip is an act; one
 * with a website wears the link mark. Click a chip for a small dialog — name, website,
 * Remove — and the dashed "+" chip opens the same dialog empty to add one. The site
 * itself is never shown on the row: it is there when you need to fix it, and not before.
 *
 * The act dialog sits OVER the card (Sam: "another modal on top of the current one"),
 * never in the row's flow — it must not push rows down or be clipped by the card's
 * scroll box. Backdrop click and Escape close it and stop there, so the card stays open.
 *
 * SELF-SAVING when the date exists: every add / edit / remove sends the WHOLE lineup
 * through one action, optimistic first, reverted (with the server's message) if refused.
 * Without a `tourDateId` (the Add card, before the row exists) it only reports the
 * lineup through `onChange`; the card writes it once the row has an id. Enter inside the
 * dialog commits and never submits a form around it. Draft until Publish.
 */
export function SupportActs({
  artistId,
  tourDateId,
  acts: initial,
  onChange,
}: {
  artistId: string
  tourDateId?: string
  acts: SupportAct[]
  onChange?: (acts: SupportAct[]) => void
}) {
  const [acts, setActs] = useState(initial)
  /** Which chip is open: an index, `-1` for the add chip, or null. */
  const [open, setOpen] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (open === null) return
    // Escape closes the act dialog and STOPS there (capture phase), so CardModal's own
    // Escape handler never sees it and the card under it stays open.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setOpen(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  function show(at: number | null) {
    const act = at !== null && at >= 0 ? acts[at] : null
    setName(act?.name ?? '')
    setUrl(act?.url ?? '')
    setOpen(at)
  }

  async function save(next: SupportAct[]): Promise<boolean> {
    if (!tourDateId) {
      setActs(next)
      onChange?.(next)
      return true
    }
    const prev = acts
    setActs(next) // optimistic
    const res = await setSupportActsAction(artistId, tourDateId, next)
    if (res.error) {
      setActs(prev)
      toast(res.error, 'error')
      return false
    }
    if (res.acts) setActs(res.acts) // as stored: trimmed, deduped, URLs normalised
    return true
  }

  async function commit() {
    if (open === null) return
    const n = name.trim()
    if (!n) {
      setOpen(null)
      return
    }
    const act = { name: n, url: url.trim() || null }
    const next = open < 0 ? [...acts, act] : acts.map((a, i) => (i === open ? act : a))
    if (await save(next)) setOpen(null)
  }

  async function remove() {
    if (open === null || open < 0) return
    if (await save(acts.filter((_, i) => i !== open))) setOpen(null)
  }

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault() // the dialog sits inside the date's card, never submit it
    void commit()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {acts.map((act, i) => (
        <button
          key={act.name}
          type="button"
          onClick={() => show(i)}
          aria-label={act.url ? `${act.name}, linked` : act.name}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-hairline bg-paper px-2.5 text-[13px] font-medium transition-colors hover:border-ink-faint"
        >
          {act.name}
          {act.url ? <Icon name="links" size={11} className="text-ink-faint" /> : null}
        </button>
      ))}
      <button
        type="button"
        onClick={() => show(-1)}
        aria-label="Add act"
        className="inline-flex h-7 items-center rounded-lg border border-dashed border-hairline px-2 text-ink-faint transition-colors hover:border-ink-faint hover:text-ink"
      >
        <Icon name="plus" size={12} />
      </button>

      {open !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-6"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}
        >
          <div role="dialog" aria-modal="true" aria-label="Act" className="w-[320px] max-w-full rounded-2xl bg-paper p-5 shadow-2xl">
            <label className="flex flex-col gap-1">
              <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={onEnter}
                className="h-7 border-b border-hairline bg-transparent text-[15px] leading-7 outline-none focus:border-ink"
              />
            </label>
            <label className="mt-3 flex flex-col gap-1">
              <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Website</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={onEnter}
                placeholder="https://"
                className="h-7 border-b border-hairline bg-transparent font-space text-[13px] leading-7 outline-none placeholder:text-ink-faint focus:border-ink"
              />
            </label>
            <div className="mt-5 flex items-center justify-between">
              {open >= 0 ? (
                <button
                  type="button"
                  onClick={remove}
                  className="rounded-md px-1.5 py-1 font-space text-[11px] uppercase tracking-[0.06em] text-accent-red hover:bg-danger-soft"
                >
                  Remove
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={commit} className={buttonClass('ghost')}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
