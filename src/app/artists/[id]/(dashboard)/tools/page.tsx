import Link from 'next/link'
import { Icon, type IconName } from '@/components/ui/icons'
import { Button, Card, KLabel, buttonClass } from '@/components/ui/ui'
import { getShopifyDomain, requireArtist } from '../_data'
import { connectedCount } from '../integrations'
import { publishAction } from '../actions'

/**
 * Manager tools — the per-artist utility hub. Folds what used to be separate
 * top-nav tabs (Site, Links, Press kit, Subscribers, Integrations, Settings) plus
 * the publish/preview/edit actions into one place, so the section nav stays
 * focused on the artist's public content (Music / Tour / Videos / Merch).
 */
export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artist = await requireArtist(id)
  const shopifyDomain = await getShopifyDomain(id)

  const connected = connectedCount(artist, !!shopifyDomain)

  const tools: { seg: string; icon: IconName; title: string; desc: string }[] = [
    { seg: 'site', icon: 'site', title: 'Site & profile', desc: 'Template, site text, photos & video' },
    // Beside SEO on purpose: both own how the artist is REPRESENTED elsewhere (tab icon,
    // social card) rather than what the site contains.
    { seg: 'brand', icon: 'photo', title: 'Brand', desc: 'Logos & browser tab icon' },
    { seg: 'tools/seo', icon: 'search', title: 'SEO', desc: 'Search & social preview' },
    { seg: 'links', icon: 'links', title: 'Links', desc: 'Social & external links' },
    { seg: 'epk', icon: 'epk', title: 'Press kit', desc: 'Shareable EPK one-pager' },
    { seg: 'subscribers', icon: 'list', title: 'Subscribers', desc: 'Emails from the site popup' },
    {
      seg: 'tools/integrations',
      icon: 'integrations',
      title: 'Integrations',
      desc: connected > 0 ? `${connected} source${connected === 1 ? '' : 's'} connected` : 'Connect data sources',
    },
  ]

  return (
    <div className="space-y-10">
      <h1 className="text-[19px] font-bold tracking-[-0.01em]">Manager tools</h1>

      <section>
        <KLabel>This artist</KLabel>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Link href={`/${artist.slug}`} className={buttonClass('ghost')}>
            View site <Icon name="external" size={15} />
          </Link>
          <Link href={`/artists/${id}/preview`} className={buttonClass('ghost')}>
            Preview
          </Link>
          <Link href={`/artists/${id}/edit`} className={buttonClass('ghost')}>
            Edit info
          </Link>
          <form action={publishAction.bind(null, id)}>
            <Button type="submit">Publish all</Button>
          </form>
        </div>
      </section>

      <section>
        <KLabel>Manage</KLabel>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => (
            <Link key={t.seg} href={`/artists/${id}/${t.seg}`}>
              <Card className="flex h-full items-center gap-3.5 p-5 transition-colors hover:border-ink-faint">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-surface text-ink-muted">
                  <Icon name={t.icon} size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{t.title}</div>
                  <div className="mt-0.5 font-space text-[11px] leading-snug text-ink-muted">{t.desc}</div>
                </div>
                <Icon name="chevronRight" size={16} className="ml-auto flex-none text-ink-faint" />
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
