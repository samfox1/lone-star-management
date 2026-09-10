'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { mediaUrl } from '@/lib/site'
import { slugify } from '@/lib/slug'
import { acceptFor, AUDIO_UPLOAD_RULES, buildStoragePath, contentTypeFor, friendlyUploadError, validateUpload } from '@/lib/upload'
import { STREAMING_SERVICES, parseStreamingLinks, type StreamingUrls } from '@/lib/song-links'
import { FileDropField, UploadError } from '../file-drop-field'
import { resolveStreamingSongAction } from '../actions'
import { useLockBodyScroll } from '../use-lock-body-scroll'
import { toast } from '../toast'

/** "A, B feat. C" → ['A', 'B feat. C'] — comma-separated collaborators. */
export function parseContributors(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
}

const COVER_RULES = {
  allowedExt: ['jpg', 'jpeg', 'png', 'webp'],
  maxBytes: 25 * 1024 * 1024,
  allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
}

type Step = 'choose' | 'manual' | 'streaming' | 'streaming-review'
type Format = 'single' | 'ep' | 'album' | 'remix' | 'live'
type Released = 'released' | 'unreleased'
type SongRow = { id: string; title: string; contributors: string; file: File | null }

// Monotonic id for stable React keys on removable rows (index keys mis-associate
// state when a middle row is removed). Module-scoped: a plain counter, so it's
// never a ref accessed during render.
let rowSeq = 0
const newRow = (): SongRow => ({ id: `r${rowSeq++}`, title: '', contributors: '', file: null })

/**
 * What ONE streaming link can be. A link is a single song, so this is the song's kind —
 * never EP/album, which are uploads of several songs. 'live' joined in 2026-08-21.
 */
const STREAMING_TYPES = ['single', 'remix', 'live'] as const
type StreamingType = (typeof STREAMING_TYPES)[number]
const STREAMING_TYPE_LABEL: Record<StreamingType, string> = {
  single: 'Original',
  remix: 'Remix',
  live: 'Live set',
}

/**
 * Best-guess a pasted link's type from its resolved title, for the manager to confirm.
 *
 * REMIX WINS a title holding both ("Live Wire [Skeen Remix]"): a remix of a live cut is
 * still a remix, whereas the reverse reading — a live performance that is also a remix —
 * is not a thing the catalog has. Live needs the word on a boundary, so "Living Room"
 * and "Olive" do not become concert recordings.
 */
export function guessStreamingType(title: string): StreamingType {
  if (/\bremix\b/i.test(title)) return 'remix'
  if (/\blive\b/i.test(title)) return 'live'
  return 'single'
}

/**
 * THE add-music flow (the Music page's single + button). Two ways in:
 *   - **Add Manually** — first pick the format (single / EP / album). A single
 *     is one song; an EP/album is a manual RELEASE with song rows (title,
 *     contributors, audio each — "+ Add song" appends one). Cover art sits at
 *     the top and a REQUIRED released/unreleased choice closes the form: a
 *     hand-added song or record can be public with no platform link (the
 *     stored `released` flags; songs inherit their release's).
 *   - **Upload from Streaming Service** — paste the song's URL per service;
 *     title/cover/contributors resolve FROM the service; automatically released.
 */
