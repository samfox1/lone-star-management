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
  /** Null once the sweep has removed the object (see expired_at). */
  storage_path: string | null
  filename: string
  mime_type: string
  /** DECLARED by the sender at submit time and never reconciled — superseded by the real
   *  size from storage wherever that is available. */
  bytes: number
  created_at: string
  expired_at: string | null
}

export type PlayableAttachment = {
  id: string
  filename: string
  mime_type: string
  /** The REAL size, read from storage. Null when there is no object or its metadata is
   *  unavailable — never the sender's declared number, which is unverified. */
  bytes: number | null
  /** A short-lived signed URL, or null when there is no object to sign. */
  url: string | null
  /** The 90 days ran out and the sweep removed the audio. The row survives so this can be
   *  said out loud rather than the attachment silently vanishing. */
  expired: boolean
  /** A ticket was issued and the bytes never arrived. A DIFFERENT fact from expired, and
   *  the manager may act on it differently — chasing the sender rather than shrugging. */
  neverUploaded: boolean
}

/**
 * Turn attachment rows into something playable.
 *
 * THREE outcomes, deliberately distinct, because they are different facts:
 *   - playable      : a signed URL, valid for minutes
 *   - expired       : the 90 days ran out and the sweep took the audio (expired_at)
 *   - neverUploaded : a ticket was issued and nothing ever arrived
 *
 * The first version collapsed the last two into "expired", reasoning that a manager
 * cannot act on the difference. That was wrong. "The file you were sent has aged out" and
 * "the sender never actually uploaded it" lead to different next moves, and only one of
 * them is worth chasing somebody about.
 *
 * SIZE COMES FROM STORAGE, not the row. The row's `bytes` is whatever the sender declared
 * at submit time and is never reconciled — someone can claim 1 byte and upload 25MB.
 * Showing that to a manager as fact is worse than showing nothing, so one `list` per
 * enquiry folder replaces it with the truth. (skeen review, 2026-08-04.)
 */
export async function toPlayable(
  supabase: SupabaseClient,
  rows: AttachmentRow[],
): Promise<PlayableAttachment[]> {
  // One listing per folder yields every file's real size. Cheap: an enquiry has at most
  // three attachments and they share a folder.
  const sizes = new Map<string, number>()
  const folders = new Set(
    rows
      .map((r) => r.storage_path?.split('/').slice(0, -1).join('/'))
      .filter((f): f is string => !!f),
  )
  await Promise.all(
    [...folders].map(async (folder) => {
      const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).list(folder, { limit: 100 })
      for (const o of data ?? []) {
        const size = (o as { metadata?: { size?: number } }).metadata?.size
        if (typeof size === 'number') sizes.set(`${folder}/${o.name}`, size)
      }
    }),
  )

  return Promise.all(
    rows.map(async (r) => {
      const base = { id: r.id, filename: r.filename, mime_type: r.mime_type }

      // No path means the sweep took the object — it is the only thing that nulls it, and
      // it always stamps `expired_at` in the same write. (An earlier version tried to
      // treat "no path, no stamp" as a third state; that state cannot occur, and an
      // untested unreachable branch is worse than not having it.)
      if (r.expired_at || !r.storage_path) {
        return { ...base, bytes: null, url: null, expired: true, neverUploaded: false }
      }

      const { data } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS)

      return {
        ...base,
        bytes: sizes.get(r.storage_path) ?? null,
        url: data?.signedUrl ?? null,
        expired: false,
        neverUploaded: !data?.signedUrl,
      }
    }),
  )
}

/** "4.1 MB" / "812 KB". Null (unknown, or no object) renders as nothing, not "0 B". */
export function fileSize(bytes: number | null): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
