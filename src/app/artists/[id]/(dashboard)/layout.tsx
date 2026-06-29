import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished } from '@/lib/content'
import { Icon } from '@/components/ui/icons'
import { Avatar, Button, buttonClass, initials, StatusDot } from '@/components/ui/ui'
import { ArtistTabs } from './artist-tabs'
import { dirtyBySeg } from './sections'
import { requireArtist } from './_data'
import { publishAction } from './actions'

/**
 * Artist-scoped dashboard shell: loads the artist once (the .single() guard is
 * the non-owner→404 gate for every sub-route, alongside the proxy's anon→login),
 * computes the unpublished diff for the per-tab dirty dots, and renders the
 * artist context bar (back / avatar / name + the Publish action bar) and the
 * section tabs around each page. Does NOT wrap /preview, which is outside this
 * route group.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const artist = await requireArtist(id)
  const diff = await diffUnpublished(supabase, id)
  const dirty = dirtyBySeg(diff)
  const anyDirty = Object.values(dirty).some(Boolean)

  return (
    <div className="font-ui text-ink flex flex-1 flex-col bg-paper">
      <header className="flex items-center gap-3 px-5 py-3.5">
        <Link href="/" title="All artists" className="group flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted transition-colors group-hover:bg-surface group-hover:text-ink">
            <Icon name="chevronLeft" size={18} />
          </span>
          <Avatar initials={initials(artist.name)} size={28} />
          <span className="text-[15px] font-bold tracking-[-0.01em]">{artist.name}</span>
        </Link>

        <div className="flex-1" />

        {anyDirty && (
          <span className="mr-1 inline-flex items-center gap-2 font-space text-xs text-ink-muted">
            <StatusDot tone="pending" /> Unpublished changes
          </span>
        )}
        <Link href={`/artists/${id}/preview`} className={buttonClass('ghost')}>
          Preview
        </Link>
        <Link href={`/${artist.slug}`} className={buttonClass('ghost')}>
          View site <Icon name="external" size={15} />
        </Link>
        <form action={publishAction.bind(null, id)}>
          <Button type="submit">Publish all</Button>
        </form>
      </header>

      <ArtistTabs artistId={id} dirty={dirty} />

      <main className="mx-auto w-full max-w-4xl px-6 py-8">{children}</main>
    </div>
  )
}
