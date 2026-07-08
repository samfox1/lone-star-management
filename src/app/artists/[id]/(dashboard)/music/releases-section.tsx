import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { toReleaseType } from '@/lib/releases'
import { requireArtist } from '../_data'
import { refreshSpotifyAction } from '../actions'
import { type ReleaseLink, type ReleaseSong } from '../releases/release-card'
import { ReleasesBrowser } from './releases-browser'

/**
 * Releases view for the Music tab: each release gets a public smart-link page
 * (/[slug]/r/[release]) with its DSP buttons. Server fetches the releases AND
 * their songs (tracks grouped by release_id) so an album/EP can expand to its
 * tracklist. The client ReleasesBrowser handles filter + sort + select + publish.
 */
export async function ReleasesSection({ id }: { id: string }) {
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [rows, trackRows, counts] = await Promise.all([
    listContent(supabase, 'release', id),
    listContent(supabase, 'track', id),
    entityCounts(supabase, id, daysAgo(30)),
  ])

  // Songs grouped under their release (the umbrella), ordered as fetched.
  const songsByRelease = new Map<string, ReleaseSong[]>()
  for (const t of trackRows) {
    const rid = t.release_id as string | null
    if (!rid) continue
    const list = songsByRelease.get(rid) ?? []
    list.push({
      id: t.id as string,
      title: t.title as string,
      featured_artists: (t.featured_artists as string[] | null) ?? [],
      stat: metricValue(counts, 'release', [t.id as string]),
    })
    songsByRelease.set(rid, list)
  }

  const releases = rows.map((row) => {
    const id = row.id as string
    const songs = songsByRelease.get(id) ?? []
    // Release engagement (30d) = plays + DSP clicks summed over the release AND its
    // tracks (the metric registry owns which events count).
    const stat = metricValue(counts, 'release', [id, ...songs.map((s) => s.id)])
    return {
      id,
      title: row.title as string,
      slug: row.slug as string,
      cover_url: (row.cover_url as string | null) ?? null,
      release_date: (row.release_date as string | null) ?? null,
      release_type: toReleaseType(row.release_type as string | null),
      links: (row.links as ReleaseLink[]) ?? [],
      visible: (row.visible as boolean | null) ?? true,
      songs,
      stat,
    }
  })

  return (
    <ReleasesBrowser
      releases={releases}
      artistId={id}
      artistSlug={artist.slug}
      refreshAction={refreshSpotifyAction.bind(null, id)}
    />
  )
}
