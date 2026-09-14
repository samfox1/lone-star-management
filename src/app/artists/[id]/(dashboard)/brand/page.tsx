import { loadFraming } from '@/lib/brand'
import { listArtistFonts } from '@/lib/fonts'
import { mediaThumbUrl, mediaUrl } from '@/lib/storage-url'
import { createClient } from '@/lib/supabase/server'
import { dashboardDiff, requireArtist } from '../_data'
import { BrandPublish } from './brand-publish'
import { FaviconEditor } from './favicon-editor'
import { FontManager } from './font-manager'
import { LogoRow } from './logo-row'

/**
 * BRAND (Sam, 2026-09-13): four rows, left-aligned, each only as wide as what is in it —
 * PRIMARY LOGO, SECONDARY LOGO, TAB ICON, FONTS. No headings, no captions: the four
 * paragraphs that used to explain PNGs, monograms, 32 pixels and font slots are gone,
 * and the controls have to say it themselves. Publish is the floating bar.
 *
 * PRIMARY is the full lockup: the EPK header, the social card, anywhere with room.
 * SECONDARY is the icon or monogram, for dark backgrounds and tight spaces. The tab icon
 * is derived from the primary. Fonts live here, not in the site editor: a typeface is
 * what the artist IS, chosen once; the editor then offers every font uploaded here.
 */
export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [, assetsRes, framing, fonts, diff] = await Promise.all([
    requireArtist(id),
    supabase.from('media').select('purpose, storage_path').eq('artist_id', id).in('purpose', ['logo_primary', 'logo_secondary']),
    loadFraming(supabase, id),
    listArtistFonts(supabase, id),
    dashboardDiff(id),
  ])
  const assets = assetsRes.data ?? []
  const pathOf = (purpose: string) => (assets.find((a) => a.purpose === purpose)?.storage_path as string | undefined) ?? null
  const thumbOf = (purpose: string) => {
    const path = pathOf(purpose)
    return path ? mediaThumbUrl(path, { size: 256 }) : null
  }
  const primaryPath = pathOf('logo_primary')

  return (
    <div className="pb-24">
      <div className="mt-2 flex flex-col items-start gap-0.5">
        <Row label="Primary logo">
          <LogoRow artistId={id} purpose="logo_primary" label="Primary logo" currentUrl={thumbOf('logo_primary')} />
        </Row>
        <Row label="Secondary logo">
          <LogoRow artistId={id} purpose="logo_secondary" label="Secondary logo" currentUrl={thumbOf('logo_secondary')} />
        </Row>
        <Row label="Tab icon">
          <FaviconEditor artistId={id} logoUrl={primaryPath ? mediaUrl(primaryPath) : null} initialFraming={framing} />
        </Row>
        <Row label="Fonts" top>
          <FontManager artistId={id} fonts={fonts} />
        </Row>
      </div>
      {/* Logos and the tab icon are media rows; fonts are their own section. Either
          unpublished lights the bar. */}
      <BrandPublish artistId={id} dirty={diff.media.dirty || diff.artist_font.dirty} />
    </div>
  )
}

/** A key, then the thing — the same row the Settings page uses. */
function Row({ label, top = false, children }: { label: string; top?: boolean; children: React.ReactNode }) {
  return (
    <div className={top ? 'inline-flex items-start gap-6 py-3' : 'inline-flex items-center gap-6 py-3'}>
      <span className={`w-[120px] flex-none font-space text-[10px] uppercase tracking-[0.12em] text-ink-faint ${top ? 'pt-2' : ''}`}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
