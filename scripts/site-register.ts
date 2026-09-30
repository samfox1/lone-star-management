/**
 * Register an artist's site with Google Search Console and Bing Webmaster Tools, as Tapir
 * (ADD_WEBSITE_PLAN.md step 4). The admin page's "Add website" button (later, TODO.md) runs the
 * same `registerSite`.
 *
 *   npm run site:register -- skeen --check     # look only: the address, who holds it, what's stored
 *   npm run site:register -- skeen             # register at the artist's current site address
 *   npm run site:register -- skeen https://www.example.com
 *
 * Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the table is written
 * only by the service role), GOOGLE_SEARCH_SERVICE_ACCOUNT_B64, BING_WEBMASTER_API_KEY,
 * TAPIR_SEARCH_OWNER_EMAIL. Missing Google or Bing credentials skip that provider, loudly.
 *
 * Prints only step names, reason codes and Google's / Bing's own short messages: never a key.
 * Safe to run again: every call tolerates repeats ("try again" = run it again).
 */
import './_node-compat' // MUST be first: polyfills WebSocket for createClient on Node < 22
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolveSiteAddress } from '../src/lib/search-engines/address'
import { bingClient } from '../src/lib/search-engines/bing'
import { googleClient, googleCredsFromEnv } from '../src/lib/search-engines/google'
import { registerSite } from '../src/lib/search-engines/register'
import { supabaseStore } from '../src/lib/search-engines/register-store'
import { guardedFetch } from '../src/lib/seo-tests/guarded-fetch'

config({ path: '.env.local' })

const args = process.argv.slice(2)
const check = args.includes('--check')
const [slug, address] = args.filter((a) => a !== '--check')

function die(msg: string): never {
  console.error(`✖ ${msg}`)
  console.error('  usage: npm run site:register -- <artist-slug> [https://address] [--check]')
  process.exit(1)
}

async function main() {
  if (!slug) die('Missing artist slug.')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.')
  const svc = createClient(url, key, { auth: { persistSession: false } })

  const { data: artist } = await svc.from('artists').select('id, name, slug, site_kind, custom_site_url').eq('slug', slug).maybeSingle()
  if (!artist) die(`No artist with slug "${slug}".`)
  const target = address ?? (artist.site_kind === 'custom' ? artist.custom_site_url : null)
  if (!target) die(`${artist.name} has no site address yet: pass one.`)

  const store = supabaseStore(svc)
  console.log(`${artist.name} (${artist.slug}) → ${target}`)

  if (check) {
    const addr = await resolveSiteAddress(target)
    const why = !addr.ok ? ('to' in addr && addr.to ? `: it goes to ${addr.to}` : 'detail' in addr && addr.detail ? `: ${addr.detail}` : '') : ''
    console.log(addr.ok ? `  address: ${addr.siteUrl}` : `  address: refused (${addr.reason})${why}`)
    if (addr.ok) {
      const holder = await store.holderOf(addr.siteUrl, artist.id)
      console.log(`  held by another artist: ${holder ?? 'no'}`)
    }
    const rows = await store.rowsOf(artist.id)
    console.log(`  stored: ${rows.length ? rows.map((r) => `${r.provider} (${r.verified_at ? 'verified' : 'not verified'}${r.error_code ? `, ${r.error_code}` : ''})`).join(', ') : 'nothing'}`)
    const creds = googleCredsFromEnv(process.env.GOOGLE_SEARCH_SERVICE_ACCOUNT_B64)
    console.log(`  Google key: ${creds ? 'set' : 'MISSING'} · Bing key: ${process.env.BING_WEBMASTER_API_KEY ? 'set' : 'MISSING'} · owner: ${process.env.TAPIR_SEARCH_OWNER_EMAIL ? 'set' : 'MISSING'}`)
    return
  }

  const creds = googleCredsFromEnv(process.env.GOOGLE_SEARCH_SERVICE_ACCOUNT_B64)
  if (!creds) console.warn('! GOOGLE_SEARCH_SERVICE_ACCOUNT_B64 missing or broken: Google is skipped.')
  const bingKey = process.env.BING_WEBMASTER_API_KEY?.trim()
  if (!bingKey) console.warn('! BING_WEBMASTER_API_KEY missing: Bing is skipped.')
  // Server config only, never a request: a typo here would hand a stranger ownership of the site.
  const listed = (process.env.TAPIR_SEARCH_OWNER_EMAIL ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const owners = listed.filter((e) => /^[^\s@,<>"']+@[^\s@,<>"']+\.[a-z]{2,}$/i.test(e))
  if (owners.length !== listed.length) die('TAPIR_SEARCH_OWNER_EMAIL holds something that is not an email address.')
  if (!owners.length) console.warn('! TAPIR_SEARCH_OWNER_EMAIL missing: only the robot account will own the site at Google.')

  const out = await registerSite(artist.id, target, {
    store,
    google: creds ? googleClient(creds) : null,
    bing: bingKey ? bingClient(bingKey) : null,
    resolveAddress: (input) => resolveSiteAddress(input),
    // Exactly the address Google and Bing will fetch (no cache-busting query: on a prerendered
    // page Vercel ignores it, and the check must see what the verifiers will see).
    fetchHome: async (siteUrl) => {
      // Only the site itself: a redirect anywhere else is not this site's page.
      const origin = new URL(siteUrl).origin
      const res = await guardedFetch(siteUrl, {
        timeoutMs: 10_000,
        deadlineMs: 20_000,
        maxBytes: 2 * 1024 * 1024,
        allow: (u) => new URL(u).origin === origin,
      })
      return res.status === 200 ? res.text : null
    },
    owners,
    log: (line) => console.log(`  ${line}`),
  })
  console.log(out.ok ? `✔ done: verified with ${out.verified.join(' + ')}` : `✖ not finished: verified with ${out.verified.join(' + ') || 'nothing'}. Run it again to retry.`)
  if (!out.ok) process.exit(1)
}

main().catch((e) => {
  // The message only: a stack or an error object could quote a request URL.
  console.error(`✖ ${e instanceof Error ? e.message : 'failed'}`)
  process.exit(1)
})
