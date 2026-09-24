import { loadBrandLogos, loadIconSettings, type IconSettings, type IconTarget } from '@/lib/brand'
import { listBrandColors } from '@/lib/manager-tools/brand/brand-colors'
import { mediaUrl } from '@/lib/storage-url'
import { createClient } from '@/lib/supabase/server'
import { requireArtist } from '../../../_data'
import { IconRows, type IconRowData } from './icon-rows'
import { iconLogoOptions, resolveIconSource } from './icon-sources'

export const metadata = { title: 'Tab icon — Brand — Lone Star Management' }

/**
 * BRAND → TAB ICON (BRAND_PAGE_PLAN.md): the tab icon, the home-screen icon and the
 * browser-bar colour. Everything here is the WORKING state — the generated PNGs are media
 * rows that publish with the brand; sources, framing and the bar colour are dashboard-only
 * this round.
 */
export default async function BrandIconsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireArtist(id) // non-owner → 404, before anything else is read
  const supabase = await createClient()
  const [settings, logos, mediaRes, colors] = await Promise.all([
    loadIconSettings(supabase, id),
    loadBrandLogos(supabase, id),
    supabase
      .from('media')
      .select('id, purpose, storage_path')
      .eq('artist_id', id)
      .in('purpose', ['favicon', 'home_icon', 'icon_source'])
      .order('sort_order', { ascending: true }),
    // The swatches are a convenience: a palette that cannot be read is an empty one.
    listBrandColors(supabase, id).catch(() => []),
  ])

  const media = (mediaRes.data ?? []) as { id: string; purpose: string; storage_path: string }[]
  const uploads = media.filter((m) => m.purpose === 'icon_source').map((m) => ({ id: m.id, storagePath: m.storage_path }))
  /** Single occupancy; a stray second row must not throw — the newest wins. */
  const generated = (purpose: IconTarget) => {
    const row = media.filter((m) => m.purpose === purpose).at(-1)
    return row ? mediaUrl(row.storage_path) : null
  }
  const rowFor = (target: IconTarget, saved: IconSettings['favicon']): IconRowData => {
    const src = resolveIconSource(saved.sourceMediaId, logos, uploads)
    return {
      generatedUrl: generated(target),
      source: { id: src.id, url: src.path ? mediaUrl(src.path) : null },
      framing: saved.framing,
    }
  }

  return (
    <IconRows
      artistId={id}
      favicon={rowFor('favicon', settings.favicon)}
      homeIcon={rowFor('home_icon', settings.homeIcon)}
      logos={iconLogoOptions(logos).map((o) => ({ id: o.id, label: o.label, url: mediaUrl(o.path) }))}
      themeColor={settings.themeColor}
      colors={colors.map((c) => ({ name: c.name, hex: c.hex }))}
    />
  )
}
