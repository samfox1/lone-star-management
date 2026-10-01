'use client'

import { useId, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { bioItem } from '@/lib/manager-tools/profiles/bios'
import { changedWords, type BioRow, type BioState, type FactsChange } from '@/lib/manager-tools/profiles/bio-state'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { useSeeded } from '../../../_ui/use-seeded'
import { ConnectionMark } from '../../../connections/connection-mark'
import { markProfileItemAction } from './actions'
import { Field, GLYPH, Glyph, LABEL, ROW } from './profiles-tab'

/**
 * OUTSIDE BIOS (OUTSIDE_PROFILES_PLAN.md, build step 1, "the change nudge"): one row per bio the
 * artist has on a connected platform (bio-state.ts), read the same way as the rows above it: a
 * round mark, the platform's mark and name, the state in Space Mono, a chevron.
 *
 *   ring             not confirmed (never ticked), or ticked over 6 months ago
 *   red ring         the facts changed on a Publish after the tick
 *   check            ticked, nothing changed since
 *
 * Opened, a small card: the artist's own profile, WHAT CHANGED (when out of date), when it was
 * last ticked, then bare glyphs: edit it on the platform, and the "updated" tick, which
 * re-confirms (the date moves to now). Tapir never edits a bio itself.
 *
 * `rows` null: the links couldn't be read; one quiet row says so. A row whose state is null
 * couldn't be checked.
 */

const VALUE = 'text-[13.5px] leading-[1.6]'
const LINK = cx('break-all border-b border-hairline font-space text-[13px] leading-[1.7] text-ink hover:text-accent', FOCUS_RING)

/** "Sep 29", in the manager's own time zone (rendered again in the browser). */
function day(iso: string, withYear = false): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

function statusText(row: BioRow, change: FactsChange | null): string {
  switch (row.state) {
    case null:
      return 'couldn’t check'
    case 'unconfirmed':
      return 'not confirmed'
    case 'stale':
      return change ? `may be out of date since ${day(change.at)}` : 'may be out of date'
    case 'recheck':
      return 'check it’s still current'
    case 'current':
      return row.confirmedAt ? `updated ${day(row.confirmedAt)}` : 'updated'
  }
}

function Mark({ state }: { state: BioState | null }) {
  if (state === null) return <span aria-hidden="true" className="h-4 w-4 flex-none rounded-full border-[1.5px] border-dashed border-ink-faint" />
  return (
    <span
      aria-hidden="true"
      data-bio-mark={state}
      className={cx(
        'flex h-4 w-4 flex-none items-center justify-center rounded-full border-[1.5px]',
        state === 'current' ? 'border-ink bg-ink text-paper' : state === 'stale' ? 'border-accent-red' : 'border-ink',
      )}
    >
      {state === 'current' ? <Icon name="check" size={10} /> : null}
    </span>
  )
}

function short(url: string): string {
  return url.replace(/^https:\/\/(www\.)?/, '')
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function BioRowItem({ artistId, row: seeded, change }: { artistId: string; row: BioRow; change: FactsChange | null }) {
  const cardId = useId()
  const [open, setOpen] = useState(false)
  const [row, setRow] = useSeeded(seeded)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  async function tick() {
    // The latch is a ref (AGENTS.md rule 5): two fast clicks both read the pre-render state.
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const r = await markProfileItemAction(artistId, bioItem(row.key), true)
      if (r.ok) setRow((x) => ({ ...x, state: 'current', confirmedAt: new Date().toISOString() }))
      else setError(r.error ?? 'Couldn’t save that.')
    } catch {
      setError('Couldn’t save that.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div data-bio={row.key}>
      <button type="button" aria-expanded={open} aria-controls={cardId} onClick={() => setOpen((o) => !o)} className={cx(ROW, 'transition-colors hover:bg-surface-hover', FOCUS_RING, 'focus-visible:-outline-offset-2')}>
        <Mark state={row.state} />
        <ConnectionMark def={row.def} size={15} className="flex-none text-ink" />
        <span className="flex-1 text-[15px]">{row.label}</span>
        <span className={cx('text-right font-space text-[12px]', row.state === 'stale' ? 'text-accent-red' : 'text-ink-muted')} suppressHydrationWarning>
          {statusText(row, change)}
        </span>
        <Icon name="chevronRight" size={16} className={cx('flex-none text-ink-faint transition-transform', open && 'rotate-90 text-ink')} />
      </button>
      {open ? (
        <div id={cardId} className="mb-[18px] mt-1.5 rounded-[14px] border border-hairline bg-paper px-6 py-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {row.url ? (
            <Field label="Profile">
              <a href={row.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                {short(row.url)}
              </a>
            </Field>
          ) : null}
          {row.state === 'stale' && change ? (
            <Field label="What changed">
              <span className={VALUE} suppressHydrationWarning>
                {[capital(changedWords(change.fields)), day(change.at)].filter(Boolean).join(' · ')}
              </span>
            </Field>
          ) : null}
          {row.confirmedAt ? (
            <Field label="Updated">
              <span className={VALUE} suppressHydrationWarning>
                {day(row.confirmedAt, true)}
              </span>
            </Field>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-4 border-t border-hairline-soft pt-4">
            <a href={row.edit} target="_blank" rel="noopener noreferrer" aria-label={`Edit on ${row.label}`} className={GLYPH}>
              <Glyph icon="edit" label={`Edit on ${row.label}`} />
            </a>
            <button type="button" aria-label="Mark as updated" onClick={() => void tick()} disabled={busy} className={cx(GLYPH, 'ml-auto')}>
              <Glyph icon="check" label="Mark as updated" />
            </button>
            {error ? (
              <span role="alert" className="font-space text-[11px] text-accent-red">
                {error}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** The group: its label, then one row per bio. Nothing at all when the artist has none. */
export function BioRows({ artistId, rows, change }: { artistId: string; rows: BioRow[] | null; change: FactsChange | null }) {
  if (rows && rows.length === 0) return null
  return (
    <section aria-label="Outside bios" className="mt-12">
      <div className={LABEL}>Outside bios</div>
      <div className="mt-3.5 border-t border-hairline">
        {rows ? (
          rows.map((row) => <BioRowItem key={row.key} artistId={artistId} row={row} change={change} />)
        ) : (
          <div className={cx(ROW, 'text-ink-muted')}>
            <span aria-hidden="true" className="h-4 w-4 flex-none rounded-full border-[1.5px] border-dashed border-ink-faint" />
            <span className="flex-1 text-[15px] text-ink">Bios</span>
            <span className="font-space text-[12px]">couldn’t check</span>
          </div>
        )}
      </div>
    </section>
  )
}
