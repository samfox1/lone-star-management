'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { mediaUrl } from '@/lib/site'
import { slugify } from '@/lib/slug'
import { buildStoragePath, contentTypeFor, friendlyUploadError, validateUpload } from '@/lib/upload'
import { STREAMING_SERVICES, parseStreamingLinks, type StreamingUrls } from '@/lib/song-links'
import { FileDropField, UploadError } from '../file-drop-field'
import { resolveStreamingSongAction } from '../actions'
import { toast } from '../toast'

/** "A, B feat. C" → ['A', 'B feat. C'] — comma-separated collaborators. */
export function parseContributors(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)
}

const AUDIO_RULES = {
  allowedExt: ['mp3', 'm4a'],
  maxBytes: 30 * 1024 * 1024,
  allowedMime: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a'],
}
const COVER_RULES = {
  allowedExt: ['jpg', 'jpeg', 'png', 'webp'],
  maxBytes: 25 * 1024 * 1024,
  allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
}

type Step = 'choose' | 'manual' | 'streaming'
type Format = 'single' | 'ep' | 'album'
type Released = 'released' | 'unreleased'
type SongRow = { title: string; contributors: string; file: File | null }

const EMPTY_ROW: SongRow = { title: '', contributors: '', file: null }

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
  const [rows, setRows] = useState<SongRow[]>([{ ...EMPTY_ROW }])
  const [released, setReleased] = useState<Released | null>(null) // deliberate: no default
  const [urls, setUrls] = useState<StreamingUrls>({})
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasUrls = Object.values(urls).some((u) => u?.trim())
  const grouped = format === 'ep' || format === 'album'

  function reset() {
    setStep('choose')
    setFormat(null)
    setReleaseTitle('')
    setRows([{ ...EMPTY_ROW }])
    setReleased(null)
    setUrls({})
    setCoverFile(null)
    setError(null)
  }
  function close() {
    if (busy) return
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

  async function submit() {
    if (busy) return
    setError(null)
    setBusy(true)
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
      if (step === 'streaming') {
        if (!hasUrls) return setError('Paste at least one streaming link.')
        const resolved = await resolveStreamingSongAction(urls)
        if (!resolved.ok) return setError(resolved.error)
        const { error: rowErr } = await supabase.from('tracks').insert({
          artist_id: artistId,
          source: 'manual',
          title: resolved.song.title.slice(0, 120),
          cover_url: resolved.song.cover_url,
          featured_artists: resolved.song.contributors,
          released: true, // it's on a platform
          ...parseStreamingLinks(urls),
        })
        if (rowErr) return setError(rowErr.message)
      } else {
        // ----- manual: single OR a grouped record (EP/album) -----------------
        if (!format) return setError('Pick single, EP, or album.')
        if (grouped && !releaseTitle.trim()) return setError(`Give the ${format.toUpperCase()} a title.`)
        if (!released) return setError('Choose released or unreleased.')
        for (const [i, r] of rows.entries()) {
          if (!r.title.trim()) return setError(`Song ${i + 1} needs a title.`)
          if (!r.file) return setError(`Song ${i + 1} needs its audio file (MP3 or M4A).`)
          const check = validateUpload(r.file, AUDIO_RULES)
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
          const check = validateUpload(r.file!, AUDIO_RULES)
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
            return setError(friendlyUploadError(audErr.message, { noun: 'song', allowed: AUDIO_RULES.allowedExt }))
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
              released: released === 'released',
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
    } finally {
      setBusy(false)
    }
  }

  const tile = (onClick: () => void, icon: 'edit' | 'bolt' | 'tracks' | 'releases', label: string) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2.5 rounded-xl border border-hairline bg-paper px-3 py-6 text-ink transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
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
    <div key={i} className="space-y-2 rounded-xl border border-hairline p-3">
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
        accept="audio/mpeg,audio/mp4,.mp3,.m4a"
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
          {/* font-space: the modal speaks the site's mono voice; wider than the
              stock card so EP/album song rows breathe. */}
          <div className={cx(modalCardClass, 'font-space !w-[720px]')}>
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
              {step !== 'choose' && (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 'manual' && format) setFormat(null)
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
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                {tile(() => setFormat('single'), 'tracks', 'Single')}
                {tile(() => { setFormat('ep'); setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]) }, 'releases', 'EP')}
                {tile(() => { setFormat('album'); setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]) }, 'releases', 'Album')}
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
                    onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
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

            {step !== 'choose' && (step !== 'manual' || format) && (
              <div className="mt-4 space-y-3">
                {error && <UploadError>{error}</UploadError>}
                <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
                  <button type="button" onClick={close} disabled={busy} className={buttonClass('ghost')}>
                    Cancel
                  </button>
                  <button type="button" onClick={submit} disabled={busy} className={buttonClass('solid')}>
                    {busy ? 'Adding…' : 'Add'}
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
