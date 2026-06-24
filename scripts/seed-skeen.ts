/**
 * Seed a mock artist "Skeen" with populated, published content so the public
 * page at /skeen renders immediately. Idempotent — re-running replaces Skeen's
 * content. Assigned to Manager A so it's also editable in the dashboard.
 *
 * Content is placeholder (example.com links, picsum images) — edit it in the
 * dashboard. Run with Node 22:  npx tsx scripts/seed-skeen.ts
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing Supabase env in .env.local')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const img = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`

async function main() {
  // 1. Artist
  const { data: artist, error: aErr } = await db
    .from('artists')
    .upsert(
      {
        slug: 'skeen',
        name: 'Skeen',
        bio: 'Nocturnal synth-pop and late-night guitars from the Gulf Coast. Debut record out this fall.',
        hero_image_url: img('skeen-hero', 1600, 600),
      },
      { onConflict: 'slug' },
    )
    .select('id')
    .single()
  if (aErr || !artist) throw aErr ?? new Error('artist upsert failed')
  const artistId = artist.id

  // 2. Assign Manager A so it shows in their dashboard and is editable.
  const { data: users } = await db.auth.admin.listUsers()
  const managerA = users?.users.find((u) => u.email === 'manager-a@lonestar.test')
  if (managerA) {
    await db.from('artist_managers').upsert({ user_id: managerA.id, artist_id: artistId })
  }

  // 3. Reset Skeen's content for idempotency.
  for (const t of ['revisions', 'tracks', 'tour_dates', 'merch', 'links']) {
    await db.from(t).delete().eq('artist_id', artistId)
  }

  // 4. Working rows.
  const tracks = ['Midnight Tide', 'Static Bloom', 'Coastline', 'Afterglow'].map(
    (title, i) => ({
      artist_id: artistId,
      title,
      cover_url: img(`skeen-cover-${i}`, 300, 300),
      stream_url: 'https://open.spotify.com/',
      sort_order: i,
    }),
  )
  const tourDates = [
    { date: '2026-09-12', venue: 'Mohawk', city: 'Austin', country: 'US', ticket_url: 'https://example.com/tickets/atx' },
    { date: '2026-09-15', venue: 'The Parish', city: 'New Orleans', country: 'US', ticket_url: 'https://example.com/tickets/nola' },
    { date: '2026-10-02', venue: 'Mercury Lounge', city: 'New York', country: 'US', ticket_url: 'https://example.com/tickets/nyc' },
  ].map((d) => ({ artist_id: artistId, ...d }))
  const merch = [
    { title: 'Tour Tee', price: 28.0, image_url: img('skeen-tee', 600, 600), url: 'https://example.com/shop/tee' },
    { title: 'Debut Vinyl', price: 32.0, image_url: img('skeen-vinyl', 600, 600), url: 'https://example.com/shop/vinyl' },
  ].map((m) => ({ artist_id: artistId, ...m }))
  const links = [
    { label: 'Spotify', url: 'https://open.spotify.com/', sort_order: 0 },
    { label: 'Instagram', url: 'https://instagram.com/', sort_order: 1 },
    { label: 'Bandcamp', url: 'https://bandcamp.com/', sort_order: 2 },
  ].map((l) => ({ artist_id: artistId, ...l }))

  const ins = async (table: string, rows: Record<string, unknown>[]) => {
    const { data, error } = await db.from(table).insert(rows).select('*')
    if (error) throw error
    return data as Record<string, unknown>[]
  }
  const trackRows = await ins('tracks', tracks)
  const tourRows = await ins('tour_dates', tourDates)
  const merchRows = await ins('merch', merch)
  const linkRows = await ins('links', links)

  // 5. Publish: snapshot public-safe fields into revisions (what /skeen reads).
  const pick = (row: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, row[k]]))
  const revisions = [
    ...trackRows.map((r) => ({ artist_id: artistId, entity_type: 'track', entity_id: r.id, data: pick(r, ['id', 'title', 'cover_url', 'stream_url', 'sort_order']) })),
    ...tourRows.map((r) => ({ artist_id: artistId, entity_type: 'tour_date', entity_id: r.id, data: pick(r, ['id', 'date', 'venue', 'city', 'country', 'ticket_url']) })),
    ...merchRows.map((r) => ({ artist_id: artistId, entity_type: 'merch', entity_id: r.id, data: pick(r, ['id', 'title', 'image_url', 'price', 'url', 'created_at']) })),
    ...linkRows.map((r) => ({ artist_id: artistId, entity_type: 'link', entity_id: r.id, data: pick(r, ['id', 'label', 'url', 'sort_order']) })),
  ]
  const { error: rErr } = await db.from('revisions').insert(revisions)
  if (rErr) throw rErr

  console.log(`Seeded + published Skeen (${artistId})`)
  console.log(`  public page: /skeen`)
  console.log(`  ${trackRows.length} tracks, ${tourRows.length} tour dates, ${merchRows.length} merch, ${linkRows.length} links`)
  console.log(`  editable as manager-a@lonestar.test`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
