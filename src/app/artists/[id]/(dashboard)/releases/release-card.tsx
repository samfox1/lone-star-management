'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import { safeHref } from '@/lib/url'
import { CardModal } from '../card-modal'
import { KvField, KvRow, MetaDot, ModalHeader } from '../modal-kit'
import { MergeSongModal, type MergeTarget } from '../music/merge-song-modal'
import { STREAMING_PLATFORMS } from '../music/platforms'
import { SongModal, type ReleaseOption, type Track } from '../tracks/song-modal'
import { toast } from '../toast'
import { SelectToggle } from '../select-toggle'
import { metricLabel } from '@/lib/analytics'
import { CardStat } from '../card-stat'
import { TrackAudio } from '../track-audio'
import { coverThumbUrl } from '@/lib/cover-url'
import { deleteContentAction, setReleaseLinkAction, setReleaseTypeAction, updateReleaseDetailsAction } from '../actions'

export type ReleaseLink = { label: string; url: string }
/** A song in a release's tracklist: a FULL song (it opens the same modal a standalone one
 *  does — Sam, 2026-09-11) plus what the tracklist row itself prints. */
export type ReleaseSong = Track & {
  featured_artists: string[]
  stat?: number
}
export type Release = {
  id: string
  title: string
  slug: string
  cover_url: string | null
  release_date: string | null
  /** When the row was created — the library's tie-break, so two undated releases order by
   *  which was added last. Not rendered anywhere. */
  created_at?: string
  release_type: ReleaseType
  links: ReleaseLink[]
  /** Whether the release is currently live on the public site. */
  on_site: boolean
  /** What the PUBLISHED copy says (PRESENCE_PLAN S1). The tile's check shows "checked,
   *  publish to put on site" while this and `on_site` disagree. */
  published_on_site?: boolean
  /** The release's songs (tracks grouped under it), shown in the edit modal. */
  songs: ReleaseSong[]
  /** 30-day engagement (track plays + Listen/DSP clicks), from analytics_by_entity. */
  stat?: number
}

/** feat. A, B — the collaborators on a song. */
function feat(song: ReleaseSong): string | null {
  return song.featured_artists.length ? `feat. ${song.featured_artists.join(', ')}` : null
}

/**
 * A release as a grid tile: cover with a select checkbox + live badge + type badge, then
 * title and meta. Selection drives the password-gated publish; the checkbox is owned by
 * the parent browser. Clicking the tile opens the release modal — built on modal-kit
 * (prototype G, Sam, 2026-09-11): cover · title · type / year / songs, then rows that save
 * their own field (Title, Type, Date, one per streaming platform, Songs or Audio), with
 * Share · Delete · Done in the footer. A tracklist song opens its own modal in the same
 * grammar. No Save, no "Edit release" sheet, no listens (the Analytics button has those).
 */
