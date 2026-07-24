import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { type EditorProject } from '../inspector-types'
import { plural } from '../inspector-shared'
import { SongThumb, AddFirstLink } from '../inspector-grid'

/**
 * The Music panel lists PROJECTS (Sam, 2026-07-21): one card per album / EP / single.
 * Each multi-song card shows its cover with the tracklist to the RIGHT (Sam, 2026-07-24)
 * — a scrollable column the SAME height as the cover, so every song is reachable at a
 * glance without expanding anything. A single is just its cover: its one song is the
 * project itself, so a tracklist would only repeat the title. The per-project on/off
 * toggle flips `on_site` on the project's songs (the site's gate), leaving `released`
 * (the library label) alone. Songs are entered/renamed on the Music page; here the
 * manager only chooses which projects show.
 */
export function MusicTools({
  releases,
  artistId,
  onToggleOnSite,
}: {
  releases: EditorProject[]
  artistId: string
  onToggleOnSite: (r: EditorProject) => void
}) {
  if (releases.length === 0) {
    return (
      <div className="px-5 py-4">
        <AddFirstLink href={`/artists/${artistId}/music`} label="Add music first" />
      </div>
    )
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {releases.map((r) => {
        // An off-site card dims — but never the toggle, or the one control that turns it
        // back on reads as disabled. The dim rides the content, not the card, so the
        // toggle sits outside it at full strength.
        const dim = !r.onSite ? 'opacity-55' : undefined
        // The tracklist is for albums/EPs; a single IS its song, so listing it beside the
        // cover would just echo the title.
        const showList = r.songs.length > 1
        return (
          <div key={r.key} className="rounded-lg border border-hairline p-2">
            <div className="mb-2 flex items-start gap-2">
              <div className={cx('min-w-0 flex-1', dim)}>
                <span className="block truncate text-[12px] font-medium text-ink">{r.title || 'Untitled'}</span>
                <span className="block font-space text-[9px] text-ink-faint">{plural(r.songs.length, 'song')}</span>
              </div>
              <button
                type="button"
                aria-label={r.onSite ? `Take ${r.title || 'project'} off the site` : `Put ${r.title || 'project'} on the site`}
                aria-pressed={r.onSite}
                onClick={() => onToggleOnSite(r)}
                className={cx(
                  'flex h-6 w-6 flex-none items-center justify-center rounded-full transition-colors',
                  r.onSite ? 'bg-accent text-white' : 'bg-surface text-ink shadow-sm hover:bg-accent hover:text-white',
                )}
              >
                <Icon name={r.onSite ? 'check' : 'plus'} size={13} />
              </button>
            </div>
            {/* Cover on the left, tracklist to its right at the SAME height, scrollable. */}
            <div className={cx('flex gap-2.5', dim)}>
              <div className={cx('relative flex-none', showList ? 'w-24' : 'w-16')}>
                <div className="overflow-hidden rounded-md">
                  <SongThumb coverUrl={r.cover_url} />
                </div>
                <span className="absolute left-1 top-1 rounded bg-ink/70 px-1 py-0.5 font-space text-[8px] font-bold uppercase tracking-[0.06em] text-paper">
                  {RELEASE_TYPE_LABEL[r.kind as ReleaseType] ?? r.kind}
                </span>
              </div>
              {showList && (
                <ol className="no-scrollbar h-24 min-w-0 flex-1 space-y-0.5 overflow-y-auto">
                  {r.songs.map((song, i) => (
                    <li key={song.id} className="flex items-baseline gap-2 text-[12px] leading-snug text-ink">
                      <span className="w-4 flex-none text-right font-space text-[10px] text-ink-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{song.title || 'Untitled'}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
