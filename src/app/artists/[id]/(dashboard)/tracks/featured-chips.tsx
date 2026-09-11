'use client'

import { useEffect, useState, type KeyboardEvent } from 'react'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { setTrackFeaturedAction } from '../actions'
import { toast } from '../toast'

/**
 * A song's collaborators as CHIPS — the Featuring row of the song modal (Sam, 2026-09-11:
 * "where do we put collaborators?"). Same shape as a tour date's lineup: a chip is a name,
 * click it for a small dialog over the card (rename, Remove), "+" opens the same dialog
 * empty. Every change sends the WHOLE list through one action, optimistic first, reverted
 * with the server's message if refused. Enter in the dialog commits and never submits a
 * form around it. Draft until Publish; the site prints them as "feat. …".
 */
export function FeaturedChips({ artistId, trackId, names: initial }: { artistId: string; trackId: string; names: string[] }) {
  const [names, setNames] = useState(initial)
  /** Which chip is open: an index, `-1` for the add chip, or null. */
  const [open, setOpen] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open === null) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation() // the dialog closes; the card under it stays open
      setOpen(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  function show(at: number | null) {
    setDraft(at !== null && at >= 0 ? names[at] : '')
    setOpen(at)
  }

  async function save(next: string[]): Promise<boolean> {
    const prev = names
    setNames(next) // optimistic
    const res = await setTrackFeaturedAction(trackId, artistId, next)
    if (res.error) {
      setNames(prev)
      toast(res.error, 'error')
      return false
    }
    if (res.names) setNames(res.names) // as stored: trimmed, deduped
    return true
  }

  async function commit() {
    if (open === null) return
    const n = draft.trim()
    if (!n) {
      setOpen(null)
      return
    }
    const next = open < 0 ? [...names, n] : names.map((a, i) => (i === open ? n : a))
    if (await save(next)) setOpen(null)
  }

  async function remove() {
    if (open === null || open < 0) return
    if (await save(names.filter((_, i) => i !== open))) setOpen(null)
  }

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    void commit()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {names.map((name, i) => (
        <button
          key={name}
          type="button"
          onClick={() => show(i)}
          aria-label={name}
          className="inline-flex h-7 items-center rounded-lg border border-hairline bg-paper px-2.5 text-[13px] font-medium transition-colors hover:border-ink-faint"
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        onClick={() => show(-1)}
        aria-label="Add collaborator"
        className="inline-flex h-7 items-center rounded-lg border border-dashed border-hairline px-2 text-ink-faint transition-colors hover:border-ink-faint hover:text-ink"
      >
        <Icon name="plus" size={12} />
      </button>

      {open !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-6"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}
        >
          <div role="dialog" aria-modal="true" aria-label="Collaborator" className="w-[320px] max-w-full rounded-2xl bg-paper p-5 shadow-2xl">
            <label className="flex flex-col gap-1">
              <span className="font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint">Name</span>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onEnter}
                className="h-7 border-b border-hairline bg-transparent text-[15px] leading-7 outline-none focus:border-ink"
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
