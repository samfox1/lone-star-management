import { createClient } from '@/lib/supabase/server'
import { ownedArtists, rosterAnalytics } from './roster-data'
import { Launcher } from './launcher'

export const metadata = { title: 'Lone Star Management' }

/** The manager's landing launcher. The full roster grid lives at /roster. */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const artists = await ownedArtists(supabase)
  const { byArtist } = await rosterAnalytics(supabase, artists)
  const launchArtists = artists.map((a) => ({ ...a, views: byArtist[a.id]?.views ?? 0 }))

  return <Launcher artists={launchArtists} email={user?.email ?? null} />
}
