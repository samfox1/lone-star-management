import { Suspense } from 'react'
import { listContent } from '@/lib/content'
import { bioRows } from '@/lib/manager-tools/seo/profiles/bio-state'
import { readProfileMarks } from '@/lib/manager-tools/seo/profiles/marks'
import { loadSeoBase } from '../load'
import { BioRows } from './bio-rows'
import { loadConnected } from './connected-load'
import { ConnectedRow, MusicBrainzRow } from './connected-rows'
import { loadOutsideBios } from './bios-load'
import { loadBioPack } from './load'
import { loadOutsideChecks } from './outside-load'
import { OutsideRows } from './outside-rows'
import { ProfilesTab } from './profiles-tab'

type Base = Awaited<ReturnType<typeof loadSeoBase>>

/**
 * PROFILES: the artist's profiles on other services (Sam, 2026-09-30). The Apple Music & Amazon
 * bio email (profiles-tab.tsx), the connected profiles and MusicBrainz (connected-rows.tsx, from
 * the old Facts tab, 2026-10-02), then the live Discogs and Wikidata checks (outside-rows.tsx); the
 * rest are still to come. Under them, the Outside bios (bio-rows.tsx): which bios may be out of
 * date since the artist's facts last changed on Publish.
 *
 * Every read is RLS-scoped and runs after loadSeoBase's ownership gate. The marks are read
 * apart: if that read fails, the row says nothing rather than "not sent" (marks.ts). The two
 * checks ask outside services, so they stream in behind their own boundary and never hold up
 * the bio card; the newest AI test run they need was already read for the Outside bios.
 */
export default async function SeoProfilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  // Each read once: the marks (the AllMusic row and the Outside bios) and the links (the bio
  // email, the Connected rows and the Outside bios; it was three reads of one table).
  const marksRead = readProfileMarks(base.supabase, id).catch(() => null)
  const linksRead = listContent(base.supabase, 'link', id)
  const [{ input, photos }, marks, bios, connected] = await Promise.all([
    loadBioPack(base, linksRead),
    marksRead,
    loadOutsideBios(base.supabase, base.artist, { marks: marksRead, links: linksRead }),
    loadConnected(base, linksRead),
  ])
  return (
    <ProfilesTab
      artistId={id}
      input={input}
      photos={photos}
      sentAt={marks?.allmusic_bio ?? null}
      marksOk={marks !== null}
      outside={
        <>
          <ConnectedRow artistId={id} profiles={connected.profiles} />
          <MusicBrainzRow artistId={id} page={connected.musicbrainz} create={connected.musicBrainzCreate} />
          <Suspense fallback={<OutsideRows artistId={id} checks={null} />}>
            <OutsideLive base={base} links={input.links ?? []} results={bios.results ?? null} />
          </Suspense>
        </>
      }
      bios={<BioRows artistId={id} rows={bioRows(bios, new Date())} />}
    />
  )
}

async function OutsideLive({ base, links, results }: { base: Base; links: readonly { url?: string | null }[]; results: unknown }) {
  return <OutsideRows artistId={base.artist.id as string} checks={await loadOutsideChecks(base, links, results)} />
}
