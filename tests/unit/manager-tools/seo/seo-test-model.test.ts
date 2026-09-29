// The Test tab's counts, words and hrefs: every number the manager reads comes from here.
/**
 * STRICT tier (AGENTS.md): the counts ("19 of 24", "5 need you") and the hrefs a stored result
 * can reach are what this file pins. Fixtures derive from SEO_TEST_IDS / SEO_TEST_DEFS /
 * SEO_TEST_GROUPS, never a hand-list of tests.
 */
import { describe, expect, it } from 'vitest'
import { SEO_TEST_DEFS, SEO_TEST_GROUPS } from '@/lib/seo-tests/defs'
import { SEO_MANUAL_COOLDOWN_S } from '@/lib/seo-tests/store'
import { SEO_TEST_IDS, type SeoTestResult } from '@/lib/seo-tests/types'
import {
  classifyRunError,
  cooldownEnd,
  countResults,
  dotText,
  editHref,
  groupsFor,
  hasNoSite,
  isStale,
  leadOf,
  matchesFilter,
  safeHttps,
  secondsLeft,
  sentenceOf,
  whenText,
} from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/test/model'
import { SEO_EDIT_TARGETS, SEO_SECTIONS, seoTabSeg } from '@/app/artists/[id]/(dashboard)/(manager-tools)/tools/seo/sections'
import { TOOLS } from '@/app/artists/[id]/(dashboard)/(manager-tools)/_shell/tools-registry'
import { fixtureResults } from '@tests/components/manager-tools/seo/seo-run-fixture'

describe('counts', () => {
  it('CRITICAL: `na` is left out of BOTH sides of "N of M"; `unknown` is not a pass and not a fail', () => {
    const rs = fixtureResults({ genre: { status: 'na' }, card: { status: 'unknown' }, shows: { status: 'na' } })
    const c = countResults(rs)
    const by = (s: string) => rs.filter((r) => r.status === s).length
    expect(c.na).toBe(2)
    expect(c.unknown).toBe(1)
    expect(c.pass).toBe(by('pass'))
    expect(c.fail).toBe(by('fail'))
    expect(c.applicable).toBe(SEO_TEST_IDS.length - 2) // 22, not 24
    expect(c.pass + c.fail + c.unknown).toBe(c.applicable)
  })
  it('an unrecognised status counts nowhere (a malformed stored result is not a pass)', () => {
    const rs = [{ id: 'google', status: 'maybe', value: '', sentence: '', evidence: [] } as unknown as SeoTestResult]
    expect(countResults(rs)).toEqual({ pass: 0, fail: 0, unknown: 0, na: 0, applicable: 0 })
  })
})

describe('groups and the filter', () => {
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
  it('"Needs you" is exactly the fails, "Passing" exactly the passes; a group left empty is dropped', () => {
    const rs = fixtureResults({ card: { status: 'unknown' } })
    const ids = (f: 'need' | 'pass') => groupsFor(rs, f).flatMap((g) => g.rows.map((r) => r.def.id))
    expect(ids('need').sort()).toEqual(rs.filter((r) => r.status === 'fail').map((r) => r.id).sort())
    expect(ids('pass').sort()).toEqual(rs.filter((r) => r.status === 'pass').map((r) => r.id).sort())
    // "Looks right when shared" has no fails in the fixture: gone from Needs you.
    expect(groupsFor(rs, 'need').some((g) => g.id === 'shared')).toBe(false)
    expect(matchesFilter(null, 'need')).toBe(false)
    expect(matchesFilter(null, 'all')).toBe(true)
  })
  it('a test the run has no result for still has its row, with no result (never a pass)', () => {
    const rs = fixtureResults().filter((r) => r.id !== 'alt')
    const row = groupsFor(rs, 'all').flatMap((g) => g.rows).find((r) => r.def.id === 'alt')!
    expect(row.result).toBeNull()
    expect(groupsFor(rs, 'pass').flatMap((g) => g.rows).some((r) => r.def.id === 'alt')).toBe(false)
  })
})

describe('the words', () => {
  it('each status has its lead; a pass reads plain and starts with a capital', () => {
    expect(leadOf({ status: 'fail' })).toBe('Not yet:')
    expect(leadOf({ status: 'fail', lead: 'Almost' })).toBe('Almost:')
    expect(leadOf({ status: 'unknown' })).toBe('Couldn’t check:')
    expect(leadOf({ status: 'na' })).toBe('Doesn’t apply:')
    expect(leadOf({ status: 'pass' })).toBeNull()
    expect(sentenceOf({ status: 'pass', sentence: 'your site answers.' })).toBe('Your site answers.')
    expect(sentenceOf({ status: 'fail', sentence: 'your bio is short.' })).toBe('your bio is short.')
  })
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
  it('stale: any run that saw an old site, and a publish run that could not confirm a new one', () => {
    expect(isStale({ siteFresh: false, trigger: 'manual' })).toBe(true)
    expect(isStale({ siteFresh: null, trigger: 'publish' })).toBe(true)
    expect(isStale({ siteFresh: true, trigger: 'publish' })).toBe(false)
    expect(isStale({ siteFresh: null, trigger: 'manual' })).toBe(false) // a manual run with no publish to compare
    expect(hasNoSite({ siteUrl: '' })).toBe(true)
    expect(hasNoSite({ siteUrl: 'https://x.com' })).toBe(false)
  })
  it('the cool-down opens 60 s after the last run started', () => {
    const at = '2026-09-28T21:14:00.000Z'
    expect(cooldownEnd(at)).toBe(Date.parse(at) + SEO_MANUAL_COOLDOWN_S * 1000)
    expect(cooldownEnd(null)).toBeNull()
    expect(secondsLeft(Date.parse(at) + 60_000, Date.parse(at) + 18_000)).toBe(42)
    expect(secondsLeft(Date.parse(at), Date.parse(at) + 5_000)).toBe(0)
  })
  it('a refused run is told apart: cool-down, already running, failed', () => {
    expect(classifyRunError({ error: 'Tested a moment ago. Try again in 42 seconds.', retryInS: 42 })).toEqual({ kind: 'cooldown', retryInS: 42 })
    expect(classifyRunError({ error: 'Tested a moment ago. Try again in 60 seconds.', retryInS: null })).toEqual({ kind: 'cooldown', retryInS: SEO_MANUAL_COOLDOWN_S })
    expect(classifyRunError({ error: 'A test is already running. It will show here when it finishes.' }).kind).toBe('busy')
    expect(classifyRunError({ error: 'Couldn’t start the test.' })).toEqual({ kind: 'failed', error: 'Couldn’t start the test.' })
  })
})

describe('where an action can go', () => {
  it('CRITICAL: an outside link is https or nothing', () => {
    expect(safeHttps('https://musicbrainz.org/artist/create')).toBe('https://musicbrainz.org/artist/create')
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'http://example.com', 'data:text/html,<b>', '//evil.com', '', null, 42]) expect(safeHttps(bad), String(bad)).toBeNull()
  })
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
