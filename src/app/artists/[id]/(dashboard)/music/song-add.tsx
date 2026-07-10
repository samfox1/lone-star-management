'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { mediaUrl } from '@/lib/site'
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
type Released = 'released' | 'unreleased'

/**
 * THE add-song flow (the Music page's single + button). Two ways in:
 *   - **Manually** — title, contributors, optional cover art, the audio file,
 *     and a REQUIRED released/unreleased choice: a hand-added song can be
 *     released without any platform link (the stored `released` flag).
 *   - **From streaming** — paste the song's URL per service; title, cover, and
 *     contributors resolve FROM the service (never typed), and a link means
 *     the song IS released.
 */
export function SongAddButton({ artistId }: { artistId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [title, setTitle] = useState('')
  const [contributors, setContributors] = useState('')
  const [released, setReleased] = useState<Released | null>(null) // deliberate: no default
  const [urls, setUrls] = useState<StreamingUrls>({})
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasUrls = Object.values(urls).some((u) => u?.trim())

  function reset() {
    setStep('choose')
    setTitle('')
    setContributors('')
    setReleased(null)
    setUrls({})
    setAudioFile(null)
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

  async function submit() {
    if (busy) return
    setError(null)
    setBusy(true)
    const supabase = createClient()
    const uploaded: { bucket: string; path: string }[] = []
    try {
      const row: Record<string, unknown> = { artist_id: artistId, source: 'manual' }

      if (step === 'manual') {
        const t = title.trim()
        if (!t) return setError('Give the song a title.')
        if (!released) return setError('Choose released or unreleased.')
        if (!audioFile) return setError('Attach the audio file (MP3 or M4A).')
        const audioCheck = validateUpload(audioFile, AUDIO_RULES)
        if (!audioCheck.ok) return setError(audioCheck.error)
        let coverExt: string | null = null
        if (coverFile) {
          const coverCheck = validateUpload(coverFile, COVER_RULES)
          if (!coverCheck.ok) return setError(coverCheck.error)
          coverExt = coverCheck.ext
        }

        row.title = t.slice(0, 120)
        row.featured_artists = parseContributors(contributors)
        row.released = released === 'released'

        // Upload cover (public media bucket) then audio (gated) then the row;
        // any failure removes everything already uploaded — no orphans.
        if (coverFile && coverExt) {
          const coverPath = buildStoragePath(artistId, 'covers', coverExt)
          const { error: upErr } = await supabase.storage
            .from('media')
            .upload(coverPath, coverFile, { contentType: contentTypeFor(coverExt), upsert: false })
          if (upErr) return setError(friendlyUploadError(upErr.message, { noun: 'cover', allowed: COVER_RULES.allowedExt }))
          uploaded.push({ bucket: 'media', path: coverPath })
          row.cover_url = mediaUrl(coverPath)
        }
        const audioPath = buildStoragePath(artistId, 'audio', audioCheck.ext)
        const { error: audErr } = await supabase.storage
          .from('audio')
          .upload(audioPath, audioFile, { contentType: contentTypeFor(audioCheck.ext), upsert: false })
        if (audErr) return setError(friendlyUploadError(audErr.message, { noun: 'song', allowed: AUDIO_RULES.allowedExt }))
        uploaded.push({ bucket: 'audio', path: audioPath })
        row.audio_path = audioPath
      } else {
        if (!hasUrls) return setError('Paste at least one streaming link.')
        // The service already knows the song — resolve title/cover/contributors.
        const resolved = await resolveStreamingSongAction(urls)
        if (!resolved.ok) return setError(resolved.error)
        row.title = resolved.song.title.slice(0, 120)
        row.cover_url = resolved.song.cover_url
        row.featured_artists = resolved.song.contributors
        row.released = true // it's on a platform
        Object.assign(row, parseStreamingLinks(urls))
      }

      const { error: rowErr } = await supabase.from('tracks').insert(row)
      if (rowErr) {
        for (const o of uploaded) await supabase.storage.from(o.bucket).remove([o.path])
        return setError(rowErr.message)
      }
      toast('Song added')
      router.refresh()
      setOpen(false)
      reset()
    } finally {
      setBusy(false)
    }
  }

  const tile = (s: Step, icon: 'edit' | 'bolt', label: string) => (
    <button
      type="button"
      onClick={() => setStep(s)}
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
        Has this song been released? Released songs can appear on your public site; unreleased songs stay
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add song"
        aria-label="Add song"
        className="group inline-flex items-center rounded-lg border border-hairline p-1.5 text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        <span className="max-w-0 overflow-hidden whitespace-nowrap font-space text-xs font-semibold transition-all duration-200 group-hover:max-w-[70px] group-hover:pl-1 group-hover:pr-1.5">
          Add
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
          {/* font-space on the card: ALL the modal's text speaks the site's mono voice. */}
          <div className={cx(modalCardClass, 'font-space')}>
            <div className="flex items-center gap-2.5 border-b border-hairline pb-3.5">
              {step !== 'choose' && (
                <button
                  type="button"
                  onClick={() => {
                    setStep('choose')
                    setError(null)
                  }}
                  aria-label="Back"
                  className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-hairline text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                >
                  <Icon name="chevronLeft" size={15} />
                </button>
              )}
              <div className="min-w-0">
                <KLabel>Song</KLabel>
                <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">Add song</h2>
              </div>
            </div>

            {step === 'choose' && (
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {tile('manual', 'edit', 'Add Manually')}
                {tile('streaming', 'bolt', 'Upload from Streaming Service')}
              </div>
            )}

            {step === 'manual' && (
              <div className="mt-4 space-y-3">
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Song title"
                  required
                  className={`${inputClass} w-full`}
                />
                <input
                  value={contributors}
                  onChange={(e) => setContributors(e.target.value)}
                  placeholder="Contributors (comma separated, optional)"
                  className={`${inputClass} w-full`}
                />
                <FileDropField
                  accept="audio/mpeg,audio/mp4,.mp3,.m4a"
                  label={audioFile ? audioFile.name : 'Drop the audio file or click to pick'}
                  hint="MP3 or M4A · up to 30 MB"
                  busy={false}
                  onFile={setAudioFile}
                />
                <FileDropField
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  label={coverFile ? coverFile.name : 'Drop the cover art (optional)'}
                  hint="JPG, PNG or WebP"
                  busy={false}
                  onFile={setCoverFile}
                />
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

            {step !== 'choose' && (
              <div className="mt-4 space-y-3">
                {error && <UploadError>{error}</UploadError>}
                <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
                  <button type="button" onClick={close} disabled={busy} className={buttonClass('ghost')}>
                    Cancel
                  </button>
                  <button type="button" onClick={submit} disabled={busy} className={buttonClass('solid')}>
                    {busy ? 'Adding…' : 'Add song'}
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
