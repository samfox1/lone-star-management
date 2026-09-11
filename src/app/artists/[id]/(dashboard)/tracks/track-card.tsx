'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { trackPlatforms, type TrackPlatformIds } from '@/lib/music'
import { safeHref } from '@/lib/url'
import { CardModal } from '../card-modal'
import { KvField, KvRow, MetaDot, ModalHeader } from '../modal-kit'
import { MergeSongModal, type MergeTarget } from '../music/merge-song-modal'
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
import { coverThumbUrl } from '@/lib/cover-url'

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
  /** What the PUBLISHED copy says (PRESENCE_PLAN S1); absent = assume it matches. */
  published_on_site?: boolean
  /** The manual released flag. Read only where it can matter (see canBeUnreleased). */
  released?: boolean | null
}

const TYPE_OPTIONS = RELEASE_TYPES.map((t) => ({ value: t, label: RELEASE_TYPE_LABEL[t] }))

/**
 * A song as a cover-grid tile that opens its modal — built on modal-kit (prototype G,
 * Sam, 2026-09-11; the song modal was the picture he liked). Header = cover · title ·
 * type / date meta. Rows: Title, Type, Release, Also on, Date, one per listen platform,
 * Audio — each saves its own field when it changes. Footer: the Unreleased pill (only
 * where the flag can decide anything), Merge into… (when there is a target), Delete,
 * Done. No Save, no nested Edit sheet, no click numbers — the Analytics button in the
 * corner goes to that page instead.
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
  const [mergeOpen, setMergeOpen] = useState(false)
  // Rows save themselves; these mirror the two values other rows depend on (the
  // "Also on" options, the header meta) so they follow a save without a refresh.
  const [type, setType] = useState<ReleaseType>(track.release_type)
  const [releaseId, setReleaseId] = useState(track.release_id ?? '')
  const [parentId, setParentId] = useState(track.parent_release_id ?? '')

  // Only an orphan (no home release) exposes its own on-site mark; others follow the release.
  const isOrphan = !releaseId
  const [onSite, setOnSite] = useState(track.on_site)
  const platforms = trackPlatforms(track)
  // The Unreleased pill is offered ONLY where the flag can decide anything: a manual
  // song with no Spotify/Apple/Deezer presence (a SoundCloud link is not a release —
  // packages/music-rules). Elsewhere the song is released by being on a service.
  const canBeUnreleased = track.source === 'manual' && platforms.every((p) => p.key === 'soundcloud')
  const [released, setReleased] = useState(track.released !== false)

  const fail = (message: string) => toast(message, 'error')

  async function toggleReleased() {
    const next = !released
    setReleased(next) // optimistic
    if (!next) setOnSite(false) // the action takes an unreleased song off the site too
    const res = await setTrackReleasedAction(track.id, artistId, next)
    if (res?.error) {
      setReleased(!next)
      fail(res.error)
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
      fail(res.error)
    } else {
      toast(next ? 'On the site' : 'Off the site')
    }
  }

  /** One row → one field. Absent keys are skipped server-side (extractUpdate), so a
   *  FormData with a single entry writes exactly that column. A link pasted here promotes
   *  an upload to Released by derivation; a cleared one is dropped. */
  const saveField = (field: string) => async (value: string) => {
    if (field === 'title' && !value) return { error: 'Give the song a title.' }
    const fd = new FormData()
    fd.set(field, value)
    return updateContentAction('track', track.id, artistId, fd)
  }

  // Only when it actually CHANGED (KvField guarantees that): a no-op write would stamp
  // the type on every save, and the value is what files the song on the Music page.
  async function saveType(value: string) {
    const fd = new FormData()
    fd.set('release_type', value)
    const res = await setTrackTypeAction(track.id, artistId, fd)
    if (!res?.error) setType(value as ReleaseType)
    return res
  }

  async function saveRelease(value: string) {
    const fd = new FormData()
    fd.set('release_id', value)
    const res = await setTrackReleaseAction(track.id, artistId, fd)
    if (res?.error) return res
    setReleaseId(value)
    // A song can't "also appear on" its own home — clear a now-equal parent.
    if (value && value === parentId) await saveParent('')
    return res
  }

  async function saveParent(value: string) {
    const fd = new FormData()
    fd.set('parent_release_id', value)
    const res = await setTrackParentReleaseAction(track.id, artistId, fd)
    if (!res?.error) setParentId(value)
    return res
  }

  const releaseOptions = releases.map((r) => ({ value: r.id, label: r.title }))
  const parentOptions = releaseOptions.filter((o) => o.value !== releaseId)
  const date = track.release_date?.slice(0, 10) ?? ''

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
              {RELEASE_TYPE_LABEL[type]}
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

      <CardModal
        open={open}
        onClose={() => !mergeOpen && setOpen(false)}
        label={track.title}
        analyticsHref={`/artists/${artistId}`}
        deleteAction={deleteContentAction.bind(null, 'track', track.id, artistId)}
        deleteLabel="Delete"
        deleteNoun="Song"
        footerLeft={
          <>
            {/* Unreleased (Sam, 2026-09-10) — only where the flag can decide: manual +
                SoundCloud-only. Flipping it on also takes the song off the site. */}
            {canBeUnreleased && (
              <button
                type="button"
                role="switch"
                aria-checked={!released}
                aria-label="Unreleased"
                onClick={toggleReleased}
                className={cx(
                  'inline-flex items-center gap-2 rounded-lg border py-1.5 pl-1.5 pr-2.5 font-space text-[11px] transition-colors',
                  !released ? 'border-accent bg-accent-soft text-accent' : 'border-hairline text-ink-muted hover:border-ink-faint',
                )}
              >
                <span
                  className={cx(
                    'flex h-3.5 w-3.5 items-center justify-center rounded border',
                    !released ? 'border-accent bg-accent text-white' : 'border-ink-faint/60 bg-paper',
                  )}
                >
                  {!released ? <Icon name="check" size={10} /> : null}
                </span>
                unreleased
              </button>
            )}
            {mergeTargets.length > 0 && (
              <button
                type="button"
                onClick={() => setMergeOpen(true)}
                className="rounded-md px-1.5 py-1 font-space text-[11px] uppercase tracking-[0.06em] text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                Merge into…
              </button>
            )}
          </>
        }
      >
        <ModalHeader
          square={
            track.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverThumbUrl(track.cover_url, 112) ?? undefined} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface">
                <span className="h-5 w-5 rounded-full bg-ink" />
              </div>
            )
          }
          title={track.title}
          meta={
            <>
              <span>{RELEASE_TYPE_LABEL[type]}</span>
              {date ? (
                <>
                  <MetaDot />
                  <span>{date}</span>
                </>
              ) : null}
              {platforms.length > 0 ? (
                <>
                  <MetaDot />
                  <span>{platforms.map((p) => p.label).join(' · ')}</span>
                </>
              ) : null}
            </>
          }
        />
        <div className="mt-5">
          <KvField label="Title" value={track.title} onSave={saveField('title')} onError={fail} />
          {/* SONG TYPE — straight off RELEASE_TYPES, so a type added to the registry appears
              here the day it lands (a hand-kept list is how 'live' shipped unpickable). */}
          <KvField label="Type" value={type} options={TYPE_OPTIONS} required onSave={saveType} onError={fail} />
          {releases.length > 0 && (
            <>
              <KvField label="Release" value={releaseId} options={releaseOptions} onSave={saveRelease} onError={fail} />
              {/* "Also appears on": a bigger EP/album this song is part of beyond its home
                  release, so it shows in that project's tracklist too. Can't be its home. */}
              <KvField label="Also on" value={parentId} options={parentOptions} onSave={saveParent} onError={fail} />
            </>
          )}
          <KvField label="Date" value={date} type="date" mono onSave={saveField('release_date')} onError={fail} />
          {SONG_PLATFORMS.map((p) => {
            const value = track[p.field] ?? ''
            const href = safeHref(value)
            return (
              <KvField
                key={p.field}
                label={p.label}
                value={value}
                type="url"
                mono
                onSave={saveField(p.field)}
                onError={fail}
                trailing={
                  href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${p.label} link in a new tab`}
                      title="Open link to check it works"
                      className="flex-none text-ink-faint transition-colors hover:text-ink"
                    >
                      <Icon name="external" size={14} />
                    </a>
                  ) : null
                }
              />
            )
          })}
          {/* Audio: the always-present player (greyed until a file exists) + add/replace. */}
          <KvRow label="Audio">
            <TrackAudio artistId={artistId} trackId={track.id} audioPath={track.audio_path} />
          </KvRow>
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
    </>
  )
}
