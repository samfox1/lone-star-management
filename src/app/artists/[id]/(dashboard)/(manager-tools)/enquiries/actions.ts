'use server'

/**
 * The Enquiries inbox's server actions: read state, attachment signing, and deleting an enquiry.
 * Everything the inbox writes, in the tool's folder; the dashboard-wide actions.ts holds nothing
 * enquiry-specific. The kinds, their recipient lists and the address codes are Settings › Email's
 * (settings/email/actions.ts).
 *
 * Signing ON OPEN rather than on page load is the point. The previous version signed every
 * attachment on the page whether or not anyone looked at it — dozens of round trips to
 * mint URLs that mostly expired unused, and the ones you did want had been counting down
 * since the page rendered. A signed URL should start its life when someone asks for it.
 */
import { revalidatePath } from 'next/cache'
import { ATTACHMENT_BUCKET, toPlayable, type AttachmentRow, type PlayableAttachment } from '@/lib/enquiries/attachments'
import { createClient } from '@/lib/supabase/server'
import { requireOwnedArtist } from '../../_owns'

/**
 * Short-lived signed URLs for one enquiry's audio.
 *
 * RLS does the scoping twice over: the row read is filtered by `enquiry_attachments`'
 * own policy, and the signing call is made with the caller's session against a private
 * bucket whose policy checks the artist folder. A caller who cannot see the enquiry gets
 * an empty list, not an error — there is nothing to tell them.
 */
export async function signEnquiryAttachmentsAction(enquiryId: string): Promise<PlayableAttachment[]> {
  const supabase = await createClient()
  // expired_at must ride along: toPlayable reads it to tell "the sweep took the file"
  // apart from "the sender never uploaded one", and the cast below would silently hide
  // a select that drops it.
  const { data } = await supabase
    .from('enquiry_attachments')
    .select('id, enquiry_id, storage_path, filename, mime_type, bytes, created_at, expired_at')
    .eq('enquiry_id', enquiryId)
    .order('created_at')
  if (!data?.length) return []
  return toPlayable(supabase, data as AttachmentRow[])
}

/**
 * Mark one enquiry read, or put it back in the unread pile.
 *
 * ONE action for both directions — they were briefly two, in two files, and only the
 * read half checked the session; the same UPDATE must not have two different guards.
 *
 * The ONLY write a manager can make to their inbox. That is enforced in Postgres by a
 * COLUMN grant (`grant update (read_at) on enquiries to authenticated`, 20260722120000),
 * not by this action and not by the RLS policy — RLS has no column granularity, so a
 * row-scoped policy alone would let a manager rewrite `message` or `to_email`. This
 * function is the convenience; the grant is the control.
 *
 * Unread is the undo for auto-read on open, and the reason auto-read is safe to have:
 * glancing at a message must not quietly destroy the manager's own triage signal.
 */
export async function setEnquiryReadAction(
  artistId: string,
  enquiryId: string,
  read: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { ok: false, error: owned.error }

  // RLS scopes the update as well; the explicit check above is the belt to its braces.
  const { error } = await supabase
    .from('enquiries')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('id', enquiryId)
    .eq('artist_id', artistId)
  if (error) return { ok: false, error: read ? 'Could not mark that as read.' : 'Could not mark that unread.' }
  revalidatePath(`/artists/${artistId}/enquiries`)
  return { ok: true }
}

/**
 * Delete one enquiry — spam, mostly (Sam, 2026-09-28: "a manager can delete an inquiry").
 *
 * WHO may is the database's call: the `enquiries_delete` policy (20260928140000) scopes it
 * to the artist's managers and admins, and anon holds no DELETE grant. `requireOwnedArtist`
 * is the belt to those braces, and the `.select` is what tells a refused or stale delete
 * (zero rows, `error: null` — AGENTS.md rule 3) apart from a real one.
 *
 * THE AUDIO GOES TOO. The attachment ROWS cascade with the enquiry, and the 90-day sweep
 * finds objects only through those rows — so an object not removed here is never removed
 * at all. The paths are read BEFORE the delete (after it they are gone), and removed only
 * AFTER it succeeds: a refused delete must never cost an enquiry that is still in the inbox
 * its audio. The removal is best-effort — the enquiry is already gone, and a leaked object
 * costs storage, not the manager's answer. It runs with the caller's session, and the
 * bucket's manager-delete policy scopes it to their artist's folder.
 */
export async function deleteEnquiryAction(
  artistId: string,
  enquiryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { ok: false, error: owned.error }

  const { data: files } = await supabase
    .from('enquiry_attachments')
    .select('storage_path')
    .eq('enquiry_id', enquiryId)
    .not('storage_path', 'is', null)

  const { data, error } = await supabase
    .from('enquiries')
    .delete()
    .eq('id', enquiryId)
    .eq('artist_id', artistId)
    .select('id')
  if (error) return { ok: false, error: 'Could not delete that enquiry.' }
  if (!data?.length) return { ok: false, error: 'That enquiry is no longer there — refresh the page.' }

  const paths = ((files ?? []) as { storage_path: string | null }[])
    .map((f) => f.storage_path)
    .filter((p): p is string => !!p)
  if (paths.length) {
    const { error: rmError } = await supabase.storage.from(ATTACHMENT_BUCKET).remove(paths)
    if (rmError) console.error('deleteEnquiryAction: audio left in the bucket', rmError.message)
  }

  // Both inboxes show it: this artist's page and the roster-wide one.
  revalidatePath(`/artists/${artistId}/enquiries`)
  revalidatePath('/artists')
  return { ok: true }
}
