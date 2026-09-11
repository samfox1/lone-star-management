'use client'

import { useState } from 'react'
import { RELEASE_TYPE_LABEL } from '@/lib/releases'
import { trackPlatforms } from '@/lib/music'
import { coverThumbUrl } from '@/lib/cover-url'
import { type MergeTarget } from '../music/merge-song-modal'
import { toast } from '../toast'
import { setTrackOnSiteAction } from '../actions'
import { SelectToggle } from '../select-toggle'
import { SongModal, type ReleaseOption, type Track } from './song-modal'

export type { ReleaseOption, Track }

/**
 * A song as a cover-grid tile. Clicking it opens THE song modal (tracks/song-modal.tsx) —
 * the same one a song inside a release opens, so a song reads identically wherever it
 * lives. The tile carries the on-site mark for a release-less song.
 */
export function TrackCard({
  track,
  artistId,
  artistSlug,
  releases,
  hideBadges = false,
  mergeTargets = [],
}: {
  track: Track
  artistId: string
  /** The artist's public slug, for the modal's Share. */
  artistSlug?: string
  releases: ReleaseOption[]
  /** Hide the platform-badge subtitle (orphan singles in the Singles grid read as a
   *  plain single card — title only — to match the release cards beside them). */
  hideBadges?: boolean
  /** The artist's other songs, for "Merge into…". Empty (the default) hides the option —
   *  a catalog of one song has nothing to merge into. */
  mergeTargets?: MergeTarget[]
}) {
  const [open, setOpen] = useState(false)
  // Only an orphan (no home release) exposes its own on-site mark; others follow the release.
  const isOrphan = !track.release_id
  const [onSite, setOnSite] = useState(track.on_site)
  const platforms = trackPlatforms(track)

  async function toggleOnSite() {
    const next = !onSite
    setOnSite(next) // optimistic
    const res = await setTrackOnSiteAction(track.id, artistId, next)
    if (res?.error) {
      setOnSite(!next)
      toast(res.error, 'error')
    } else {
      toast(next ? 'On the site' : 'Off the site')
    }
  }

  return (
    <>
      {/* THE SAME CHECK THE RELEASE CARDS WEAR (Sam, 2026-09-10: "why dont the soundcloud
          music assets have the check on them like the spotify one on the right does").
          Same SelectToggle, same corner, same layering as GridCard: a SIBLING of the tile
          button, never inside it, so the check is not also a click on the card. It writes
          the song's working row — a DRAFT (PRESENCE_PLAN S1): the public doors read
          presence from the snapshot, so `onSite` here is what the PUBLISHED copy says and
          the mark shows "checked, publish to put on site" until Publish, exactly like a
          release's. A song inside a release shows none: the release's check governs it. */}
      <div className="relative">
        {isOrphan && (
          <div className="absolute left-2 top-2 z-10">
            <SelectToggle selected={onSite} onSite={track.published_on_site ?? onSite} onToggle={toggleOnSite} label={track.title} />
          </div>
        )}
        <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
            {/* Same type badge the release cards carry, from the song's own release_type —
                so an orphan remix reads "REMIX" just like a release-based one. */}
            <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.08em] text-white">
              {RELEASE_TYPE_LABEL[track.release_type]}
            </span>
            {track.cover_url ? (
              // Sized for the tile (lib/cover-url): Spotify's 640 is 4x the bytes of the 300
              // this 192px box needs (Sam, 2026-09-10).
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverThumbUrl(track.cover_url, 192) ?? undefined} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="h-9 w-9 rounded-full bg-ink" />
            )}
          </div>
          <div className="mt-2.5 truncate text-sm font-semibold group-hover:text-accent">{track.title}</div>
          {!hideBadges && platforms.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-x-2">
              {platforms.map((p) => (
                <span key={p.key} className="font-space text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                  {p.label}
                </span>
              ))}
            </div>
          )}
        </button>
      </div>

      <SongModal
        track={track}
        artistId={artistId}
        artistSlug={artistSlug}
        releases={releases}
        open={open}
        onClose={() => setOpen(false)}
        mergeTargets={mergeTargets}
        onTakenOffSite={() => setOnSite(false)}
      />
    </>
  )
}
