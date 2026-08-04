'use server'

/**
 * Inbox actions: read state, and signing attachments at the moment a message is opened.
 *
 * Signing ON OPEN rather than on page load is the point. The previous version signed every
 * attachment on the page whether or not anyone looked at it — dozens of round trips to
 * mint URLs that mostly expired unused, and the ones you did want had been counting down
 * since the page rendered. A signed URL should start its life when someone asks for it.
 */
import { revalidatePath } from 'next/cache'
import { toPlayable, type AttachmentRow, type PlayableAttachment } from '@/lib/enquiry-attachments'
import { createClient } from '@/lib/supabase/server'

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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not signed in.' }

  // RLS scopes the update to enquiries the caller manages, so a non-owner silently
  // matches zero rows rather than erroring.
  const { error } = await supabase
    .from('enquiries')
    .update({ read_at: read ? new Date().toISOString() : null })
    .eq('id', enquiryId)
    .eq('artist_id', artistId)
  if (error) return { ok: false, error: read ? 'Could not mark that as read.' : 'Could not mark that unread.' }
  revalidatePath(`/artists/${artistId}/enquiries`)
  return { ok: true }
}
