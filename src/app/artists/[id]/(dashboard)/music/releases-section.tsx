import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { toReleaseType } from '@/lib/releases'
import { requireArtist } from '../_data'
import { addReleaseAction, publishSectionAction } from '../actions'
import { type ReleaseLink } from '../releases/release-card'
import { ReleasesBrowser } from './releases-browser'

/**
 * Releases view for the Music tab: each release gets a public smart-link page
 * (/[slug]/r/[release]) with its DSP buttons. Server fetches the full list; the
 * client ReleasesBrowser handles the type filter + sort + cover grid.
 */
export async function ReleasesSection({ id }: { id: string }) {
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [rows, trackRows] = await Promise.all([
    listContent(supabase, 'release', id),
    listContent(supabase, 'track', id),
  ])

  // Tracks assigned to each release — the umbrella count shown on the card.
  const counts = new Map<string, number>()
  for (const t of trackRows) {
    const rid = t.release_id as string | null
    if (rid) counts.set(rid, (counts.get(rid) ?? 0) + 1)
  }

  const releases = rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    slug: row.slug as string,
    cover_url: (row.cover_url as string | null) ?? null,
    release_date: (row.release_date as string | null) ?? null,
    release_type: toReleaseType(row.release_type as string | null),
    links: (row.links as ReleaseLink[]) ?? [],
    track_count: counts.get(row.id as string) ?? 0,
  }))

  return (
    <ReleasesBrowser
      releases={releases}
      artistId={id}
      artistSlug={artist.slug}
      addAction={addReleaseAction.bind(null, id)}
      publishAction={publishSectionAction.bind(null, 'release', id)}
    />
  )
}
