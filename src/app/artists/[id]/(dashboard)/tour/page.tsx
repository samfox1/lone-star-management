import { createClient } from '@/lib/supabase/server'
import { listContent } from '@/lib/content'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { SectionShell } from '../section-shell'
import { SectionMeta, ConnectLink } from '../section-meta'
import { requireArtist } from '../_data'
import { addContentAction } from '../actions'
import { TourBrowser } from './tour-browser'

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id)
  const rows = await listContent(supabase, 'tour_date', id)

  return (
    <SectionShell title="Tour dates" publishType="tour_date" artistId={id}>
      <SectionMeta count={rows.length} singular="date" plural="dates">
        <ConnectLink href={`/artists/${id}/tools/integrations`}>
          Sync from Bandsintown / Ticketmaster →
        </ConnectLink>
      </SectionMeta>

      <form action={addContentAction.bind(null, 'tour_date', id)} className="flex flex-wrap items-center gap-2">
        <input name="date" type="date" required className={`${inputClass} w-40`} />
        <input name="venue" placeholder="Venue" className={`${inputClass} flex-1`} />
        <input name="city" placeholder="City" className={`${inputClass} w-32`} />
        <input name="ticket_url" type="url" placeholder="Tickets URL" className={`${inputClass} w-44`} />
        <button type="submit" className={buttonClass('solid')}>
          Add
        </button>
      </form>

      <TourBrowser
        artistId={id}
        tours={rows.map((row) => ({
          id: row.id as string,
          date: (row.date as string | null) ?? null,
          venue: (row.venue as string | null) ?? null,
          city: (row.city as string | null) ?? null,
          ticket_url: (row.ticket_url as string | null) ?? null,
          source: (row.source as string | null) ?? null,
        }))}
      />
    </SectionShell>
  )
}
