import { listBrandColors } from '@/lib/manager-tools/brand/brand-colors'
import { isCustom } from '@/lib/custom-site'
import { manifestFor } from '@/lib/site-editor/manifest'
import { siteSwatches } from '@/lib/site-editor/style-apply'
import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../../../_data'
import { LedgerSection } from '../../_ui/ledger'
import { ColorsLedger } from './colors-ledger'

export const metadata = { title: 'Colors — Brand — Lone Star Management' }

/**
 * BRAND → COLORS (BRAND_PAGE_PLAN.md). The palette, and what the colour panel offers as
 * "On the site": the colours the site's saved styles already use — plus, for a built-in
 * template, the palette its manifest declares. A custom site announces its palette only
 * at runtime, over the editor's frame, so here it is the colours it uses, which is still
 * what is on it.
 */
export default async function BrandColorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id) // non-owner → 404
  const supabase = await createClient()
  const [colors, { data: styleRows }] = await Promise.all([
    listBrandColors(supabase, id),
    supabase.from('site_styles').select('region_key, class_names').eq('artist_id', id),
  ])
  const styleValues = Object.fromEntries(
    ((styleRows ?? []) as { region_key: string; class_names: string | null }[]).map((r) => [r.region_key, r.class_names ?? '']),
  )
  const declared = isCustom(artist) ? undefined : manifestFor(artist.template)?.styleOptions
  return (
    <LedgerSection label="Colors">
      <ColorsLedger artistId={id} colors={colors} siteSwatches={siteSwatches(declared, styleValues, 12)} />
    </LedgerSection>
  )
}
