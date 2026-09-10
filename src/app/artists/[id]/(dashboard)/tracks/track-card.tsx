'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { trackPlatforms, type TrackPlatformIds } from '@/lib/music'
import { safeHref } from '@/lib/url'
import { CardModal } from '../card-modal'
import { MergeSongModal, type MergeTarget } from '../music/merge-song-modal'
import { EntitySparkline } from '../entity-sparkline'
import { TrackAudio } from '../track-audio'
import { toast } from '../toast'
import { SONG_PLATFORMS } from '../releases/release-card'
import {
  deleteContentAction,
  setTrackOnSiteAction,
  setTrackReleasedAction,
  setTrackParentReleaseAction,
  setTrackReleaseAction,
  setTrackTypeAction,
  updateContentAction,
} from '../actions'
import { SelectToggle } from '../select-toggle'

/** A release the track can be assigned to (id + title, for the selector). */
export type ReleaseOption = { id: string; title: string }

export type Track = TrackPlatformIds & {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  source: string | null
  audio_path: string | null
  release_id: string | null
  /** "Also appears on" — a bigger EP/album this track is part of, beyond its own home. */
  parent_release_id: string | null
  /** Optional own release date (orphan singles); album songs show the album's year instead. */
  release_date: string | null
  /** The song's own category (single/remix/…), shown as a tile badge like the release cards. */
  release_type: ReleaseType
  /** Live on-site state — only surfaced/toggled for orphans (a track with a release follows it). */
  on_site: boolean
  /** The manual released flag. Read only where it can matter (see canBeUnreleased). */
  released?: boolean | null
}

/**
 * A track as a cover-grid tile that opens the SAME single-style modal a release
 * single uses (an orphan single IS a single): a big cover + title on the left with
 * an audio player when the track has uploaded audio, and its listens + per-platform
 * links on the right. Title and release assignment are edited in a nested modal via
 * the 3-dots, so the overview reads identically to a release single.
 */
