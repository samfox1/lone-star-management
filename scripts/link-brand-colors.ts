/**
 * LINK one artist's stored colours to the Brand page colours they already are (bridge 0.42.0).
 *
 * Before 0.42 a brand swatch saved a copy of its hex (`text-[#f4f1ea]`), so a region painted
 * Cream never followed Cream when the Brand page changed it. New picks save the brand token
 * (`text-[brand-cream_#f4f1ea]`, rendered `var(--brand-cream, #f4f1ea)`). This rewrites the
 * picks made before that: every plain text / background / border hex in the artist's WORKING
 * style rows that equals a PUBLISHED brand colour becomes that colour's token. The rule is
 * `linkBrandColors` (src/lib/site-editor/brand-link.ts), pinned by brand-link.test.ts.
 *
 * Why the PUBLISHED brand: it is what `--brand-<key>` holds on the live site today, so a link
 * changes nothing a fan sees at the moment it lands. A published key also never moves (the
 * key-handover trigger only re-keys never-published colours).
 *
 * DRAFT ONLY. It updates `site_styles` rows, which ARE the draft; it never touches
 * `revisions`, so nothing reaches the live site until the manager presses Publish, and the
 * editor's Revert takes it back like any other edit.
 *
 * ONLY once the site runs bridge 0.42.0+. An older site's applier leaves the token as a dead
 * class, and every linked region falls back to its base colour.
 *
 * Dry run by default. `--apply` writes, after backing every before/after up to disk.
 *
 *   npx tsx scripts/link-brand-colors.ts <artist-slug>
 *   npx tsx scripts/link-brand-colors.ts <artist-slug> --apply
 */
import './_node-compat'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import type { PublicSitePayload } from '@samfox1/site-bridge/payload'
import { canonicalHex } from '../src/lib/color'
import { planBrandLinks, type BrandColorRef, type StyleRow } from '../src/lib/site-editor/brand-link'

config({ path: '.env.local' })

const slug = process.argv.slice(2).find((a) => !a.startsWith('--'))
const APPLY = process.argv.includes('--apply')
if (!slug) throw new Error('usage: link-brand-colors <artist-slug> [--apply]')

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: artist, error: aErr } = await s.from('artists').select('id, name').eq('slug', slug).single()
  if (aErr || !artist) throw new Error(aErr?.message ?? `no artist "${slug}"`)

  // What the live site's `--brand-<key>` variables hold right now.
  const { data: site, error: sErr } = await s.rpc('get_public_site', { p_slug: slug })
  if (sErr) throw new Error(sErr.message)
  const published: BrandColorRef[] = ((site as PublicSitePayload | null)?.brand?.colors ?? []).map((c) => ({
    key: c.key,
    name: c.name,
    hex: c.hex,
  }))
  // The Brand page's working colours — only to say which published ones have a change waiting.
  const { data: working, error: wErr } = await s.from('brand_colors').select('key, name, hex').eq('artist_id', artist.id)
  if (wErr) throw new Error(wErr.message)
  const { data: rows, error: rErr } = await s
    .from('site_styles')
    .select('id, region_key, class_names')
    .eq('artist_id', artist.id)
    .order('region_key')
  if (rErr) throw new Error(rErr.message)

  console.log(`${artist.name} (${slug}): ${rows?.length ?? 0} working style rows, ${published.length} published brand colours`)
  if (!published.length) {
    console.log('  The Brand page has not been published, so no --brand-* variable exists yet. Publish Brand first.')
    return
  }
  console.log(`  ${published.map((c) => `${c.name} ${c.hex} (--brand-${c.key})`).join(' · ')}`)

  const plan = planBrandLinks((rows ?? []) as StyleRow[], published)
  for (const c of plan.changes) {
    console.log(`\n  ${c.region_key}`)
    for (const l of c.links) console.log(`    ${l.from} → ${l.to}  (${l.name})`)
  }
  for (const r of plan.refused) {
    console.log(`\n  ${r.region_key}: SKIPPED, the linked string would be one the editor's save refuses (over 500 characters?)`)
  }

  const linkedKeys = new Set(plan.changes.flatMap((c) => c.links.map((l) => l.key)))
  for (const p of published) {
    const w = (working ?? []).find((c) => c.key === p.key)
    if (!linkedKeys.has(p.key) || !w || canonicalHex(w.hex) === canonicalHex(p.hex)) continue
    console.log(`\n  Note: ${p.name} has an unpublished change on the Brand page (${p.hex} → ${w.hex}). Regions linked to it follow when Brand is published.`)
  }

  const tokens = plan.changes.reduce((n, c) => n + c.links.length, 0)
  console.log(`\n${plan.changes.length} rows, ${tokens} tokens ${APPLY ? 'to link' : 'would be linked'}.`)
  if (!plan.changes.length) return
  if (!APPLY) {
    console.log('Dry run: nothing written. Re-run with --apply ONLY once the site runs bridge 0.42.0+.')
    console.log('The rows change as DRAFT; Publish ships them, Revert undoes them.')
    return
  }

  const backup = join(tmpdir(), `link-brand-colors-${slug}-${Date.now()}.json`)
  writeFileSync(backup, JSON.stringify(plan.changes, null, 2))
  console.log(`Backup (every before/after): ${backup}`)
  for (const c of plan.changes) {
    // Guarded on the value read, so an edit the manager made since the read is never
    // overwritten, and a zero-row answer is an error rather than a quiet success.
    const { data, error } = await s
      .from('site_styles')
      .update({ class_names: c.after })
      .eq('id', c.id)
      .eq('artist_id', artist.id)
      .eq('class_names', c.before)
      .select('id')
    if (error) throw new Error(`${c.region_key}: ${error.message}`)
    if (!data?.length) console.log(`  ${c.region_key}: changed since the read, left alone`)
  }
  console.log(`Linked ${plan.changes.length} rows (draft). Publish to ship them.`)
}

main()
