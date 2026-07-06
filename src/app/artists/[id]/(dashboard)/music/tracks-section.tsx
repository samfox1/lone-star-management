import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { SectionToolbar } from '../section-toolbar'
import { CardGrid } from '../card-grid'
import { TrackCard } from '../tracks/track-card'
import { addContentAction, publishSectionAction } from '../actions'

/**
 * Tracks view for the Music tab. Catalog import (Spotify/Deezer/Apple) now lives
 * in the Integrations hub under Manager tools, so this is just the toolbar
 * (add/publish) + the cover grid.
 */
export async function TracksSection({ id }: { id: string }) {
  const supabase = await createClient()
  await requireArtist(id)
  const rows = await listContent(supabase, 'track', id)

  return (
    <div className="space-y-6">
      <SectionToolbar
        count={rows.length}
        singular="track"
        plural="tracks"
        addLabel="Add track"
        publishAction={publishSectionAction.bind(null, 'track', id)}
      >
        <form action={addContentAction.bind(null, 'track', id)} className="flex items-center gap-2">
          <input name="title" placeholder="Track title" required autoFocus className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      </SectionToolbar>

      <CardGrid size="sm" count={rows.length} empty="None yet.">
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
      </CardGrid>
    </div>
  )
}
