import Link from 'next/link'
import { Icon } from '@/components/ui/icons'
import { Button, Card, buttonClass } from '@/components/ui/ui'
import { createClient } from '@/lib/supabase/server'
import { dashboardDiff, getShopifyDomain, requireArtist } from '../_data'
import { connectedCount } from '../integrations'
import { dirtyBySeg } from '../sections'
import { publishAction } from '../actions'
import { TOOLS } from '../tools-rail'

/**
 * The Overview of the manager-tools dashboard (Sam, 2026-08-28): what state the site is
 * in, the actions that matter, and every tool with a line on what it is for. The side
 * panel (tools-rail.tsx) is the navigation; this page is the front door.
 */
export default async function ToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const [artist, shopifyDomain, diff, { count: subscribers }, { count: enquiries }] = await Promise.all([
    requireArtist(id),
    getShopifyDomain(id),
    dashboardDiff(id),
    supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('artist_id', id),
    supabase.from('enquiries').select('id', { count: 'exact', head: true }).eq('artist_id', id).is('read_at', null),
  ])
  const dirty = dirtyBySeg(diff)
  const connected = connectedCount(artist, !!shopifyDomain)
  const unpublished = Object.values(dirty).filter(Boolean).length

  const stats: { value: string | number; label: string; href: string; tone?: 'accent' }[] = [
    { value: unpublished ? `${unpublished} section${unpublished === 1 ? '' : 's'}` : 'Live', label: unpublished ? 'unpublished' : 'everything published', href: `/artists/${id}/site`, tone: unpublished ? 'accent' : undefined },
    { value: subscribers ?? 0, label: 'subscribers', href: `/artists/${id}/subscribers` },
    { value: enquiries ?? 0, label: 'unread enquiries', href: `/artists/${id}/enquiries`, tone: enquiries ? 'accent' : undefined },
    { value: connected, label: `source${connected === 1 ? '' : 's'} connected`, href: `/artists/${id}/tools/integrations` },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href={`/${artist.slug}`} className={buttonClass('ghost')}>
            View site <Icon name="external" size={15} />
          </Link>
          <Link href={`/artists/${id}/preview`} className={buttonClass('ghost')}>
            Preview
          </Link>
          <Link href={`/artists/${id}/editor`} className={buttonClass('ghost')}>
            Edit site
          </Link>
          <form action={publishAction.bind(null, id)}>
            <Button type="submit">Publish all</Button>
          </form>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="h-full p-5 transition-colors hover:border-ink-faint">
              <div className={`font-space text-[25px] font-bold tracking-[-0.02em] ${s.tone === 'accent' ? 'text-accent' : ''}`}>{s.value}</div>
              <div className="mt-1.5 font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{s.label}</div>
            </Card>
          </Link>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.filter((t) => t.seg !== 'tools').map((t) => (
          <Link key={t.seg} href={`/artists/${id}/${t.seg}`}>
            <Card className="flex h-full items-center gap-3.5 p-5 transition-colors hover:border-ink-faint">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-surface text-ink-muted">
                <Icon name={t.icon} size={18} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-bold">
                  {t.label}
                  {dirty[t.seg] && <span className="h-[6px] w-[6px] rounded-full bg-accent" aria-label="Unpublished changes" />}
                </div>
                <div className="mt-0.5 truncate font-space text-[11px] text-ink-faint">{t.desc}</div>
              </div>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  )
}
