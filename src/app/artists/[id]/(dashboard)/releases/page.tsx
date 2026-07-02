import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import { addReleaseAction } from '../actions'
import { ReleaseCard } from './release-card'

type ReleaseLink = { label: string; url: string }

/**
 * Releases: each release gets a public smart-link page (/[slug]/r/[release]) with
 * its DSP buttons. Shown as a cover-art grid; per-release links + delete live in a
 * modal on each card (ReleaseCard). Per-section publish like content.
 */
export default async function ReleasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const rows = await listContent(supabase, 'release', id)

  return (
    <SectionShell title="Releases" publishType="release" artistId={id}>
      <div>
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">Add a release</h2>
        <form action={addReleaseAction.bind(null, id)} className="mt-2 flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Title" required className={`${inputClass} w-44`} />
          <input name="release_date" type="date" className={`${inputClass} w-40`} />
          <input name="cover_url" type="url" placeholder="Cover image URL" className={`${inputClass} flex-1`} />
          <button type="submit" className={buttonClass('solid')}>
            Add
          </button>
        </form>
      </div>

      {rows.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-7">
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
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center font-space text-sm text-ink-muted">
          No releases yet.
        </p>
      )}
    </SectionShell>
  )
}
