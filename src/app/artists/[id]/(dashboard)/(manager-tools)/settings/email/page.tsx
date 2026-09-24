import { createClient } from '@/lib/supabase/server'
import { toKindRows, type RawKindRow } from '@/lib/enquiries/kinds'
import { requireArtist } from '../../../_data'
import { KindRows } from '../../enquiries/kind-rows'

export const metadata = { title: 'Email — Settings — Lone Star Management' }

/**
 * SETTINGS → EMAIL (Sam, 2026-09-22). Who receives each kind of enquiry: one row per kind,
 * the modal kit on click. This lived above the inbox on the Enquiries page for one day;
 * Sam wanted the inbox to have the whole page and the editing to sit with the booking
 * address, which General already holds — so all routing is under Settings, in one place.
 *
 * No heading, no caption: the second panel names the tab (no-instruction-copy).
 */
export default async function EmailSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id) // non-owner → 404

  // One query with an embedded child rather than one per kind; RLS scopes both sides to
  // this artist's managers (20260921120000). Ordered as the manager arranged them, and each
  // list as the resolver addresses it.
  const [{ data: kindRows }, { data: preview }] = await Promise.all([
    supabase
      .from('enquiry_kinds')
      .select('id, slug, label, sort_order, enquiry_recipients(id, email, label, created_at)')
      .eq('artist_id', id)
      .order('sort_order')
      .order('created_at'),
    // The live resolved booking recipient — what every kind's list is ADDED to. SECURITY
    // DEFINER with an internal owner guard; edited under General, shown read-only here.
    supabase.rpc('booking_recipient_preview', { p_artist_id: id }),
  ])
  const kinds = toKindRows(kindRows as RawKindRow[] | null)
  const current = ((preview ?? []) as { to_email: string }[])[0]

  return (
    <div className="mt-2">
      <KindRows artistId={id} kinds={kinds} primary={current?.to_email ?? null} />
    </div>
  )
}
