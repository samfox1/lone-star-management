'use server'

/**
 * The Enquiries tool's server actions: inbox read state, attachment signing, and — since
 * 2026-09-22 — the enquiry kinds and their recipient lists. Everything the tool writes,
 * in the tool's folder; the dashboard-wide actions.ts holds nothing enquiry-specific.
 *
 * Signing ON OPEN rather than on page load is the point. The previous version signed every
 * attachment on the page whether or not anyone looked at it — dozens of round trips to
 * mint URLs that mostly expired unused, and the ones you did want had been counting down
 * since the page rendered. A signed URL should start its life when someone asks for it.
 */
import { revalidatePath } from 'next/cache'
import { ATTACHMENT_BUCKET, toPlayable, type AttachmentRow, type PlayableAttachment } from '@/lib/enquiries/attachments'
import { createClient } from '@/lib/supabase/server'
import { LABEL_MAX, slugFromLabel, uniqueSlug, type EnquiryKindRow, type KindDetails } from '@/lib/enquiries/kinds'
import { KIND_GONE, saveEnquiryKind } from '@/lib/enquiries/kind-save'
import { codeStatus, emailKey, sendStatus, type CodeStatus, type SendStatus } from '@/lib/enquiries/confirm'
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

// ---------------------------------------------------------------------------
// Enquiry kinds and their recipient lists (20260921120000)
// ---------------------------------------------------------------------------
/**
 * Who receives each kind of enquiry. The kinds are the artist's to invent; each one goes ONLY
 * to its own list (20261002210000, Sam: "I should have to add each one individually"), and only
 * to the addresses on it that are confirmed (20261006120000). There is no booking address added
 * on top any more.
 *
 * Every write below goes through the request-bound client, so RLS scopes it to the caller's
 * tenant, AND through `requireOwnedArtist` — belt and braces, per the note in `_owns.ts`.
 * The database is the real authority on everything these refuse: the slug shape, the
 * address shape, the ten-per-kind cap, the immutable slug and the undeletable fallback all
 * live in CHECKs and triggers, because this file is not the only writer that table has.
 */

/**
 * Add a kind. The manager types a LABEL; the slug is derived from it and is the word their
 * site will post. Derived rather than asked for because the slug is immutable once created
 * and a manager has no way to know what it is for — the one thing they must not be invited
 * to get wrong is the part they can never change.
 */
export async function addEnquiryKindAction(
  artistId: string,
  label: string,
): Promise<{ error?: string; kind?: EnquiryKindRow }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }

  const clean = label.trim()
  if (!clean) return { error: 'Give the kind a name.' }

  // Read the taken slugs THROUGH RLS, so a name colliding with another artist's kind is
  // not a collision at all — (artist_id, slug) is what is unique.
  const { data: existing } = await supabase
    .from('enquiry_kinds')
    .select('slug, sort_order')
    .eq('artist_id', artistId)
  const taken = (existing ?? []).map((k) => (k as { slug: string }).slug)
  const nextOrder = Math.max(-1, ...(existing ?? []).map((k) => (k as { sort_order: number }).sort_order)) + 1

  const { data, error } = await supabase
    .from('enquiry_kinds')
    .insert({
      artist_id: artistId,
      slug: uniqueSlug(slugFromLabel(clean), taken),
      label: clean.slice(0, LABEL_MAX),
      sort_order: nextOrder,
    })
    .select('id, slug, label, sort_order')
    .single()
  // 23505: two tabs adding "Press" at once. uniqueSlug read the taken set a moment ago;
  // the second insert loses the race and the manager should hear a sentence for it.
  if (error) return { error: error.code === '23505' ? 'That kind was just added — refresh to see it.' : error.message }

  revalidatePath(`/artists/${artistId}`, 'layout')
  const row = data as { id: string; slug: string; label: string; sort_order: number }
  // A new kind has no description: the column defaults to null.
  return { kind: { ...row, description: null, sortOrder: row.sort_order, recipients: [] } }
}

/**
 * Save a kind's NAME and/or DESCRIPTION: only the fields the manager changed (Sam, 2026-10-02:
 * "I should be able to add and edit the description"). Never the slug: a trigger refuses any
 * change to it.
 *
 * The write itself is saveEnquiryKind (src/lib/enquiries/kind-save.ts), which checks the input
 * (kindDetailsUpdate) and tells a zero-row match apart from a save.
 */
export async function saveEnquiryKindAction(
  artistId: string,
  kindId: string,
  details: KindDetails,
): Promise<{ error?: string; saved?: KindDetails }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }

  const res = await saveEnquiryKind(supabase, artistId, kindId, details)
  if (res.error) return { error: res.error }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return { saved: res.saved }
}

/**
 * Delete a kind and, by cascade, its list. The database refuses this for `other` — the
 * fallback every unrecognised purpose lands on — and the message it raises is the one the
 * manager sees, rather than a second copy of that rule maintained here.
 */
