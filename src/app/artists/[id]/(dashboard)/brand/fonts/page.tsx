import { loadBrandFonts } from '@/lib/fonts'
import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../../_data'
import { FontsLedger } from './fonts-ledger'

export const metadata = { title: 'Fonts — Brand — Lone Star Management' }

/**
 * BRAND → FONTS (BRAND_PAGE_PLAN.md). The slots (with their titles and notes) and every
 * uploaded font (with its weight) in one read pair; the ledger does the rest. The layout
 * above owns the Publish bar, and every write here refreshes the route so it sees it.
 */
export default async function BrandFontsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireArtist(id) // non-owner → 404
  const supabase = await createClient()
  const data = await loadBrandFonts(supabase, id)
  return <FontsLedger artistId={id} data={data} />
}
