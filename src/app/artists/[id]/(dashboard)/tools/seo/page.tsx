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
 * SEO / GEO (SEO_GEO_PLAN, Sam 2026-08-26): one page that explains every tool the site
 * uses to be found — by search engines AND by AI answer engines — lets the manager edit
 * what is theirs to edit, and says how to check each one is working. The rules live in
 * the bridge (`@samfox1/site-bridge/seo`) and ship on every connected site; this page
 * is the manager's window onto them.
 */

/** The five prompts of the AI probe — ask them, note who cites the site. Fixed, so the
 *  comparison stays honest across months. */
function probePrompts(name: string, location: string): string[] {
  const who = location ? `${name}, the ${location} artist` : name
  return [
    `Who is ${who}?`,
    `What genre of music does ${name} make?`,
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
        { label: 'Rich Results Test', href: `https://search.google.com/test/rich-results?url=${enc}` },
        { label: 'Schema validator', href: `https://validator.schema.org/#url=${enc}` },
        { label: 'PageSpeed / Lighthouse', href: `https://pagespeed.web.dev/analysis?url=${enc}` },
        { label: 'Search Console', href: 'https://search.google.com/search-console' },
        { label: 'Bing Webmaster', href: 'https://www.bing.com/webmasters' },
      ]
    : []

  return (
    <div className="max-w-3xl space-y-10">
      <Link href={`/artists/${id}/tools`} className="inline-flex items-center gap-1 font-space text-xs text-ink-muted transition-colors hover:text-ink">
        <Icon name="chevronLeft" size={15} /> Manager tools
      </Link>

      <div className="flex items-end justify-between border-b border-hairline pb-3">
        <div>
          <h1 className="text-[19px] font-bold tracking-[-0.01em]">SEO / GEO</h1>
          <p className="mt-1 font-space text-xs text-ink-faint">
            How {artist.name}&rsquo;s site is found by search engines (SEO) and quoted by AI answers (GEO).
            Edits are drafts until the site is published.
          </p>
        </div>
        <form action={publishSiteAction.bind(null, id)}>
          <button type="submit" className={buttonClass('ghost')}>
            Publish site
          </button>
        </form>
      </div>

      {/* 1. Live check */}
      <Section
        n="1"
        title="Is the site findable right now?"
        what="Fetches the public site the way Google does and checks the plumbing: a real description, one main heading, a heading per section, alt text on every picture, direct image URLs, a fact sheet that parses, the editor page hidden. Green here means the changes SHIPPED."
        check="Run it after every publish. Then, once a month, the tools below tell you whether Google and the AI engines noticed."
      >
        <AuditPanel artistId={id} siteUrl={siteUrl} />
        {external.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {external.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'text-[11px]')}>
                {l.label} <Icon name="external" size={12} />
              </a>
            ))}
          </div>
        )}
      </Section>

      {/* 2. The words search shows */}
      <Section
        n="2"
        title="The words search results show"
        what="The title is the blue link; the description is the grey line under it, and what a shared link previews. Blank means automatic: the artist's name, and the bio."
        check="Google: search the artist's name and read the result. Search Console → Performance shows impressions and clicks for it over time."
      >
        <SeoWords artistId={id} name={artist.name} initial={seo} />
        <div className="mt-6 space-y-2 border-t border-hairline pt-5">
          <KLabel>Social preview image</KLabel>
          <p className="font-space text-xs text-ink-faint">The card shown when the site is shared on iMessage, X, Instagram. Defaults to the hero image.</p>
          <OgImagePicker artistId={id} sources={sources} currentUrl={content.og_image ?? ''} />
        </div>
      </Section>

      {/* 3. The fact sheet */}
      <Section
        n="3"
        title="The fact sheet (JSON-LD)"
        what="Invisible text in the page that tells bots, in a standard language, who the artist is: name, genre, where they are based, links, upcoming shows, releases and their songs, videos, listed photos. Shows, releases and videos fill in on their own from what is published; these three facts are yours."
        check="Rich Results Test above: it should list the artist, and an Event for each upcoming show. Search Console → Enhancements → Events appears once Google has read it. Ask an AI engine what genre the artist makes: the answer should match this."
      >
        <SeoFacts artistId={id} initial={artistFacts} />
      </Section>

      {/* 4. The bio */}
      <Section
        n="4"
        title="Something to quote"
        what="AI answers quote visible words. A site with a great fact sheet and no paragraphs gives them nothing. The one bio you keep here feeds the About section or the /about page, the description above, and the fact sheet. Hidden still feeds search; it just does not show on the site."
        check="Open /about on the site. Search Console → Pages should list it as indexed within a few weeks. The AI probe below is the direct test."
      >
        <SeoAbout artistId={id} initial={seo} />
        <div className="mt-4 flex items-center gap-3 font-space text-xs">
          <span className={bio ? 'text-ink-muted' : 'text-status-pending'}>{bio ? `Bio: ${bio.length} characters` : 'No bio yet'}</span>
          <Link href={`/artists/${id}/editor`} className={buttonClass('ghost', 'text-[11px]')}>
            Edit the bio <Icon name="edit" size={12} />
          </Link>
        </div>
      </Section>

      {/* 5. Images */}
      <Section
        n="5"
        title="Pictures with names"
        what="Every photo carries alt text (what it shows, read aloud and quoted) and a descriptive file name (what its URL says). Both are recommended automatically from the artist and caption; edit either from Images → Edit alt tag in the editor."
        check="Google Images: search the artist's name. Lighthouse (above) → Accessibility: image elements have alt. Search Console → Performance → Search type: Image."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat value={photos.length} label="photos on the site" />
          <Stat value={withAlt} label="with their own alt text" />
          <Stat value={withSlug} label="with a named file" />
        </div>
        <Link href={`/artists/${id}/editor`} className={buttonClass('ghost', 'mt-4 text-[11px]')}>
          Open Images <Icon name="photo" size={12} />
        </Link>
      </Section>

      {/* 6. AI probe */}
      <Section
        n="6"
        title="The AI probe"
        what="There is no dashboard for 'Perplexity cited you'. The only measure is to ask. Ask each of ChatGPT (search on), Perplexity, Google AI Mode and Copilot these five prompts, and note: cited or not, and whether the facts are right. Same five, every time, so months compare."
        check="Target after the bio and fact sheet are live: prompts 1, 2 and 5 cite the site in at least two of the four engines, with the genre and location right."
      >
        <ol className="space-y-2">
          {probePrompts(artist.name, artistFacts.location).map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2 text-sm">
              <span>
                <span className="mr-2 font-space text-[11px] text-ink-faint">{i + 1}</span>
                {p}
              </span>
              <CopyButton text={p} />
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}

function Section({ n, title, what, check, children }: { n: string; title: string; what: string; check: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-baseline gap-3">
        <span className="font-space text-[11px] font-bold text-ink-faint">{n}</span>
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{what}</p>
      <div className="mt-5">{children}</div>
      <div className="mt-5 flex gap-2 border-t border-hairline pt-4">
        <span className="mt-0.5 flex-none text-ink-faint">
          <Icon name="check" size={13} />
        </span>
        <p className="font-space text-xs leading-relaxed text-ink-faint">
          <b className="font-bold text-ink-muted">How to check: </b>
          {check}
        </p>
      </div>
    </Card>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-space text-[25px] font-bold tracking-[-0.02em]">{value}</div>
      <div className="mt-1 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
    </div>
  )
}
