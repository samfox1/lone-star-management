'use client'

import { useId, useState } from 'react'
import { cx } from '@/lib/cx'
import type { DatabasePage, ProfileLink } from '@/lib/manager-tools/seo/profiles/connected'
import { shortLink } from '@/lib/manager-tools/format'
import { CardField, RowMark, SentenceAction } from '../_ui/disclosure'
import { PlatformMark } from '../_ui/mark'
import { OutLink, ProfileCard, ProfileRow, VALUE } from './_ui/profile-row'

/**
 * THE CONNECTED PROFILES AND MUSICBRAINZ (moved from the SEO / GEO Facts tab's Profiles section,
 * 2026-10-02, when Facts became the Profile tool). Discogs and Wikidata were there too; their
 * live rows here (outside-rows.tsx) already cover them, so only these two moved, redrawn in this
 * tab's row and card (profile-row.tsx):
 *
 *   Connected profiles   how many the site's fact card lists, each platform's mark; Connections
 *   MusicBrainz          what is linked, or its own artist editor filled in
 */

function ToConnections({ artistId }: { artistId: string }) {
  return <SentenceAction icon="plug" label="Open Connections" href={`/artists/${artistId}/connections`} link="app" />
}

/** The platforms as their marks, the ones the fact card leaves out faint. */
function Marks({ profiles }: { profiles: readonly ProfileLink[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2.5 align-middle text-ink" aria-label="Connected profiles">
      {profiles.map((l) => (
        <span key={l.slug} title={l.label} className={cx('inline-flex', !l.inFactCard && 'text-ink-faint')}>
          <PlatformMark slug={l.slug} />
          <span className="sr-only">{l.label}</span>
        </span>
      ))}
    </span>
  )
}

export function ConnectedRow({ artistId, profiles }: { artistId: string; profiles: readonly ProfileLink[] }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const shown = profiles.filter((l) => l.inFactCard)
  const left = profiles.filter((l) => !l.inFactCard)
  return (
    <ProfileRow
      id={id}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      itemData={{ 'data-connected': '' }}
      mark={<RowMark kind={profiles.length ? 'check' : 'ring'} />}
      name="Connected profiles"
      status={profiles.length ? `${shown.length} of ${profiles.length} shown to search engines` : 'none yet'}
    >
      <ProfileCard id={id}>
        {shown.length ? (
          <CardField label="Shown">
            <Marks profiles={shown} />
          </CardField>
        ) : null}
        {left.length ? (
          <CardField label="Not shown">
            <Marks profiles={left} />
          </CardField>
        ) : null}
        <CardField label="Next">
          <span className={VALUE}>{profiles.length ? 'Add or change them in Connections.' : 'Connect your profiles in Connections.'}</span>
          <ToConnections artistId={artistId} />
        </CardField>
      </ProfileCard>
    </ProfileRow>
  )
}

/** `page`: the linked MusicBrainz page, or undefined. `create`: MusicBrainz's own artist editor,
 *  filled in (connections/services/musicbrainz/seed.ts). */
export function MusicBrainzRow({ artistId, page, create }: { artistId: string; page?: DatabasePage; create: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <ProfileRow
      id={id}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      itemData={{ 'data-musicbrainz': '' }}
      mark={<RowMark kind={page ? 'check' : 'ring'} />}
      name="MusicBrainz"
      status={page ? 'page linked' : 'no page yet'}
    >
      <ProfileCard id={id}>
        <CardField label="Page">
          {page ? <OutLink href={page.url}>{shortLink(page.url)}</OutLink> : <span className={VALUE}>None linked</span>}
          {page ? <ToConnections artistId={artistId} /> : null}
        </CardField>
        {page ? null : (
          <CardField label="Next">
            <span className={VALUE}>Create the page on MusicBrainz, then link it in Connections.</span>
            <SentenceAction icon="external" label="Create the page" href={create} link="external" />
          </CardField>
        )}
      </ProfileCard>
    </ProfileRow>
  )
}
