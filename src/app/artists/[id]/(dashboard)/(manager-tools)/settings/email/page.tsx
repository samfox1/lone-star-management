import { createClient } from '@/lib/supabase/server'
import { toKindRows, type RawKindRow } from '@/lib/enquiries/kinds'
import { confirmStateFrom } from '@/lib/enquiries/confirm'
import { requireArtist } from '../../../_data'
import { KindRows } from '../../enquiries/kind-rows'

export const metadata = { title: 'Email — Settings — Lone Star Management' }

/** Each kind with its description (20261002220000) and its list. */
const KIND_SELECT = 'id, slug, label, description, sort_order, enquiry_recipients(id, email, label, created_at)'

/**
 * SETTINGS → EMAIL (Sam, 2026-09-22). Who receives each kind of enquiry: one ledger row per
 * kind, its addresses as plain text (2026-10-02). The ONLY place addresses are managed (Sam,
 * 2026-10-02: "Remove email from General"), and each kind goes only to its own list ("I should
 * have to add each one individually"). This lived above the inbox on the Enquiries page for one
 * day; Sam wanted the inbox to have the whole page.
 *
 * No caption: the ledger's section word and the second panel name the tab (no-instruction-copy).
 */
export default async function EmailSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  await requireArtist(id) // non-owner → 404

  // One query with an embedded child rather than one per kind; RLS scopes both sides to
  // this artist's managers (20260921120000). Ordered as the manager arranged them, and each
  // list as the resolver addresses it. Each kind's OWN list is everyone it goes to
  // (20261002210000): no booking address or site contact is added, so none is read here.
  //
  // Beside it, which addresses have confirmed (EMAIL_CONFIRM_PLAN.md §3): every address on the
  // lists, once, confirmed or waiting. confirmStateFrom reads a failure: before 20261006120000
  // is pushed the function is missing and the page works as it did (TODO there: remove that
  // fallback after the push); any other failure shows every address waiting, never confirmed.
  const [{ data: kindRows }, status] = await Promise.all([
    supabase.from('enquiry_kinds').select(KIND_SELECT).eq('artist_id', id).order('sort_order').order('created_at'),
    supabase.rpc('email_confirmation_status', { p_artist_id: id }),
  ])
  const kinds = toKindRows(kindRows as unknown as RawKindRow[] | null)

  // No width of its own: ToolsShell sets one for every tool (Batch 3, 2026-10-02).
  return <KindRows artistId={id} kinds={kinds} confirm={confirmStateFrom(status)} />
}
