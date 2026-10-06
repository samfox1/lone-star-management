'use client'

import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { modalCornerGlyphClass } from '@/components/ui/ui'
import { RELEASE_TYPES, RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { trackPlatforms, type TrackPlatformIds } from '@/lib/music'
import { safeHref } from '@/lib/url'
import { CardModal } from '../card-modal'
import { KvField, KvRow } from '../modal-kit'
import { MergeSongModal, type MergeTarget } from '../music/merge-song-modal'
import { SONG_PLATFORMS } from '../music/platforms'
import { mergeTwins } from '@/lib/song-merge'
import { wrongPlatformError } from '@/lib/song-links'
import { FeaturedChips } from './featured-chips'
import { TrackAudio } from '../track-audio'
import { RowIcon } from '../(manager-tools)/_ui/row-icon'
import { toast } from '../toast'
import { deleteContentAction, setTrackReleasedAction, setTrackReleaseAction, setTrackTypeAction, updateContentAction } from '../actions'

/** A release the track can be assigned to (id + title, for the selector). */
export type ReleaseOption = { id: string; title: string; release_type?: ReleaseType; slug?: string }

export type Track = TrackPlatformIds & {
  id: string
  title: string
  cover_url: string | null
  stream_url: string | null
  source: string | null
  audio_path: string | null
  release_id: string | null
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
  /** Collaborators — printed as "feat. …" on the site. Absent on a caller that predates
   *  the Featuring row; the modal treats that as none. */
  featured_artists?: string[]
}

const TYPE_OPTIONS = RELEASE_TYPES.map((t) => ({ value: t, label: RELEASE_TYPE_LABEL[t] }))

/**
 * THE song modal — one for every place a song opens (Sam, 2026-09-11: "clicking from a
 * song of an album should bring me to the same song modal seen for singles"). Built on
 * modal-kit: the song's name as a plain title (2026-10-02). Two columns: Title, Type, Release,
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
  onOpenRelease,
  artistSlug,
}: {
  track: Track
  artistId: string
  /** The artist's public slug — the release page a song shares lives under it. */
  artistSlug?: string
  releases: ReleaseOption[]
  /** The record this song was opened FROM (the release card opening one of its songs) —
   *  its home, or a bigger record it also appears on. */
  home?: ReleaseOption
  /** Go back to that record's modal — a release glyph at the end of the "Released on" row. */
  onOpenRelease?: () => void
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
   *  FormData with a single entry writes exactly that column. */
  const saveField = (field: string) => async (value: string) => {
    if (field === 'title' && !value) return { error: 'Give the song a title.' }
    const fd = new FormData()
    fd.set(field, value)
    return updateContentAction('track', track.id, artistId, fd)
  }

  /** A listen-link row. Each row holds ITS platform's link: a SoundCloud link in the
   *  Spotify row became `stream_url`, which forces Released — so a demo was released by
   *  a paste (reviewer, 2026-09-28). A link recognisably another platform's is refused. */
  const saveLink = (p: (typeof SONG_PLATFORMS)[number]) => async (value: string) => {
    const wrong = wrongPlatformError(p.platform, value)
    return wrong ? { error: wrong } : saveField(p.field)(value)
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
    if (!res?.error) setReleaseId(value)
    return res
  }

  // The record it was opened from counts even when the caller passed no list: its row is
  // where the way back to that record sits.
  const releaseList = releases.length > 0 ? releases : home ? [home] : []
  const releaseOptions = releaseList.map((r) => ({ value: r.id, label: r.title }))
  // "Merge duplicate…" only when there IS a likely duplicate (lib/song-merge mergeTwins,
  // the one rule a release's tracklist uses too). Sam could not tell what the button was
  // for on a song with no twin — now it appears only when there is one to fold in.
  const twins = mergeTwins({ id: track.id, title: track.title, release_id: releaseId || null }, mergeTargets)
  const date = track.release_date?.slice(0, 10) ?? ''

  // A song on a record is TYPED by the record (Sam, 2026-09-11), so the Type row is the
  // release's to edit, not the song's; the "Released on" row names the record.
  // THE record: its home release — the one it was opened from when the caller knows it
  // (a release card), else looked up among the artist's releases.
  const homeRelease = releaseId ? (home?.id === releaseId ? home : releases.find((r) => r.id === releaseId)) : undefined

  // What Share hands out (Sam, 2026-09-11: every song has a Share): the home release's
  // public page when there is one, else the song's own listen link. Nothing to share →
  // no button, rather than a button that copies nothing.
  const shareUrl = (() => {
    const page = homeRelease
    if (page?.slug && artistSlug) {
      const origin = typeof window === 'undefined' ? '' : window.location.origin
      return `${origin}/${artistSlug}/r/${page.slug}`
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
        title={track.title}
        analyticsHref={`/artists/${artistId}`}
        corner={
          shareUrl ? (
            <button
              type="button"
              onClick={share}
              aria-label="Share"
              title="Share"
              className={modalCornerGlyphClass}
            >
              <Icon name="share" size={16} />
            </button>
          ) : null
        }
        deleteAction={deleteContentAction.bind(null, 'track', track.id, artistId)}
        deleteLabel="Delete"
        deleteNoun="Song"
        footerFill={<TrackAudio artistId={artistId} trackId={track.id} audioPath={track.audio_path} />}
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
            {/* The merge glyph, named on hover, not the word on a grey box (Sam, 2026-10-05). */}
            {twins.length > 0 && (
              <RowIcon icon="merge" label="Merge duplicate…" variant="boxed" size="sm" labelSide="top" labelAlign="start" onClick={() => setMergeOpen(true)} />
            )}
          </>
        }
      >
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
            {releaseList.length > 0 && (
              <KvField
                label="Released on"
                value={releaseId}
                options={releaseOptions}
                onSave={saveRelease}
                onError={fail}
                // The way BACK to the record this song was opened from (it closed behind
                // this one). It lived in the header's meta line until headers went plain.
                trailing={
                  onOpenRelease && homeRelease && home?.id === homeRelease.id ? (
                    <button
                      type="button"
                      onClick={onOpenRelease}
                      aria-label={`Open ${homeRelease.title}`}
                      title={`Open ${homeRelease.title}`}
                      className="flex-none text-ink-faint transition-colors hover:text-ink"
                    >
                      <Icon name="releases" size={14} />
                    </button>
                  ) : null
                }
              />
            )}
            <KvField label="Date" value={date} type="date" mono onSave={saveField('release_date')} onError={fail} />
            {/* Collaborators (Sam, 2026-09-11): a click-to-edit list (2026-10-05), printed
                as "feat. …" on the site. */}
            <KvRow label="Featuring">
              <FeaturedChips artistId={artistId} trackId={track.id} names={track.featured_artists ?? []} />
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
                  onSave={saveLink(p)}
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
        targets={twins}
      />
    </>
  )
}