export function SongAddButton({ artistId }: { artistId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [format, setFormat] = useState<Format | null>(null)
  const [releaseTitle, setReleaseTitle] = useState('')
  const [rows, setRows] = useState<SongRow[]>(() => [newRow()])
  const [released, setReleased] = useState<Released | null>(null) // deliberate: no default
  const [urls, setUrls] = useState<StreamingUrls>({})
  // A streaming link (SoundCloud etc.) carries no album/type, so the manager tags it.
  // One link is one song, so the choice is what KIND of song: an original, a remix, or a
  // recording of a performance (Sam, 2026-08-21 — his Navy Pier set arrived as exactly
  // this and had to be filed under 'remix' for want of anywhere else to put it). EP/album
  // is absent because that is an upload of multiple songs, not one link.
  const [streamingType, setStreamingType] = useState<StreamingType | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  // The streaming REVIEW step: what the service resolved (or blanks it couldn't), which the
  // manager confirms/fills before the row is written. reviewCoverUrl is the detected cover;
  // coverFile overrides it (or supplies one when nothing was detected).
  const [reviewTitle, setReviewTitle] = useState('')
  const [reviewContributors, setReviewContributors] = useState('')
  const [reviewCoverUrl, setReviewCoverUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Mirror `busy` into a ref so close() (captured by the Escape effect) reads the
  // LIVE value, not the open-time closure — otherwise Escape mid-upload sails
  // past the guard and reset()s the form while writes are still in flight.
  const busyRef = useRef(false)
  const setBusyBoth = (v: boolean) => {
    busyRef.current = v
    setBusy(v)
  }

  useLockBodyScroll(open)
  const hasUrls = Object.values(urls).some((u) => u?.trim())
  const grouped = format === 'ep' || format === 'album'

  function reset() {
    setStep('choose')
    setFormat(null)
    setStreamingType(null)
    setReleaseTitle('')
    setRows([newRow()])
    setReleased(null)
    setUrls({})
    setCoverFile(null)
    setReviewTitle('')
    setReviewContributors('')
    setReviewCoverUrl(null)
    setError(null)
  }
  function close() {
    if (busyRef.current) return
    setOpen(false)
    reset()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const setRow = (i: number, patch: Partial<SongRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  /** A collision-free release slug, mirroring addReleaseAction's suffixing. */
  async function uniqueSlug(supabase: ReturnType<typeof createClient>, base: string): Promise<string> {
    const { data } = await supabase.from('releases').select('slug').eq('artist_id', artistId).like('slug', `${base}%`)
    const taken = new Set((data ?? []).map((r) => r.slug as string))
    let slug = base
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
    return slug
  }

  /** Streaming: resolve what the service can, then go to the review step so the manager
   *  completes anything it couldn't detect (title, cover, contributors) before saving. */
  async function startReview() {
    if (busyRef.current) return
    setError(null)
    if (!hasUrls) return setError('Paste at least one streaming link.')
    setBusyBoth(true)
    try {
      const resolved = await resolveStreamingSongAction(urls)
      const title = resolved.ok ? resolved.song.title.slice(0, 120) : ''
      setReviewTitle(title)
      setReviewContributors(resolved.ok ? resolved.song.contributors.join(', ') : '')
      setReviewCoverUrl(resolved.ok ? resolved.song.cover_url : null)
      // Best-guess the type from the title ("… [remix]", "LIVE @ …") — the manager
      // confirms it on the review step, so a wrong guess is one click to fix.
      setStreamingType(guessStreamingType(title))
      setStep('streaming-review')
    } finally {
      setBusyBoth(false)
    }
  }

  async function submit() {
    if (busyRef.current) return
    setError(null)
    setBusyBoth(true)
    const supabase = createClient()
    const uploaded: { bucket: string; path: string }[] = []
    const createdTracks: string[] = []
    let createdRelease: string | null = null

    const rollback = async () => {
      for (const o of uploaded) await supabase.storage.from(o.bucket).remove([o.path])
      if (createdTracks.length) await supabase.from('tracks').delete().in('id', createdTracks)
      if (createdRelease) await supabase.from('releases').delete().eq('id', createdRelease)
    }

    try {
      if (step === 'streaming-review') {
        if (!reviewTitle.trim()) return setError('Give the song a title.')
        // An uploaded cover overrides the detected one; either (or neither) may be present.
        let coverUrl = reviewCoverUrl
        if (coverFile) {
          const coverCheck = validateUpload(coverFile, COVER_RULES)
          if (!coverCheck.ok) return setError(coverCheck.error)
          const coverPath = buildStoragePath(artistId, 'covers', coverCheck.ext)
          const { error: upErr } = await supabase.storage
            .from('media')
            .upload(coverPath, coverFile, { contentType: contentTypeFor(coverCheck.ext), upsert: false })
          if (upErr) return setError(friendlyUploadError(upErr.message, { noun: 'cover', allowed: COVER_RULES.allowedExt }))
          uploaded.push({ bucket: 'media', path: coverPath })
          coverUrl = mediaUrl(coverPath)
        }
        const { error: rowErr } = await supabase.from('tracks').insert({
          artist_id: artistId,
          source: 'manual',
          title: reviewTitle.trim().slice(0, 120),
          cover_url: coverUrl,
          featured_artists: parseContributors(reviewContributors),
          released: true, // it's on a platform
          // The service can't tell single from remix, so the manager tagged it.
          release_type: streamingType,
          ...parseStreamingLinks(urls),
        })
        if (rowErr) {
          await rollback()
          return setError(rowErr.message)
        }
      } else {
        // ----- manual: single OR a grouped record (EP/album) -----------------
        if (!format) return setError('Pick a format.')
        if (grouped && !releaseTitle.trim()) return setError(`Give the ${format.toUpperCase()} a title.`)
        if (!released) return setError('Choose released or unreleased.')
        for (const [i, r] of rows.entries()) {
          if (!r.title.trim()) return setError(`Song ${i + 1} needs a title.`)
          if (!r.file) return setError(`Song ${i + 1} needs its audio file (MP3 or M4A).`)
          const check = validateUpload(r.file, AUDIO_UPLOAD_RULES)
          if (!check.ok) return setError(`Song ${i + 1}: ${check.error}`)
        }
        let coverExt: string | null = null
        if (coverFile) {
          const coverCheck = validateUpload(coverFile, COVER_RULES)
          if (!coverCheck.ok) return setError(coverCheck.error)
          coverExt = coverCheck.ext
        }

        // Cover first (shared by the release and every song tile).
        let coverUrl: string | null = null
        if (coverFile && coverExt) {
          const coverPath = buildStoragePath(artistId, 'covers', coverExt)
          const { error: upErr } = await supabase.storage
            .from('media')
            .upload(coverPath, coverFile, { contentType: contentTypeFor(coverExt), upsert: false })
          if (upErr) return setError(friendlyUploadError(upErr.message, { noun: 'cover', allowed: COVER_RULES.allowedExt }))
          uploaded.push({ bucket: 'media', path: coverPath })
          coverUrl = mediaUrl(coverPath)
        }

        // The record row (EP/album): songs hang off it and inherit its bucket.
        let releaseId: string | null = null
        if (grouped) {
          const slug = await uniqueSlug(supabase, slugify(releaseTitle.trim()) || 'release')
          const { data: rel, error: relErr } = await supabase
            .from('releases')
            .insert({
              artist_id: artistId,
              title: releaseTitle.trim().slice(0, 120),
              slug,
              cover_url: coverUrl,
              release_type: format,
              links: [],
              source: 'manual',
              released: released === 'released',
              // EXPLICIT, because the column defaults to TRUE: omitting it would put an
              // unreleased record on the public site at the next publish, contradicting
              // the promise this modal makes ("unreleased music stays private to the
              // dashboard"). Sync inserts off-site for the same reason.
              on_site: released === 'released',
            })
            .select('id')
            .single()
          if (relErr || !rel) {
            await rollback()
            return setError(relErr?.message ?? 'Could not create the release.')
          }
          createdRelease = rel.id as string
          releaseId = createdRelease
        }

        for (const r of rows) {
          const check = validateUpload(r.file!, AUDIO_UPLOAD_RULES)
          if (!check.ok) {
            await rollback()
            return setError(check.error)
          }
          const audioPath = buildStoragePath(artistId, 'audio', check.ext)
          const { error: audErr } = await supabase.storage
            .from('audio')
            .upload(audioPath, r.file!, { contentType: contentTypeFor(check.ext), upsert: false })
          if (audErr) {
            await rollback()
            return setError(friendlyUploadError(audErr.message, { noun: 'song', allowed: AUDIO_UPLOAD_RULES.allowedExt }))
          }
          uploaded.push({ bucket: 'audio', path: audioPath })
          const { data: trk, error: trkErr } = await supabase
            .from('tracks')
            .insert({
              artist_id: artistId,
              title: r.title.trim().slice(0, 120),
              featured_artists: parseContributors(r.contributors),
              source: 'manual',
              audio_path: audioPath,
              cover_url: coverUrl,
              release_id: releaseId,
              release_type: format,
              // Only a grouped record (EP/album) has an album name; a single/remix stands
              // alone, so it groups by its own id, not a shared album.
              album_name: grouped ? releaseTitle.trim().slice(0, 120) : null,
              released: released === 'released',
              // See the release insert above: the column defaults to TRUE, so an
              // unreleased song must say so or it goes public on the next publish.
              on_site: released === 'released',
            })
            .select('id')
            .single()
          if (trkErr || !trk) {
            await rollback()
            return setError(trkErr?.message ?? 'Could not save a song.')
          }
          createdTracks.push(trk.id as string)
        }
      }

      toast(grouped && step === 'manual' ? `${format?.toUpperCase()} added` : 'Song added')
      router.refresh()
      setOpen(false)
      reset()
    } catch (e) {
      // A throw (uniqueSlug/storage/network reject) would otherwise skip the
      // rollback list AND leave the user with no message — orphaned audio/cover
      // objects and a half-created EP. Undo what we uploaded/inserted, then show
      // a friendly error.
      await rollback()
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusyBoth(false)
    }
  }

  // Width by step: the choice pickers (choose + single/EP/album) are narrow and
  // tall (few tiles, no reason to sprawl); the actual add form is medium; the
  // streaming form sits in between.
  const isChoiceStep = step === 'choose' || (step === 'manual' && !format)
  const cardWidth = isChoiceStep ? '!w-[440px]' : '!w-[520px]'

  const tile = (onClick: () => void, icon: 'edit' | 'bolt' | 'tracks' | 'releases', label: string) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-3 rounded-xl border border-hairline bg-paper px-3 py-10 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
    >
      <Icon name={icon} size={22} />
      <span className="text-sm font-semibold">{label}</span>
    </button>
  )

  // REQUIRED choice, deliberately not a toggle: neither option is preselected.
  const releasedChoice = (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">
        Has this been released? Released music can appear on your public site; unreleased music stays
        private to the dashboard. <span className="text-accent-red">*</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(['released', 'unreleased'] as Released[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReleased(r)}
            aria-pressed={released === r}
            className={cx(
              'rounded-lg border px-3 py-2 text-xs font-semibold capitalize transition-colors',
              released === r
                ? 'border-ink bg-ink text-white'
                : 'border-hairline text-ink-muted hover:border-ink-faint hover:text-ink',
            )}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )

  const coverDrop = (
    <FileDropField
      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
      label={coverFile ? coverFile.name : 'Drop the cover art (optional)'}
      hint="JPG, PNG or WebP"
      busy={false}
      onFile={setCoverFile}
    />
  )

  const songRow = (r: SongRow, i: number) => (
    <div key={r.id} className="space-y-2 rounded-xl border border-hairline p-3">
      {grouped && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Song {i + 1}</span>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              className="text-xs text-accent-red hover:underline"
            >
              remove
            </button>
          )}
        </div>
      )}
      <input
        value={r.title}
        onChange={(e) => setRow(i, { title: e.target.value })}
        placeholder="Song title"
        required
        className={`${inputClass} w-full`}
      />
      <input
        value={r.contributors}
        onChange={(e) => setRow(i, { contributors: e.target.value })}
        placeholder="Contributors (comma separated, optional)"
        className={`${inputClass} w-full`}
      />
      <FileDropField
        accept={acceptFor(AUDIO_UPLOAD_RULES)}
        label={r.file ? r.file.name : 'Drop the audio file or click to pick'}
        hint="MP3 or M4A · up to 30 MB"
        busy={false}
        onFile={(f) => setRow(i, { file: f })}
      />
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add music"
        aria-label="Add music"
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[90px] group-hover:pl-1 group-hover:pr-1.5">
          Add Music
        </span>
        <Icon name="plus" size={14} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className={modalOverlayClass}
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          {/* font-space: the modal speaks the site's mono voice. Width tracks the
              step (cardWidth) — narrow for the pickers, medium for the add form. */}
          <div className={cx(modalCardClass, 'font-space', cardWidth)}>
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
              {step !== 'choose' && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 'manual' && format) setFormat(null)
                    else if (step === 'streaming-review') setStep('streaming')
                    else setStep('choose')
                    setError(null)
                  }}
                  aria-label="Back"
                  className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                >
                  <Icon name="chevronLeft" size={15} />
                </button>
              )}
              <div className="min-w-0">
                <KLabel>Music</KLabel>
                <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">Add Music</h2>
              </div>
            </div>

            {step === 'choose' && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {tile(() => setStep('manual'), 'edit', 'Add Manually')}
                {tile(() => setStep('streaming'), 'bolt', 'Upload from Streaming Service')}
              </div>
            )}

            {/* Manual, first question: what is this? */}
            {step === 'manual' && !format && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {tile(() => { setFormat('single'); setRows([newRow()]) }, 'tracks', 'Single')}
                {tile(() => { setFormat('remix'); setRows([newRow()]) }, 'tracks', 'Remix')}
                {tile(() => { setFormat('live'); setRows([newRow()]) }, 'tracks', 'Live set')}
                {tile(() => { setFormat('ep'); setRows([newRow(), newRow()]) }, 'releases', 'EP')}
                {tile(() => { setFormat('album'); setRows([newRow(), newRow()]) }, 'releases', 'Album')}
              </div>
            )}

            {step === 'manual' && format && (
              <div className="mt-4 space-y-3">
                {coverDrop}
                {grouped && (
                  <input
                    autoFocus
                    value={releaseTitle}
                    onChange={(e) => setReleaseTitle(e.target.value)}
                    placeholder={`${format === 'ep' ? 'EP' : 'Album'} title`}
                    required
                    className={`${inputClass} w-full`}
                  />
                )}
                <div className="space-y-2.5">{rows.map(songRow)}</div>
                {grouped && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => [...prev, newRow()])}
                    className={buttonClass('ghost')}
                  >
                    + Add song
                  </button>
                )}
                {releasedChoice}
              </div>
            )}

            {step === 'streaming' && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-ink-muted">
                  Paste the song&apos;s link on each service it lives on — the title, cover art, and
                  contributors come from the service, and the song counts as released.
                </p>
                <div className="space-y-2">
                  {STREAMING_SERVICES.map((s) => (
                    <div key={s.key} className="flex items-center gap-2">
                      <span className="w-24 flex-none text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                        {s.label}
                      </span>
                      <input
                        type="url"
                        value={urls[s.key] ?? ''}
                        onChange={(e) => setUrls((p) => ({ ...p, [s.key]: e.target.value }))}
                        placeholder={s.placeholder}
                        className={`${inputClass} min-w-0 flex-1`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 'streaming-review' && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-ink-muted">
                  Here&apos;s what we pulled from the link. Fill in anything it couldn&apos;t detect before adding.
                </p>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Title</span>
                  <input
                    value={reviewTitle}
                    onChange={(e) => setReviewTitle(e.target.value)}
                    placeholder="Song title"
                    className={`${inputClass} w-full`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                    Contributors
                  </span>
                  <input
                    value={reviewContributors}
                    onChange={(e) => setReviewContributors(e.target.value)}
                    placeholder="Comma-separated (optional)"
                    className={`${inputClass} w-full`}
                  />
                </label>
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Cover</span>
                  {reviewCoverUrl && !coverFile ? (
                    <div className="flex items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={reviewCoverUrl} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" />
                      <button
                        type="button"
                        onClick={() => setReviewCoverUrl(null)}
                        className="text-xs text-ink-muted hover:text-ink hover:underline"
                      >
                        Replace
                      </button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                      className="text-xs text-ink-muted file:mr-2 file:rounded-md file:border file:border-hairline file:bg-paper file:px-2 file:py-1 file:text-ink-muted"
                    />
                  )}
                </div>
                {/* Required: the manager confirms the machine's guess (from the title). */}
                <div>
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                    Song type
                  </span>
                  <div className="flex gap-2">
                    {STREAMING_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setStreamingType(t)}
                        className={buttonClass(streamingType === t ? 'solid' : 'ghost')}
                      >
                        {STREAMING_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step !== 'choose' && (step !== 'manual' || format) && (
              <div className="mt-4 space-y-3">
                {error && <UploadError>{error}</UploadError>}
                <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
                  <button type="button" onClick={close} disabled={busy} className={buttonClass('ghost')}>
                    Cancel
                  </button>
                  {/* Streaming resolves into a review step first; everything else adds directly. */}
                  <button
                    type="button"
                    onClick={step === 'streaming' ? startReview : submit}
                    disabled={busy}
                    className={buttonClass('solid')}
                  >
                    {busy ? (step === 'streaming' ? 'Checking…' : 'Adding…') : step === 'streaming' ? 'Continue' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
