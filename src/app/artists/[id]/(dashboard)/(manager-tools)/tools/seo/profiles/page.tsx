import { Suspense } from 'react'
import { readProfileMarks } from '@/lib/manager-tools/profiles/marks'
import { loadSeoBase } from '../load'
import { loadBioPack } from './load'
import { loadOutsideChecks } from './outside-load'
import { OutsideRows } from './outside-rows'
import { ProfilesTab } from './profiles-tab'

type Base = Awaited<ReturnType<typeof loadSeoBase>>

/**
 * PROFILES: the artist's profiles on other services (Sam, 2026-09-30). The Apple Music & Amazon
 * bio email (profiles-tab.tsx), then the live Discogs and Wikidata checks (outside-rows.tsx); the
 * rest are still to come.
 *
 * Every read is RLS-scoped and runs after loadSeoBase's ownership gate. The marks are read
 * apart: if that read fails, the row says nothing rather than "not sent" (marks.ts). The two
 * checks ask outside services, so they stream in behind their own boundary and never hold up
 * the bio card.
 */
export default async function SeoProfilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base = await loadSeoBase(id)
  const [{ input, photos }, marks] = await Promise.all([loadBioPack(base), readProfileMarks(base.supabase, id).catch(() => null)])
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
    />
  )
}

async function OutsideLive({ base, links }: { base: Base; links: readonly { url?: string | null }[] }) {
  return <OutsideRows artistId={base.artist.id as string} checks={await loadOutsideChecks(base, links)} />
}
