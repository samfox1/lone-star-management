'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  validateUpload,
  buildStoragePath,
  contentTypeFor,
  performUpload,
  friendlyUploadError,
  type UploadRules,
} from '@/lib/upload'
import { resumableUpload } from '@/lib/resumable-upload'

/**
 * The one place the upload dance lives: validate → direct-to-Storage upload → the
 * caller's row write → remove the orphan if the row write fails → refresh. Every
 * uploader (media, track audio, video) is a thin adapter that supplies its bucket,
 * path category, rules, and a `writeRow` (INSERT a row, or UPDATE a column — the hook
 * doesn't care which). Direct-to-Storage keeps big files off the Next server.
 */
export function useStorageUpload(opts: {
  bucket: string
  artistId: string
  /** Path segment under the artist folder: `{artistId}/{category}/{uuid}.{ext}`. */
  category: string
  /** What the manager is uploading, for error copy: 'video' | 'image' | 'audio'. */
  noun: string
  /** Optional ext/size guard (UX only; the bucket's caps are the real guard). */
  rules?: UploadRules
  /** Resumable/tus transport with real progress — for large files (video). */
  resumable?: boolean
  /** Persist the uploaded object; return an error message, or null on success. */
  writeRow: (path: string, file: File) => Promise<string | null>
  /** Called after a successful upload settles (busy cleared, view refreshed). */
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 0..1 during a resumable upload, null otherwise. */
  const [progress, setProgress] = useState<number | null>(null)

  const fail = (raw: string) =>
    setError(friendlyUploadError(raw, { noun: opts.noun, allowed: opts.rules?.allowedExt, maxBytes: opts.rules?.maxBytes }))

  async function upload(file: File) {
    setError(null)
    let ext: string
    if (opts.rules) {
      const v = validateUpload(file, opts.rules)
      if (!v.ok) {
        setError(v.error) // already specific + friendly
        return
      }
      ext = v.ext
    } else {
      const dot = file.name.lastIndexOf('.')
      ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'bin'
    }
    setBusy(true)
    if (opts.resumable) setProgress(0)
    try {
      const supabase = createClient()
      const path = buildStoragePath(opts.artistId, opts.category, ext)
      const contentType = contentTypeFor(ext) ?? (file.type || undefined)

      // Resumable transport needs the session token for its own Authorization header.
      let transfer: (() => Promise<string | null>) | undefined
      if (opts.resumable) {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) {
          transfer = () =>
            resumableUpload({
              supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
              accessToken: token,
              bucket: opts.bucket,
              path,
              file,
              contentType,
              onProgress: setProgress,
            })
        }
      }

      const res = await performUpload({
        supabase: supabase as never,
        bucket: opts.bucket,
        path,
        file,
        contentType,
        transfer,
        writeRow: (p) => opts.writeRow(p, file),
      })
      if ('error' in res) {
        fail(res.error) // map the raw Storage/DB error to something a manager can act on
        return
      }
      router.refresh()
      opts.onSuccess?.()
    } catch (e) {
      // A thrown error (network drop, unexpected client throw) must never leave the
      // field stuck on "Uploading…" with no message.
      fail(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return { busy, error, progress, upload, reset: () => setError(null) }
}
