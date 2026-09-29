'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { EventbriteApiError, createEventbriteClient } from '@/lib/eventbrite'
import { syncEventbriteTourDates, syncOutcome, type SyncOutcome } from '@/lib/sync'

/**
 * THE EVENTBRITE SOURCE'S SERVER ACTIONS: pull the artist's shows into Tour, and forget the
 * sign-in on Remove (Sam, 2026-09-28). "Connect with Eventbrite" (src/lib/eventbrite-oauth.ts)
 * is what stores the sign-in; see the Eventbrite README.
 *
 * The token is read back ONLY through `eventbrite_credentials` — the owner-gated Vault door,
 * the Shopify pattern — handed to the Eventbrite client for the Authorization header, and
 * dropped. The write (`syncEventbriteTourDates`) never sees it. No message built here
 * carries it: an Eventbrite refusal says our own sentence, anything else says its NAME only.
 */

const NOT_SIGNED_IN = 'Eventbrite isn’t signed in for this artist. Press Connect with Eventbrite to pull shows.'

type Credentials = { organization_id: string | null; organizer_id: string | null; token: string | null }

/** Pull the artist's upcoming public Eventbrite events into draft tour dates. */
export async function syncEventbriteAction(artistId: string): Promise<SyncOutcome | { ok: false; error: string; notes?: [] }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('eventbrite_credentials', { p_artist_id: artistId })
  if (error) return { ok: false, error: 'Couldn’t read the Eventbrite sign-in.' }
  const creds = ((data ?? []) as Credentials[])[0]
  if (!creds?.token || !creds.organization_id || !creds.organizer_id) return { ok: false, error: NOT_SIGNED_IN }

  let result
  try {
    const shows = await createEventbriteClient().listUpcomingShows(creds.token, creds.organization_id, creds.organizer_id)
    result = await syncEventbriteTourDates(supabase, artistId, shows)
  } catch (e) {
    return { ok: false, error: e instanceof EventbriteApiError ? e.message : `Pull failed (${e instanceof Error ? e.name : 'unknown'}).` }
  }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return syncOutcome(result, 'tour date')
}

/**
 * Remove: forget the sign-in — `disconnect_eventbrite` deletes the Vault secret, then the
 * pointer row. Only when there is one: a pasted organizer link has no sign-in behind it and
 * must still remove cleanly (the integrations table exists everywhere; the Vault door only
 * where the migration has run). Eventbrite has no revoke endpoint, so ending the grant at
 * Eventbrite itself is the artist's, from their Eventbrite account.
 */
export async function disconnectEventbriteAction(artistId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: row, error } = await supabase.from('integrations').select('id').eq('artist_id', artistId).eq('provider', 'eventbrite').maybeSingle()
  if (error) return { error: 'Couldn’t read the Eventbrite sign-in.' }
  if (!row) return {}
  const { error: e2 } = await supabase.rpc('disconnect_eventbrite', { p_artist_id: artistId })
  if (e2) return { error: 'Couldn’t forget the Eventbrite sign-in. Try again.' }
  revalidatePath(`/artists/${artistId}`, 'layout')
  return {}
}
