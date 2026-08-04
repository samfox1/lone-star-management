/**
 * Reading a demo enquiry's attachments in the dashboard.
 *
 * The bucket is PRIVATE and stays that way. A manager reaches a file through a signed URL
 * minted at view time and valid for minutes — never a permanent public URL, because these
 * are unsolicited files from strangers sent to one person.
 *
 * Files are deleted after 90 days; the enquiry is kept. So a row whose object is gone is
 * the NORMAL end state, not an error, and the UI has to say "expired" rather than break.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const ATTACHMENT_BUCKET = 'enquiry-attachments'

/** Long enough to press play, short enough that a copied URL is useless by the time it is
 *  pasted anywhere. */
export const SIGNED_URL_TTL_SECONDS = 300

export type AttachmentRow = {
  id: string
  enquiry_id: string
  storage_path: string
  filename: string
  mime_type: string
  bytes: number
  created_at: string
}

export type PlayableAttachment = {
  id: string
  filename: string
  mime_type: string
  bytes: number
  /** A short-lived signed URL, or null when the object is gone (expired or never uploaded). */
  url: string | null
  expired: boolean
}

/**
 * Is this row's file past the retention window?
 *
 * Derived from `created_at` rather than probing storage: it is the same 90 days the sweep
 * uses, and it means the common case costs no round trip. A file can also be missing
 * before the window (an abandoned upload — the row is written when the ticket is minted,
 * not when the bytes arrive), which is why the caller still treats a failed sign as
 * expired rather than trusting this alone.
 */
export function isExpired(createdAt: string, nowMs: number, days = 90): boolean {
  return nowMs - Date.parse(createdAt) > days * 24 * 60 * 60 * 1000
}

/**
 * Turn attachment rows into something playable.
 *
 * Signing is skipped entirely for rows already past retention — there is nothing to sign,
 * and asking would cost a round trip per row to learn what the timestamp already says.
 * A sign that fails for any other reason (the object was never uploaded, or was removed)
 * lands in the same place: `expired: true`, no URL. From the manager's side those are the
 * same fact — the file is not there — and inventing a second error state would give them
 * a distinction they cannot act on.
 */
export async function toPlayable(
  supabase: SupabaseClient,
  rows: AttachmentRow[],
  nowMs: number = Date.now(),
): Promise<PlayableAttachment[]> {
  return Promise.all(
    rows.map(async (r) => {
      const base = { id: r.id, filename: r.filename, mime_type: r.mime_type, bytes: r.bytes }
      if (isExpired(r.created_at, nowMs)) return { ...base, url: null, expired: true }

      const { data } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS)
      return { ...base, url: data?.signedUrl ?? null, expired: !data?.signedUrl }
    }),
  )
}

/** "4.1 MB" / "812 KB". Advisory — the sender declared it, so it is display only. */
export function fileSize(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
