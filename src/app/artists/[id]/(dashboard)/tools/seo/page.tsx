import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SEO_FIELDS } from '@/lib/site-content-schema'
import { Icon } from '@/components/ui/icons'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { mediaUrl } from '@/lib/storage-url'
import { requireArtist } from '../../_data'
import { OgImagePicker, type OgSource } from './og-image-picker'
import { publishSiteAction, saveSeoAction } from '../../actions'

/** Editor hint per SEO field: what the public page uses when the field is blank. */
const PLACEHOLDER: Record<string, (name: string) => string> = {
  seo_title: (name) => name,
  seo_description: (name) => `${name} — official site (or the bio)`,
  og_image: () => 'Defaults to the hero image',
}

/**
 * SEO — cross-template overrides for how the artist's public site appears in
 * search results and social shares. Stored as site_content (draft until the Site
 * section publishes); `lib/seo.ts` reads them for the public <head>. Blank = auto
 * (falls back to name / bio / hero image).
 */
export default async function SeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const { data: rows } = await supabase
    .from('site_content')
    .select('key, value')
    .eq('artist_id', id)
  const content = Object.fromEntries(
    (rows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']),
  )

  // What the card can be built FROM: the artist's own images. Logos first — a social
  // card is brand identity, and the logo is the thing designed to sit on a flat colour.
  // requireArtist selects config columns only, so the hero is fetched here alongside
  // the brand images rather than widening that shared query for one page.
  const [{ data: mediaRows }, { data: heroRow }] = await Promise.all([
    supabase
      .from('media')
      .select('purpose, storage_path')
      .eq('artist_id', id)
      .in('purpose', ['logo_primary', 'logo_secondary', 'profile_photo']),
    supabase.from('artists').select('hero_image_url').eq('id', id).single(),
  ])
  const LABEL: Record<string, string> = {
    logo_primary: 'Primary logo',
    logo_secondary: 'Secondary logo',
    profile_photo: 'Profile photo',
  }
  const ORDER = ['logo_primary', 'logo_secondary', 'profile_photo']
  const sources: OgSource[] = (mediaRows ?? [])
    .sort((a, b) => ORDER.indexOf(a.purpose as string) - ORDER.indexOf(b.purpose as string))
    .map((m) => ({ url: mediaUrl(m.storage_path as string), label: LABEL[m.purpose as string] ?? 'Image' }))
  const heroUrl = (heroRow?.hero_image_url as string | null) ?? null
  if (heroUrl) sources.push({ url: heroUrl, label: 'Hero image' })

  return (
    <div className="max-w-2xl space-y-8">
      <Link
        href={`/artists/${id}/tools`}
        className="inline-flex items-center gap-1 font-space text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <Icon name="chevronLeft" size={15} /> Manager tools
      </Link>

      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <h1 className="text-[19px] font-bold tracking-[-0.01em]">SEO</h1>
        <form action={publishSiteAction.bind(null, id)}>
          <button type="submit" className={buttonClass('ghost')}>
            Publish site
          </button>
        </form>
      </div>

      <p className="font-space text-xs leading-relaxed text-ink-faint">
        How <b className="font-bold text-ink">{artist.name}</b>&rsquo;s site appears in search results
        and social previews. Leave a field blank to use the automatic default (name, bio, hero image).
        Draft until you publish the site.
      </p>

      <form action={saveSeoAction.bind(null, id)} className="space-y-4">
        {SEO_FIELDS.filter((f) => f.key !== 'og_image').map((f) => (
          <label key={f.key} className="block">
            <span className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
              {f.label}
            </span>
            <input
              name={f.key}
              defaultValue={content[f.key] ?? ''}
              placeholder={PLACEHOLDER[f.key]?.(artist.name) ?? ''}
              className={`mt-1.5 ${inputClass} w-full`}
            />
          </label>
        ))}
        <button type="submit" className={buttonClass('ghost')}>
          Save SEO
        </button>
      </form>

      {/* Outside the SEO form on purpose: the card SAVES ITSELF (it uploads bytes and
          writes og_image), so nesting it would offer a Save button that does not save it
          and a form submit that silently overwrites the URL it just stored. */}
      <div className="space-y-2 border-t border-hairline pt-6">
        <h2 className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">
          Social preview image
        </h2>
        <OgImagePicker artistId={id} sources={sources} currentUrl={content.og_image ?? ''} />
      </div>
    </div>
  )
}
