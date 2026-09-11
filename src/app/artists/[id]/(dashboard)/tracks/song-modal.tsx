'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { trackPlatforms, type TrackPlatformIds } from '@/lib/music'
import { safeHref } from '@/lib/url'
import { coverThumbUrl } from '@/lib/cover-url'
import { CardModal } from '../card-modal'
import { KvField, KvRow, MetaDot, ModalHeader } from '../modal-kit'
import { MergeSongModal, type MergeTarget } from '../music/merge-song-modal'
import { SONG_PLATFORMS } from '../music/platforms'
import { TrackAudio } from '../track-audio'
import { toast } from '../toast'
import {
  deleteContentAction,
  setTrackReleasedAction,
  setTrackParentReleaseAction,
  setTrackReleaseAction,
  setTrackTypeAction,
  updateContentAction,
} from '../actions'

/** A release the track can be assigned to (id + title, for the selector). `release_type`
 *  lets a song's modal say "Track from EP OutWest" when its home is a multi-song record. */
export type ReleaseOption = { id: string; title: string; release_type?: ReleaseType; slug?: string }

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
 * THE song modal — one for every place a song opens (Sam, 2026-09-11: "clicking from a
 * song of an album should bring me to the same song modal seen for singles"). Built on
 * modal-kit: cover · title · kind / year meta. Two columns: Title, Type, Release,
 * Also on, Date, one per listen platform, Audio — each saves its own field when it
 * changes. Footer: the Unreleased pill (only where the flag can decide anything), Merge
 * into… (when there is a target), Delete, Done. No Save, no nested Edit sheet, no click
 * numbers — the Analytics button in the corner goes to that page instead.
 */
export function SongModal({
  track,
  artistId,
  releases,
  open,
  onClose,
  mergeTargets = [],
  onTakenOffSite,
  home,
  artistSlug,
}: {
  track: Track
  artistId: string
  /** The artist's public slug — the release page a song shares lives under it. */
  artistSlug?: string
  releases: ReleaseOption[]
  /** The song's home release, when the caller knows it better than `releases` does (the
   *  release card opening one of its own songs). */
  home?: ReleaseOption
  open: boolean
  onClose: () => void
  /** The artist's other songs, for "Merge into…". Empty hides the option. */
  mergeTargets?: MergeTarget[]
  /** Marking a song unreleased also takes it off the site; a tile with an on-site mark
   *  listens here so its check follows. */
  onTakenOffSite?: () => void
}) {
  const [mergeOpen, setMergeOpen] = useState(false)
  const [type, setType] = useState<ReleaseType>(track.release_type)
  const [releaseId, setReleaseId] = useState(track.release_id ?? '')
  const [parentId, setParentId] = useState(track.parent_release_id ?? '')
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
    if (!next) onTakenOffSite?.() // the action takes an unreleased song off the site too
    const res = await setTrackReleasedAction(track.id, artistId, next)
    if (res?.error) {
      setReleased(!next)
      fail(res.error)
    } else {
      toast(next ? 'Marked released' : 'Marked unreleased')
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

  // A song on a record is TYPED by the record (Sam, 2026-09-11: "instead of it saying EP
  // or Album for the individual track … it should say Track from EP/Album {title}"), so
  // the Type row is the release's to edit, not the song's, and the meta names the record.
  const homeRelease = releaseId ? (home?.id === releaseId ? home : releases.find((r) => r.id === releaseId)) : undefined
  const homeType = homeRelease?.release_type
  const onRecord = homeType === 'ep' || homeType === 'album'
  const kind = onRecord && homeRelease ? `Track from ${RELEASE_TYPE_LABEL[homeType]} ${homeRelease.title}` : RELEASE_TYPE_LABEL[type]

  // What Share hands out (Sam, 2026-09-11: every song has a Share): the home release's
  // public page when there is one, else the song's own listen link. Nothing to share →
  // no button, rather than a button that copies nothing.
  const shareUrl = (() => {
    if (homeRelease?.slug && artistSlug) {
      const origin = typeof window === 'undefined' ? '' : window.location.origin
      return `${origin}/${artistSlug}/r/${homeRelease.slug}`
    }
    for (const p of SONG_PLATFORMS) {
      const href = safeHref(track[p.field] ?? '')
      if (href) return href
    }
    return null
  })()
  async function share() {
    if (!shareUrl) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: track.title, url: shareUrl })
        return
      } catch {
        // cancelled or unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast('Link copied')
    } catch {
      toast("Couldn't copy the link.", 'error')
    }
  }

  return (
    <>
      <CardModal
        open={open}
        onClose={() => !mergeOpen && onClose()}
        wide
        label={track.title}
        analyticsHref={`/artists/${artistId}`}
        corner={
          shareUrl ? (
            <button
              type="button"
              onClick={share}
              aria-label="Share"
              title="Share"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <Icon name="share" size={16} />
            </button>
          ) : null
        }
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
            // Kind · year, like a release's meta — no platform names (Sam, 2026-09-11):
            // the logos on the right already say where the song is.
            <>
              <span>{kind}</span>
              {date ? (
                <>
                  <MetaDot />
                  <span>{date.slice(0, 4)}</span>
                </>
              ) : null}
            </>
          }
        />
        {/* Two columns, like the release modal (Sam, 2026-09-11: "it should look like this"):
            the song on the left, its listen links on the right under the platforms' logos —
            black when a link is set, grey when empty. */}
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_320px] gap-x-10">
          <div>
            <KvField label="Title" value={track.title} onSave={saveField('title')} onError={fail} />
            {/* SONG TYPE — straight off RELEASE_TYPES, so a type added to the registry appears
                here the day it lands (a hand-kept list is how 'live' shipped unpickable). Not
                offered on a song that lives on a record: the record's type is the song's. */}
            {!releaseId && <KvField label="Type" value={type} options={TYPE_OPTIONS} required onSave={saveType} onError={fail} />}
            {releases.length > 0 && (
              <>
                <KvField label="Release" value={releaseId} options={releaseOptions} onSave={saveRelease} onError={fail} />
                {/* "Also appears on": a bigger EP/album this song is part of beyond its home
                    release, so it shows in that project's tracklist too. Can't be its home. */}
                <KvField label="Also on" value={parentId} options={parentOptions} onSave={saveParent} onError={fail} />
              </>
            )}
            <KvField label="Date" value={date} type="date" mono onSave={saveField('release_date')} onError={fail} />
            {/* Audio: the always-present player (greyed until a file exists) + add/replace. */}
            <KvRow label="Audio">
              <TrackAudio artistId={artistId} trackId={track.id} audioPath={track.audio_path} />
            </KvRow>
          </div>
          <div>
            {SONG_PLATFORMS.map((p) => {
              const value = track[p.field] ?? ''
              const href = safeHref(value)
              return (
                <KvField
                  key={p.field}
                  label={p.label}
                  labelNode={<p.Icon size={18} className={value ? 'text-ink' : 'text-ink-faint/60'} />}
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
          </div>
        </div>
      </CardModal>

      {/* Merge — fold this duplicate into the song that should survive. This song is the
          one deleted, so closing the merge modal also closes the card behind it. */}
      <MergeSongModal
        open={mergeOpen}
        onClose={() => {
          setMergeOpen(false)
          onClose()
        }}
        artistId={artistId}
        song={{ id: track.id, title: track.title }}
        targets={mergeTargets}
      />
    </>
  )
}
