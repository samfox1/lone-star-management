import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { diffUnpublished } from '@/lib/content'
import { Icon } from '@/components/ui/icons'
import { Avatar, Button, buttonClass, initials, StatusDot } from '@/components/ui/ui'
import { ArtistNav } from './artist-tabs'
import { dirtyBySeg } from './sections'
import { requireArtist } from './_data'
import { publishAction } from './actions'

/** Today as YYYY-MM-DD, out of render so it isn't an impure call. */
function todayIso(): string {
  return new Date(Date.now()).toISOString().slice(0, 10)
}

/**
 * Artist-scoped dashboard shell. The artist's sections live in the CENTERED top
 * nav (like the prototype); the bar's right side keeps the Publish workflow. A
 * hero below carries the artist identity (avatar / name / on-tour / handle) and
 * the View-site + edit actions. The .single() in requireArtist is the
 * non-owner→404 gate for every sub-route. Does NOT wrap /preview.
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

  // "On tour" = has an upcoming tour date (RLS-scoped). Real signal, not a flag.
  const { count } = await supabase
    .from('tour_dates')
    .select('id', { count: 'exact', head: true })
    .eq('artist_id', id)
    .gte('date', todayIso())
  const onTour = (count ?? 0) > 0

  return (
    <div className="font-ui text-ink flex flex-1 flex-col bg-paper">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-hairline px-5 py-3.5">
        {/* brand: back to roster + small avatar + name */}
        <Link href="/" title="Back to roster" className="group flex min-w-0 items-center gap-2">
          <span className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-ink-muted transition-colors group-hover:bg-surface group-hover:text-ink">
            <Icon name="chevronLeft" size={18} />
          </span>
          <Avatar initials={initials(artist.name)} size={24} />
          <b className="truncate text-[15px] font-bold tracking-[-0.01em]">{artist.name}</b>
        </Link>

        {/* centered artist section nav */}
        <ArtistNav artistId={id} dirty={dirty} layout="bar" />

        {/* publish tools */}
        <div className="flex items-center justify-end gap-3">
          {anyDirty && (
            <span className="hidden items-center gap-2 font-space text-xs text-ink-muted lg:inline-flex">
              <StatusDot tone="pending" /> Unpublished
            </span>
          )}
          <Link href={`/artists/${id}/preview`} className={buttonClass('ghost')}>
            Preview
          </Link>
          <form action={publishAction.bind(null, id)}>
            <Button type="submit">Publish all</Button>
          </form>
        </div>
      </header>

      {/* mobile section strip */}
      <ArtistNav artistId={id} dirty={dirty} layout="strip" />

      {/* hero */}
      <div className="mx-auto w-full max-w-5xl px-6 pt-8">
        <div className="flex items-center gap-[18px]">
          <Avatar initials={initials(artist.name)} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 text-[25px] font-bold tracking-[-0.01em]">
              <span className="truncate">{artist.name}</span>
              {onTour && (
                <span className="inline-flex flex-none items-center gap-1.5 rounded-full border border-danger-border bg-danger-soft px-2.5 py-1 font-space text-[10px] uppercase tracking-[0.08em] text-accent-red">
                  <StatusDot tone="live" /> On tour
                </span>
              )}
            </div>
            <div className="mt-1.5 font-space text-xs text-ink-muted">
              /{artist.slug} · lonestar.fm/{artist.slug}
            </div>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <Link href={`/${artist.slug}`} className={buttonClass('ghost')}>
              View site <Icon name="external" size={15} />
            </Link>
            <Link
              href={`/artists/${id}/edit`}
              title="Edit info"
              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
            >
              <Icon name="edit" size={17} />
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
