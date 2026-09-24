import { loadBrandLogos, loadIconSettings } from '@/lib/brand'
import { listBrandColors } from '@/lib/manager-tools/brand/brand-colors'
import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../../_data'
import { LedgerSection } from '../_ui/ledger'
import { LogosList } from './logos/logos-list'
import type { IconUse } from './logos/remove'

export const metadata = { title: 'Logos — Brand — Lone Star Management' }

/**
 * BRAND → LOGOS (Sam, 2026-09-23, BRAND_PAGE_PLAN.md): the first Brand tab, and only the
 * logo rows — the tab icon and fonts have their own tabs now. The Publish bar is the
 * layout's (brand/layout.tsx), so it is the same bar on every tab; this page renders none.
 *
 * `icons` is, for each generated icon, whether it exists and which logo it is framed from
 * (a null source means the primary). Removing a logo removes the icons cut from it; an icon
 * framed from another logo stays.
 */
export default async function BrandLogosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [, logos, colors, icons, iconRows] = await Promise.all([
    requireArtist(id), // non-owner → 404
    loadBrandLogos(supabase, id),
    listBrandColors(supabase, id),
    loadIconSettings(supabase, id),
    supabase.from('media').select('purpose').eq('artist_id', id).in('purpose', ['favicon', 'home_icon']),
  ])

  const present = new Set(((iconRows.data ?? []) as { purpose: string }[]).map((r) => r.purpose))
  const iconUse: IconUse = {
    favicon: { exists: present.has('favicon'), sourceMediaId: icons.favicon.sourceMediaId },
    home_icon: { exists: present.has('home_icon'), sourceMediaId: icons.homeIcon.sourceMediaId },
  }

  return (
    <LedgerSection label="Logos">
      <LogosList
        artistId={id}
        logos={logos}
        swatches={colors.map((c) => ({ key: c.id, name: c.name, hex: c.hex }))}
        icons={iconUse}
      />
    </LedgerSection>
  )
}
