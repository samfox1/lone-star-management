import { requireArtist } from '../_data'
import { ReleasesSection } from './releases-section'

/**
 * Music tab — the artist's releases (singles, EPs, albums). A release is the one
 * unit of music content; there's no separate track list. A Refresh button (in the
 * list toolbar) pulls the catalog from the artist's linked Spotify.
 */
export default async function MusicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireArtist(id) // non-owner → 404

  return <ReleasesSection id={id} />
}
