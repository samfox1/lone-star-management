import { createClient } from '@supabase/supabase-js'
import { signAudioUrl } from '@/lib/audio'

/**
 * Gated-audio play endpoint. Mints a short-lived signed URL for a PUBLISHED
 * track's audio and returns it as JSON ({ url }); the player sets it as the
 * <audio> src. Uses the service role only to SIGN — authorization is the
 * audio_path_for_play door (published-only, slug-scoped), so a caller can't get
 * another artist's or an unpublished track's audio. 404 when there's nothing to
 * play.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; trackId: string }> },
) {
  const { slug, trackId } = await params
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const url = await signAudioUrl(admin, slug, trackId)
  if (!url) return Response.json({ error: 'not found' }, { status: 404 })
  // Don't let a proxy/browser cache the signed URL past its life.
  return Response.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
