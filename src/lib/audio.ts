/**
 * Gated-audio signing. The public player can't read the private `audio` bucket;
 * it asks the server for a short-lived signed URL. We resolve the path through
 * audio_path_for_play (which only returns a PUBLISHED track's audio for the
 * given slug), then sign THAT path — never a path the caller supplied. So a
 * caller can't sign another artist's or an unpublished track's audio.
 *
 * `admin` must be a service-role client: the bucket has no public read policy, so
 * only the service role can mint a signed URL. The DB door is the authorization;
 * the service role is just the signer.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const AUDIO_BUCKET = 'audio'
/** TTL ≥ any realistic track length, so seeking never outlives the URL (§9). */
export const AUDIO_URL_TTL_SECONDS = 60 * 60 // 1 hour

export async function signAudioUrl(
  admin: SupabaseClient,
  slug: string,
  trackId: string,
  ttl: number = AUDIO_URL_TTL_SECONDS,
): Promise<string | null> {
  const { data: path, error } = await admin.rpc('audio_path_for_play', {
    p_slug: slug,
    p_track_id: trackId,
  })
  if (error || !path) return null

  const { data, error: signErr } = await admin.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path as string, ttl)
  if (signErr || !data) return null
  return data.signedUrl
}
