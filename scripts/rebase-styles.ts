/**
 * REBASE stored style overrides onto a site's CURRENT base classes.
 *
 * The problem this exists for. A section override REPLACES the region's base — that is
 * what lets a control REMOVE a base token (the Divider toggle strips `border-t`). The
 * cost is that the stored string is frozen at the base it was written against: every
 * later improvement to the site's own design is invisible to any region the manager has
 * already styled, forever, with nothing on screen to say so.
 *
 * Skeen's footer, 2026-08-15: the base gained `grid content-center` (so Height grows the
 * bar around its contents) and `bg-background` (so the editor can show what colour it
 * is). The stored override predated both, so the contents stayed pinned to the top and
 * the background picker read "none" — the two things Sam reported, one cause.
 *
 * What it does. For each base token, add it to the stored string UNLESS the manager has
 * made a choice that conflicts. Conflict is decided by the EDITOR'S OWN control
 * ownership, not by guesswork: if a control owns the base token and the stored string
 * already has a token that same control owns, the manager's choice wins and the base
 * token is skipped. A token no control owns (layout: `grid`, `content-center`) is added
 * when absent, because nothing the manager did could have meant to remove it.
 *
 * Dry run by default. `--apply` writes, after backing every row up to disk.
 *
 *   npm run rebase:styles -- <site-dump.json> <artist-slug>
 *   npm run rebase:styles -- <site-dump.json> <artist-slug> --apply
 */
import './_node-compat'
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { buildStyleControls, controlsForRegion, type StyleControl } from '../src/lib/site-editor/style-controls'
import type { ManifestStyleRegion } from '../src/lib/site-editor/manifest'
import { rebaseOverride } from '../src/lib/site-editor/rebase-override'

config({ path: '.env.local' })

type Dump = {
  site: string
  regions: { key: string; label: string; base?: string; scope?: string }[]
  textColors: string[]
  bgColors: string[]
}

const [dumpPath, slug] = process.argv.slice(2)
const APPLY = process.argv.includes('--apply')
/** Also fold back tokens a CONTROL owns but the manager has set nothing for. Ambiguous by
 *  nature (cleared on purpose, or new to the base?) — so it takes a human reading the dry
 *  run, never a default. */
const INCLUDE_OWNED = process.argv.includes('--include-owned')
/** Limit to one region. Rebasing every styled region at once changes things the manager
 *  never asked about — this keeps a fix to the thing they actually reported. */
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
if (!dumpPath || !slug) throw new Error('usage: rebase-styles <site-dump.json> <artist-slug> [--apply]')

async function main() {
  const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump
  const controls = buildStyleControls({
    fonts: [],
    textColors: dump.textColors.map((v) => ({ value: v, label: v })),
    bgColors: dump.bgColors.map((v) => ({ value: v, label: v })),
  })
  const baseOf = new Map(dump.regions.map((r) => [r.key, r]))

  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: artist, error: aErr } = await s.from('artists').select('id, name').eq('slug', slug).single()
  if (aErr) throw new Error(aErr.message)
  const { data: rows, error } = await s
    .from('site_styles')
    .select('id, region_key, class_names')
    .eq('artist_id', artist!.id)
    .order('region_key')
  if (error) throw new Error(error.message)

  const changes: { id: string; region_key: string; before: string; after: string }[] = []
  for (const row of rows ?? []) {
    if (ONLY && row.region_key !== ONLY) continue
    const region = baseOf.get(row.region_key)
    if (!region?.base) continue // a per-item key, or a region this build no longer has
    const offered = controlsForRegion(controls, {
      key: region.key,
      label: region.label,
      base: region.base,
      scope: region.scope,
    } as ManifestStyleRegion)
    const next = rebaseOverride(region.base, row.class_names as string, offered, { includeOwned: INCLUDE_OWNED })
    if (next) changes.push({ id: row.id as string, region_key: row.region_key as string, before: row.class_names as string, after: next })
  }

  console.log(`${artist!.name}: ${rows?.length ?? 0} stored overrides, ${changes.length} behind the current design`)
  for (const c of changes) {
    const added = c.after.slice(c.before.length).trim()
    console.log(`\n  ${c.region_key}`)
    console.log(`    picks up: ${added}`)
  }
  if (!changes.length) return
  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.')
    return
  }

  const backup = `/tmp/site-styles-backup-${slug}-${Date.now()}.json`
  writeFileSync(backup, JSON.stringify(changes, null, 2))
  console.log(`\nBackup (every before/after): ${backup}`)
  for (const c of changes) {
    const { error: upErr } = await s.from('site_styles').update({ class_names: c.after }).eq('id', c.id)
    if (upErr) throw new Error(upErr.message)
  }
  console.log(`Updated ${changes.length} rows.`)
}

main()
