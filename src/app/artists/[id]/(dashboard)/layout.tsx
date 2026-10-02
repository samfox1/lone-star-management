import { ToolsShell } from './(manager-tools)/_shell/tools-rail'
import { AssetsShell } from './assets-rail'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isCustom } from '@/lib/custom-site'
import { Icon } from '@/components/ui/icons'
import { Avatar, initials, StatusDot } from '@/components/ui/ui'
import { ArtistNav } from './artist-tabs'
import { dirtyBySeg } from './sections'
import { dashboardDiff, requireArtist } from './_data'
import { Toaster } from './toast'
import { NAV_GROUP_HOVER } from './nav-hover'

/** Today as YYYY-MM-DD, out of render so it isn't an impure call. */
function todayIso(): string {
  return new Date(Date.now()).toISOString().slice(0, 10)
}

/**
 * Artist-scoped dashboard shell. One compact top bar: brand (back / avatar / name
 * / on-tour) on the left, the CENTERED section nav, and a minimal tools cluster
 * (search / settings / avatar) on the right — the per-artist publish / preview /
 * view-site / edit actions live on the Settings tab. Full-width content. The
 * .single() in requireArtist is the non-owner→404 gate. Does NOT wrap /preview.
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
  // These four are independent network round-trips to the hosted DB/auth. Run them
  // as ONE parallel wave instead of a serial waterfall — the shell paints after the
  // slowest, not the sum. requireArtist stays cache()d so each page's own call is deduped.
  const [
    artist,
    {
      data: { user },
    },
    diff,
    { count },
  ] = await Promise.all([
    requireArtist(id),
    supabase.auth.getUser(),
    dashboardDiff(id),
    // "On tour" = has an upcoming tour date (RLS-scoped). Real signal, not a flag.
    supabase.from('tour_dates').select('id', { count: 'exact', head: true }).eq('artist_id', id).gte('date', todayIso()),
  ])
  const dirty = dirtyBySeg(diff)
  const onTour = (count ?? 0) > 0

  return (
    // `relative` is load-bearing: the side rails hang their full-height lanes off THIS box
    // (RAIL_LANE, tools-rail.tsx: RIDING THE BOUNCE), so it is what makes a lane run from
    // the top of the page to the bottom. Nothing between here and the rails may be
    // positioned, or the lanes shrink to that box instead.
    <div className="font-ui text-ink relative flex flex-1 flex-col bg-paper">
      {/* STICKY (Sam, 2026-09-10, with a screenshot of the Integrations page mid-scroll:
          "the vertical line on the side bar disconnects… I think the top nav bar should
          stay in place when scrolling"). The tools and assets rails were `fixed` to the
          viewport at top:71px — this header's rendered height — so they stayed put while
          the page scrolled. The header did not, so it scrolled away and left the rail
          pinned 71px down with blank paper above it and its border-right meeting nothing.
          Pinning the header is what made the rail meet the bar at every scroll offset.
          (The rails now run from the very top, under this bar, and are sticky like it:
          see RIDING THE BOUNCE in tools-rail.tsx.)

          z-30: under the modal overlay (z-50) and the toasts (z-60), above page content
          and the side rails (z-10 / z-20). `bg-paper` because a sticky element with no
          background lets the page show through it as it scrolls underneath.

          THE BOUNCE COVER (`before:` classes, Sam, 2026-09-10, fourth screenshot: "now
          when I scroll far enough down I see the line above the nav bar"). A Mac trackpad
          scrolled past the top rubber-bands the page and this sticky header rides that
          bounce. While the side rails were FIXED they did not, so for the length of the
          bounce their full-height line showed in the gap above the bar. Since 2026-10-01
          the rails are sticky too and ride the bounce with the bar (Sam: "allow the side
          panels to move with the scroll like that too"), so there is no line up there any
          more. The cover stays for the other thing in that gap: the canvas, which is the
          body's `--background` and near-black when the Mac is in dark mode. The ::before
          is a screen-tall block of paper hung above the header — off-screen at rest, and
          exactly filling the exposed gap during a bounce because it moves with the header.

          Not pinned by a test — jsdom does no layout, headless Chromium does not bounce,
          and this is an async server component that reads the database. */}
      <header className="sticky top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center border-b border-hairline bg-paper px-5 py-3.5 before:absolute before:inset-x-0 before:bottom-full before:h-screen before:bg-paper before:content-['']">
        {/* brand: back to roster + small avatar + name */}
        <Link href="/roster" title="Back to roster" className="group flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg text-ink-muted transition-colors ${NAV_GROUP_HOVER}`}>
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

        {/* tools: search / settings / avatar (like the roster) */}
        <div className="flex items-center justify-end gap-3.5 text-ink-muted">
          <Link href="/" title="Home / search" className="inline-flex transition-colors hover:text-ink">
            <Icon name="search" size={18} />
          </Link>
          <Link
            href={`/artists/${id}/tools`}
            title="Manager tools"
            className="inline-flex transition-colors hover:text-ink"
          >
            <Icon name="settings" size={18} />
          </Link>
          <Link href="/account" title={user?.email ?? 'Account'}>
            <Avatar initials={initials(user?.email ?? '?')} size={30} />
          </Link>
        </div>
      </header>

      {/* mobile section strip */}
      <ArtistNav artistId={id} dirty={dirty} layout="strip" />

      <main className="w-full px-7 py-8">
        {/* On a tool route this adds the tools side panel; on an assets route (music /
            images / videos) the assets rail; elsewhere it is the page alone. Both live HERE
            so they persist across a tab switch while the page beneath streams in behind
            its loading.tsx (2026-09-10). */}
        <ToolsShell artistId={id} customSite={isCustom(artist)}>
          <AssetsShell artistId={id}>{children}</AssetsShell>
        </ToolsShell>
      </main>
      <Toaster />
    </div>
  )
}
