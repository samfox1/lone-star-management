import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { type EditorProject } from '../inspector-types'
import { plural, EYEBROW } from '../inspector-shared'
import { SongThumb, AddFirstLink } from '../inspector-grid'

/* ── Music tools: the setlist as on-site cover cards + an Add tile (mirrors Videos).
 * Songs are entered/renamed on the Music page; here the manager just picks which are on
 * the site. Remove takes a song off (never deletes); Replace swaps it for another from
 * the catalog — the old one only leaves once a replacement is chosen. */
/** Album/EP/single, shown as a short mono tag on each project cover. */
/**
 * The Music panel lists PROJECTS, not songs (Sam, 2026-07-21): the site renders one
 * cover per album/EP/single, so listing every track inside an album is noise. Projects
 * are a 3-up cover grid ordered newest-first (by release date, in page.tsx) with a
 * per-project on/off toggle. A project's on/off flips `on_site` on its songs — the flag
 * the site gates on — leaving `released` (the library label) alone. Songs are managed on
 * the Music page; here the manager only chooses which projects show.
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
  const [open, setOpen] = useState<string | null>(null)
  if (releases.length === 0) {
    return (
      <div className="px-5 py-4">
        <AddFirstLink href={`/artists/${artistId}/music`} label="Add music first" />
      </div>
    )
  }

  // Cards are 3-up. Clicking one opens its tracklist FULL-WIDTH under its row (not just
  // under the card), so it reads as "these songs belong to this album" — which needs the
  // grid chunked into rows of 3, with the open list injected after the owning row.
  const rows: EditorProject[][] = []
  for (let i = 0; i < releases.length; i += 3) rows.push(releases.slice(i, i + 3))

  return (
    <div className="space-y-2.5 px-5 py-4">
      {rows.map((row, ri) => {
        const openInRow = row.find((r) => r.key === open)
        return (
          <div key={ri} className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {row.map((r) => {
                const isOpen = r.key === open
                // An off-site card dims — but the toggle must NOT, or the one control that
                // turns it back on reads as disabled. CSS opacity composites the whole
                // subtree, so the dim lives on the thumbnail/tag/text, never on the card,
                // and the toggle button sits outside it at full strength.
                const dim = !r.onSite && 'opacity-55'
                return (
                  <div
                    key={r.key}
                    className={cx(
                      'relative overflow-hidden rounded-lg border',
                      isOpen ? 'border-accent ring-1 ring-accent' : 'border-hairline',
                    )}
                  >
                    {/* The card face expands the tracklist; the on/off toggle is a SIBLING
                        overlaid on top (valid HTML — no button inside a button — and it
                        receives its own clicks without needing stopPropagation). */}
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${r.title || 'Untitled'} — ${plural(r.songs.length, 'song')}`}
                      onClick={() => setOpen(isOpen ? null : r.key)}
                      className="block w-full text-left"
                    >
                      <div className={cx('relative', dim)}>
                        <SongThumb coverUrl={r.cover_url} />
                        <span className="absolute left-1 top-1 rounded bg-ink/70 px-1 py-0.5 font-space text-[8px] font-bold uppercase tracking-[0.06em] text-paper">
                          {RELEASE_TYPE_LABEL[r.kind as ReleaseType] ?? r.kind}
                        </span>
                      </div>
                      <div className={cx('px-1.5 py-1', dim)}>
                        <span className="block truncate text-[11px] text-ink">{r.title || 'Untitled'}</span>
                        <span className="block font-space text-[9px] text-ink-faint">{plural(r.songs.length, 'song')}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={r.onSite ? `Take ${r.title || 'project'} off the site` : `Put ${r.title || 'project'} on the site`}
                      aria-pressed={r.onSite}
                      onClick={() => onToggleOnSite(r)}
                      className={cx(
                        'absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition-colors',
                        r.onSite ? 'bg-accent text-white' : 'bg-paper text-ink shadow-sm hover:bg-accent hover:text-white',
                      )}
                    >
                      <Icon name={r.onSite ? 'check' : 'plus'} size={12} />
                    </button>
                  </div>
                )
              })}
            </div>

            {openInRow && (
              <div className="rounded-lg bg-surface px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className={cx(EYEBROW, 'flex-1 truncate')}>{openInRow.title || 'Untitled'}</span>
                  <span className="font-space text-[9px] text-ink-faint">{plural(openInRow.songs.length, 'song')}</span>
                </div>
                <ol className="space-y-0.5">
                  {openInRow.songs.map((song, i) => (
                    <li key={song.id} className="flex items-baseline gap-2 text-[12px] text-ink">
                      <span className="w-4 flex-none text-right font-space text-[10px] text-ink-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{song.title}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
