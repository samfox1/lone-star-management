import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { CATALOG_SOURCES, type CatalogSource } from '@/lib/catalog'
import { ContentSection } from '../content-sections'
import { SyncPanel } from '../sync-panel'
import { SectionShell } from '../section-shell'
import { CatalogSourceForm } from '../catalog-source-form'
import { requireArtist } from '../_data'
import {
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

/** One config per catalog source — label for the selector + (for importers) the
 *  id field and bound actions that drive the SyncPanel. Adding Apple = one entry. */
const SOURCES: Record<CatalogSource, { label: string; importer?: Importer; comingSoon?: boolean }> = {
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
  // Confirm a switch only when it would actually delete imported tracks.
  const hasImportedTracks = source !== 'manual' && rows.some((r) => r.source === source)

  return (
    <SectionShell title="Tracks" publishType="track" artistId={id}>
      <div>
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">Catalog source</h2>
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

      {cfg.comingSoon && (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-3 font-space text-sm text-ink-muted">
          {cfg.label} import is coming soon. Add tracks manually for now.
        </p>
      )}

      <ContentSection type="track" artistId={id} rows={rows} />
    </SectionShell>
  )
}
