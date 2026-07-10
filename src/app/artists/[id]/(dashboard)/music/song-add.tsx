'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buttonClass, inputClass, KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { mediaUrl } from '@/lib/site'
import { buildStoragePath, contentTypeFor, friendlyUploadError, validateUpload } from '@/lib/upload'
import { FileDropField, UploadError } from '../file-drop-field'
import { Segmented } from '../segmented'
import { toast } from '../toast'

/** One URL row per streaming service we know how to store (the union model). */
export const STREAMING_SERVICES = [
  { key: 'spotify', label: 'Spotify', placeholder: 'https://open.spotify.com/track/…' },
  { key: 'apple', label: 'Apple Music', placeholder: 'https://music.apple.com/…' },
  { key: 'soundcloud', label: 'SoundCloud', placeholder: 'https://soundcloud.com/…' },
  { key: 'deezer', label: 'Deezer', placeholder: 'https://www.deezer.com/track/…' },
] as const

export type StreamingUrls = Partial<Record<(typeof STREAMING_SERVICES)[number]['key'], string>>

/**
 * Map pasted service URLs onto the union-model columns: Spotify/Deezer ids parse
 * out of their URLs (badges/links rebuild from ids); Apple + SoundCloud store the
 * URL itself. Unknown-shaped URLs still save to the URL column when one exists.
 */
export function parseStreamingLinks(urls: StreamingUrls): Record<string, string> {
  const out: Record<string, string> = {}
  const spotify = urls.spotify?.trim()
  if (spotify) {
    out.stream_url = spotify
    const id = spotify.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/)?.[1]
    if (id) out.spotify_id = id
  }
  const apple = urls.apple?.trim()
  if (apple) out.apple_url = apple
  const soundcloud = urls.soundcloud?.trim()
  if (soundcloud) out.soundcloud_url = soundcloud
  const deezer = urls.deezer?.trim()
  if (deezer) {
    out.provider_url = deezer
    const id = deezer.match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/)?.[1]
    if (id) out.deezer_id = id
  }
  return out
}

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
 *   - **Manually** — the full song: title, contributors, cover art (optional),
 *     and the audio file itself, plus the REQUIRED released/unreleased toggle —
 *     a hand-added song can be released without any platform link (the stored
 *     `released` flag; see lib/music.ts).
 *   - **From streaming** — paste the song's URL per service (Spotify / Apple /
 *     SoundCloud / Deezer, any subset). Attaching a service means the song IS
 *     released, so the toggle locks to Released.
 */
export function SongAddButton({ artistId, defaultReleased = 'unreleased' }: { artistId: string; defaultReleased?: Released }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [title, setTitle] = useState('')
  const [contributors, setContributors] = useState('')
  const [released, setReleased] = useState<Released>(defaultReleased)
  const [urls, setUrls] = useState<StreamingUrls>({})
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasUrls = Object.values(urls).some((u) => u?.trim())
  // Attaching a streaming service means the song is out in the world.
  const effectiveReleased = step === 'streaming' && hasUrls ? 'released' : released

  function reset() {
    setStep('choose')
    setTitle('')
    setContributors('')
    setReleased(defaultReleased)
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
    setReleased(defaultReleased)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function submit() {
    if (busy) return
    const t = title.trim()
    if (!t) return setError('Give the song a title.')
    setError(null)

    const base: Record<string, unknown> = {
      artist_id: artistId,
      title: t.slice(0, 120),
      featured_artists: parseContributors(contributors),
      source: 'manual',
      released: effectiveReleased === 'released',
    }

    setBusy(true)
    const supabase = createClient()
    const uploaded: { bucket: string; path: string }[] = []
    try {
      if (step === 'manual') {
        if (!audioFile) return setError('Attach the audio file (MP3 or M4A).')
        const audioCheck = validateUpload(audioFile, AUDIO_RULES)
        if (!audioCheck.ok) return setError(audioCheck.error)
        let coverExt: string | null = null
        if (coverFile) {
          const coverCheck = validateUpload(coverFile, COVER_RULES)
          if (!coverCheck.ok) return setError(coverCheck.error)
          coverExt = coverCheck.ext
        }

        // Upload cover (public media bucket) then audio (gated) then the row;
        // any failure removes everything already uploaded — no orphans.
        if (coverFile && coverExt) {
          const coverPath = buildStoragePath(artistId, 'covers', coverExt)
          const { error: upErr } = await supabase.storage
            .from('media')
            .upload(coverPath, coverFile, { contentType: contentTypeFor(coverExt), upsert: false })
          if (upErr) return setError(friendlyUploadError(upErr.message, { noun: 'cover', allowed: COVER_RULES.allowedExt }))
          uploaded.push({ bucket: 'media', path: coverPath })
          base.cover_url = mediaUrl(coverPath)
        }
        const audioPath = buildStoragePath(artistId, 'audio', audioCheck.ext)
        const { error: audErr } = await supabase.storage
          .from('audio')
          .upload(audioPath, audioFile, { contentType: contentTypeFor(audioCheck.ext), upsert: false })
        if (audErr) return setError(friendlyUploadError(audErr.message, { noun: 'song', allowed: AUDIO_RULES.allowedExt }))
        uploaded.push({ bucket: 'audio', path: audioPath })
        base.audio_path = audioPath
      } else {
        if (!hasUrls) return setError('Paste at least one streaming link.')
        Object.assign(base, parseStreamingLinks(urls), { released: true })
      }

      const { error: rowErr } = await supabase.from('tracks').insert(base)
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

  const releasedToggle = (
    <div className="flex items-center gap-3">
      <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">Status</span>
      {step === 'streaming' && hasUrls ? (
        <span className="font-space text-xs text-ink-muted">Released — it&apos;s on a platform</span>
      ) : (
        <Segmented
          label="Released or unreleased"
          options={[
            { key: 'released', label: 'Released' },
            { key: 'unreleased', label: 'Unreleased' },
          ]}
          value={released}
          onChange={setReleased}
        />
      )}
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
          <div className={modalCardClass}>
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
                {tile('manual', 'edit', 'Add manually')}
                {tile('streaming', 'bolt', 'From streaming')}
              </div>
            )}

            {step !== 'choose' && (
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

                {step === 'manual' && (
                  <>
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
                  </>
                )}

                {step === 'streaming' && (
                  <div className="space-y-2">
                    {STREAMING_SERVICES.map((s) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="w-24 flex-none font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">
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
                )}

                {releasedToggle}

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
