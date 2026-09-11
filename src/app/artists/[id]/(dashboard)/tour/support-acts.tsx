'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import type { SupportAct } from '@/lib/content'
import { setSupportActsAction } from '../actions'
import { toast } from '../toast'

/**
 * A tour date's lineup as CHIPS (prototype G, Sam, 2026-09-11). A chip is an act; one
 * with a website wears the link mark. Click a chip for a small popover — name, website,
 * Remove — and the dashed '+' chip opens the same popover empty to add one. The site
 * itself is never shown on the row: it is there when you need to fix it, and not before.
 *
 * SELF-SAVING when the date exists: every add / edit / remove sends the WHOLE lineup
 * through one action, optimistic first, reverted (with the server's message) if refused.
 * Without a `tourDateId` (the Add card, before the row exists) it only reports the
 * lineup through `onChange`; the card writes it once the row has an id. Enter inside the
 * popover commits and never submits a form around it. Draft until Publish.
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
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node))
        setOpen(null)
    }
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) =>
      e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
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
    setActs(next); // optimistic
    const res = await setSupportActsAction(artistId, tourDateId, next)
    if (res.error) {
      setActs(prev)
      toast(res.error, 'error')
      return false
    }
    if (res.acts) setActs(res.acts); // as stored: trimmed, deduped, URLs normalised
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
    const next =
      open < 0 ? [...acts, act] : acts.map((a, i) => (i === open ? act : a))
    if (await save(next)) setOpen(null)
  }

  async function remove() {
    if (open === null || open < 0) return
    if (await save(acts.filter((_, i) => i !== open))) setOpen(null)
  }

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault(); // the popover sits inside the date's card, never submit it
    void commit()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {acts.map((act, i) => (
          <button
            key={act.name}
            type="button"
            onClick={() => show(i)}
            aria-label={act.url ? `${act.name}, linked` : act.name}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-paper px-2.5 py-1 text-[13px] font-medium transition-colors hover:border-ink-faint"
          >
            {act.name}
            {act.url ? (
              <Icon name='links' size={11} className="text-ink-faint" />
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => show(-1)}
          aria-label="Add act"
          className="inline-flex items-center rounded-lg border border-dashed border-hairline px-2 py-1 text-[13px] text-ink-faint transition-colors hover:border-ink-faint hover:text-ink"
        >
          <Icon name='plus' size={12} />
        </button>
      </div>

      {/* In the row's flow, not floated: the card scrolls (overflow-auto), so a floated
          panel would be clipped at its edge. It opens under the chips and pushes the
          rows below it down for as long as it is open. */}
      {open !== null && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Act"
          className="w-full max-w-[320px] rounded-xl border border-hairline bg-paper p-4 shadow-lg"
        >
          <label className="flex flex-col gap-1">
            <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Name
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onEnter}
              className="border-b border-hairline bg-transparent py-1 text-sm outline-none focus:border-ink"
            />
          </label>
          <label className="mt-3 flex flex-col gap-1">
            <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Website
            </span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={onEnter}
              placeholder="https://"
              className="border-b border-hairline bg-transparent py-1 font-space text-xs outline-none placeholder:text-ink-faint focus:border-ink"
            />
          </label>
          <div className="mt-4 flex items-center justify-between">
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
            <button
              type="button"
              onClick={commit}
              className={buttonClass('ghost')}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
