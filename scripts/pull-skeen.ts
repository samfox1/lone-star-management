/**
 * One-off: set Skeen's Spotify artist id, drop the placeholder tracks, pull his
 * real discography, and publish — exercising the real product code path
 * (spotifyClient -> syncSpotifyTracks -> publishContent) as manager A.
 *
 *   npx tsx scripts/pull-skeen.ts
 */
import './_node-compat' // MUST be first: polyfills WebSocket for createClient on Node < 22
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { createSpotifyClient } from '../src/lib/spotify'
import { syncSpotifyTracks } from '../src/lib/sync'
import { publishContent } from '../src/lib/content'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SPOTIFY_ARTIST_ID = '26KxuQlgIw8VP8YX2IkMWR'

async function main() {
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Manager A manages Skeen — use their RLS-scoped client for the sync/publish.
  const asA = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error: signInErr } = await asA.auth.signInWithPassword({
    email: 'manager-a@lonestar.test',
    password: 'lonestar-dev-password',
  })
  if (signInErr) throw signInErr

  const { data: artist } = await svc.from('artists').select('id').eq('slug', 'skeen').single()
  if (!artist) throw new Error('Skeen not found — run seed-skeen first')
  const skeenId = artist.id

  // 1. Set his Spotify artist id.
  await svc.from('artists').update({ spotify_artist_id: SPOTIFY_ARTIST_ID }).eq('id', skeenId)

  // 2. Drop the placeholder (manual) tracks so only his real catalog remains.
  await svc.from('tracks').delete().eq('artist_id', skeenId)

  // 3. Pull his discography via the real Spotify client.
  const spotify = createSpotifyClient()
  const tracks = await spotify.getDiscographyTracks(SPOTIFY_ARTIST_ID)
  console.log(`Spotify returned ${tracks.length} tracks`)

  // 4. Sync into Skeen's draft tracks (source='spotify').
  const result = await syncSpotifyTracks(asA, skeenId, tracks)
  console.log('sync:', result)

  // 5. Publish — snapshots the real tracks and tombstones the old placeholders.
  const published = await publishContent(asA, 'track', skeenId)
  console.log(`published ${published} track revisions`)
  console.log('Done — see /skeen')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
