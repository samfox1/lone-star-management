import { cx } from '@/lib/cx'
import type { TopSong } from '@/lib/analytics'
import { coverThumbUrl } from '@/lib/cover-url'

/**
 * The songs people played on the site, most played first, with the cover.
 *
 * One number per row — plays — because that is the one thing the site records
 * against a song. The bar is drawn against the most-played song, so the list
 * reads as "how far behind the leader is each one".
 *
 * The line above the list says how many plays named a song and how many did not.
 * A list summing to 24 under an overview reading 70 would otherwise look like a
 * bug; it is a surface on the site that plays without a track id.
 */
export function TopSongs({
  songs, attributed, unattributed, empty = 'No plays yet.', className,
}: {
  songs: TopSong[]; attributed: number; unattributed: number; empty?: string; className?: string
}) {
  if (songs.length === 0) return <p className={cx('font-space text-xs text-ink-faint', className)}>{empty}</p>
  const max = Math.max(1, ...songs.map((s) => s.plays))
  return (
    <div className={className}>
      <p className="font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        {attributed.toLocaleString('en-US')} plays named a song
        {unattributed > 0 && <> · {unattributed.toLocaleString('en-US')} did not</>}
      </p>
      <ol className="mt-2">
        {songs.map((s) => (
          <li key={s.id} className="grid grid-cols-[48px_minmax(0,1fr)_minmax(80px,1fr)_auto] items-center gap-x-4 border-b border-hairline py-2.5">
            <span className="block h-12 w-12 overflow-hidden rounded-md bg-track">
              {s.cover_url && (
                // Plain <img>, as every cover on the dashboard is: the sources already
                // serve a sized variant by URL (coverThumbUrl), so next/image would add a
                // proxy hop for nothing.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverThumbUrl(s.cover_url, 96) ?? undefined} alt="" className="h-full w-full object-cover" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-ink">{s.title}</span>
              {s.album_name && (
                <span className="block truncate font-space text-[10px] uppercase tracking-[0.1em] text-ink-faint">{s.album_name}</span>
              )}
            </span>
            <span className="h-[7px] overflow-hidden rounded-full bg-track">
              <span data-bar aria-hidden className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (s.plays / max) * 100)}%` }} />
            </span>
            <span className="font-space text-[11px] font-bold tabular-nums text-ink">
              {s.plays.toLocaleString('en-US')}<span className="sr-only"> plays</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
