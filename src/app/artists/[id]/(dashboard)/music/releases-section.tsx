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
  const rows = await listContent(supabase, 'release', id)

  const releases = rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    slug: row.slug as string,
    cover_url: (row.cover_url as string | null) ?? null,
    release_date: (row.release_date as string | null) ?? null,
    release_type: toReleaseType(row.release_type as string | null),
    links: (row.links as ReleaseLink[]) ?? [],
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
