import { Suspense } from 'react'
import { bioRows } from '@/lib/manager-tools/seo/profiles/bio-state'
import { readProfileMarks } from '@/lib/manager-tools/seo/profiles/marks'
import { loadSeoBase } from '../load'
import { BioRows } from './bio-rows'
import { loadOutsideBios } from './bios-load'
import { loadBioPack } from './load'
import { loadOutsideChecks } from './outside-load'
import { OutsideRows } from './outside-rows'
import { ProfilesTab } from './profiles-tab'

type Base = Awaited<ReturnType<typeof loadSeoBase>>

/**
 * PROFILES: the artist's profiles on other services (Sam, 2026-09-30). The Apple Music & Amazon
 * bio email (profiles-tab.tsx), then the live Discogs and Wikidata checks (outside-rows.tsx); the
 * rest are still to come. Under them, the Outside bios (bio-rows.tsx): which bios may be out of
 * date since the artist's facts last changed on Publish.
 *
 * Every read is RLS-scoped and runs after loadSeoBase's ownership gate. The marks are read
 * apart: if that read fails, the row says nothing rather than "not sent" (marks.ts). The two
 * checks ask outside services, so they stream in behind their own boundary and never hold up
 * the bio card.
 */
export default async function SeoProfilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  // Read once: the AllMusic row and the Outside bios both use it.
  const marksRead = readProfileMarks(base.supabase, id).catch(() => null)
  const [{ input, photos }, marks, bios] = await Promise.all([loadBioPack(base), marksRead, loadOutsideBios(base.supabase, base.artist, marksRead)])
  return (
    <ProfilesTab
      artistId={id}
      input={input}
      photos={photos}
      sentAt={marks?.allmusic_bio ?? null}
      marksOk={marks !== null}
      outside={
        <Suspense fallback={<OutsideRows artistId={id} checks={null} />}>
          <OutsideLive base={base} links={input.links ?? []} />
        </Suspense>
      }
      bios={<BioRows artistId={id} rows={bioRows(bios, new Date())} />}
    />
  )
}

async function OutsideLive({ base, links }: { base: Base; links: readonly { url?: string | null }[] }) {
  return <OutsideRows artistId={base.artist.id as string} checks={await loadOutsideChecks(base, links)} />
}
