import { KLabel } from '@/components/ui/ui'
import { CHECK_SLUG, checkState } from '@/lib/posthog-check'
import {
  comparisonWindow,
  compare,
  formatReport,
  hogqlQueries,
  oursSide,
  parseHogQL,
  posthogSide,
  type HogQLRows,
  type OursRaw,
  type Window,
} from '@/lib/compare-posthog'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * TEMPORARY (2026-09-17) — the PostHog cross-check, on screen.
 *
 * DELETE THIS WHOLE FILE when the 30-day comparison ends, along with `src/lib/posthog-check.ts`,
 * its test, the one `<PostHogCheck />` line in the artist dashboard page, and the
 * `NEXT_PUBLIC_POSTHOG_*` env vars on skeen. `compare-posthog.ts` and the `compare:posthog`
 * script are NOT part of this: the script is the real tool, and this is a window onto it.
 *
 * It is the same report `npm run compare:posthog` prints, from the same pure module, so the
 * two can never disagree about what passes. It renders for ONE artist and only when the
 * server holds both PostHog credentials (`checkState`); everyone else sees nothing at all.
 *
 * The personal API key is read HERE, in a server component, and never reaches the browser.
 * The whole report is text, deliberately: it is a diagnostic for a month, not a feature, and
 * a designed panel would be a thing people expect to keep.
 */
export async function PostHogCheck({
  supabase,
  artistId,
  slug,
  now,
}: {
  supabase: SupabaseClient
  artistId: string
  slug: string
  /** The page's ONE read of the clock, passed in: the same instant the charts above use. */
  now: number
}) {
  if (checkState(slug, process.env) !== 'ready') return null

  let text: string
  try {
    const w = comparisonWindow(30, now)
    const [ours, ph] = await Promise.all([readOurs(supabase, artistId, w), readPostHog(slug, w)])
    text = formatReport(compare(oursSide(ours), ph, w))
  } catch (e) {
    // A failed read must not take down a page the manager opens every day.
    text = `The cross-check could not run: ${(e as Error).message}`
  }

  return (
    <section>
      <KLabel>PostHog cross-check · {CHECK_SLUG} · temporary</KLabel>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-surface p-5 font-space text-[11px] leading-relaxed text-ink-muted">
        {text}
      </pre>
    </section>
  )
}

/** The public readers, through the manager's own session. The `analytics` schema is not
 *  exposed through PostgREST, and these RPCs are granted to `authenticated`. */
async function readOurs(supabase: SupabaseClient, artistId: string, w: Window): Promise<OursRaw> {
  const args = { p_artist_id: artistId, p_since: w.since, p_until: w.until }
  const read = async <T,>(fn: string, a: Record<string, unknown>): Promise<T[]> => {
    const res = await supabase.rpc(fn, a)
    if (res.error) throw new Error(`${fn}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }
  const [timeline, typeTimeline, sources, places, entities] = await Promise.all([
    read<OursRaw['timeline'][number]>('analytics_timeline', args),
    read<OursRaw['typeTimeline'][number]>('analytics_type_timeline', args),
    read<OursRaw['sources'][number]>('analytics_sources', args),
    read<OursRaw['places'][number]>('analytics_places', args),
    read<OursRaw['entities'][number]>('analytics_by_entity', { p_artist_id: artistId, p_since: `${w.since}T00:00:00Z` }),
  ])
  return { timeline, typeTimeline, sources, places, entities }
}

async function readPostHog(slug: string, w: Window) {
  const host = (process.env.POSTHOG_HOST ?? 'https://us.posthog.com').replace(/\/+$/, '')
  const url = `${host}/api/projects/${process.env.POSTHOG_PROJECT_ID}/query/`
  const run = async (bots: boolean) => {
    const q = hogqlQueries(slug, w, bots)
    const names = Object.keys(q) as (keyof typeof q)[]
    const rows = await Promise.all(
      names.map(async (name) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.POSTHOG_PERSONAL_API_KEY}` },
          body: JSON.stringify({ query: { kind: 'HogQLQuery', query: q[name] } }),
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`PostHog ${name}: HTTP ${res.status}`)
        return parseHogQL(await res.json(), name)
      }),
    )
    return Object.fromEntries(names.map((n, i) => [n, rows[i]])) as Record<keyof typeof q, HogQLRows>
  }
  try {
    return posthogSide(await run(true), w, true)
  } catch (first) {
    // Only the one known cause, so a 429 does not silently cost the bot column.
    if (!/virt_is_bot/i.test((first as Error)?.message ?? '')) throw first
    return posthogSide(await run(false), w, false)
  }
}