export function TrackCard({
  track,
  artistId,
  releases,
  hideBadges = false,
  mergeTargets = [],
}: {
  track: Track
  artistId: string
  releases: ReleaseOption[]
  /** Hide the platform-badge subtitle (orphan singles in the Singles grid read as a
   *  plain single card — title only — to match the release cards beside them). */
  hideBadges?: boolean
  /** The artist's other songs, for "Merge into…". Empty (the default) hides the option —
   *  a catalog of one song has nothing to merge into. */
  mergeTargets?: MergeTarget[]
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [typeDraft, setTypeDraft] = useState<ReleaseType>(track.release_type)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState(track.title)
  const [releaseDraft, setReleaseDraft] = useState(track.release_id ?? '')
  const [parentDraft, setParentDraft] = useState(track.parent_release_id ?? '')
  const [releaseDateDraft, setReleaseDateDraft] = useState(track.release_date?.slice(0, 10) ?? '')
  // Only an orphan (no home release) exposes its own on-site switch; others follow the release.
  const isOrphan = !track.release_id
  const [onSite, setOnSite] = useState(track.on_site)
  const platforms = trackPlatforms(track)
  // The Unreleased switch is offered ONLY where the flag can decide anything: a manual
  // song with no Spotify/Apple/Deezer presence (a SoundCloud link is not a release —
  // packages/music-rules). Elsewhere the song is released by being on a service.
  const canBeUnreleased = track.source === 'manual' && platforms.every((p) => p.key === 'soundcloud')
  const [released, setReleased] = useState(track.released !== false)

  async function toggleReleased() {
    const next = !released
    setReleased(next) // optimistic
    if (!next) setOnSite(false) // the action takes an unreleased song off the site too
    const res = await setTrackReleasedAction(track.id, artistId, next)
    if (res?.error) {
      setReleased(!next)
      toast(res.error, 'error')
    } else {
      toast(next ? 'Marked released' : 'Marked unreleased')
    }
  }

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

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // A per-platform link saves on blur — paste a url and it's stored, clear it and it's
  // dropped. Setting any listen link promotes an upload to Released by derivation.
  async function saveLink(field: string, current: string, input: HTMLInputElement) {
    const val = input.value.trim()
    if (val === current) return
    const fd = new FormData()
    fd.set(field, val)
    const res = await updateContentAction('track', track.id, artistId, fd)
    if (res?.error) toast(res.error, 'error')
    else toast(val ? 'Link saved' : 'Link removed')
  }

  function enterEdit() {
    setMenuOpen(false)
    setTitleDraft(track.title)
    setReleaseDraft(track.release_id ?? '')
    setParentDraft(track.parent_release_id ?? '')
    setReleaseDateDraft(track.release_date?.slice(0, 10) ?? '')
    setTypeDraft(track.release_type)
    setEditOpen(true)
  }

  // Save the editable details (title, release date, home release, and "also appears on"
  // project), then close the editor.
  async function saveDetails() {
    const t = titleDraft.trim()
    if (!t) {
      toast('Give the song a title.', 'error')
      return
    }
    let saved = false
    if (t !== track.title || releaseDateDraft !== (track.release_date?.slice(0, 10) ?? '')) {
      const fd = new FormData()
      fd.set('title', t)
      fd.set('release_date', releaseDateDraft)
      const res = await updateContentAction('track', track.id, artistId, fd)
      if (res?.error) {
        toast(res.error, 'error')
        return
      }
      saved = true
    }
    if (releaseDraft !== (track.release_id ?? '')) {
      const fd = new FormData()
      fd.set('release_id', releaseDraft)
      const res = await setTrackReleaseAction(track.id, artistId, fd)
      if (res?.error) {
        toast(res.error, 'error')
        return
      }
      saved = true
    }
    // Only when it actually CHANGED. A no-op write would stamp the type on every save,
    // which matters because the value is what puts the song in its Music-page section.
    if (typeDraft !== track.release_type) {
      const fd = new FormData()
      fd.set('release_type', typeDraft)
      const res = await setTrackTypeAction(track.id, artistId, fd)
      if (res?.error) {
        toast(res.error, 'error')
        return
      }
      saved = true
    }
    if (parentDraft !== (track.parent_release_id ?? '')) {
      const fd = new FormData()
      fd.set('parent_release_id', parentDraft)
      const res = await setTrackParentReleaseAction(track.id, artistId, fd)
      if (res?.error) {
        toast(res.error, 'error')
        return
      }
      saved = true
    }
    if (saved) toast('Saved')
    setEditOpen(false)
  }

  async function del() {
    setMenuOpen(false)
    const res = await deleteContentAction('track', track.id, artistId)
    if (res?.error) toast(res.error, 'error')
    else {
      toast('Song deleted')
      setOpen(false)
    }
  }

  return (
    <>
      {/* THE SAME CHECK THE RELEASE CARDS WEAR (Sam, 2026-09-10: "why dont the soundcloud
          music assets have the check on them like the spotify one on the right does").
          An orphan song's on-site switch lived only inside the modal (48db004), so on the
          shelf a release showed a check and the song beside it showed nothing — one fact,
          two faces. Same SelectToggle, same corner, same layering as GridCard: a SIBLING
          of the tile button, never inside it, so the check is not also a click on the card.
          It flips the song instantly through the existing action (the doors read the live
          row), so `selected` and `onSite` are always the same value and the mark is
          simply on or off — never the release cards' "publish to apply" states. A song
          inside a release shows none: the release's check governs it. */}
      <div className="relative">
        {isOrphan && (
          <div className="absolute left-2 top-2 z-10">
            <SelectToggle selected={onSite} onSite={onSite} onToggle={toggleOnSite} label={track.title} />
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
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
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

      {/* Same single-style modal as a release single — a song is a song wherever it lives. */}
      <CardModal open={open} onClose={() => !editOpen && !mergeOpen && setOpen(false)} wide footer={null}>
        <div className="font-space">
          <div className="grid grid-cols-2 gap-8">
            {/* LEFT — cover + title (+ audio player when uploaded). */}
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex aspect-square w-full max-w-[360px] items-center justify-center overflow-hidden rounded-2xl bg-surface">
                {track.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="h-16 w-16 rounded-full bg-ink" />
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 flex-1 text-2xl font-bold leading-tight tracking-[-0.01em]">{track.title}</h3>
                <div ref={menuRef} className="relative flex-none">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label={`${track.title} options`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    <Icon name="more" size={18} />
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-9 z-10 w-36 overflow-hidden rounded-xl border border-hairline bg-paper py-1 shadow-2xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={enterEdit}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                      >
                        <Icon name="edit" size={15} /> Edit
                      </button>
                      {mergeTargets.length > 0 && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false)
                            setMergeOpen(true)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface"
                        >
                          <Icon name="links" size={15} /> Merge into…
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={del}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-accent-red hover:bg-danger-soft"
                      >
                        <Icon name="trash" size={15} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Unreleased switch (Sam, 2026-09-10) — only where the flag can decide:
                  manual + SoundCloud-only. Flipping it on also takes the song off the site. */}
              {canBeUnreleased && (
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Unreleased</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!released}
                    aria-label="Unreleased"
                    onClick={toggleReleased}
                    className={cx(
                      'relative h-5 w-9 flex-none rounded-full transition-colors',
                      !released ? 'bg-ink' : 'bg-ink/15',
                    )}
                  >
                    <span className={cx('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform', !released && 'translate-x-4')} />
                  </button>
                </label>
              )}
              {/* On-site switch — only for an orphan song (no release to follow). Live, green
                  when on. A song with a release is governed by that release instead. */}
              {isOrphan && (
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">On site</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={onSite}
                    onClick={toggleOnSite}
                    className={cx(
                      'relative h-6 w-11 flex-none rounded-full transition-colors',
                      onSite ? 'bg-accent' : 'bg-ink/15',
                    )}
                  >
                    <span
                      className={cx(
                        'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        onSite && 'translate-x-5',
                      )}
                    />
                  </button>
                </label>
              )}

              {/* Audio: the always-present player (greyed until a file exists) + add/replace. */}
              <div className="mt-auto">
                <TrackAudio artistId={artistId} trackId={track.id} audioPath={track.audio_path} />
              </div>
            </div>

            {/* RIGHT — listens + per-platform links. */}
            <div className="flex min-w-0 flex-col gap-6">
              <EntitySparkline artistId={artistId} entityIds={[track.id]} label="Listens · 30d" />

              <div className="space-y-2.5">
                {SONG_PLATFORMS.map((p) => {
                  const value = track[p.field] ?? ''
                  const href = safeHref(value)
                  return (
                    <div key={p.field} className="flex items-center gap-3">
                      <p.Icon size={22} className={cx('flex-none', value ? p.color : 'text-ink-faint')} />
                      <input
                        key={value}
                        type="url"
                        defaultValue={value}
                        placeholder={p.placeholder}
                        aria-label={`${p.label} link`}
                        onBlur={(e) => saveLink(p.field, value, e.currentTarget)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-center font-space text-[12px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline"
                      />
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${p.label} link in a new tab`}
                          title="Open link to check it works"
                          className="flex-none text-ink-muted transition-colors hover:text-ink"
                        >
                          <Icon name="external" size={16} />
                        </a>
                      ) : (
                        <span aria-hidden className="flex-none text-ink-faint/40">
                          <Icon name="external" size={16} />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="mt-auto flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-paper px-5 py-2.5 font-space text-sm font-semibold text-ink transition-colors hover:border-ink-faint"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      </CardModal>

      {/* Merge — fold this duplicate into the song that should survive. This card's song
          is the one deleted, so closing the merge modal also closes the card behind it. */}
      <MergeSongModal
        open={mergeOpen}
        onClose={() => {
          setMergeOpen(false)
          setOpen(false)
        }}
        artistId={artistId}
        song={{ id: track.id, title: track.title }}
        targets={mergeTargets}
      />

      {/* Edit details — title + which release the song belongs to. */}
      <CardModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-paper px-5 py-2.5 font-space text-sm font-semibold text-ink transition-colors hover:border-ink-faint"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDetails}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 font-space text-sm font-semibold text-white shadow-lg transition-colors hover:bg-accent-hover"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-5 font-space">
          <h3 className="text-lg font-bold tracking-[-0.01em]">Edit song</h3>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Title</span>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Song title"
              className="w-full rounded-lg bg-surface px-3 py-2 font-space text-sm text-ink outline-none focus:bg-paper focus:ring-1 focus:ring-hairline"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Release date</span>
            <input
              type="date"
              value={releaseDateDraft}
              onChange={(e) => setReleaseDateDraft(e.target.value)}
              className="block rounded-lg bg-surface px-2.5 py-2 font-space text-sm text-ink outline-none focus:bg-paper focus:ring-1 focus:ring-hairline"
            />
          </label>
          {/* SONG TYPE — the same chips a release card has had all along. Straight off
              RELEASE_TYPES, so a type added to the registry appears here the day it lands
              rather than needing a second hand-kept list (which is exactly how 'live'
              shipped unpickable). */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Type</span>
            <div className="flex flex-wrap gap-2">
              {RELEASE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeDraft(t)}
                  aria-pressed={typeDraft === t}
                  className={cx(
                    'rounded-lg border px-3 py-2 font-space text-xs font-semibold transition-colors',
                    typeDraft === t
                      ? 'border-ink bg-ink text-white'
                      : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
                  )}
                >
                  {RELEASE_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          {releases.length > 0 && (
            <>
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Release</span>
                <select
                  value={releaseDraft}
                  onChange={(e) => {
                    const v = e.target.value
                    setReleaseDraft(v)
                    // A song can't "also appear on" its own home — clear a now-equal parent.
                    if (v && v === parentDraft) setParentDraft('')
                  }}
                  className="block w-full rounded-lg border border-hairline bg-paper px-2.5 py-2 font-space text-sm text-ink outline-none focus:border-ink-faint"
                >
                  <option value="">— None (standalone single) —</option>
                  {releases.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </label>
              {/* "Also appears on": a bigger EP/album this song is part of beyond its home
                  release, so it shows in that project's tracklist too. Can't be its home. */}
              <label className="block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Also appears on</span>
                <select
                  value={parentDraft}
                  onChange={(e) => setParentDraft(e.target.value)}
                  className="block w-full rounded-lg border border-hairline bg-paper px-2.5 py-2 font-space text-sm text-ink outline-none focus:border-ink-faint"
                >
                  <option value="">— None —</option>
                  {releases
                    .filter((r) => r.id !== releaseDraft)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                </select>
              </label>
            </>
          )}
        </div>
      </CardModal>
    </>
  )
}
