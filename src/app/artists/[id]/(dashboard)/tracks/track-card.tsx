'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { trackPlatforms, type TrackPlatformIds } from '@/lib/music'
import { safeHref } from '@/lib/url'
import { CardModal } from '../card-modal'
import { EntitySparkline } from '../entity-sparkline'
import { TrackAudio } from '../track-audio'
import { toast } from '../toast'
import { SONG_PLATFORMS } from '../releases/release-card'
import { deleteContentAction, setTrackReleaseAction, updateContentAction } from '../actions'

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
}: {
  track: Track
  artistId: string
  releases: ReleaseOption[]
  /** Hide the platform-badge subtitle (orphan singles in the Singles grid read as a
   *  plain single card — title only — to match the release cards beside them). */
  hideBadges?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState(track.title)
  const [releaseDraft, setReleaseDraft] = useState(track.release_id ?? '')
  const platforms = trackPlatforms(track)

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
    setEditOpen(true)
  }

  // Save the editable details (title + which release it belongs to), then close the editor.
  async function saveDetails() {
    const t = titleDraft.trim()
    if (!t) {
      toast('Give the song a title.', 'error')
      return
    }
    let saved = false
    if (t !== track.title) {
      const fd = new FormData()
      fd.set('title', t)
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
      <button type="button" onClick={() => setOpen(true)} className="group block w-full text-left">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-surface">
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

      {/* Same single-style modal as a release single — a song is a song wherever it lives. */}
      <CardModal open={open} onClose={() => !editOpen && setOpen(false)} wide footer={null}>
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

              {/* Audio: a player when the track has uploaded audio, plus add/replace. */}
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
          {releases.length > 0 && (
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Release</span>
              <select
                value={releaseDraft}
                onChange={(e) => setReleaseDraft(e.target.value)}
                className="block w-full rounded-lg border border-hairline bg-paper px-2.5 py-2 font-space text-sm text-ink outline-none focus:border-ink-faint"
              >
                <option value="">— None —</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </CardModal>
    </>
  )
}
