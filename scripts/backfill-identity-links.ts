/**
 * BACKFILL `links.identity_url` for rows written before 20260928170000 (AI_VISIBILITY_AUDIT.md 1.2).
 *
 * The public door now sends `identity_links`: an artist's connected profiles that say who
 * they are, button or not, so they reach the fact card's `sameAs`. A link that is not a site
 * button is published only when TypeScript judged it an identity profile, and that verdict
 * lives in `links.identity_url` (the url judged, or null). New writes store it themselves
 * (lib/content.ts); rows from before have none, so until this runs their off-site profiles
 * stay out of `sameAs`.
 *
 * The verdict is `identityUrlOf` (lib/connections), the SAME function every write uses, never
 * a SQL guess: a connection's profile row whose url the bridge reads as an identity profile
 * (`isIdentityProfileUrl`). Never a payment handle, an invite, a playlist, a booking address or a
 * role-bound button. The plan is `planIdentityBackfill`, pinned by identity-verdict.test.ts.
 * It also CLEARS a stored verdict that no longer holds, so re-running it after a bridge rule
 * changes brings every row back in line. A second run plans nothing.
 *
 * What it changes on the live site: once written, an off-site identity profile whose
 * PUBLISHED url equals its verdict joins `identity_links` at once (no publish needed); a row
 * with an unpublished url edit joins after the next Publish. It never touches `revisions`,
 * `on_site`, or anything a fan sees on the page itself.
 *
 * ONLY after 20260928170000 is pushed: `--apply` refuses while the column is missing. The dry
 * run works before it (every row reads as unjudged).
 *
 * Dry run by default. `--apply` writes, after backing every before/after up to disk.
 *
 *   npx tsx scripts/backfill-identity-links.ts                  # every artist, dry run
 *   npx tsx scripts/backfill-identity-links.ts <artist-slug>    # one artist, dry run
 *   npx tsx scripts/backfill-identity-links.ts [slug] --apply
 */
import './_node-compat'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { planIdentityBackfill, type IdentityChange, type IdentityRow } from '../src/lib/connections'

config({ path: '.env.local' })

const slug = process.argv.slice(2).find((a) => !a.startsWith('--'))
const APPLY = process.argv.includes('--apply')
const PAGE = 1000

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  let artistQuery = s.from('artists').select('id, slug, name').order('slug')
  if (slug) artistQuery = artistQuery.eq('slug', slug)
  const { data: artists, error: aErr } = await artistQuery
  if (aErr) throw new Error(aErr.message)
  if (slug && !artists?.length) throw new Error(`no artist "${slug}"`)
  const byId = new Map((artists ?? []).map((a) => [a.id as string, a as { id: string; slug: string; name: string }]))

  // Paged: PostgREST caps a read at 1000 rows, and a truncated read would plan only part of
  // the table without saying so. `*` so a dry run works before the column exists.
  const rows: IdentityRow[] = []
  for (let from = 0; ; from += PAGE) {
    let q = s.from('links').select('*').order('id').range(from, from + PAGE - 1)
    if (slug) q = q.eq('artist_id', [...byId.keys()][0])
    const { data, error } = await q
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as IdentityRow[]))
    if (!data || data.length < PAGE) break
  }
  const migrated = rows.length === 0 || 'identity_url' in rows[0]

  const plan = planIdentityBackfill(rows)
  console.log(`Identity links: ${rows.length} link rows${slug ? ` for ${slug}` : ''}${migrated ? '' : ' (identity_url column not pushed yet: every row reads as unjudged)'}`)

  const perArtist = new Map<string, IdentityChange[]>()
  for (const c of plan) perArtist.set(c.artist_id, [...(perArtist.get(c.artist_id) ?? []), c])
  for (const [artistId, changes] of perArtist) {
    const a = byId.get(artistId)
    console.log(`\n${a ? `${a.slug} · ${a.name}` : artistId}`)
    for (const c of changes) {
      const where = c.on_site ? 'button' : 'off the site'
      const what = c.to ? '+ flag ' : '- clear'
      console.log(`  ${what}  ${(c.label ?? '').padEnd(16)} ${c.url ?? ''}  (${where})`)
    }
  }

  const flag = plan.filter((c) => c.to !== null).length
  const clear = plan.length - flag
  const offSite = plan.filter((c) => c.to !== null && !c.on_site).length
  console.log(`\n${flag} to flag (${offSite} of them off the site, so new to sameAs), ${clear} to clear, ${rows.length - plan.length} already right.`)
  if (!plan.length) return
  if (!APPLY) {
    console.log('Dry run: nothing written. Re-run with --apply once 20260928170000 is pushed.')
    return
  }
  if (!migrated) throw new Error('links.identity_url does not exist yet: push 20260928170000 first (npm run db:push).')

  const backup = join(tmpdir(), `backfill-identity-links-${slug ?? 'all'}-${Date.now()}.json`)
  writeFileSync(backup, JSON.stringify(plan, null, 2))
  console.log(`Backup (every before/after): ${backup}`)
  let written = 0
  for (const c of plan) {
    // Guarded on what was read: a url edited since, or a verdict a write already stored, is
    // left alone (that write judged it itself), and a zero-row answer says so.
    let q = s.from('links').update({ identity_url: c.to }).eq('id', c.id).eq('url', c.url ?? '')
    q = c.from === null ? q.is('identity_url', null) : q.eq('identity_url', c.from)
    const { data, error } = await q.select('id')
    if (error) throw new Error(`${c.label} (${c.id}): ${error.message}`)
    if (data?.length) written++
    else console.log(`  ${c.label} (${c.id}): changed since the read, left alone`)
  }
  console.log(`Wrote ${written} of ${plan.length} verdicts.`)
}

main()
