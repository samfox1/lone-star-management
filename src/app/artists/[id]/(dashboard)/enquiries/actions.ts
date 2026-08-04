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
  const { data } = await supabase
    .from('enquiry_attachments')
    .select('id, enquiry_id, storage_path, filename, mime_type, bytes, created_at')
    .eq('enquiry_id', enquiryId)
    .order('created_at')
  if (!data?.length) return []
  return toPlayable(supabase, data as AttachmentRow[])
}

/**
 * Put a message back in the unread pile.
 *
 * Opening a message marks it read, which is what an inbox does — but that quietly
 * destroys the manager's own triage signal if they were only glancing. This is the undo,
 * and it is the reason auto-read is safe to have at all.
 *
 * Allowed by the same COLUMN grant that permits marking read (`grant update (read_at)`,
 * 20260722120000): a manager may write that one column and nothing else, so clearing it
 * needs no new permission.
 */
export async function markEnquiryUnreadAction(
  artistId: string,
  enquiryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('enquiries')
    .update({ read_at: null })
    .eq('id', enquiryId)
    .eq('artist_id', artistId)
  if (error) return { ok: false, error: 'Could not mark that unread.' }
  revalidatePath(`/artists/${artistId}/enquiries`)
  return { ok: true }
}
