/**
 * Upload Skeen's hero videos into Supabase Storage under his own folder,
 * organized by use, and register them in the `media` table.
 *
 *   media/{artist_id}/hero-videos/video{n}.{mp4,webm}
 *
 *   npx tsx scripts/upload-skeen-media.ts
 */
import './_node-compat' // MUST be first: polyfills WebSocket for createClient on Node < 22
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

const CLIPS = ['video1', 'video2', 'video3']

async function main() {
  const { data: artist } = await db.from('artists').select('id').eq('slug', 'skeen').single()
  if (!artist) throw new Error('Skeen not found — run seed-skeen first')
  const id = artist.id

  // Upload mp4 + webm for each clip into the artist's hero-videos folder.
  for (const name of CLIPS) {
    for (const ext of ['mp4', 'webm'] as const) {
      const local = `public/videos/skeen/${name}.${ext}`
      const path = `${id}/hero-videos/${name}.${ext}`
      const buf = await readFile(local)
      const { error } = await db.storage
        .from('media')
        .upload(path, buf, { contentType: `video/${ext}`, upsert: true })
      if (error) throw new Error(`upload ${path}: ${error.message}`)
      console.log(`uploaded ${path}`)
    }
  }

  // Register hero videos in the media table (idempotent). We store the mp4; the
  // template derives the webm by extension.
  await db.from('media').delete().eq('artist_id', id).eq('purpose', 'hero_video')
  const { error } = await db.from('media').insert(
    CLIPS.map((name, i) => ({
      artist_id: id,
      purpose: 'hero_video',
      storage_path: `${id}/hero-videos/${name}.mp4`,
      sort_order: i,
    })),
  )
  if (error) throw error

  console.log(`Registered ${CLIPS.length} hero videos for Skeen. See /skeen`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
