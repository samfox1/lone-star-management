'use client'

import { useId, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import type { DiscogsCheck, OutsideChecks, WikidataCheck } from '@/lib/manager-tools/seo/profiles/outside'
import { shortLink } from '@/lib/manager-tools/format'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { CardField, RowMark, SentenceAction } from '../../../_ui/disclosure'
import { OutLink, ProfileCard, ProfileRow, QuietRow, VALUE } from './_ui/profile-row'

/**
 * The Profiles tab's Discogs and Wikidata rows (lib/manager-tools/seo/profiles/outside.ts), read
 * live: a round mark (a check when all is well, a ring when something is missing or it's only
 * news), the status in Space Mono, a chevron. Each opens a small card: what we found, the link,
 * and the one thing to do, its action a bare glyph at the end of that sentence (or after the
 * link when there is nothing to do), as the AI test's cards end theirs. `checks` null = still
 * asking (the page streams them in).
 *
 * Tapir never edits either service: every action happens there, by the artist.
 */

/** One row. No `children`: a quiet row with nothing to open (still checking, no site). `note`: a
 *  small link under the status, outside the button (a link can't sit inside one). */
function Row({ name, ok, status, note, children }: { name: string; ok: boolean | null; status: string; note?: ReactNode; children?: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (!children) return <QuietRow name={name} status={status} />
  return (
    <ProfileRow id={id} open={open} onToggle={() => setOpen((o) => !o)} mark={<RowMark kind={ok ? 'check' : 'ring'} />} name={name} status={status} note={note}>
      <ProfileCard id={id}>{children}</ProfileCard>
    </ProfileRow>
  )
}

function ToConnections({ artistId }: { artistId: string }) {
  return <SentenceAction icon="plug" label="Open Connections" href={`/artists/${artistId}/connections`} link="app" />
}

/** No site to look for: nothing was asked, and there is nothing to open. */
const NO_SITE = 'no site'

const DISCOGS_STATUS: Record<Exclude<DiscogsCheck['kind'], 'nosite'>, string> = {
  listed: 'lists your site',
  missing: 'site missing',
  unlinked: 'no page linked',
  gone: 'page not found',
  unknown: 'couldn’t check',
}

const DISCOGS_NEXT: Record<Exclude<DiscogsCheck['kind'], 'nosite'>, string | null> = {
  listed: null,
  missing: 'Add your site under Sites on Discogs.',
  unlinked: 'Link your Discogs artist page in Connections.',
  gone: 'Check the Discogs link in Connections.',
  unknown: 'Discogs didn’t answer. Try again later.',
}

/** Discogs' terms: what we show from its API carries this link beside it, open or closed. */
function DiscogsCredit() {
  return (
    <a href="https://www.discogs.com/" target="_blank" rel="noopener noreferrer" className={cx('font-space text-[10px] text-ink-faint hover:text-ink', FOCUS_RING)}>
      Data provided by Discogs
    </a>
  )
}

export function DiscogsRow({ artistId, check }: { artistId: string; check: DiscogsCheck }) {
  if (check.kind === 'nosite') return <Row name="Discogs" ok={null} status={NO_SITE} />
  const url = check.kind === 'unlinked' ? null : check.url
  const next = DISCOGS_NEXT[check.kind]
  const fromDiscogs = check.kind === 'listed' || check.kind === 'missing' || check.kind === 'gone'
  const action =
    check.kind === 'unlinked' || check.kind === 'gone' ? (
      <ToConnections artistId={artistId} />
    ) : url ? (
      <SentenceAction icon="external" label="Open on Discogs" href={url} link="external" />
    ) : null
  return (
    <Row name="Discogs" ok={check.kind === 'listed'} status={DISCOGS_STATUS[check.kind]} note={fromDiscogs ? <DiscogsCredit /> : null}>
      <CardField label="Page">
        {url ? <OutLink href={url}>{shortLink(url)}</OutLink> : <span className={VALUE}>None linked</span>}
        {next ? null : action}
      </CardField>
      {check.kind === 'listed' || check.kind === 'missing' ? (
        <CardField label="Your site">
          <span className={VALUE}>{check.kind === 'listed' ? 'Listed' : 'Not listed'}</span>
        </CardField>
      ) : null}
      {next ? (
        <CardField label="Next">
          <span className={VALUE}>{next}</span>
          {action}
        </CardField>
      ) : null}
    </Row>
  )
}

/** `hasSite` null (no site to look for) counts as nothing missing: only the ID is asked about. */
function wikidataStatus(check: Exclude<WikidataCheck, { kind: 'nosite' }>): string {
  if (check.kind === 'none') return 'no item yet'
  if (check.kind === 'unknown') return 'couldn’t check'
  const site = check.hasSite !== false
  if (site && check.hasMbid) return 'item found'
  if (!site && !check.hasMbid) return 'site, ID missing'
  return site ? 'MusicBrainz ID missing' : 'site missing'
}

export function WikidataRow({ check }: { check: WikidataCheck }) {
  if (check.kind === 'nosite') return <Row name="Wikidata" ok={null} status={NO_SITE} />
  const found = check.kind === 'found' ? check : null
  const complete = !!found && found.hasSite !== false && found.hasMbid
  const open = found ? <SentenceAction icon="external" label="Open on Wikidata" href={found.url} link="external" /> : null
  const next =
    check.kind === 'none'
      ? 'Wikidata needs press first; then the artist can create an item.'
      : check.kind === 'unknown'
        ? 'Wikidata didn’t answer. Try again later.'
        : found && !complete
          ? 'Add what’s missing on Wikidata, with a source.'
          : null
  return (
    <Row name="Wikidata" ok={complete} status={wikidataStatus(check)}>
      <CardField label="Item">
        {found ? <OutLink href={found.url}>{shortLink(found.url)}</OutLink> : <span className={VALUE}>{check.kind === 'none' ? 'None yet' : '—'}</span>}
        {found && !next ? open : null}
      </CardField>
      {found ? (
        <>
          {found.hasSite !== null ? (
            <CardField label="Your site">
              <span className={VALUE}>{found.hasSite ? 'Listed' : 'Missing'}</span>
            </CardField>
          ) : null}
          <CardField label="MusicBrainz">
            <span className={VALUE}>{found.hasMbid ? 'Listed' : 'Missing'}</span>
          </CardField>
        </>
      ) : null}
      {next ? (
        <CardField label="Next">
          <span className={VALUE}>{next}</span>
          {found ? open : null}
        </CardField>
      ) : null}
    </Row>
  )
}

/** Both rows; `checks` null while the page is still asking. */
export function OutsideRows({ artistId, checks }: { artistId: string; checks: OutsideChecks | null }) {
  if (!checks) {
    return (
      <>
        <Row name="Discogs" ok={null} status="checking" />
        <Row name="Wikidata" ok={null} status="checking" />
      </>
    )
  }
  return (
    <>
      <DiscogsRow artistId={artistId} check={checks.discogs} />
      <WikidataRow check={checks.wikidata} />
    </>
  )
}
