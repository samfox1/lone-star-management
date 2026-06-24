import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { CATALOG_SOURCES } from '@/lib/catalog'
import { ContentSection } from '../content-sections'
import { SyncPanel } from '../sync-panel'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import {
  saveDeezerIdAction,
  saveSpotifyIdAction,
  setCatalogSourceAction,
  syncDeezerAction,
  syncSpotifyAction,
} from '../actions'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual only',
  spotify: 'Spotify',
  apple: 'Apple Music',
  deezer: 'Deezer',
}

export default async function TracksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'track', id)
  const source = artist.catalog_source ?? 'manual'

  return (
    <SectionShell title="Tracks" publishType="track" artistId={id}>
      <div>
        <h2 className="text-sm font-medium text-zinc-500">Catalog source</h2>
        <p className="mt-1 text-xs text-zinc-400">
          Import from one service. Switching replaces that import; your manual tracks stay.
        </p>
        <form action={setCatalogSourceAction.bind(null, id)} className="mt-2 flex items-center gap-2">
          <select
            name="catalog_source"
            defaultValue={source}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
          >
            {CATALOG_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Apply
          </button>
        </form>
      </div>

      {source === 'spotify' && (
        <SyncPanel
          title="Spotify"
          idName="spotify_artist_id"
          idValue={artist.spotify_artist_id ?? ''}
          placeholder="Spotify artist ID"
          hasId={!!artist.spotify_artist_id}
          pullLabel="Pull from Spotify"
          saveAction={saveSpotifyIdAction.bind(null, id)}
          pullAction={syncSpotifyAction.bind(null, id)}
        />
      )}

      {source === 'deezer' && (
        <SyncPanel
          title="Deezer"
          idName="deezer_artist_id"
          idValue={artist.deezer_artist_id ?? ''}
          placeholder="Deezer artist ID"
          hasId={!!artist.deezer_artist_id}
          pullLabel="Pull from Deezer"
          saveAction={saveDeezerIdAction.bind(null, id)}
          pullAction={syncDeezerAction.bind(null, id)}
        />
      )}

      {source === 'apple' && (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
          Apple Music import is coming soon. Add tracks manually for now.
        </p>
      )}

      <ContentSection type="track" artistId={id} rows={rows} />
    </SectionShell>
  )
}
