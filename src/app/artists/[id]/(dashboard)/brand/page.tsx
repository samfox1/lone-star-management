import Link from 'next/link'
import { loadFraming } from '@/lib/brand'
import { listArtistFonts } from '@/lib/fonts'
import { mediaThumbUrl, mediaUrl } from '@/lib/storage-url'
import { createClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icons'
import { requireArtist } from '../_data'
import { FaviconEditor } from './favicon-editor'
import { FontManager } from './font-manager'
import { LogoUpload } from './logo-upload'

/**
 * Brand — the artist's logos, and the browser-tab icon derived from the primary one.
 *
 * Not on the Images page (that is gallery photos, curated onto the site) and not on the
 * EPK page (the logo is used site-wide, the press kit is just one consumer). Brand sits
 * beside SEO in Manager tools, which already owns how the artist is represented
 * elsewhere — the social share image lives there for the same reason.
 *
 * PRIMARY is the full lockup: the EPK header, the social card, anywhere with room.
 * SECONDARY is the icon or monogram, for dark backgrounds and tight spaces. They are not
 * "the good one and the spare" — a wide wordmark is illegible small, which is exactly
 * why the pair exists.
 */
export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const supabase = await createClient()

  // `loadFraming` rather than an inline copy of the same query + cast + cleanFraming:
  // an inline copy made the tested function the one nobody ran, so the tests covered a
  // path that was not the shipped path. It returns a promise, so parallelism is kept.
  const [{ data: assets }, framing, fonts] = await Promise.all([
    supabase.from('media').select('purpose, storage_path').eq('artist_id', id).in('purpose', ['logo_primary', 'logo_secondary']),
    loadFraming(supabase, id),
    listArtistFonts(supabase, id),
  ])

  const pathOf = (purpose: string) =>
    ((assets ?? []).find((a) => a.purpose === purpose)?.storage_path as string | undefined) ?? null
  // Thumbnail for the PREVIEW (a 128px box was downloading the full multi-megapixel
  // original), but the canvas gets the FULL-RES url: the export draws from it at up to
  // 6x zoom, so a downscaled source would degrade the saved icon.
  const thumbOf = (purpose: string) => {
    const path = pathOf(purpose)
    return path ? mediaThumbUrl(path, { size: 256 }) : null
  }
  const primaryPath = pathOf('logo_primary')
  const primary = primaryPath ? mediaUrl(primaryPath) : null

  return (
    <div className="max-w-2xl space-y-10">
      <Link
        href={`/artists/${id}/tools`}
        className="inline-flex items-center gap-1 font-space text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} /> Manager tools
      </Link>

      <div>
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">Brand</h1>
        <p className="mt-2 font-space text-sm leading-relaxed text-ink-muted">
          <b className="font-bold text-ink">{artist.name}</b>&rsquo;s logos. Used on the press kit, the
          browser tab, and anywhere else a logo is needed. Draft until you publish the site.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Primary logo
        </h2>
        <LogoUpload
          artistId={id}
          purpose="logo_primary"
          label="Primary logo"
          hint="The full logo. PNG with a transparent background works best."
          currentUrl={thumbOf('logo_primary')}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Secondary logo
        </h2>
        <p className="font-space text-xs leading-relaxed text-ink-faint">
          Optional. An icon or monogram, for dark backgrounds and small spaces.
        </p>
        <LogoUpload
          artistId={id}
          purpose="logo_secondary"
          label="Secondary logo"
          hint="PNG with a transparent background works best."
          currentUrl={thumbOf('logo_secondary')}
        />
      </section>

      <section className="space-y-3 border-t border-hairline pt-8">
        <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Browser tab icon
        </h2>
        <p className="font-space text-xs leading-relaxed text-ink-faint">
          Made from the primary logo. A tab icon is 32 pixels across, so a wide logo needs
          zooming into the mark to stay readable. What you see at actual size is the file
          that gets used.
        </p>
        <FaviconEditor artistId={id} logoUrl={primary} initialFraming={framing} />
      </section>

      {/* Fonts sit with the logos, not on the site editor: a typeface is what the artist
          IS, the same as the mark, and it is chosen once rather than per page. The editor
          then offers every font uploaded here in its per-region dropdown. */}
      <section className="space-y-3 border-t border-hairline pt-8">
        <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">Fonts</h2>
        <p className="font-space text-xs leading-relaxed text-ink-faint">
          Upload the fonts the site is set in, then put them in slots. Primary is headings
          and display type, secondary is body text, and the custom slots are for whatever
          else the site asks for. One font can fill several slots. Any font here can also
          be picked for one part of the site in the editor. Draft until you publish.
        </p>
        <FontManager artistId={id} fonts={fonts} />
      </section>
    </div>
  )
}
