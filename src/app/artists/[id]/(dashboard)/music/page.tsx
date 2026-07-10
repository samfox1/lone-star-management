import { createClient } from '@/lib/supabase/server'
import { diffUnpublished, listContent } from '@/lib/content'
import { entityCounts, metricValue, daysAgo } from '@/lib/analytics'
import { toReleaseType } from '@/lib/releases'
import { releaseBucket, trackBucket, type MusicBucket } from '@/lib/music'
import { requireArtist } from '../_data'
import { importDriveFileAction, listDriveFilesAction, refreshSpotifyAction } from '../actions'
import { AssetsShell } from '../assets-rail'
import { DriveBrowser } from '../drive-browser'
import { DriveImportButton } from '../drive-import-button'
import { type Track, type ReleaseOption } from '../tracks/track-card'
import { type ReleaseLink, type ReleaseSong } from '../releases/release-card'
import { MusicBrowser, LOOSE, type UnreleasedSong } from './music-browser'

/**
 * The Music tab — ONE surface for the artist's whole catalog, classified by
 * provenance (lib/music.ts): Released (on a platform → public site material) vs
 * Unreleased (uploads/demos — dashboard-only, never public). The MusicBrowser
 * filters it with two segmented lenses (release state + site visibility) under
 * one shared toolbar. No manual toggle: a song moves buckets by joining a
 * released release or gaining a listen link.
 */
export default async function MusicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [releaseRows, trackRows, counts, diff] = await Promise.all([
    listContent(supabase, 'release', id),
    listContent(supabase, 'track', id),
    entityCounts(supabase, id, daysAgo(30)),
    diffUnpublished(supabase, id),
  ])
  // Unpublished music edits (renames, links…) enable the publish pill even when
  // the on-site selection hasn't changed, so an edit can't strand as a draft.
  const musicDirty = diff.release.dirty || diff.track.dirty

  // Classify every release once; tracks inherit through their release_id.
  const relBucket = new Map<string, MusicBucket>(
    releaseRows.map((r) => [
      r.id as string,
      releaseBucket({
        source: (r.source as string | null) ?? null,
        spotify_id: (r.spotify_id as string | null) ?? null,
        links: r.links,
        released: (r.released as boolean | null) ?? false,
      }),
    ]),
  )

  const tracks = trackRows.map((row) => {
    const t: Track & { created_at: string } = {
      id: row.id as string,
      title: row.title as string,
      cover_url: (row.cover_url as string | null) ?? null,
      stream_url: (row.stream_url as string | null) ?? null,
      source: (row.source as string | null) ?? null,
      audio_path: (row.audio_path as string | null) ?? null,
      release_id: (row.release_id as string | null) ?? null,
      spotify_id: (row.spotify_id as string | null) ?? null,
      apple_id: (row.apple_id as string | null) ?? null,
      deezer_id: (row.deezer_id as string | null) ?? null,
      apple_url: (row.apple_url as string | null) ?? null,
      soundcloud_url: (row.soundcloud_url as string | null) ?? null,
      created_at: (row.created_at as string | null) ?? '',
    }
    const bucket = trackBucket(
      {
        release_id: t.release_id,
        source: t.source,
        audio_path: t.audio_path,
        spotify_id: t.spotify_id,
        apple_id: t.apple_id,
        deezer_id: t.deezer_id,
        provider_url: (row.provider_url as string | null) ?? null,
        stream_url: t.stream_url,
        apple_url: t.apple_url,
        soundcloud_url: t.soundcloud_url ?? null,
        released: (row.released as boolean | null) ?? false,
      },
      (rid) => relBucket.get(rid),
    )
    return { ...t, bucket }
  })

  // Songs grouped under their release (the umbrella) for the release tracklists.
  const songsByRelease = new Map<string, ReleaseSong[]>()
  for (const row of trackRows) {
    const rid = row.release_id as string | null
    if (!rid) continue
    const list = songsByRelease.get(rid) ?? []
    list.push({
      id: row.id as string,
      title: row.title as string,
      featured_artists: (row.featured_artists as string[] | null) ?? [],
      stat: metricValue(counts, 'release', [row.id as string]),
    })
    songsByRelease.set(rid, list)
  }

  const toReleaseCard = (row: Record<string, unknown>) => {
    const rid = row.id as string
    const songs = songsByRelease.get(rid) ?? []
    // Release engagement (30d) = plays + DSP clicks summed over the release AND
    // its songs (the metric registry owns which events count).
    const stat = metricValue(counts, 'release', [rid, ...songs.map((s) => s.id)])
    return {
      id: rid,
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
  }

  // Released releases → the browser (groups + tracklists + PublishBar); unreleased
  // ones (a manual demo EP) → manageable cards in the Unreleased half.
  const releases = releaseRows.filter((row) => relBucket.get(row.id as string) === 'released').map(toReleaseCard)
  const unreleasedReleases = releaseRows
    .filter((row) => relBucket.get(row.id as string) === 'unreleased')
    .map(toReleaseCard)

  // Loose released tracks (platform-linked, not on a release) — rare, but they're
  // public site material and need managing (rename / assign to a release / master).
  const looseReleased = tracks.filter((t) => t.bucket === 'released' && !t.release_id)

  // Unreleased songs, grouped under their (unreleased) release; loose uploads last.
  const relTitle = new Map(releaseRows.map((r) => [r.id as string, r.title as string]))
  const unreleasedSongs: UnreleasedSong[] = tracks
    .filter((t) => t.bucket === 'unreleased')
    .map((t) => ({
      ...t,
      group: t.release_id ?? LOOSE,
      groupLabel: (t.release_id && relTitle.get(t.release_id)) || '',
    }))

  const releaseOptions: ReleaseOption[] = releaseRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
  }))

  return (
    <AssetsShell artistId={id} active="music">
    <MusicBrowser
      releases={releases}
      unreleasedReleases={unreleasedReleases}
      looseReleased={looseReleased}
      unreleasedSongs={unreleasedSongs}
      releaseOptions={releaseOptions}
      artistId={id}
      artistSlug={artist.slug}
      refreshAction={refreshSpotifyAction.bind(null, id)}
      dirty={musicDirty}
      importButton={
        artist.drive_folder_id ? (
          <DriveImportButton title="Import songs from Drive">
            <DriveBrowser
              kind="audio"
              listAction={listDriveFilesAction.bind(null, id, 'audio')}
              importAction={importDriveFileAction.bind(null, id, 'audio')}
            />
          </DriveImportButton>
        ) : undefined
      }
    />
    </AssetsShell>
  )
}
