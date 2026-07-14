/**
 * Point an artist's public site at an EXTERNAL custom site, or back at a built-in
 * template (SITE_STYLING_PLAN.md §5 / S4).
 *
 *   npm run site:custom -- skeen http://localhost:3001            # dev: local skeen
 *   npm run site:custom -- skeen https://skeen-website.vercel.app # the deployed site
 *   npm run site:custom -- skeen --template                       # back to built-in
 *
 * This is CONFIG, not content: `site_kind` / `custom_site_url` are deliberately not
 * in ARTIST_SNAPSHOT, so they never ride `get_public_site` and flipping them does
 * NOT change the payload the live site renders. What changes is:
 *   1. lone-star's public `/[slug]` — redirects to `custom_site_url` when custom.
 *   2. the visual editor — embeds `custom_site_url/edit` instead of the built-in
 *      `/artists/[id]/edit-frame`, and posts the draft over the bridge.
 *
 * A one-off script, NOT a migration: the URL is per-environment (localhost in dev,
 * a real domain in prod), so baking it into a migration would force one env's URL
 * onto every other. Re-run this when the target moves — and keep the custom site's
 * NEXT_PUBLIC_EDITOR_ORIGIN pointed at whatever origin lone-star is served from,
 * or its bridge will reject the editor's messages. No code change either way.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { WebSocket } from 'ws'

config({ path: '.env.local' })

// Node < 22 has no global WebSocket, which @supabase/realtime-js requires at
// SupabaseClient construction — even though this script never opens a realtime
// connection. Same polyfill vitest.setup.ts uses. Harmless on Node 22+.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
}

const [slug, target] = process.argv.slice(2)

function die(msg: string): never {
  console.error(`✖ ${msg}`)
  console.error('  usage: npm run site:custom -- <artist-slug> <https://url | --template>')
  process.exit(1)
}

async function main() {
  if (!slug) die('Missing artist slug.')
  if (!target) die('Missing target: an absolute URL, or --template to revert.')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.')

  const toTemplate = target === '--template'
  if (!toTemplate) {
    // Fail loudly on a bad URL: the editor derives the frame's postMessage target
    // origin from this value, and a wrong origin fails SILENTLY (the browser drops
    // the message and the frame just never populates).
    try {
      const parsed = new URL(target)
      if (!/^https?:$/.test(parsed.protocol)) die(`Not an http(s) URL: ${target}`)
    } catch {
      die(`Not a valid absolute URL: ${target}  (did you mean --template?)`)
    }
  }

  const svc = createClient(url, key, { auth: { persistSession: false } })

  const { data: artist } = await svc
    .from('artists')
    .select('id, name, slug, site_kind, custom_site_url')
    .eq('slug', slug)
    .maybeSingle<{ id: string; name: string; slug: string; site_kind: string; custom_site_url: string | null }>()
  if (!artist) die(`No artist with slug "${slug}".`)

  const next = toTemplate
    ? { site_kind: 'template', custom_site_url: null }
    : { site_kind: 'custom', custom_site_url: target.replace(/\/$/, '') }

  const { error } = await svc.from('artists').update(next).eq('id', artist!.id)
  if (error) die(error.message)

  console.log(`✔ ${artist!.name} (${artist!.slug})`)
  console.log(`    was: ${artist!.site_kind}${artist!.custom_site_url ? ` → ${artist!.custom_site_url}` : ''}`)
  console.log(`    now: ${next.site_kind}${next.custom_site_url ? ` → ${next.custom_site_url}` : ''}`)
  if (!toTemplate) {
    console.log(`\n  Next: the custom site must trust the editor's origin.`)
    console.log(`  Set NEXT_PUBLIC_EDITOR_ORIGIN there to wherever lone-star is served`)
    console.log(`  (http://localhost:3000 in dev), or its bridge will ignore the editor.`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
