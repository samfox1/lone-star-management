import { createClient } from '@/lib/supabase/server'
import { toKindRows, type RawKindRow } from '@/lib/enquiries/kinds'
import { missingColumn } from '@/lib/enquiries/kind-save'
import { requireArtist } from '../../../_data'
import { KindRows } from '../../enquiries/kind-rows'

export const metadata = { title: 'Email — Settings — Lone Star Management' }

const RECIPIENTS = 'enquiry_recipients(id, email, label, created_at)'
/** Each kind with its description (20261002220000) and its list. */
const KIND_SELECT = `id, slug, label, description, sort_order, ${RECIPIENTS}`
/** The same without the description: what the page reads until 20261002220000 is pushed, when
 *  naming the column is a 42703. DELETE at push time (that migration's checklist). */
const KIND_SELECT_OLD = `id, slug, label, sort_order, ${RECIPIENTS}`

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
  const read = (columns: string) =>
    supabase.from('enquiry_kinds').select(columns).eq('artist_id', id).order('sort_order').order('created_at')
  let { data: kindRows, error } = await read(KIND_SELECT)
  // Without the column, every kind still shows, with the fixed lines it has always shown
  // (toKindRows falls back to them when `description` is absent). An unchecked error here would
  // leave the page empty, not broken-looking.
  if (missingColumn(error)) ({ data: kindRows, error } = await read(KIND_SELECT_OLD))
  const kinds = toKindRows(kindRows as unknown as RawKindRow[] | null)

  // No width of its own: ToolsShell sets one for every tool (Batch 3, 2026-10-02).
  return <KindRows artistId={id} kinds={kinds} />
}
