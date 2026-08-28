import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SEO_FIELDS } from '@/lib/site-content-schema'
import { Icon } from '@/components/ui/icons'
import { Card, KLabel, buttonClass } from '@/components/ui/ui'
import { mediaUrl } from '@/lib/storage-url'
import { publicSiteOrigin } from '@/lib/custom-site'
import { requireArtist } from '../../_data'
import { OgImagePicker, type OgSource } from './og-image-picker'
import { publishSiteAction } from '../../actions'
import { SeoAbout, SeoFacts, SeoWords } from './seo-fields'
import { AuditPanel } from './audit-panel'
import { CopyButton } from './copy-button'

/**
 * SEO / GEO (SEO_GEO_PLAN). One screen: the live check on top, then the things the
 * manager owns as cards — the search listing, the facts, the bio, the pictures, the AI
 * probe. Each card carries one line on what it is and one on how to check it (Sam,
 * 2026-08-28: clean and consistent, not paragraphs). The rules live in the bridge
 * (`@samfox1/site-bridge/seo`) and ship on every connected site.
 */

/** PROBE_PROMPTS v1 — FROZEN. They read the name and the artist TYPE only, never a fact the
 *  site is supposed to teach. Change the wording only with a new version. */
export const PROBE_VERSION = 'v1'
export function probePrompts(name: string, schemaType: string): string[] {
  const role = schemaType === 'Person' ? 'the artist' : 'the musician'
  return [
    `Who is ${name}, ${role}?`,
    `What kind of music does ${name} make, and where are they based?`,
    `When is ${name} playing next?`,
    `What has ${name} released recently?`,
    `${name} official website`,
  ]
}

