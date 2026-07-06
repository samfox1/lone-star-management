import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { requireArtist } from '../_data'
import { SectionToolbar } from '../section-toolbar'
import { CardGrid } from '../card-grid'
import { addReleaseAction, publishSectionAction } from '../actions'
import { ReleaseCard, type ReleaseLink } from '../releases/release-card'

/**
 * Releases view for the Music tab: each release gets a public smart-link page
 * (/[slug]/r/[release]) with its DSP buttons. Cover-art grid; per-release links +
 * delete live in a modal on each card (ReleaseCard). Shares SectionToolbar with
 * the Tracks view so both halves of the Music tab match.
 */
export async function ReleasesSection({ id }: { id: string }) {
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'release', id)

  return (
    <div className="space-y-6">
      <SectionToolbar
        count={rows.length}
        singular="release"
        plural="releases"
        addLabel="Add release"
        publishAction={publishSectionAction.bind(null, 'release', id)}
      >
        <form action={addReleaseAction.bind(null, id)} className="flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required autoFocus className={`${inputClass} w-44`} />
          <input name="release_date" type="date" className={`${inputClass} w-40`} />
          <input name="cover_url" type="url" placeholder="Cover image URL" className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      </SectionToolbar>

      <CardGrid size="md" count={rows.length} empty="No releases yet.">
        {rows.map((row) => (
          <ReleaseCard
            key={row.id as string}
            artistId={id}
            artistSlug={artist.slug}
            release={{
              id: row.id as string,
              title: row.title as string,
              slug: row.slug as string,
              cover_url: (row.cover_url as string | null) ?? null,
              release_date: (row.release_date as string | null) ?? null,
              links: (row.links as ReleaseLink[]) ?? [],
            }}
          />
        ))}
      </CardGrid>
    </div>
  )
}
