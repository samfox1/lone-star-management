'use client'

import { useRef, useState, type ReactNode } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { formatProgress } from '@/lib/upload'

/** A styled, specific error banner for upload / file-management failures. */
export function UploadError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 rounded-lg border border-accent-red/25 bg-accent-red/[0.06] px-3 py-2 text-xs font-medium leading-snug text-accent-red"
    >
      <Icon name="alert" size={14} className="mt-px flex-none" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Presentational drop zone: drag-and-drop OR click to pick, with busy + error states.
 * Owns zero upload logic — wire `onFile` to a useStorageUpload `upload`. Shared by the
 * media and video uploaders (the audio uploader keeps its inline text label but the
 * same hook), so this is a real 2-adapter seam.
 */
export function FileDropField({
  accept,
  label,
  hint,
  busy,
  progress,
  error,
  onFile,
  disabled,
}: {
  accept: string
  label: string
  hint?: string
  busy: boolean
  /** 0..1 for a determinate progress bar (resumable upload); null/undefined = spinner text. */
  progress?: number | null
  error?: string | null
  onFile: (file: File) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const blocked = busy || disabled

  function take(file?: File | null) {
    if (file && !blocked) onFile(file)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          if (!blocked) setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          take(e.dataTransfer.files?.[0])
        }}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-8 text-center transition-colors',
          drag ? 'border-accent bg-accent-soft' : 'border-hairline hover:border-ink-faint',
          blocked && 'cursor-wait opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={blocked}
          onChange={(e) => {
            take(e.target.files?.[0])
            if (inputRef.current) inputRef.current.value = ''
          }}
          // sr-only, NOT `hidden` (display:none): Safari won't open the file dialog when
          // a label wraps a display:none file input, so a click did nothing there.
          className="sr-only"
        />
        {busy && progress != null ? (
          <span className="flex w-full max-w-[240px] flex-col items-center gap-2">
            <span className="font-space text-xs uppercase tracking-[0.08em] text-ink-muted">
              Uploading {formatProgress(progress)}
            </span>
            <span
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-full overflow-hidden rounded-full bg-hairline"
            >
              <span
                className="block h-full rounded-full bg-ink transition-[width] duration-200 ease-out"
                style={{ width: formatProgress(progress) }}
              />
            </span>
          </span>
        ) : (
          <>
            <span className="font-space text-xs uppercase tracking-[0.08em] text-ink-muted">
              {busy ? 'Uploading…' : label}
            </span>
            {hint && !busy && <span className="text-xs text-ink-faint">{hint}</span>}
          </>
        )}
      </label>
      {error && <UploadError>{error}</UploadError>}
    </div>
  )
}
