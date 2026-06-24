/**
 * Switch Skeen to the cinematic template and load his real bio + socials into
 * the backend, then publish the links. Run after seed-skeen + pull-skeen.
 *
 *   npx tsx scripts/skeen-cinematic.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { publishContent } from '../src/lib/content'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const BIO = [
  "Skeen is a Chicago-born DJ, producer, and filmmaker whose music and visual identity redefine the underground house music scene, pumping it with cinematic narratives and one-of-a-kind storylines. What began as a college dorm-room passion project evolved into a full-fledged creative movement, rooted in authenticity, storytelling, and a deep respect for the culture that shaped him.",
  "Drawing from the city's rich house legacy and inspired by new-age innovators like Fred again.., John Summit, D.O.D., and Calvin Harris, Skeen crafts music that can feel intimate, explosive, euphoric, and gritty, all at the same time.",
  "Beyond the studio, Skeen has become a force in Chicago's nightlife, independently producing and headlining his own large-scale underground events. From DIY \"Boiler Room\"-style sets in college basements to 300-person warehouse raves across the city, and now performances abroad in Norway and Italy, his rise has been built entirely on word-of-mouth energy and community support.",
  "Every Skeen show is an experience: cinematic, emotional, and deeply connected to house culture. With each project, he continues to build a larger world of his own, where film, music, and authentic experience converge into something unforgettable and unique.",
].join('\n')

const LINKS = [
  { label: 'Instagram', url: 'https://www.instagram.com/skeeeeeeen/' },
  { label: 'Spotify', url: 'https://open.spotify.com/artist/26KxuQlgIw8VP8YX2IkMWR' },
  { label: 'SoundCloud', url: 'https://soundcloud.com/user-818426052' },
  { label: 'YouTube', url: 'https://www.youtube.com/@Sskeen' },
  { label: 'Apple Music', url: 'https://music.apple.com/no/artist/skeen/1754431714' },
  { label: 'TikTok', url: 'https://tiktok.com/@skeen200' },
  { label: 'Linktree', url: 'https://linktr.ee/skeeen' },
  { label: 'Bookings', url: 'mailto:bookings@skeen.example' },
]

async function main() {
  const asA = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error: signInErr } = await asA.auth.signInWithPassword({
    email: 'manager-a@lonestar.test',
    password: 'lonestar-dev-password',
  })
  if (signInErr) throw signInErr

  const { data: artist } = await asA.from('artists').select('id').eq('slug', 'skeen').single()
  if (!artist) throw new Error('Skeen not found')
  const id = artist.id

  // Template + bio live on the artist row (read live by get_public_site).
  const { error: upErr } = await asA
    .from('artists')
    .update({ template: 'cinematic', bio: BIO })
    .eq('id', id)
  if (upErr) throw upErr

  // Replace links and publish them.
  await asA.from('links').delete().eq('artist_id', id)
  const { error: linkErr } = await asA
    .from('links')
    .insert(LINKS.map((l, i) => ({ artist_id: id, ...l, sort_order: i })))
  if (linkErr) throw linkErr

  const published = await publishContent(asA, 'link', id)
  console.log(`Skeen → cinematic template; ${LINKS.length} links published (${published} revisions)`)
  console.log('See /skeen')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