export async function deleteEnquiryKindAction(
  artistId: string,
  kindId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }

  const { data, error } = await supabase
    .from('enquiry_kinds')
    .delete()
    .eq('id', kindId)
    .eq('artist_id', artistId)
    .select('id')
  if (error) return { error: error.message }
  if (!data?.length) return { error: KIND_GONE }

  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}

/**
 * Replace one kind's whole list — ATOMICALLY.
 *
 * The first version of this did a DELETE and then an INSERT as two PostgREST calls, which
 * is two transactions. When the insert was refused (an 11th address, a malformed one, a
 * case-variant duplicate) the delete had already committed: the list was gone, the
 * dashboard "reverted" to chips that no longer existed, and every enquiry of that kind
 * went to the primary alone until someone reloaded. Four reviewers found it independently
 * on 2026-09-22. The comment here also claimed `setSupportActsAction` as precedent; that
 * one is a single UPDATE of a JSON column, which is atomic — this was not the same shape.
 *
 * `set_enquiry_recipients` (20260922120000) does both statements in one function body, so
 * a trigger or CHECK raise unwinds the delete too. It is SECURITY INVOKER — RLS still
 * applies — and returns the rows as stored, ids and order included, so the dashboard
 * replaces its optimistic state with the truth.
 *
 * Whole-list rather than add/remove because the chips are edited as a set. The client
 * serialises saves with a ref latch so two fast edits cannot interleave.
 */
export async function setEnquiryRecipientsAction(
  artistId: string,
  kindId: string,
  recipients: { email: string; label: string | null }[],
): Promise<{ error?: string; rows?: EnquiryKindRow['recipients'] }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { error: owned.error }

  const { data, error } = await supabase.rpc('set_enquiry_recipients', {
    p_artist_id: artistId,
    p_kind_id: kindId,
    p_recipients: recipients.map((r) => ({ email: r.email.trim(), label: r.label?.trim() || null })),
  })
  if (error) return { error: friendlyRecipientError(error.code, error.message) }

  revalidatePath(`/artists/${artistId}`, 'layout')
  const rows = (data ?? []) as { id: string; email: string; label: string | null }[]
  return { rows: rows.map((r) => ({ id: r.id, email: r.email, label: r.label })) }
}

/** The database's refusal as a sentence. The dashboard pre-checks all three, so these are
 *  the messages for a race or a second tab, not the common path. */
function friendlyRecipientError(code: string | undefined, message: string): string {
  if (code === '23505') return 'That address is already on the list.'
  if (code === '23514' && /cap reached/.test(message)) return 'A list holds at most 10 people.'
  if (code === '23514') return 'That does not look like an email address.'
  return message
}

// ---------------------------------------------------------------------------
// Confirming an address (EMAIL_CONFIRM_PLAN.md §3, 20261006120000)
// ---------------------------------------------------------------------------
/**
 * Send (or send again) the 6-digit code that confirms one address on this artist's lists.
 *
 * The email-confirm Edge Function does the work: it verifies the manager's JWT, asks
 * begin_email_confirmation (service key) for a code, and mails it. So this sends the SESSION's
 * access token as the bearer, and nothing else that could vouch for anyone; the function checks
 * again that this user manages this artist and that the address is on one of its lists.
 *
 * Returns `{ status }` only, from a fixed set (sendStatus): never the function's body, so a code
 * or token could never ride back to the browser even if the function ever answered one.
 * Nothing here logs.
 */
export async function sendEmailCodeAction(artistId: string, email: string): Promise<{ status: SendStatus | 'error' }> {
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { status: 'error' }

  // The session from the cookie; requireOwnedArtist's getUser() has just verified it with the
  // auth server, and the function verifies the token again.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) return { status: 'error' }

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/email-confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistId, email: emailKey(email) }),
      cache: 'no-store',
    })
    const body = (await res.json().catch(() => null)) as { status?: unknown } | null
    return { status: sendStatus(body?.status) }
  } catch {
    return { status: 'error' }
  }
}

/**
 * Check the six digits typed into the code window (confirm_email_code: the row is locked, five
 * wrong tries kill the code, the right one confirms the address for EVERY list of this artist).
 * Manager-facing in SQL; RLS-free there, so the function checks is_manager_of itself.
 */
export async function confirmEmailCodeAction(
  artistId: string,
  email: string,
  code: string,
): Promise<{ status: CodeStatus | 'error' }> {
  // The window only sends six digits; anything else never costs one of the five tries.
  if (!/^\d{6}$/.test(code)) return { status: 'error' }
  const supabase = await createClient()
  const owned = await requireOwnedArtist(supabase, artistId)
  if (!owned.ok) return { status: 'error' }

  const { data, error } = await supabase.rpc('confirm_email_code', {
    p_artist_id: artistId,
    p_email: emailKey(email),
    p_code: code,
  })
  if (error) return { status: 'error' }
  const status = codeStatus(data)
  if (status === 'confirmed') revalidatePath(`/artists/${artistId}`, 'layout')
  return { status }
}