export function ReleaseCard({
  release,
  artistId,
  artistSlug,
  selected,
  onToggleSelect,
  mergeTargets = [],
  releases = [],
}: {
  release: Release
  artistId: string
  artistSlug: string
  /** Every release the artist has (for a song's Release / Also on rows in its modal). */
  releases?: ReleaseOption[]
  /** On-site selection (publish flow). Omit both for an UNRELEASED release —
   *  publish doesn't apply, so no checkbox / live badge is shown. */
  selected?: boolean
  onToggleSelect?: () => void
  /** The artist's WHOLE catalog, for "Merge into…" on tracklist rows — the sync's
   *  merge-refusal duplicates frequently land inside a release, and their twin can be
   *  anywhere, not just on this release. Empty (the default) hides the affordance. */
  mergeTargets?: MergeTarget[]
}) {
  const [editing, setEditing] = useState(false)
  // Rows save themselves; these mirror what other rows and the header depend on, so they
  // follow a save without a refresh. Title and date travel TOGETHER on every write:
  // updateReleaseDetailsAction nulls a missing date, so a title-only write would erase it.
  const [title, setTitle] = useState(release.title)
  const [date, setDate] = useState(release.release_date?.slice(0, 10) ?? '')
  const [type, setType] = useState<ReleaseType>(release.release_type)
  // The tracklist song whose modal is open. Opening it CLOSES the release's modal (Sam,
  // 2026-09-11: "I don't want to see the album modal behind it").
  const [song, setSong] = useState<ReleaseSong | null>(null)
  // The tracklist song being merged away. Same modal + server action as the standalone
  // song cards — one merge implementation, wherever the song lives.
  const [mergeSong, setMergeSong] = useState<ReleaseSong | null>(null)
  // A song can never be its own merge target — the server refuses it, but offering it at
  // all invites the manager to delete the row they are standing on.
  const targetsFor = (id: string) => mergeTargets.filter((t) => t.id !== id)

  const year = date.slice(0, 4)
  const songCount = release.songs.length
  // Only EPs and albums have a tracklist (Sam, 2026-07-24) — a single IS its song, so its
  // modal shows the song's audio where the tracklist would be.
  const expandable = type === 'ep' || type === 'album'
  // Singles read as just the year (no song count — a single is one track); EPs/albums keep
  // the count. No year → no meta line at all (never a "—" placeholder).
  const meta = expandable
    ? [year, songCount ? `${songCount} song${songCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')
    : year
  // Type is constrained by the release's SIZE (Sam, 2026-09-11): several songs → EP or
  // Album; one song → Single, Remix or Live set. The current type is always offered too,
  // so a release never shows a value it cannot keep (a one-song EP, a Featured appearance).
  const typeChoices: ReleaseType[] = songCount > 1 ? ['ep', 'album'] : ['single', 'remix', 'live']
  const typeOptions: readonly ReleaseType[] = typeChoices.includes(type) ? typeChoices : [...typeChoices, type]

  const fail = (message: string) => toast(message, 'error')

  // Share the public release page — native sheet where available, clipboard otherwise.
  async function share() {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/${artistSlug}/r/${release.slug}`
    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // cancelled or unsupported — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      toast("Couldn't copy the link.", 'error')
    }
  }

  async function saveDetails(nextTitle: string, nextDate: string) {
    if (!nextTitle) return { error: 'Give the release a title.' }
    const fd = new FormData()
    fd.set('title', nextTitle)
    fd.set('release_date', nextDate)
    const res = await updateReleaseDetailsAction(release.id, artistId, fd)
    if (!res?.error) {
      setTitle(nextTitle)
      setDate(nextDate)
    }
    return res
  }

  // Only when it actually CHANGED (KvField guarantees that): the action locks the type
  // against a later Spotify sync, so a no-op write would lock it for no reason.
  async function saveType(value: string) {
    const fd = new FormData()
    fd.set('release_type', value)
    const res = await setReleaseTypeAction(release.id, artistId, fd)
    if (!res?.error) setType(value as ReleaseType)
    return res
  }

  // A release link slot: the value is stored under the platform's label; blank clears it.
  const saveReleaseLink = (label: string) => async (value: string) => {
    const fd = new FormData()
    fd.set('url', value)
    return setReleaseLinkAction(release.id, artistId, label, fd)
  }

  /** The ↗ beside a link row: opens the saved link to check it works. */
  const openMark = (label: string, url: string) => {
    const href = safeHref(url)
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${label} link in a new tab`}
        title="Open link to check it works"
        className="flex-none text-ink-faint transition-colors hover:text-ink"
      >
        <Icon name="external" size={14} />
      </a>
    ) : null
  }

  const cover = (size: number) =>
    release.cover_url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={coverThumbUrl(release.cover_url, size) ?? undefined} alt="" className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface">
        <span className="h-5 w-5 rounded-full bg-ink" />
      </div>
    )

  return (
    // A plain fixed-width tile — the tracklist lives in a modal, so the card never grows
    // and the grid never reflows or pushes a far-left album's songs off-screen.
    <div className="w-48 flex-none">
      <div className="group relative">
        {/* On-site select — top-left, doesn't open a modal */}
        {onToggleSelect && (
          <div className="absolute left-2 top-2 z-10">
            <SelectToggle selected={!!selected} onSite={release.published_on_site ?? release.on_site} onToggle={onToggleSelect} label={title} />
          </div>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-haspopup="dialog"
          aria-label={`${title} — ${songCount} song${songCount === 1 ? '' : 's'}`}
          className="block w-full text-left"
        >
          <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
            <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.08em] text-white">
              {RELEASE_TYPE_LABEL[type]}
            </span>
            {release.cover_url ? (
              // Sized for the tile — see tracks/track-card.tsx.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverThumbUrl(release.cover_url, 192) ?? undefined} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="h-9 w-9 rounded-full bg-ink" />
            )}
          </div>
          <div className="mt-3 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.01em] group-hover:text-accent">{title}</span>
            {expandable && (
              <span className="flex-none text-ink-faint" aria-hidden>
                <Icon name="chevronRight" size={16} />
              </span>
            )}
          </div>
          {meta && <div className="mt-0.5 font-space text-[13px] text-ink-muted">{meta}</div>}
          <CardStat value={release.stat ?? 0} label={metricLabel('release')} />
        </button>
      </div>

      <CardModal
        open={editing}
        // Escape / click-outside closes ONE layer: while a song or merge modal is open it
        // guards this one, so the top layer dismisses first.
        onClose={() => !mergeSong && setEditing(false)}
        label={title}
        analyticsHref={`/artists/${artistId}`}
        deleteAction={deleteContentAction.bind(null, 'release', release.id, artistId)}
        deleteLabel="Delete"
        deleteNoun="Release"
        wide
        corner={
          <button
            type="button"
            onClick={share}
            aria-label="Share"
            title="Share the release page"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <Icon name="share" size={16} />
          </button>
        }
      >
        <ModalHeader
          square={cover(112)}
          title={title}
          meta={
            <>
              <span>{RELEASE_TYPE_LABEL[type]}</span>
              {year ? (
                <>
                  <MetaDot />
                  <span>{year}</span>
                </>
              ) : null}
              {expandable && songCount ? (
                <>
                  <MetaDot />
                  <span>
                    {songCount} song{songCount === 1 ? '' : 's'}
                  </span>
                </>
              ) : null}
            </>
          }
        />
        {/* Two columns (Sam, 2026-09-11): the release on the left, its listen links on the
            right — each link row labelled by the platform's logo, black when a link is set,
            grey when empty. */}
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_320px] gap-x-10">
          <div>
          <KvField label="Title" value={title} onSave={(v) => saveDetails(v, date)} onError={fail} />
          <KvField
            label="Type"
            value={type}
            options={typeOptions.map((t) => ({ value: t, label: RELEASE_TYPE_LABEL[t] }))}
            required
            onSave={saveType}
            onError={fail}
          />
          <KvField label="Date" value={date} type="date" mono onSave={(v) => saveDetails(title, v)} onError={fail} />
          {expandable ? (
            songCount > 0 && (
              <KvRow label="Songs" align="start">
                {/* Click a song → its own modal, the same grammar as a standalone song. Merge
                    into… on hover: a sync-refusal duplicate frequently lives HERE, inside a
                    release, and its twin can be anywhere in the catalog. */}
                {/* The number hangs in the gutter (-ml) so every TITLE starts on the value
                    edge, flush with Title / Type / Date above (Sam, 2026-09-11); rows are
                    20px lines, no padding, so a five-song EP reads as one block. */}
                <ol className="-ml-7 -mt-0.5 min-w-0 flex-1">
                  {release.songs.map((s, i) => (
                    <li key={s.id} className="group/row flex items-baseline gap-2 text-[15px] leading-5">
                      <span className="w-5 flex-none text-right font-space text-[10px] text-ink-faint">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false)
                          setSong(s)
                        }}
                        className="min-w-0 flex-1 truncate text-left hover:text-accent"
                      >
                        {s.title}
                      </button>
                      {feat(s) && <span className="max-w-[40%] flex-none truncate font-space text-[11px] text-ink-faint">{feat(s)}</span>}
                      {targetsFor(s.id).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setMergeSong(s)}
                          aria-label={`Merge ${s.title} into…`}
                          title="Merge into…"
                          className="flex-none self-center text-ink-faint opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100"
                        >
                          <Icon name="links" size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </KvRow>
            )
          ) : (
            // A single IS one song: its audio sits where a tracklist would.
            release.songs[0] && (
              <KvRow label="Audio">
                <TrackAudio artistId={artistId} trackId={release.songs[0].id} audioPath={release.songs[0].audio_path} />
              </KvRow>
            )
          )}
          </div>
          <div>
            {STREAMING_PLATFORMS.map((p) => {
              const url = release.links.find((l) => l.label === p.label)?.url ?? ''
              return (
                <KvField
                  key={p.label}
                  label={p.label}
                  labelNode={<p.Icon size={18} className={url ? 'text-ink' : 'text-ink-faint/60'} />}
                  value={url}
                  type="url"
                  mono
                  onSave={saveReleaseLink(p.label)}
                  onError={fail}
                  trailing={openMark(p.label, url)}
                />
              )
            })}
          </div>
        </div>
      </CardModal>

      {/* Merge — the SAME modal + server action the standalone song cards use, verbatim:
          the row's song is the one deleted; the selected keeper gains its links. Mounted
          only while open so each opening starts with a fresh keeper selection. */}
      {mergeSong && (
        <MergeSongModal
          open
          onClose={() => setMergeSong(null)}
          artistId={artistId}
          song={{ id: mergeSong.id, title: mergeSong.title }}
          targets={targetsFor(mergeSong.id)}
        />
      )}

      {/* A tracklist song opens THE song modal — the same one a standalone song opens,
          with the release's modal already closed behind it. */}
      {song && (
        <SongModal
          track={song}
          artistId={artistId}
          releases={releases}
          home={{ id: release.id, title, release_type: type, slug: release.slug }}
          artistSlug={artistSlug}
          open
          onClose={() => setSong(null)}
          mergeTargets={targetsFor(song.id)}
        />
      )}
    </div>
  )
}
