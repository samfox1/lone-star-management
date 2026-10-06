import { createClient } from '@/lib/supabase/server'
import type { InboxRow } from '@/lib/enquiries/inbox'
import { attachmentCounts } from '@/lib/enquiries/inbox-server'
import { requireArtist } from '../../_data'
import { EnquiriesLedger } from './enquiries-ledger'
import { kindLabeller } from '@/lib/enquiries/kinds'

export const metadata = { title: 'Enquiries — Lone Star Management' }

/** The Enquiries tool: the inbox, the whole page (Sam, 2026-09-22), on the Subscribers
 *  page's layout since 2026-10-05 (enquiries-ledger.tsx). Who receives each kind is edited
 *  under Settings → Email. */
export default async function EnquiriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id) // non-owner → 404

  // Both reads at once: neither needs the other, and each is a round trip to the hosted
  // database. The enquiries: RLS scopes them to the artist's managers + admins (see
  // 20260722120000). The kinds: their LABELS for each row, and the list itself for the filter
  // words, in the artist's order. The list used to carry its own three-entry map and a
  // hard-coded "Demos" filter, both stale the moment a manager renamed or invented a kind. RLS
  // scopes this to the artist.
  const [{ data }, { data: kindRows }] = await Promise.all([
    supabase
      .from('enquiries')
      .select('id, purpose, name, email, message, read_at, created_at, demo_url, status')
      .eq('artist_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('enquiry_kinds').select('slug, label, sort_order').eq('artist_id', id).order('sort_order'),
  ])
  const enquiries = (data ?? []) as Omit<InboxRow, 'attachmentCount' | 'artistId' | 'artistName'>[]
  const kinds = ((kindRows ?? []) as { slug: string; label: string }[]).map((k) => ({ slug: k.slug, label: k.label }))
  const labelFor = kindLabeller(kinds)

  // After the enquiries: it needs their ids.
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

  // No SectionShell: it only added a spacer above the list, and Subscribers, whose layout this
  // page follows, has none.
  return <EnquiriesLedger rows={rows} kinds={kinds} />
}
