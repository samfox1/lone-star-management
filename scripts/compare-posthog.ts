/**
 * The PostHog cross-check: pull up to 30 complete UTC days from BOTH analytics pipelines for
 * one artist and print whether they agree where they should (ANALYTICS_PAGE_PLAN.md,
 * "PostHog cross-check").
 *
 *   npm run compare:posthog -- skeen
 *   npm run compare:posthog -- skeen --days 14
 *   npm run compare:posthog -- skeen --json
 *
 * Exit 0: every criterion met. 1: a criterion failed. 2: a side could not be read, or had no
 * data (an empty side is never printed as a table of zeros that reads like agreement).
 *
 * PLUMBING ONLY. Every judgement (ratios, gates, host normalization, the HogQL itself) lives
 * in src/lib/compare-posthog.ts, where it is unit- and mutation-tested. Strictly read-only on
 * both sides.
 *
 * Reads from .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  our public analytics readers
 *   POSTHOG_PERSONAL_API_KEY   a `phx_` personal key with the query:read scope
 *                              (the `phc_` project key cannot read)
 *   POSTHOG_PROJECT_ID         the numeric project id
 *   POSTHOG_HOST               optional, default https://us.posthog.com (the APP host, not
 *                              the us.i.posthog.com ingestion host)
 */
import './_node-compat' // MUST be first: polyfills WebSocket for createClient on Node < 22
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import {
  compare,
  comparisonWindow,
  exitCode,
  formatReport,
  hogqlQueries,
  oursSide,
  parseHogQL,
  posthogSide,
  type HogQLRows,
  type OursRaw,
  type QueryName,
  type Window,
} from '../src/lib/compare-posthog'

config({ path: '.env.local' })

const USAGE = 'usage: npm run compare:posthog -- <artist-slug> [--days N] [--json]'

function die(msg: string): never {
  console.error(`✖ ${msg}`)
  process.exit(2)
}

function parseArgs(argv: string[]) {
  let slug: string | undefined
  let days = 30
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a === '--days') days = Number(argv[++i])
    else if (a.startsWith('--')) die(`Unknown flag ${a}\n  ${USAGE}`)
    else slug = a
  }
  if (!slug) die(`Missing artist slug.\n  ${USAGE}`)
  return { slug, days, json }
}

async function runHogQL(name: QueryName, query: string): Promise<HogQLRows> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY
  const project = process.env.POSTHOG_PROJECT_ID
  const host = (process.env.POSTHOG_HOST || 'https://us.posthog.com').replace(/\/+$/, '')
  const res = await fetch(`${host}/api/projects/${project}/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`PostHog ${name}: HTTP ${res.status} ${JSON.stringify(body)}`)
  return parseHogQL(body, name)
}

async function readPostHog(slug: string, w: Window) {
  const all = async (bots: boolean) => {
    const q = hogqlQueries(slug, w, bots)
    const names = Object.keys(q) as QueryName[]
    const rows = await Promise.all(names.map((n) => runHogQL(n, q[n])))
    return Object.fromEntries(names.map((n, i) => [n, rows[i]])) as Record<QueryName, HogQLRows>
  }
  try {
    return posthogSide(await all(true), w, true)
  } catch (first) {
    // `$virt_is_bot` is a query-time virtual property; if this project cannot resolve it,
    // retry without it and print no PostHog bot column, rather than inventing one. ONLY for
    // that error: a 429 or a network blip used to land here too, and quietly cost the bot
    // column while blaming a property that was fine.
    if (!/virt_is_bot/i.test((first as Error)?.message ?? '')) throw first
    let rows: Record<QueryName, HogQLRows>
    try {
      rows = await all(false)
    } catch {
      throw first
    }
    console.error(`! PostHog rejected $virt_is_bot, so its bot column is omitted: ${(first as Error).message}`)
    return posthogSide(rows, w, false)
  }
}

async function readOurs(slug: string, w: Window): Promise<OursRaw> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.')
  const svc = createClient(url, key, { auth: { persistSession: false } })

  const { data: artist, error } = await svc.from('artists').select('id').eq('slug', slug).maybeSingle<{ id: string }>()
  if (error) throw new Error(`artists: ${error.message}`)
  if (!artist) die(`No artist with slug "${slug}".`)

  // Public readers only: the `analytics` schema is not exposed through PostgREST.
  const args = { p_artist_id: artist.id, p_since: w.since, p_until: w.until }
  const read = async <T>(fn: string, a: Record<string, unknown>): Promise<T[]> => {
    const res = await svc.rpc(fn, a)
    if (res.error) throw new Error(`${fn}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  const [timeline, typeTimeline, sources, places, entities] = await Promise.all([
    read<OursRaw['timeline'][number]>('analytics_timeline', args),
    read<OursRaw['typeTimeline'][number]>('analytics_type_timeline', args),
    read<OursRaw['sources'][number]>('analytics_sources', args),
    read<OursRaw['places'][number]>('analytics_places', args),
    // No upper bound on this reader; see the entities query in src/lib/compare-posthog.ts.
    read<OursRaw['entities'][number]>('analytics_by_entity', { p_artist_id: artist.id, p_since: `${w.since}T00:00:00Z` }),
  ])
  return { timeline, typeTimeline, sources, places, entities }
}

async function main() {
  const { slug, days, json } = parseArgs(process.argv.slice(2))
  let w: Window
  try {
    w = comparisonWindow(days, Date.now())
    hogqlQueries(slug, w, true) // validates the slug before anything is fetched
  } catch (e) {
    die((e as Error).message)
  }
  if (!process.env.POSTHOG_PERSONAL_API_KEY || !process.env.POSTHOG_PROJECT_ID) {
    die('POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID missing from .env.local.')
  }

  // PostHog FIRST, ours second: a click PostHog holds has already reached our door, so the
  // gap between the two reads can only produce ours-only clicks, never a false door drop.
  let ph, ours
  try {
    ph = await readPostHog(slug, w)
  } catch (e) {
    die(`Could not read PostHog. ${(e as Error).message}`)
  }
  try {
    ours = oursSide(await readOurs(slug, w))
  } catch (e) {
    die(`Could not read our analytics. ${(e as Error).message}`)
  }

  let report
  try {
    report = compare(ours, ph, w)
  } catch (e) {
    die((e as Error).message)
  }
  if (json) console.log(JSON.stringify(report, null, 2))
  else process.stdout.write(formatReport(report))
  process.exit(exitCode(report))
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
