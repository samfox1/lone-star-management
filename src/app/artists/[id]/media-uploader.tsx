'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SiteMedia } from '@/lib/site'

/**
 * Uploads a media file straight from the browser to Storage (RLS scopes the
 * write to the artist's own folder), then registers it in the `media` table.
 * Direct-to-Storage keeps large videos off the Next server.
 */
export function MediaUploader({
  artistId,
  purpose,
  folder,
  accept,
  label,
}: {
  artistId: string
  purpose: SiteMedia['purpose']
  folder: string
  accept: string
  label: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const path = `${artistId}/${folder}/${safeName}`

    const { error: upErr } = await supabase.storage
      .from('media')
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (upErr) {
      setError(upErr.message)
      setBusy(false)
      return
    }

    const nextOrder = Math.floor(Date.now() / 1000)
    const { error: rowErr } = await supabase
      .from('media')
      .insert({ artist_id: artistId, purpose, storage_path: path, sort_order: nextOrder })
    if (rowErr) {
      // Don't leave an orphaned object if the row insert failed.
      await supabase.storage.from('media').remove([path])
      setError(rowErr.message)
      setBusy(false)
      return
    }

    if (inputRef.current) inputRef.current.value = ''
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900">
        {busy ? 'Uploading…' : label}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onChange}
          disabled={busy}
          className="hidden"
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
