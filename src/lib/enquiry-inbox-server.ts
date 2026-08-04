/**
 * Server-side inbox reads. Its own module rather than more surface on
 * `lib/enquiry-inbox.ts`, because that file is imported by the client-side table — a
 * Supabase server query has no business in a 'use client' bundle.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * How many attachments each enquiry has, in one query.
 *
 * COUNTS only, not signed URLs: the list needs a badge, and signing happens when a
 * message is opened — otherwise a page load mints one round trip per attachment for
 * URLs that mostly expire unread. Enquiries absent from the map have zero.
 */
export async function attachmentCounts(
  supabase: SupabaseClient,
  enquiryIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  // An empty .in() list is a malformed filter, not "no rows" — skip the query instead.
  if (!enquiryIds.length) return counts

  const { data } = await supabase
    .from('enquiry_attachments')
    .select('enquiry_id')
    .in('enquiry_id', enquiryIds)
  for (const a of data ?? []) {
    const key = a.enquiry_id as string
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}
