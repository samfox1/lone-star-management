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
 * Artist-scoped dashboard shell. One compact top bar: brand (back / avatar / name
 * / on-tour) on the left, the CENTERED section nav, and the actions on the right
 * (View site / Preview / Publish all / edit) — no repeated hero. The .single() in
 * requireArtist is the non-owner→404 gate for every sub-route. Does NOT wrap
 * /preview.
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
        <Link href="/roster" title="Back to roster" className="group flex min-w-0 items-center gap-2">
          <span className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-ink-muted transition-colors group-hover:bg-surface group-hover:text-ink">
            <Icon name="chevronLeft" size={18} />
          </span>
          <Avatar initials={initials(artist.name)} size={24} />
          <b className="truncate text-[15px] font-bold tracking-[-0.01em]">{artist.name}</b>
          {onTour && (
            <span className="ml-1 hidden flex-none items-center gap-1.5 rounded-full border border-danger-border bg-danger-soft px-2 py-0.5 font-space text-[9px] uppercase tracking-[0.08em] text-accent-red sm:inline-flex">
              <StatusDot tone="live" /> On tour
            </span>
          )}
        </Link>

        {/* centered artist section nav */}
        <ArtistNav artistId={id} dirty={dirty} layout="bar" />

        {/* actions */}
        <div className="flex items-center justify-end gap-2.5">
          {anyDirty && (
            <span className="hidden items-center gap-2 font-space text-xs text-ink-muted xl:inline-flex">
              <StatusDot tone="pending" /> Unpublished
            </span>
          )}
          <Link href={`/${artist.slug}`} className={buttonClass('ghost', 'hidden sm:inline-flex')}>
            View site <Icon name="external" size={15} />
          </Link>
          <Link href={`/artists/${id}/preview`} className={buttonClass('ghost', 'hidden sm:inline-flex')}>
            Preview
          </Link>
          <form action={publishAction.bind(null, id)}>
            <Button type="submit">Publish all</Button>
          </form>
          <Link
            href={`/artists/${id}/edit`}
            title="Edit info"
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
          >
            <Icon name="edit" size={16} />
          </Link>
        </div>
      </header>

      {/* mobile section strip */}
      <ArtistNav artistId={id} dirty={dirty} layout="strip" />

      <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
    </div>
  )
}