export default async function SeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const [{ data: rows }, { data: facts }, { data: mediaRows }, { data: gallery }] = await Promise.all([
    supabase.from('site_content').select('key, value').eq('artist_id', id),
    supabase.from('artists').select('bio, genre, location, schema_type, hero_image_url').eq('id', id).single(),
    supabase.from('media').select('purpose, storage_path').eq('artist_id', id).in('purpose', ['logo_primary', 'logo_secondary', 'profile_photo']),
    supabase.from('media').select('alt, kind, slug').eq('artist_id', id).eq('purpose', 'gallery_image').eq('on_site', true),
  ])
  const content = Object.fromEntries((rows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']))
  const seo = Object.fromEntries(SEO_FIELDS.map((f) => [f.key, content[f.key] ?? '']))
  const bio = ((facts?.bio as string | null) ?? '').trim()
  const artistFacts = {
    genre: (facts?.genre as string | null) ?? '',
    location: (facts?.location as string | null) ?? '',
    schema_type: (facts?.schema_type as string | null) ?? 'MusicGroup',
  }
  const siteUrl = publicSiteOrigin(artist)

  const LABEL: Record<string, string> = { logo_primary: 'Primary logo', logo_secondary: 'Secondary logo', profile_photo: 'Profile photo' }
  const ORDER = ['logo_primary', 'logo_secondary', 'profile_photo']
  const sources: OgSource[] = (mediaRows ?? [])
    .sort((a, b) => ORDER.indexOf(a.purpose as string) - ORDER.indexOf(b.purpose as string))
    .map((m) => ({ url: mediaUrl(m.storage_path as string), label: LABEL[m.purpose as string] ?? 'Image' }))
  const heroUrl = (facts?.hero_image_url as string | null) ?? null
  if (heroUrl) sources.push({ url: heroUrl, label: 'Hero image' })

  const photos = gallery ?? []
  const withAlt = photos.filter((p) => ((p.alt as string | null) ?? '').trim()).length
  const withSlug = photos.filter((p) => p.slug).length

  const enc = siteUrl ? encodeURIComponent(siteUrl + '/') : ''
  const external = siteUrl
    ? [
        { label: 'Rich Results', href: `https://search.google.com/test/rich-results?url=${enc}` },
        { label: 'Schema', href: `https://validator.schema.org/#url=${enc}` },
        { label: 'Lighthouse', href: `https://pagespeed.web.dev/analysis?url=${enc}` },
        { label: 'Search Console', href: 'https://search.google.com/search-console' },
        { label: 'Bing', href: 'https://www.bing.com/webmasters' },
      ]
    : []

  return (
    <div className="space-y-6">
      {/* Actions, right-aligned like every other tool page. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {external.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'text-[11px]')}>
            {l.label} <Icon name="external" size={12} />
          </a>
        ))}
        <form action={publishSiteAction.bind(null, id)}>
          <button type="submit" className={buttonClass('solid')}>
            Publish site
          </button>
        </form>
      </div>

      <Tile label="Live check" what="Fetches the public site as a crawler would and checks every findability rule." check="Run after each publish.">
        <AuditPanel artistId={id} siteUrl={siteUrl} />
      </Tile>

      <div className="grid gap-6 lg:grid-cols-2">
        <Tile label="Search listing" what="The link and the grey line under it. Blank = the name and the bio." check="Search the name; Search Console → Performance.">
          <SeoWords artistId={id} name={artist.name} initial={seo} />
          <div className="mt-5 border-t border-hairline pt-4">
            <KLabel>Social card</KLabel>
            <div className="mt-3">
              <OgImagePicker artistId={id} sources={sources} currentUrl={content.og_image ?? ''} />
            </div>
          </div>
        </Tile>

        <div className="grid content-start gap-6">
          <Tile label="Facts" what="What the fact sheet states about the artist. Shows, releases and videos fill in from what is published." check="Rich Results; ask an AI engine the genre.">
            <SeoFacts artistId={id} initial={artistFacts} />
          </Tile>

          <Tile label="Bio" what="Visible words are what AI answers quote. Hidden still feeds search." check="Open /about; Search Console → Pages.">
            <SeoAbout artistId={id} initial={seo} />
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className={`font-space text-[11px] ${bio ? 'text-ink-faint' : 'text-status-pending'}`}>{bio ? `${bio.length} characters` : 'No bio yet'}</span>
              <Link href={`/artists/${id}/editor`} className={buttonClass('ghost', 'text-[11px]')}>
                Edit bio <Icon name="edit" size={12} />
              </Link>
            </div>
          </Tile>

          <Tile label="Pictures" what="Every photo carries alt text and a named file; both are recommended automatically." check="Google Images; Lighthouse → Accessibility.">
            <div className="flex items-end justify-between gap-4">
              <div className="grid grid-cols-3 gap-6">
                <Stat value={photos.length} label="on the site" />
                <Stat value={withAlt} label="own alt text" />
                <Stat value={withSlug} label="named file" />
              </div>
              <Link href={`/artists/${id}/editor`} className={buttonClass('ghost', 'text-[11px]')}>
                Images <Icon name="photo" size={12} />
              </Link>
            </div>
          </Tile>
        </div>

        <Tile
          label={`AI probe · ${PROBE_VERSION}`}
          what="Ask ChatGPT, Perplexity, Google AI Mode and Copilot, signed out. Note: cited or not, facts right or wrong."
          check="Target: prompts 1, 2, 5 cite the site in two of four engines."
          className="lg:col-span-2"
        >
          <ol className="grid gap-2 md:grid-cols-2">
            {probePrompts(artist.name, artistFacts.schema_type).map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 font-space text-[11px] text-ink-faint">{i + 1}</span>
                  {p}
                </span>
                <CopyButton text={p} />
              </li>
            ))}
          </ol>
        </Tile>
      </div>
    </div>
  )
}

/** One card: mono eyebrow, a line on what it is, the controls, a mono "check" line. */
function Tile({ label, what, check, className, children }: { label: string; what: string; check: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={`flex flex-col p-5 ${className ?? ''}`}>
      <KLabel>{label}</KLabel>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">{what}</p>
      <div className="mt-4 flex-1">{children}</div>
      <p className="mt-5 border-t border-hairline-soft pt-3 font-space text-[10px] text-ink-faint">
        <span className="font-bold uppercase tracking-[0.1em]">Check </span>
        {check}
      </p>
    </Card>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-space text-[22px] font-bold tracking-[-0.02em]">{value}</div>
      <div className="mt-1 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
    </div>
  )
}
