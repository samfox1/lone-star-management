'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass, KLabel, modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { createClient } from '@/lib/supabase/client'
import { FileDropField, UploadError } from '../file-drop-field'
import { useStorageUpload } from '../use-storage-upload'
import { addVideoAction, resolveVideoUrlAction } from '../actions'
import { useLockBodyScroll } from '../use-lock-body-scroll'
import { toast } from '../toast'

type Step = 'choose' | 'manual' | 'streaming'

/**
 * The Videos "+ Add" — the same two-way modal the Music page uses:
 *   - **Add manually** — a title (optional, falls back to the filename) and the
 *     video file itself (resumable direct-to-Storage; lands off-site until
 *     published).
 *   - **From streaming** — paste the video's link, then the title (prefilled
 *     from the platform when it resolves, still editable).
 */
export function VideoAddButton({ artistId }: { artistId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('choose')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useLockBodyScroll(open)

  // writeRow runs mid-upload; a ref keeps it reading the LATEST title. close() is
  // captured by the Escape effect (deps [open]); a busy ref lets it read the LIVE
  // value so an Escape mid-upload can't sail past the guard. Both are synced in
  // effects below (never assigned during render).
  const titleRef = useRef('')
  const busyRef = useRef(false)

  const upload = useStorageUpload({
    bucket: 'videos',
    artistId,
    category: 'videos',
    noun: 'video',
    resumable: true, // large files: real progress + resume on a dropped connection
    rules: {
      allowedExt: ['mp4', 'mov', 'webm'],
      maxBytes: 500 * 1024 * 1024,
      allowedMime: ['video/mp4', 'video/quicktime', 'video/webm'],
    },
    writeRow: async (path, f) => {
      const fallback = f.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled video'
      const { error: rowErr } = await createClient()
        .from('videos')
        .insert({
          artist_id: artistId,
          title: titleRef.current.trim().slice(0, 120) || fallback,
          provider: 'uploaded',
          storage_path: path,
          source: 'manual',
          visible: false,
        })
      return rowErr?.message ?? null
    },
    onSuccess: () => {
      router.refresh()
      close(true)
    },
  })

  function reset() {
    setStep('choose')
    setTitle('')
    setUrl('')
    setFile(null)
    setError(null)
  }
  function close(force = false) {
    if (!force && busyRef.current) return
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

  /** Best-effort title prefill once a link is pasted (still editable). */
  async function prefillFromUrl() {
    if (!url.trim() || title.trim()) return
    const r = await resolveVideoUrlAction(url.trim())
    if (r.ok) setTitle(r.title)
  }

  async function submit() {
    if (pending || upload.busy) return
    setError(null)
    if (step === 'manual') {
      if (!file) return setError('Attach the video file (MP4, MOV or WebM).')
      await upload.upload(file) // closes via onSuccess; errors surface below
      return
    }
    const t = title.trim()
    if (!url.trim()) return setError('Paste the video link.')
    if (!t) return setError('Give the video a title.')
    setPending(true)
    try {
      const fd = new FormData()
      fd.set('title', t)
      fd.set('embed_url', url.trim())
      const res = await addVideoAction(artistId, fd)
      if (res && 'error' in res && res.error) return setError(res.error)
      toast('Video added')
      router.refresh()
      close(true)
    } finally {
      setPending(false)
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

  const busy = pending || upload.busy
  // Width matches the Music modal: narrow for the choose picker, medium for a form.
  const cardWidth = step === 'choose' ? '!w-[440px]' : '!w-[520px]'
  useEffect(() => {
    titleRef.current = title
  }, [title])
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add video"
        aria-label="Add video"
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
          <div className={cx(modalCardClass, 'font-space', cardWidth)}>
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
                <KLabel>Video</KLabel>
                <h2 className="text-lg font-bold leading-tight tracking-[-0.01em]">Add video</h2>
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
                  placeholder="Video title (optional — the filename works too)"
                  className={`${inputClass} w-full`}
                />
                <FileDropField
                  accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                  label={file ? file.name : 'Drop the video file or click to pick'}
                  hint="MP4, MOV or WebM · up to 500 MB"
                  busy={upload.busy}
                  progress={upload.progress}
                  onFile={setFile}
                />
              </div>
            )}

            {step === 'streaming' && (
              <div className="mt-4 space-y-3">
                <input
                  autoFocus
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={prefillFromUrl}
                  placeholder="Paste the video link (YouTube)"
                  className={`${inputClass} w-full`}
                />
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Video title"
                  required
                  className={`${inputClass} w-full`}
                />
              </div>
            )}

            {step !== 'choose' && (
              <div className="mt-4 space-y-3">
                {(error || upload.error) && <UploadError>{error ?? upload.error}</UploadError>}
                <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
                  <button type="button" onClick={() => close()} disabled={busy} className={buttonClass('ghost')}>
                    Cancel
                  </button>
                  <button type="button" onClick={submit} disabled={busy} className={buttonClass('solid')}>
                    {busy ? 'Adding…' : 'Add video'}
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
