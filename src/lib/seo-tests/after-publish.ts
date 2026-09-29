/**
 * TEST AFTER PUBLISH: once a publish has gone out, run the SEO / GEO tests in the background, the
 * way the IndexNow ping runs (lib/indexnow.ts): scheduled with `after`, so it never slows or
 * fails the publish; every error ends here as a quiet log line.
 *
 * THE TRAP it handles: the artist's site caches each page for ~60 s, so a run straight after
 * Publish would read the OLD page and store a stale verdict under today's date. So it waits
 * (fresh.ts, up to ~90 s) until the site's sitemap names this publish, poking "/" as it goes;
 * then it runs. Whatever the wait found is RECORDED with the run (`site_fresh`, `note`), so the
 * page can say "your site may not have updated yet" instead of pretending.
 *
 * BURSTS: publishing 20 times in a minute schedules 20 of these, and must not make 20 runs.
 *   1. Each first pauses 10 s, then stops if a NEWER publish exists ("superseded"): only the
 *      newest publish's hook goes on to poll the site. Checked again after the wait and before
 *      every retry.
 *   2. The database coalesces the rest: a publish run for a publish a run already covers is
 *      refused ("coalesced"), and at most one publish run per artist starts per 60 s.
 * Busy (a manual run going), the cool-down and the per-person limit are retried for up to
 * 150 s, sleeping what the database says (at most 15 s a time). A manual run's cool-down counts
 * from its FINISH too, so a chain of "Test again" clicks always leaves a publish run a window.
 *
 * WHO WRITES: the claim and the results go through the SERVICE-ROLE client (the only role that
 * may call seo_test_claim / seo_test_finish), created here, for the manager `publishGated` has
 * already signed in, whose id rides along for the per-person limits. The manager's own session
 * only reads.
 *
 * ON SERVERLESS HOSTING (LAUNCH_CHECKLIST.md, "SEO/GEO tests"): `after` lives inside the publish
 * request's function, so pause + wait + retries + run (10 + ~90 + up to 150 + up to 90 s) must fit
 * the route's `maxDuration`. Past it the platform kills the function; a claim left running is
 * marked failed by the next claim after 5 minutes. Nothing is lost but that run.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { waitForFreshSite, type FreshWait, type WaitOptions } from './fresh'
import { readKnown as readKnownDefault } from './known'
import { readPublishMoments, runSeoTests, type RunDeps, type SeoRunOutcome } from './run'

export type AfterPublishDeps = RunDeps & {
  wait?: (o: WaitOptions) => Promise<FreshWait>
  sleep?: (ms: number) => Promise<void>
  /** The pause before anything else, so a burst of publishes can supersede this one. */
  settleMs?: number
  /** How long a refused claim (busy / cool-down / limit) is retried. */
  retryWindowMs?: number
}

export type AfterPublishOutcome =
  | { ran: true; outcome: SeoRunOutcome; wait: FreshWait }
  | { ran: false; reason: 'no-site' | 'superseded' | 'coalesced' | 'gave-up' | 'refused' | 'error'; error?: string }

const SETTLE_MS = 10_000
const RETRY_WINDOW_MS = 150_000
const MAX_RETRY_SLEEP_MS = 15_000

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Settle, skip if superseded, wait for the site, then run and store. Never throws.
 * `supabase` is the manager's session (reads only); `who.writer` the service role.
 */
export async function testAfterPublish(
  supabase: SupabaseClient,
  artistId: string,
  who: { writer: SupabaseClient; userId: string | null },
  deps: AfterPublishDeps = {},
): Promise<AfterPublishOutcome> {
  try {
    const now = deps.now ?? Date.now
    const sleep = deps.sleep ?? realSleep
    const known = await (deps.readKnown ?? readKnownDefault)(supabase, artistId, { now: now() })
    // Nothing to fetch, nothing to wait for: a publish with no site stores no run of unknowns.
    if (!known.siteUrl) return { ran: false, reason: 'no-site' }
    const mine = known.published?.publishedAt ?? null
    const readMoments = deps.readMoments ?? readPublishMoments
    const moments = () => readMoments(supabase, artistId).catch(() => [] as string[])
    /** A publish newer than the one this hook is for: a later hook will test that one. */
    const superseded = async () => {
      if (!mine) return false
      const mineAt = Date.parse(mine)
      return (await moments()).some((m) => Date.parse(m) > mineAt)
    }

    await sleep(deps.settleMs ?? SETTLE_MS)
    if (await superseded()) return { ran: false, reason: 'superseded' }

    const wait = await (deps.wait ?? waitForFreshSite)({
      origin: known.siteUrl,
      publishedAt: mine,
      moments: await moments(),
      fetcher: deps.fetcher,
      sleep: deps.sleep,
      now: deps.now,
    })
    const secs = Math.round(wait.waitedMs / 1000)
    const note =
      wait.fresh === false
        ? `Your site still showed the last publish after ${secs} seconds, so these results may be out of date.`
        : wait.fresh === null && mine
          ? `We couldn’t confirm your site had updated; we waited ${secs} seconds before testing.`
          : null

    const deadline = now() + (deps.retryWindowMs ?? RETRY_WINDOW_MS)
    for (;;) {
      if (await superseded()) return { ran: false, reason: 'superseded' }
      const outcome = await runSeoTests(
        supabase,
        artistId,
        'publish',
        { writer: who.writer, userId: who.userId, publishedAt: mine },
        { ...deps, readMoments, freshness: { fresh: wait.fresh }, note },
      )
      if (outcome.ok) return { ran: true, outcome, wait }
      if (outcome.reason === 'coalesced') return { ran: false, reason: 'coalesced' }
      if (outcome.reason !== 'busy' && outcome.reason !== 'cooldown' && outcome.reason !== 'limit') return { ran: false, reason: 'refused', error: outcome.reason }
      const pause = Math.min(Math.max(1, outcome.retryInS ?? 10) * 1000, MAX_RETRY_SLEEP_MS)
      if (now() + pause > deadline) return { ran: false, reason: 'gave-up' }
      await sleep(pause)
    }
  } catch (e) {
    return { ran: false, reason: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Schedule the run for after the publish's response has gone. Call it once per successful
 * publish that ships page words, with the manager the publish verified. A failure anywhere,
 * `after` itself included (outside a request), is logged quietly and goes no further.
 */
export function scheduleSeoTestRun(supabase: SupabaseClient, artistId: string, userId: string): void {
  try {
    after(async () => {
      try {
        const out = await testAfterPublish(supabase, artistId, { writer: createAdminClient(), userId })
        if (!out.ran && (out.reason === 'error' || out.reason === 'refused' || out.reason === 'gave-up')) {
          console.warn(`[seo-tests] no run after publish (artist ${artistId}): ${out.reason}`)
        } else if (out.ran && !out.outcome.ok) console.warn(`[seo-tests] run after publish not stored (artist ${artistId}): ${out.outcome.reason}`)
      } catch (e) {
        console.warn('[seo-tests] run after publish failed:', e instanceof Error ? e.message : e)
      }
    })
  } catch (e) {
    console.warn('[seo-tests] run not scheduled:', e instanceof Error ? e.message : e)
  }
}
