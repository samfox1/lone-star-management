/**
 * The Test tab's rules: every count, headline, word and link the manager reads there, and how
 * the tab tells "not switched on yet" from "couldn't read" from "never tested".
 *
 * Code:     src/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/model.ts,
 *           test/load.ts (loadTestTab, isMissingTable)
 * Feature:  SEO / GEO page · Test tab (and the Overview, which shares its headline), all 24 SEO
 *           tests in their four groups
 * Tier:     STRICT (AGENTS.md "Test depth"): the counts ("19 of 24", "5 need you"), the headline
 *           and the hrefs a stored result can reach are what the manager is told is true.
 * Covers:   • counts: `na` left out of both sides of "N of M"; an unknown status counts nowhere
 *           • groups and the filter: four groups in page order, each row in exactly one filter,
 *             and the three add up to the score; a test with no result is never a pass
 *           • the headline: a site that didn't answer is one sentence (from the run's `reach`
 *             first, then the statuses); no site, none apply, nothing checked each have words
 *           • the words: each status's lead, times in the manager's day
 *           • the run: stale, "may not have updated" for an hour, old runs, a moved site, the
 *             cool-down, and a refusal read from its reason (words only for an older server)
 *           • where an action can go: https or nothing; the "check it yourself" links; every
 *             pencil lands on a real tab or route
 *           • reading the tab: the table missing is "off", a failed read is "error", an empty
 *             table is "never tested"
 * Not here: drawing the tab (tests/components/manager-tools/seo/test-tab.test.tsx); the server
 *           action around the read (tests/unit/seo-tests/runs/actions.test.ts).
 * Fixtures: results from the REAL engine (tests/components/manager-tools/seo/seo-run-fixture.ts);
 *           test lists derived from SEO_TEST_IDS / SEO_TEST_DEFS / SEO_TEST_GROUPS, never hand-
 *           listed; a query-builder fake for the read that answers every chain the same way.
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEO_TEST_DEFS, SEO_TEST_GROUPS } from '@/lib/seo-tests/defs'
import { SEO_MANUAL_COOLDOWN_S } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, type SeoTestResult } from '@/lib/seo-tests/types'
import {
  EMPTY_FILTER,
  checkItYourself,
  classifyRunError,
  cooldownEnd,
  countResults,
  dotText,
  editHref,
  groupsFor,
  hasNoSite,
  headlineLine,
  hostOf,
  isStale,
  isUnreachable,
  oldRunText,
  rowsAreResults,
  runHeadline,
  showStale,
  siteChanged,
  leadOf,
  matchesFilter,
  safeHttps,
  secondsLeft,
  sentenceOf,
  whenText,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/model'
import { SEO_EDIT_TARGETS, SEO_SECTIONS, seoTabSeg } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections'
import { TOOLS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_shell/tools-registry'
import { isMissingTable, loadTestTab } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/load'
import { SCENARIO_NAMES, engineResults, fixtureResults } from '@tests/components/manager-tools/seo/seo-run-fixture'

describe('counts', () => {
  // Counts: `na` is out of both sides of "N of M"; unknown is neither a pass nor a fail.
  it('CRITICAL: `na` is left out of BOTH sides of "N of M"; `unknown` is not a pass and not a fail', () => {
    const rs = fixtureResults({ genre: { status: 'na' }, card: { status: 'unknown' }, shows: { status: 'na' } })
    const c = countResults(rs)
    const by = (s: string) => rs.filter((r) => r.status === s).length
    expect(c.na).toBe(2)
    expect(c.unknown).toBe(by('unknown'))
    expect(c.unknown).toBeGreaterThan(0)
    expect(c.pass).toBe(by('pass'))
    expect(c.fail).toBe(by('fail'))
    expect(c.applicable).toBe(SEO_TEST_IDS.length - 2) // 22, not 24
    expect(c.pass + c.fail + c.unknown).toBe(c.applicable)
  })
  // A malformed stored status counts nowhere, so it can never pass.
  it('an unrecognised status counts nowhere (a malformed stored result is not a pass)', () => {
    const rs = [{ id: 'google', status: 'maybe', value: '', sentence: '', evidence: [] } as unknown as SeoTestResult]
    expect(countResults(rs)).toEqual({ pass: 0, fail: 0, unknown: 0, na: 0, applicable: 0 })
  })
})

describe('groups and the filter', () => {
  // Groups: four in page order, each counting ALL its rows whatever the filter.
  it('four groups in page order, each counting ALL its rows whatever the filter', () => {
    const rs = fixtureResults({ genre: { status: 'na' } })
    const all = groupsFor(rs, 'all')
    expect(all.map((g) => g.id)).toEqual(SEO_TEST_GROUPS.map((g) => g.id))
    for (const g of all) {
      const defs = SEO_TEST_DEFS.filter((d) => d.group === g.id)
      expect(g.rows.map((r) => r.def.id)).toEqual(defs.map((d) => d.id))
      const mine = rs.filter((r) => defs.some((d) => d.id === r.id))
      expect(g.pass).toBe(mine.filter((r) => r.status === 'pass').length)
      expect(g.applicable).toBe(mine.filter((r) => r.status !== 'na').length)
    }
    const need = groupsFor(rs, 'need')
    for (const g of need) {
      expect(g.rows.every((r) => r.result?.status === 'fail')).toBe(true)
      expect(g.pass).toBe(all.find((x) => x.id === g.id)!.pass) // the count does not move
    }
  })
  // The filters: every scored row in exactly one, and the three add up to the score (every scenario).
  it('CRITICAL: every scored row is in exactly ONE filter, and the three add up to the score', () => {
    for (const s of SCENARIO_NAMES) {
      const rs = engineResults(s)
      const ids = (f: 'need' | 'pass' | 'unknown') => groupsFor(rs, f).flatMap((g) => g.rows.map((r) => r.def.id))
      const [need, pass, unknown] = [ids('need'), ids('pass'), ids('unknown')]
      expect(need.sort(), s).toEqual(rs.filter((r) => r.status === 'fail').map((r) => r.id).sort())
      expect(pass.sort(), s).toEqual(rs.filter((r) => r.status === 'pass').map((r) => r.id).sort())
      expect(unknown.sort(), s).toEqual(rs.filter((r) => r.status === 'unknown').map((r) => r.id).sort())
      expect(new Set([...need, ...pass, ...unknown]).size, s).toBe(need.length + pass.length + unknown.length)
      expect(need.length + pass.length + unknown.length, s).toBe(countResults(rs).applicable)
    }
    // A group the filter empties is dropped; the page says so instead (EMPTY_FILTER).
    expect(groupsFor(engineResults('visualArtist'), 'need')).toEqual([])
    expect(EMPTY_FILTER.need).toBe('Nothing needs you')
    expect(matchesFilter(null, 'need')).toBe(false)
    expect(matchesFilter(null, 'all')).toBe(true)
  })
  // A missing result keeps its row, with no result, and is never a pass.
  it('a test the run has no result for still has its row, with no result (never a pass)', () => {
    const rs = fixtureResults().filter((r) => r.id !== 'alt')
    const row = groupsFor(rs, 'all').flatMap((g) => g.rows).find((r) => r.def.id === 'alt')!
    expect(row.result).toBeNull()
    expect(groupsFor(rs, 'pass').flatMap((g) => g.rows).some((r) => r.def.id === 'alt')).toBe(false)
  })
})

describe('the headline: one helper for the Test tab and the Overview', () => {
  // Site didn't answer (timed out, or error 500): one sentence, never a score, no rows.
  it('CRITICAL: a site that didn\u2019t answer (timed out, or error 500) is ONE sentence, never a score', () => {
    for (const s of ['siteDown', 'site500'] as const) {
      const h = runHeadline({ results: engineResults(s), siteUrl: 'https://x.com' })
      expect(h.kind, s).toBe('unreachable')
      expect(h.title).toBe('We couldn’t reach your site')
      expect(headlineLine(h)).not.toMatch(/tests? pass|need/)
      expect(rowsAreResults(h)).toBe(false)
    }
  })
  // The run's own `reach` comes first, and each way of not answering has its own words.
  it('CRITICAL: the run\u2019s own `reach` is read FIRST: each way of not answering has its words', () => {
    const healthy = engineResults('healthy') // statuses that look fine: only `reach` can say otherwise
    const at = (state: 'no-answer' | 'server-error' | 'refused') => runHeadline({ results: healthy, siteUrl: 'https://x.com', reach: { state, status: state === 'server-error' ? 500 : state === 'refused' ? 403 : null } })
    expect(at('no-answer')).toEqual({ kind: 'unreachable', title: 'We couldn’t reach your site', detail: ['It may be down, so nothing else was checked'] })
    expect(at('server-error')).toEqual({ kind: 'unreachable', title: 'Your site answered with an error', detail: ['It may be down, so nothing else was checked'] })
    expect(at('refused')).toEqual({ kind: 'unreachable', title: 'Your site turned our visit away', detail: ['So nothing else could be checked'] })
  })
  // "Answered" wins over the statuses rule; an older run with no `reach` falls back to it; no site outranks all.
  it('CRITICAL: `reach` "answered" wins over the statuses rule; no `reach` (older run) falls back to it', () => {
    const down = engineResults('siteDown')
    expect(runHeadline({ results: down, siteUrl: 'https://x.com', reach: { state: 'answered', status: 200 } }).kind).not.toBe('unreachable')
    expect(runHeadline({ results: down, siteUrl: 'https://x.com', reach: null }).kind).toBe('unreachable')
    expect(runHeadline({ results: down, siteUrl: 'https://x.com' }).kind).toBe('unreachable')
    // No site outranks everything.
    expect(runHeadline({ results: down, siteUrl: '', reach: { state: 'no-answer', status: null } }).kind).toBe('no-site')
  })
  // A site that answered is never called unreachable, whatever else is wrong with it.
  it('CRITICAL: a site that answered is never called unreachable, whatever is wrong with it', () => {
    for (const s of SCENARIO_NAMES.filter((n) => n !== 'siteDown' && n !== 'site500')) expect(isUnreachable(engineResults(s)), s).toBe(false)
  })
  // The rule reads statuses only: rewording every sentence changes nothing.
  it('the rule reads statuses only: rewording every sentence and value changes nothing', () => {
    const reworded = (s: 'siteDown' | 'healthy') => engineResults(s).map((r) => ({ ...r, value: 'x', sentence: 'y', evidence: [] }))
    expect(isUnreachable(reworded('siteDown'))).toBe(true)
    expect(isUnreachable(reworded('healthy'))).toBe(false)
  })
  // The score: "N of M tests pass", never "All M", with need-you and couldn't-check beside it.
  it('CRITICAL: the score is "N of M tests pass" — never "All M" — with need-you and couldn\u2019t-check beside it', () => {
    for (const s of SCENARIO_NAMES) {
      const rs = engineResults(s)
      const h = runHeadline({ results: rs, siteUrl: 'https://x.com' })
      if (h.kind !== 'score') continue
      const c = countResults(rs)
      expect(h.title, s).toBe(`${c.pass} of ${c.applicable} tests pass`)
      expect(h.detail, s).toEqual([...(c.fail ? [`${c.fail} need${c.fail === 1 ? 's' : ''} you`] : []), ...(c.unknown ? [`${c.unknown} couldn’t be checked`] : [])])
      expect(headlineLine(h)).not.toMatch(/^All /)
    }
    // 23 pass + 1 couldn't check reads exactly as the brief asked.
    const oneUnknown = fixtureResults(Object.fromEntries(SEO_TEST_IDS.map((id) => [id, { status: id === 'bingwm' ? 'unknown' : 'pass' }])))
    expect(headlineLine(runHeadline({ results: oneUnknown, siteUrl: 'https://x.com' }))).toBe('23 of 24 tests pass · 1 couldn’t be checked')
  })
  // No site, none apply (0 of 0) and nothing checked each have their own words, never a score.
  it('no site, every test na (0 of 0), and nothing passed or failed each have their own words', () => {
    const rs = engineResults('healthy')
    expect(runHeadline({ results: rs, siteUrl: '' }).kind).toBe('no-site')
    expect(runHeadline({ results: rs.map((r) => ({ ...r, status: 'na' as const })), siteUrl: 'https://x.com' })).toMatchObject({ kind: 'none-apply', title: 'None of the tests apply to you' })
    const unchecked = rs.map((r) => ({ ...r, status: ['title', 'desc', 'card'].includes(r.id) ? ('na' as const) : ('unknown' as const) }))
    expect(runHeadline({ results: unchecked, siteUrl: 'https://x.com' }).kind).toBe('unchecked')
  })
})

describe('the words', () => {
  // Leads: each status has its own; a pass reads plain with a capital.
  it('each status has its lead; a pass reads plain and starts with a capital', () => {
    expect(leadOf({ status: 'fail' })).toBe('Not yet:')
    expect(leadOf({ status: 'fail', lead: 'Almost' })).toBe('Almost:')
    expect(leadOf({ status: 'unknown' })).toBe('Couldn’t check:')
    expect(leadOf({ status: 'na' })).toBe('Doesn’t apply:')
    expect(leadOf({ status: 'pass' })).toBeNull()
    expect(sentenceOf({ status: 'pass', sentence: 'your site answers.' })).toBe('Your site answers.')
    expect(sentenceOf({ status: 'fail', sentence: 'your bio is short.' })).toBe('your bio is short.')
  })
  // Times read in the manager's day: today, yesterday, or a date.
  it('times read in the manager’s day: today / yesterday / a date', () => {
    const now = new Date(2026, 8, 28, 22, 0)
    expect(whenText(new Date(2026, 8, 28, 21, 14).toISOString(), now, 'en-US')).toBe('today at 9:14 PM')
    expect(whenText(new Date(2026, 8, 27, 6, 0).toISOString(), now, 'en-US')).toBe('yesterday at 6:00 AM')
    expect(whenText(new Date(2026, 8, 21, 9, 14).toISOString(), now, 'en-US')).toBe('Sep 21 at 9:14 AM')
    expect(whenText(new Date(2025, 8, 21, 9, 14).toISOString(), now, 'en-US')).toBe('Sep 21, 2025 at 9:14 AM')
    expect(whenText('not a date', now)).toBe('')
    expect(dotText(new Date(2026, 8, 28, 21, 14).toISOString(), 'fail', now, 'en-US')).toBe('Today, 9:14 PM · needed you')
  })
})

describe('the run', () => {
  // Stale: a run that saw an old site, or a publish run that couldn't confirm the new one.
  it('stale: any run that saw an old site, and a publish run that could not confirm a new one', () => {
    expect(isStale({ siteFresh: false, trigger: 'manual' })).toBe(true)
    expect(isStale({ siteFresh: null, trigger: 'publish' })).toBe(true)
    expect(isStale({ siteFresh: true, trigger: 'publish' })).toBe(false)
    expect(isStale({ siteFresh: null, trigger: 'manual' })).toBe(false) // a manual run with no publish to compare
    expect(hasNoSite({ siteUrl: '' })).toBe(true)
    expect(hasNoSite({ siteUrl: 'https://x.com' })).toBe(false)
  })
  // "May not have updated" lasts an hour; a run over 30 days is called old; a moved site is noticed.
  it('"may not have updated" lasts an hour; a run over 30 days is called old; a moved site is noticed', () => {
    const at = Date.parse('2026-09-28T21:14:00.000Z')
    const run = { siteFresh: null, trigger: 'publish' as const, ranAt: new Date(at).toISOString() }
    expect(showStale(run, at + 10 * 60_000)).toBe(true)
    expect(showStale(run, at + 2 * 60 * 60_000)).toBe(false)
    expect(oldRunText(run.ranAt, at + 20 * 86_400_000)).toBeNull()
    expect(oldRunText(run.ranAt, at + 45 * 86_400_000)).toBe('6 weeks ago')
    expect(oldRunText(run.ranAt, at + 120 * 86_400_000)).toBe('4 months ago')
    expect(siteChanged('https://old.com', 'https://new.com')).toBe(true)
    expect(siteChanged('https://www.a.com', 'https://www.a.com/')).toBe(false)
    expect(siteChanged('', 'https://new.com')).toBe(false)
    expect(siteChanged('https://old.com', null)).toBe(false)
    expect(hostOf('https://www.skeenmusic.com/x')).toBe('www.skeenmusic.com')
  })
  // The cool-down: 60 s after the last run started, and a clock an hour behind never reads "3660 s".
  it('the cool-down opens 60 s after the last run started', () => {
    const at = '2026-09-28T21:14:00.000Z'
    expect(cooldownEnd(at)).toBe(Date.parse(at) + SEO_MANUAL_COOLDOWN_S * 1000)
    expect(cooldownEnd(null)).toBeNull()
    expect(secondsLeft(Date.parse(at) + 60_000, Date.parse(at) + 18_000)).toBe(42)
    expect(secondsLeft(Date.parse(at), Date.parse(at) + 5_000)).toBe(0)
    // A browser clock an hour behind the server's never reads "3660 s".
    expect(secondsLeft(Date.parse(at) + 60_000, Date.parse(at) - 60 * 60_000)).toBe(0)
  })
  // A refusal is read from its reason, never its words (and a silly wait is capped).
  it('CRITICAL: a refusal is read from its REASON, never its wording', () => {
    expect(classifyRunError({ error: 'Something new.', reason: 'busy' }).kind).toBe('busy')
    expect(classifyRunError({ error: 'Anything.', reason: 'cooldown', retryInS: 42 })).toEqual({ kind: 'cooldown', retryInS: 42 })
    expect(classifyRunError({ error: 'A test is already running.', reason: 'error' }).kind).toBe('failed')
    expect(classifyRunError({ error: 'x', reason: 'cooldown', retryInS: 5000 })).toEqual({ kind: 'cooldown', retryInS: SEO_MANUAL_COOLDOWN_S })
  })
  // An older server with no reason: told apart by its words.
  it('a refused run with no reason (an older server) is told apart by its words', () => {
    expect(classifyRunError({ error: 'Tested a moment ago. Try again in 42 seconds.', retryInS: 42 })).toEqual({ kind: 'cooldown', retryInS: 42 })
    expect(classifyRunError({ error: 'Tested a moment ago. Try again in 60 seconds.', retryInS: null })).toEqual({ kind: 'cooldown', retryInS: SEO_MANUAL_COOLDOWN_S })
    expect(classifyRunError({ error: 'A test is already running. It will show here when it finishes.' }).kind).toBe('busy')
    expect(classifyRunError({ error: 'Couldn’t start the test.' })).toEqual({ kind: 'failed', error: 'Couldn’t start the test.' })
  })
})

describe('where an action can go', () => {
  // Outside links: https or nothing (javascript:, http:, data:, protocol-relative all refused).
  it('CRITICAL: an outside link is https or nothing', () => {
    expect(safeHttps('https://musicbrainz.org/artist/create')).toBe('https://musicbrainz.org/artist/create')
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'http://example.com', 'data:text/html,<b>', '//evil.com', '', null, 42]) expect(safeHttps(bad), String(bad)).toBeNull()
  })
  // "Check it yourself" links: beside the test they check, all https, on the tested address.
  it('the "check it yourself" links sit beside the test they check, all https, on the tested address', () => {
    const links = checkItYourself('card', 'https://www.skeenmusic.com')
    expect(links.map((l) => l.label)).toEqual(['Google’s Rich Results Test', 'Schema.org validator'])
    for (const id of SEO_TEST_IDS) for (const l of checkItYourself(id, 'https://www.skeenmusic.com')) expect(safeHttps(l.href), `${id} ${l.label}`).toBe(l.href)
    expect(links[0].href).toContain(encodeURIComponent('https://www.skeenmusic.com/'))
    expect(checkItYourself('card', '')).toEqual([])
  })
  // Every pencil lands on a real SEO tab or dashboard route.
  it('every pencil target lands on a real SEO tab or a real dashboard route', () => {
    const tabs = SEO_SECTIONS.map((s) => seoTabSeg(s.seg))
    const tools = TOOLS.map((t) => t.seg)
    for (const target of Object.keys(SEO_EDIT_TARGETS) as (keyof typeof SEO_EDIT_TARGETS)[]) {
      const path = SEO_EDIT_TARGETS[target].split('#')[0]
      expect(tabs.includes(path) || tools.includes(path) || ['tour', 'music'].includes(path), target).toBe(true)
      expect(editHref('a1', target)).toBe(`/artists/a1/${SEO_EDIT_TARGETS[target]}`)
    }
  })
})

/** A query builder that answers every chain with `result`. */
function fake(result: { data: unknown; error: { code?: string; message?: string } | null }): SupabaseClient {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']) chain[m] = () => chain
  chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad)
  return { from: () => chain } as unknown as SupabaseClient
}

describe('reading the tab: "not switched on" vs "couldn\'t read" vs "never tested"', () => {
  // "No such table": PostgREST's and Postgres's words for it, and nothing else (a denied read is not "off").
  it('knows PostgREST’s and Postgres’s "no such table", and nothing else', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.seo_test_runs' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42P01', message: 'relation "public.seo_test_runs" does not exist' })).toBe(true)
    expect(isMissingTable({ message: "seo_test_runs: Could not find the table 'public.seo_test_runs' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42501', message: 'permission denied for table seo_test_runs' })).toBe(false)
    expect(isMissingTable({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })

  // The table missing (the migration isn't pushed) is "off"; a denied read is "error"; an empty table is "never tested".
  it('CRITICAL: the table missing is "off", a denied or broken read is "error", an empty table is "never tested"', async () => {
    expect(await loadTestTab(fake({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }), 'a1')).toEqual({ state: 'off' })
    expect(await loadTestTab(fake({ data: null, error: { code: '42501', message: 'permission denied' } }), 'a1')).toEqual({ state: 'error' })
    const ok = await loadTestTab(fake({ data: null, error: null }), 'a1')
    expect(ok.state).toBe('ready')
    expect(ok.state === 'ready' && ok.latest).toBeNull()
  })
})
