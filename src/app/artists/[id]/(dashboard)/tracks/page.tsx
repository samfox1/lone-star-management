import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { CATALOG_SOURCES, type CatalogSource } from '@/lib/catalog'
import { SyncPanel } from '../sync-panel'
import { CatalogSourceForm } from '../catalog-source-form'
import { requireArtist } from '../_data'
import { TrackCard } from './track-card'
import { TracksHeader } from './tracks-header'
import {
  addContentAction,
  publishSectionAction,
  saveAppleIdAction,
  saveDeezerIdAction,
  saveSpotifyIdAction,
  setCatalogSourceAction,
  syncAppleAction,
  syncDeezerAction,
  syncSpotifyAction,
} from '../actions'

type Importer = {
  idField: 'spotify_artist_id' | 'deezer_artist_id' | 'apple_artist_id'
  placeholder: string
  pullLabel: string
  save: (artistId: string, formData: FormData) => Promise<void>
  pull: (artistId: string) => Promise<void>
}

const SOURCES: Record<CatalogSource, { label: string; importer?: Importer }> = {
  manual: { label: 'Manual only' },
  spotify: {
    label: 'Spotify',
    importer: {
      idField: 'spotify_artist_id',
      placeholder: 'Spotify artist ID',
      pullLabel: 'Pull from Spotify',
      save: saveSpotifyIdAction,
      pull: syncSpotifyAction,
    },
  },
  deezer: {
    label: 'Deezer',
    importer: {
      idField: 'deezer_artist_id',
      placeholder: 'Deezer artist ID',
      pullLabel: 'Pull from Deezer',
      save: saveDeezerIdAction,
      pull: syncDeezerAction,
    },
  },
  apple: {
    label: 'Apple Music',
    importer: {
      idField: 'apple_artist_id',
      placeholder: 'Apple Music artist ID',
      pullLabel: 'Pull from Apple Music',
      save: saveAppleIdAction,
      pull: syncAppleAction,
    },
  },
}

export default async function TracksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'track', id)
  const source = (artist.catalog_source ?? 'manual') as CatalogSource
  const cfg = SOURCES[source]
  const hasImportedTracks = source !== 'manual' && rows.some((r) => r.source === source)

  // Import machinery (catalog source + sync) — tucked behind the header's Import
  // toggle so it never wastes space above the grid.
  const importPanel = (
    <div className="space-y-4">
      <div>
        <div className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Catalog source
        </div>
        <p className="mt-1 font-space text-xs text-ink-faint">
          Import from one service. Switching replaces that import; your manual tracks stay.
        </p>
        <CatalogSourceForm
          action={setCatalogSourceAction.bind(null, id)}
          current={source}
          currentLabel={cfg.label}
          hasImportedTracks={hasImportedTracks}
          sources={CATALOG_SOURCES.map((s) => ({ value: s, label: SOURCES[s].label }))}
        />
      </div>
      {cfg.importer && (
        <SyncPanel
          title={cfg.label}
          idName={cfg.importer.idField}
          idValue={artist[cfg.importer.idField] ?? ''}
          placeholder={cfg.importer.placeholder}
          hasId={!!artist[cfg.importer.idField]}
          pullLabel={cfg.importer.pullLabel}
          saveAction={cfg.importer.save.bind(null, id)}
          pullAction={cfg.importer.pull.bind(null, id)}
        />
      )}
    </div>
  )

  return (
    <div>
      <TracksHeader
        count={rows.length}
        addAction={addContentAction.bind(null, 'track', id)}
        publishAction={publishSectionAction.bind(null, 'track', id)}
        importPanel={importPanel}
      />

      {rows.length > 0 ? (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-8">
          {rows.map((row) => (
            <TrackCard
              key={row.id as string}
              artistId={id}
              track={{
                id: row.id as string,
                title: row.title as string,
                cover_url: (row.cover_url as string | null) ?? null,
                stream_url: (row.stream_url as string | null) ?? null,
                source: (row.source as string | null) ?? null,
                audio_path: (row.audio_path as string | null) ?? null,
              }}
            />
          ))}
        </div>
      ) : (
        <p className="mt-6 rounded-xl border border-dashed border-hairline px-4 py-6 text-center font-space text-sm text-ink-muted">
          None yet.
        </p>
      )}
    </div>
  )
}
