import { createClient } from '@/lib/supabase/server'
import type { InboxRow } from '@/lib/enquiry-inbox'
import { attachmentCounts } from '@/lib/enquiry-inbox-server'
import { Icon } from '@/components/ui/icons'
import { SectionShell } from '../section-shell'
import { requireArtist } from '../_data'
import { EnquiryTable } from './enquiry-table'

export const metadata = { title: 'Enquiries — Lone Star Management' }

/** Where the manager can change the address that resolved, in plain language. */
const SOURCE_LABEL: Record<string, string> = {
  mail_settings: 'set by Lone Star admin',
  link: 'from your booking link',
  site_content: 'from your site text',
  default: 'the Lone Star fallback — set a booking address to route these yourself',
}

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

  const counts = await attachmentCounts(supabase, enquiries.map((r) => r.id))
  // Artist identity rides on every row even here, where the label is hidden: the
  // read/unread writes need it, and it keeps this page's data identical to the
  // roster-wide inbox so one component serves both.
  const rows: InboxRow[] = enquiries.map((r) => ({
    ...r,
    attachmentCount: counts.get(r.id) ?? 0,
    artistId: id,
    artistName: artist.name as string,
  }))

  // The live resolved recipient, which may differ from any single row's frozen to_email if
  // the address has since changed. SECURITY DEFINER with an internal owner guard — the
  // only path by which a resolved address reaches a client.
  const { data: preview } = await supabase.rpc('booking_recipient_preview', { p_artist_id: id })
  const current = (preview ?? [])[0] as { to_email: string; recipient_source: string } | undefined

  return (
    <SectionShell title="Enquiries" artistId={id}>
      <div className="space-y-1">
        {current ? (
          <p className="text-sm text-ink-muted">
            New enquiries go to <span className="font-medium text-ink">{current.to_email}</span>{' '}
            <span className="text-ink-faint">
              ({SOURCE_LABEL[current.recipient_source] ?? current.recipient_source})
            </span>
            . Changes take effect immediately — no publish needed.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <Icon name="alert" size={15} />
            No booking address is set, so enquiries cannot be delivered. Add one in Site text
            or as a booking link.
          </p>
        )}
      </div>

      <EnquiryTable rows={rows} />
    </SectionShell>
  )
}
