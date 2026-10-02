'use client'

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import type { DiscogsCheck, OutsideChecks, WikidataCheck } from '@/lib/manager-tools/seo/profiles/outside'
import { FOCUS_RING } from '../../../_ui/focus-ring'
import { Field, GLYPH, Glyph, ROW } from './profiles-tab'

/**
 * The Profiles tab's Discogs and Wikidata rows (lib/manager-tools/seo/profiles/outside.ts), read
 * live: a round mark (a check when all is well, a ring when something is missing or it's only
 * news), the status in Space Mono, a chevron. Each opens a small card: what we found, the link,
 * and the one thing to do. `checks` null = still asking (the page streams them in).
 *
 * Tapir never edits either service: every action happens there, by the artist.
 */

const LINK = cx('break-all border-b border-hairline font-space text-[13px] leading-[1.7] text-ink hover:text-accent', FOCUS_RING)
const VALUE = 'text-[13.5px] leading-[1.6]'

function short(url: string): string {
  return url.replace(/^https:\/\/(www\.)?/, '')
}

/** One row. No `children`: a quiet row with nothing to open (still checking, no site). `note`: a
 *  small link under the status, outside the button (a link can't sit inside one). */
function Row({ name, ok, status, note, children }: { name: string; ok: boolean | null; status: string; note?: ReactNode; children?: ReactNode }) {
  const cardId = useId()
  const [open, setOpen] = useState(false)
  if (!children) {
    return (
      <div className={cx(ROW, 'text-ink-muted')}>
        <span aria-hidden="true" className="h-4 w-4 flex-none rounded-full border-[1.5px] border-dashed border-ink-faint" />
        <span className="flex-1 text-[15px] text-ink">{name}</span>
        <span className="font-space text-[12px]">{status}</span>
      </div>
    )
  }
  return (
    <>
      <div className="relative">
        <button type="button" aria-expanded={open} aria-controls={cardId} onClick={() => setOpen((o) => !o)} className={cx(ROW, 'transition-colors hover:bg-surface-hover', FOCUS_RING, 'focus-visible:-outline-offset-2')}>
          <span aria-hidden="true" className={cx('flex h-4 w-4 flex-none items-center justify-center rounded-full border-[1.5px] border-ink', ok && 'bg-ink text-paper')}>
            {ok ? <Icon name="check" size={10} /> : null}
          </span>
          <span className="flex-1 text-[15px]">{name}</span>
          <span className="font-space text-[12px] text-ink-muted">{status}</span>
          <Icon name="chevronRight" size={16} className={cx('flex-none text-ink-faint transition-transform', open && 'rotate-90 text-ink')} />
        </button>
        {note ? <span className="absolute bottom-1 right-10 leading-none">{note}</span> : null}
      </div>
      {open ? (
        <div id={cardId} className="mb-[18px] mt-1.5 rounded-[14px] border border-hairline bg-paper px-6 py-[22px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {children}
        </div>
      ) : null}
    </>
  )
}

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {children}
    </a>
  )
}

function Glyphs({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex flex-wrap items-center gap-4 border-t border-hairline-soft pt-4">{children}</div>
}

function ToConnections({ artistId }: { artistId: string }) {
  return (
    <Link href={`/artists/${artistId}/connections`} aria-label="Open Connections" className={GLYPH}>
      <Glyph icon="plug" label="Open Connections" />
    </Link>
  )
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
  return (
    <Row name="Discogs" ok={check.kind === 'listed'} status={DISCOGS_STATUS[check.kind]} note={fromDiscogs ? <DiscogsCredit /> : null}>
      <Field label="Page">{url ? <Out href={url}>{short(url)}</Out> : <span className={VALUE}>None linked</span>}</Field>
      {check.kind === 'listed' || check.kind === 'missing' ? (
        <Field label="Your site">
          <span className={VALUE}>{check.kind === 'listed' ? 'Listed' : 'Not listed'}</span>
        </Field>
      ) : null}
      {next ? (
        <Field label="Next">
          <span className={VALUE}>{next}</span>
        </Field>
      ) : null}
      <Glyphs>
        {url && check.kind !== 'gone' ? (
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open on Discogs" className={GLYPH}>
            <Glyph icon="external" label="Open on Discogs" />
          </a>
        ) : null}
        {check.kind === 'unlinked' || check.kind === 'gone' ? <ToConnections artistId={artistId} /> : null}
      </Glyphs>
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
      <Field label="Item">{found ? <Out href={found.url}>{short(found.url)}</Out> : <span className={VALUE}>{check.kind === 'none' ? 'None yet' : '—'}</span>}</Field>
      {found ? (
        <>
          {found.hasSite !== null ? (
            <Field label="Your site">
              <span className={VALUE}>{found.hasSite ? 'Listed' : 'Missing'}</span>
            </Field>
          ) : null}
          <Field label="MusicBrainz">
            <span className={VALUE}>{found.hasMbid ? 'Listed' : 'Missing'}</span>
          </Field>
        </>
      ) : null}
      {next ? (
        <Field label="Next">
          <span className={VALUE}>{next}</span>
        </Field>
      ) : null}
      {found ? (
        <Glyphs>
          <a href={found.url} target="_blank" rel="noopener noreferrer" aria-label="Open on Wikidata" className={GLYPH}>
            <Glyph icon="external" label="Open on Wikidata" />
          </a>
        </Glyphs>
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
