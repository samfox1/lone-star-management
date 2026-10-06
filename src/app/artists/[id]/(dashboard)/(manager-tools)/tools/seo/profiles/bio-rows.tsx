'use client'

import { useId, useRef, useState } from 'react'
import { bioItem } from '@/lib/manager-tools/seo/profiles/bios'
import { changedWords, dayLabel, type BioRead, type BioRow, type BioState } from '@/lib/manager-tools/seo/profiles/bio-state'
import { leadOf, sentenceOf } from '@/lib/manager-tools/seo/test-model'
import { SAVE_FAILED, shortLink } from '@/lib/manager-tools/format'
import { useSeeded } from '../../../_ui/use-seeded'
import { FieldError } from '../../../_ui/field-error'
import { useNow } from '../_ui/clock'
import { ConnectionMark } from '../../../_ui/connection-mark'
import { markProfileItemAction } from './actions'
import { CardAction, CardActions, CardField, DisclosureGroup, RowMark, SentenceAction, type RowMarkKind } from '../../../_ui/disclosure'
import { OutLink, ProfileCard, ProfileRow, QuietRow, VALUE } from './_ui/profile-row'

/**
 * OUTSIDE BIOS (OUTSIDE_PROFILES_PLAN.md, build step 1, "the change nudge"): one row per bio the
 * artist has on a connected platform (bio-state.ts), read the same way as the rows above it: a
 * mark, the platform's mark and name, the state in Space Mono, a chevron.
 *
 *   ring             not confirmed (never ticked), or ticked over 6 months ago
 *   red ring         the facts changed on a Publish after the tick
 *   check            ticked, nothing changed since
 *
 * A bio the AI test READS itself (YouTube's description, OUTSIDE_PROFILES_PLAN.md step 2) shows
 * that read instead, from the newest run: a check and the test's value when it passes, a red ring
 * and what is missing when it fails. The "updated" tick stays: it is the manual part (the facts
 * the test doesn't look for). With no read (never tested, couldn't check), the row is as above.
 *
 * Opened, a small card: the artist's own profile, WHAT CHANGED (when out of date), when it was
 * last ticked, then a line of bare glyphs: edit it on the platform, and the "updated" tick,
 * which re-confirms (the date moves to now). Tapir never edits a bio itself.
 *
 * `rows` null: the links couldn't be read; one quiet row says so. A row whose state is null
 * couldn't be checked. Dates are written only after mount, in the viewer's time zone (useNow:
 * null on the server), so a server in UTC never prints another day.
 */

/** The row's words. `now` null (on the server, before mount): no dates yet. */
function statusText(row: BioRow, now: number | null): string {
  const day = (iso: string | null) => (iso && now != null ? dayLabel(iso, now) : '')
  switch (row.state) {
    case null:
      return 'couldn’t check'
    case 'unconfirmed':
      return 'not confirmed'
    case 'stale':
      return ['may be out of date', day(row.since)].filter(Boolean).join(' since ')
    case 'recheck':
      return 'check it’s still current'
    case 'current':
      return ['updated', day(row.confirmedAt)].filter(Boolean).join(' ')
  }
}

const MARK: Record<BioState, RowMarkKind> = { current: 'check', stale: 'red-ring', unconfirmed: 'ring', recheck: 'ring' }

function Mark({ state, read }: { state: BioState | null; read: BioRead | null }) {
  const kind = read ? (read.status === 'pass' ? 'check' : 'red-ring') : state === null ? 'dashed' : MARK[state]
  return <RowMark kind={kind} data={{ 'data-bio-mark': state ?? undefined, 'data-bio-read': read?.status }} />
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function BioRowItem({ artistId, row: seeded }: { artistId: string; row: BioRow }) {
  const id = useId()
  const now = useNow(false)
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
      if (r.ok) setRow((x) => ({ ...x, state: 'current', confirmedAt: new Date().toISOString(), since: null, changed: [] }))
      else setError(r.error ?? SAVE_FAILED)
    } catch {
      setError(SAVE_FAILED)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <ProfileRow
      id={id}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      itemData={{ 'data-bio': row.key }}
      mark={
        <>
          <Mark state={row.state} read={row.read} />
          <ConnectionMark def={row.def} size={15} className="flex-none text-ink" />
        </>
      }
      name={row.label}
      status={row.read ? row.read.value : statusText(row, now)}
      bad={row.read ? row.read.status === 'fail' : row.state === 'stale'}
    >
      <ProfileCard id={id}>
        {row.url ? (
          <CardField label="Profile">
            {/* Edit sits right after the link it edits, and shows only while the pointer is on that
                line (Sam, 2026-10-02): the field is the pencil's EDIT_TARGET (_ui/styles.ts). */}
            <OutLink href={row.url}>{shortLink(row.url)}</OutLink>
            <SentenceAction icon="edit" label={`Edit on ${row.label}`} href={row.edit} link="external" />
          </CardField>
        ) : null}
        {row.read ? (
          <CardField label="AI test">
            <span className={VALUE}>{[leadOf(row.read), sentenceOf(row.read)].filter(Boolean).join(' ')}</span>
          </CardField>
        ) : null}
        {row.state === 'stale' && row.changed.length ? (
          <CardField label="What changed">
            <span className={VALUE}>{[capital(changedWords(row.changed)), row.since && now != null ? dayLabel(row.since, now) : ''].filter(Boolean).join(' · ')}</span>
          </CardField>
        ) : null}
        {row.confirmedAt && now != null ? (
          <CardField label="Updated">
            <span className={VALUE}>{dayLabel(row.confirmedAt, now)}</span>
          </CardField>
        ) : null}
        <CardActions>
          {row.url ? null : <CardAction icon="edit" label={`Edit on ${row.label}`} href={row.edit} link="external" />}
          <CardAction icon="check" label="Mark as updated" onClick={() => void tick()} disabled={busy} className="ml-auto" />
          {error ? <FieldError>{error}</FieldError> : null}
        </CardActions>
      </ProfileCard>
    </ProfileRow>
  )
}

/** The group: its label, then one row per bio. Nothing at all when the artist has none. */
export function BioRows({ artistId, rows }: { artistId: string; rows: BioRow[] | null }) {
  if (rows && rows.length === 0) return null
  return (
    // mt-[22px] + the group's own 26px: 48px under the line above, as before.
    <section aria-label="Outside bios" className="mt-[22px]">
      <DisclosureGroup title="Outside bios">
        {rows ? rows.map((row) => <BioRowItem key={row.key} artistId={artistId} row={row} />) : <QuietRow name="Bios" status="couldn’t check" />}
      </DisclosureGroup>
    </section>
  )
}
