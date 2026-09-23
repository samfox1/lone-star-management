import { createClient } from '@/lib/supabase/server'
import type { InboxRow } from '@/lib/enquiries/inbox'
import { attachmentCounts } from '@/lib/enquiries/inbox-server'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import { EnquiryTable } from './enquiry-table'
import { kindLabeller } from '@/lib/enquiries/kinds'

export const metadata = { title: 'Enquiries — Lone Star Management' }

/** The Enquiries tool: the inbox, the whole page (Sam, 2026-09-22). Who receives each kind
 *  is edited under Settings → Email. */
export default async function EnquiriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id) // non-owner → 404

  // RLS scopes this to the artist's managers + admins (see 20260722120000).
  const { data } = await supabase
    .from('enquiries')
    .select('id, purpose, name, email, message, read_at, created_at, demo_url, status')
    .eq('artist_id', id)
    .order('created_at', { ascending: false })
  const enquiries = (data ?? []) as Omit<InboxRow, 'attachmentCount' | 'artistId' | 'artistName'>[]

  // The kinds, for their LABELS only. The table used to carry its own three-entry map,
  // which went stale the moment a manager renamed a kind; RLS scopes this to the artist.
  const { data: kindRows } = await supabase.from('enquiry_kinds').select('slug, label').eq('artist_id', id)
  const labelFor = kindLabeller((kindRows ?? []) as { slug: string; label: string }[])

  const counts = await attachmentCounts(supabase, enquiries.map((r) => r.id))
  // Artist identity rides on every row even here, where the label is hidden: the
  // read/unread writes need it, and it keeps this page's data identical to the
  // roster-wide inbox so one component serves both.
  const rows: InboxRow[] = enquiries.map((r) => ({
    ...r,
    purposeLabel: labelFor(r.purpose),
    attachmentCount: counts.get(r.id) ?? 0,
    artistId: id,
    artistName: artist.name as string,
  }))

  return (
    <SectionShell title="Enquiries" artistId={id}>
      <EnquiryTable rows={rows} />
    </SectionShell>
  )
}
