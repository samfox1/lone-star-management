// The PostHog cross-check's JUDGE (`npm run compare:posthog`). Pure: rows from both
// pipelines in, a report and an exit code out. The script around it is plumbing.
//
// What the judge must never do is call two numbers "agreeing" for the wrong reason, so the
// rules pinned here are the ones that separate a real accuracy bug from a known artifact:
//   • views are independent, so only their RATIO's stability is judged, and thin days are
//     "low n", neither a pass nor a failure;
//   • clicks are mirrored, so a click PostHog kept and we lack is a door drop (gated at 1%),
//     while one we kept and PostHog lacks is an ad blocker (reported, never gated);
//   • visitors are not the same unit on the two sides and never produce a ratio;
//   • no data on either side is exit 2, never a table of zeros that reads like agreement.
//
// Fixtures are typed with the REAL reader row types (src/lib/analytics.ts) and shaped like
// the real HogQL response ({ columns, results }), so a renamed column fails to compile or
// fails here, rather than agreeing with a copy of the implementation.
import { beforeEach, describe, expect, it } from 'vitest'
import type { PlaceRow, SourceRow, TimelineDay } from '@/lib/analytics'
import { EVENT_TYPES } from '@/lib/events'
import {
  COMPARED_CLICK_TYPES,
  HOGQL_COLUMNS,
  LIMITS,
  QUERY_LIMIT,
  compare,
  comparisonWindow,
  exitCode,
  formatReport,
  hogqlQueries,
  normalizeHost,
  oursSide,
  parseHogQL,
  posthogSide,
  rankCorrelation,
  type HogQLRows,
  type OursRaw,
  type Window,
} from '@/lib/compare-posthog'

// MUTATION SURVIVORS, 2026-09-17, all equivalent — checked one at a time, not waved past.
// `npx stryker run --mutate src/lib/compare-posthog.ts` leaves these two, and a NEW survivor
// is something that is not on this list:
//   • `dayRatio === null ||` → `false ||` in compare()'s outlier test: dayRatio is null only
//     when ours is 0, and then `Math.abs(null - ratio)` is `ratio`, which is always more than
//     25% of `ratio` once `!ratio` has ruled out zero. Same verdict either way; the explicit
//     check stays because it is the readable statement of the rule.
//   • `values.map(() => 0)` → `() => undefined` in ranks(): the loop below writes every
//     index before anything reads it, so the initial value is never observed.
// Two earlier "survivors" were a harness artefact worth knowing about: a fixture computed at
// module or describe load (`const W = comparisonWindow(…)`) throws under a mutant, the FILE
// fails to load, no single test fails, and Stryker calls the mutant survived. Fixtures here
// are literals, and anything computed is computed inside a test.

/* ── Fixture builders ───────────────────────────────────────────────────────────── */

// 2026-09-17 12:00 UTC. The window is the 3 complete UTC days before today. Written out
// literally, NOT computed at load: a module-level call that throws fails the whole file with
// no failing test, which Stryker then reports as a survivor.
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0)
const W: Window = { since: '2026-09-14', until: '2026-09-16', days: ['2026-09-14', '2026-09-15', '2026-09-16'] }
const [D1, D2, D3] = W.days

type TypeRow = { day: string; type: string; count: number } // analytics_type_timeline
type EntityRow = { entity_type: string; entity_id: string; type: string; count: number } // analytics_by_entity

/** A real HogQL response: column names plus positional rows. */
function hogql(name: keyof typeof HOGQL_COLUMNS, rows: unknown[][]): unknown {
  return { columns: [...HOGQL_COLUMNS[name]], results: rows, is_cached: false }
}

function ours(p: Partial<OursRaw> = {}): OursRaw {
  return { timeline: [], typeTimeline: [], sources: [], places: [], entities: [], ...p }
}

/** Timeline + the type timeline's `view` rows agreeing with it, as the readers do. */
function oursViews(views: Record<string, number>, extra: Partial<OursRaw> = {}): OursRaw {
  const timeline: TimelineDay[] = Object.entries(views).map(([day, v]) => ({ day, views: v, visitors: Math.ceil(v / 2), bots: 1 }))
  const typeTimeline: TypeRow[] = Object.entries(views).map(([day, v]) => ({ day, type: 'view', count: v }))
  return ours({ timeline, typeTimeline, ...extra, ...(extra.typeTimeline ? { typeTimeline: [...typeTimeline, ...extra.typeTimeline] } : {}) })
}

type PhRaw = Partial<Record<keyof typeof HOGQL_COLUMNS, unknown[][]>>
function ph(p: PhRaw = {}, botsAvailable = true) {
  const parsed = {} as Record<keyof typeof HOGQL_COLUMNS, HogQLRows>
  for (const name of Object.keys(HOGQL_COLUMNS) as (keyof typeof HOGQL_COLUMNS)[]) {
    parsed[name] = parseHogQL(hogql(name, p[name] ?? []), name)
  }
  return posthogSide(parsed, W, botsAvailable)
}
/** PostHog daily rows: [day, event, n, bots]. */
const phViews = (views: Record<string, number>): unknown[][] => Object.entries(views).map(([day, n]) => [day, '$pageview', n, 0])

/* ── The click-type list comes from the registry ────────────────────────────────── */

describe('compared click types', () => {
  it('are every event type in src/lib/events.ts except view, derived rather than listed', () => {
    const expected = EVENT_TYPES.map((e) => e.type).filter((t) => t !== 'view')
    expect([...COMPARED_CLICK_TYPES]).toEqual(expected)
    expect(COMPARED_CLICK_TYPES).not.toContain('view')
  })
})

/* ── The window ─────────────────────────────────────────────────────────────────── */

describe('comparisonWindow', () => {
  it('is N complete UTC days ending YESTERDAY: today is partial on both sides and excluded', () => {
    expect(comparisonWindow(3, NOW)).toEqual({ since: '2026-09-14', until: '2026-09-16', days: ['2026-09-14', '2026-09-15', '2026-09-16'] })
  })

  it('reads the day in UTC, not the machine timezone, one second either side of midnight', () => {
    expect(comparisonWindow(1, Date.UTC(2026, 8, 17, 0, 0, 1)).until).toBe('2026-09-16')
    expect(comparisonWindow(1, Date.UTC(2026, 8, 16, 23, 59, 59)).until).toBe('2026-09-15')
  })

  it('accepts 1..30 whole days and refuses anything else', () => {
    expect(comparisonWindow(30, NOW).days).toHaveLength(30)
    expect(comparisonWindow(1, NOW).days).toEqual(['2026-09-16'])
    for (const bad of [0, 31, 2.5, NaN]) expect(() => comparisonWindow(bad, NOW)).toThrow(/1 and 30/)
  })
})

/* ── HogQL: what we ask PostHog ─────────────────────────────────────────────────── */

describe('hogqlQueries', () => {
  // Built per test, not at collection time (see the note on W above).
  let q: ReturnType<typeof hogqlQueries>
  beforeEach(() => {
    q = hogqlQueries('skeen', W, true)
  })

  it('filters every query on the site property, never on a $host value', () => {
    // Comparing $host with $referring_domain (the landing rule below) is not a host filter.
    for (const sql of Object.values(q)) {
      expect(sql).toContain("properties.site = 'skeen'")
      const where = sql.slice(sql.indexOf('WHERE'))
      expect(where).not.toMatch(/\$host\s*(=|IN\b)/)
    }
  })

  it('CRITICAL: a PostHog page view counts only as a LANDING, by PostHog\'s own referring domain', () => {
    // A view is landing on the site (Sam, 2026-09-17). Our side drops same-site page loads
    // in the browser; PostHog captures every load, so the query drops them here, from the
    // `$referring_domain` PostHog stamped itself. `www.` ignored on both sides of the test.
    const landed =
      "replaceRegexpOne(lower(ifNull(properties.$referring_domain, '')), '^www\\\\.', '') != " +
      "replaceRegexpOne(lower(ifNull(properties.$host, '')), '^www\\\\.', '')"
    expect(q.daily).toContain(`(event != '$pageview' OR ${landed})`)
    for (const name of ['referrers', 'countries'] as const) expect(q[name]).toContain(`event = '$pageview' AND ${landed}`)
    // Hosts must see EVERY page view: it is how same-site referrers are recognised at all.
    expect(q.hosts).not.toContain('$referring_domain')
  })

  it('bounds the range with explicit-UTC datetimes and buckets days in UTC', () => {
    expect(q.daily).toContain("timestamp >= toDateTime('2026-09-14 00:00:00', 'UTC')")
    expect(q.daily).toContain("timestamp < toDateTime('2026-09-17 00:00:00', 'UTC')")
    expect(q.daily).toContain("toDate(toTimeZone(timestamp, 'UTC'))")
    for (const name of ['referrers', 'hosts', 'countries'] as const) {
      expect(q[name]).toContain("timestamp < toDateTime('2026-09-17 00:00:00', 'UTC')")
    }
  })

  it('reads entity clicks from the window start with NO upper bound, like analytics_by_entity', () => {
    expect(q.entities).toContain("timestamp >= toDateTime('2026-09-14 00:00:00', 'UTC')")
    expect(q.entities).not.toContain('timestamp <')
  })

  it('passes an explicit LIMIT on every query (the default is 100 rows)', () => {
    for (const sql of Object.values(q)) expect(sql).toMatch(new RegExp(`LIMIT ${QUERY_LIMIT}\\s*$`))
  })

  it('asks for $pageview plus exactly the derived click types', () => {
    const list = ['$pageview', ...COMPARED_CLICK_TYPES].map((t) => `'${t}'`).join(', ')
    expect(q.daily).toContain(`event IN (${list})`)
    expect(q.entities).toContain(`event IN (${COMPARED_CLICK_TYPES.map((t) => `'${t}'`).join(', ')})`)
  })

  it('names each column with the alias the reader uses', () => {
    for (const [name, cols] of Object.entries(HOGQL_COLUMNS)) {
      for (const c of cols) expect(q[name as keyof typeof q]).toContain(`AS ${c}`)
    }
  })

  it('uses $virt_is_bot (dot form) only when it is available', () => {
    expect(q.daily).toContain('countIf(ifNull(properties.$virt_is_bot, false)) AS bots')
    for (const name of ['referrers', 'countries', 'entities'] as const) {
      expect(q[name]).toContain(' AND NOT ifNull(properties.$virt_is_bot, false) GROUP BY')
    }
    const without = hogqlQueries('skeen', W, false)
    for (const sql of Object.values(without)) expect(sql).not.toContain('$virt_is_bot')
    // Without it, the column is still there (as a constant) and the filters close up cleanly.
    expect(without.daily).toContain('count() AS n, 0 AS bots FROM')
    expect(without.referrers).toMatch(/'\^www\\\\\.', ''\) GROUP BY domain/)
    expect(without.countries).toMatch(/'\^www\\\\\.', ''\) GROUP BY country/)
    expect(without.entities).toContain('IS NOT NULL GROUP BY')
  })

  it('counts only page views for referrers, hosts and countries', () => {
    for (const name of ['referrers', 'hosts', 'countries'] as const) expect(q[name]).toContain("AND event = '$pageview'")
    expect(q.hosts).toMatch(/AND event = '\$pageview' GROUP BY host/)
  })

  it('refuses a slug that could break out of the string literal', () => {
    for (const bad of ["x' OR 1=1 --", 'Skeen', '', 'a b', "a\\'"]) {
      expect(() => hogqlQueries(bad, W, true)).toThrow(/slug/)
    }
    expect(() => hogqlQueries('skeen-music-2', W, true)).not.toThrow()
  })
})

describe('parseHogQL', () => {
  it('turns positional rows into records keyed by the returned column names', () => {
    const rows = parseHogQL({ columns: [...HOGQL_COLUMNS.daily], results: [['2026-09-14', 'play', 3, 0]] }, 'daily')
    expect(rows).toEqual([Object.fromEntries(HOGQL_COLUMNS.daily.map((c, i) => [c, ['2026-09-14', 'play', 3, 0][i]]))])
  })

  it("throws, naming the query and passing on PostHog's detail, when the response has no results array", () => {
    expect(() => parseHogQL({ columns: [...HOGQL_COLUMNS.daily], detail: 'Permission denied' }, 'daily')).toThrow(
      'PostHog daily: no results in the response (Permission denied)',
    )
    expect(() => parseHogQL(null, 'hosts')).toThrow('PostHog hosts: no results in the response')
    expect(() => parseHogQL(null, 'hosts')).toThrow(/^PostHog hosts: no results in the response$/)
  })

  it('throws when the returned columns are not the ones asked for', () => {
    expect(() => parseHogQL({ columns: ['day', 'n'], results: [] }, 'daily')).toThrow('expected columns day,ev,n,bots, got day,n')
  })

  it('throws when the result hit the LIMIT, because a truncated count is a wrong count', () => {
    const full = Array.from({ length: QUERY_LIMIT }, () => ['a.com', 1])
    expect(() => parseHogQL({ columns: [...HOGQL_COLUMNS.referrers], results: full }, 'referrers')).toThrow(/truncat/i)
    expect(() => parseHogQL({ columns: [...HOGQL_COLUMNS.referrers], results: full.slice(1) }, 'referrers')).not.toThrow()
  })
})

describe('posthogSide', () => {
  it('refuses a day outside the window: that is a timezone shift, not data', () => {
    expect(() => ph({ daily: [['2026-09-17', '$pageview', 5, 0]] })).toThrow(/outside.*window/i)
    expect(() => ph({ daily: [['2026-09-13', 'play', 5, 0]] })).toThrow(/outside.*window/i)
  })

  it('subtracts PostHog-flagged bots from human counts and keeps them as its own column', () => {
    const side = ph({ daily: [[D1, '$pageview', 40, 4], [D1, 'play', 5, 1]] })
    expect(side.views.get(D1)).toBe(36)
    expect(side.clicks.get(`${D1}|play`)).toBe(4)
    expect(side.bots?.get(D1)).toBe(5)
  })

  it('has NO bot column when $virt_is_bot is unavailable, rather than a column of zeros', () => {
    const side = ph({ daily: [[D1, '$pageview', 40, 0]] }, false)
    expect(side.bots).toBeNull()
    expect(side.views.get(D1)).toBe(40)
  })
})

/* ── Referrer hosts ─────────────────────────────────────────────────────────────── */

describe('normalizeHost', () => {
  it('strips www., a port and a trailing dot, and lower-cases, like the door does', () => {
    expect(normalizeHost('WWW.Instagram.com')).toBe('instagram.com')
    expect(normalizeHost('skeenmusic.com:443')).toBe('skeenmusic.com')
    expect(normalizeHost('google.com.')).toBe('google.com')
  })

  it("maps PostHog's $direct and empty values to no host", () => {
    for (const v of ['$direct', '', null, undefined]) expect(normalizeHost(v)).toBe('')
  })
})

/* ── The comparison ─────────────────────────────────────────────────────────────── */

describe('views: ratio stability, not equality', () => {
  it('computes r over the window, flags a day outside ±25% of r, and passes one exactly at the edge', () => {
    // Σours = 1600, Σph = 800 → r = 0.5. Band is [0.375, 0.625], both edges exact in binary.
    const o = oursViews({ [D1]: 400, [D2]: 800, [D3]: 400 })
    const p = ph({ daily: phViews({ [D1]: 250, [D2]: 300, [D3]: 250 }) })
    const r = compare(oursSide(o), p, W)
    expect(r.views.ratio).toBe(0.5)
    const byDay = Object.fromEntries(r.views.days.map((d) => [d.day, d]))
    expect(byDay[D1]).toMatchObject({ ours: 400, ph: 250, dayRatio: 0.625, status: 'ok' })
    expect(byDay[D2]).toMatchObject({ dayRatio: 0.375, status: 'ok' })
    expect(r.criteria.find((c) => c.name === 'views')?.pass).toBe(true)
  })

  it('fails a day just past the band on either side', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100 })
    // Σph = 100 over Σours 200 → r = 0.5; D1 0.64 is high, D2 0.36 is low.
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 64, [D2]: 36 }) }), W)
    expect(r.views.days.filter((d) => d.status === 'outlier').map((d) => d.day)).toEqual([D1, D2])
    expect(r.criteria.find((c) => c.name === 'views')?.pass).toBe(false)
    expect(exitCode(r)).toBe(1)
  })

  it('labels a day below 30 on the LARGER side "low n": never a pass, never a failure', () => {
    // D2's ratio is wildly off, but 29 is below the gate on both sides.
    const o = oursViews({ [D1]: 300, [D2]: 29 })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 150, [D2]: 2 }) }), W)
    const d2 = r.views.days.find((d) => d.day === D2)!
    expect(d2.status).toBe('low-n')
    expect(r.criteria.find((c) => c.name === 'views')?.pass).toBe(true)
    // The larger side decides: 30 on PostHog's side is enough to judge.
    const r2 = compare(oursSide(oursViews({ [D1]: 300, [D2]: 5 })), ph({ daily: phViews({ [D1]: 150, [D2]: 30 }) }), W)
    expect(r2.views.days.find((d) => d.day === D2)!.status).toBe('outlier')
  })

  it('judges a day we recorded nothing on but PostHog saw 30+ as an outlier, not a divide-by-zero pass', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: phViews({ [D1]: 80, [D2]: 40 }) }), W)
    const d2 = r.views.days.find((d) => d.day === D2)!
    expect(d2.dayRatio).toBeNull()
    expect(d2.status).toBe('outlier')
  })

  it('fails every judged day when PostHog has clicks but no page views at all (r = 0)', () => {
    const o = oursViews({ [D1]: 100 })
    const r = compare(oursSide(o), ph({ daily: [[D1, 'play', 1, 0]] }), W)
    expect(r.views.ratio).toBe(0)
    expect(r.views.days.find((d) => d.day === D1)!.status).toBe('outlier')
  })

  it('covers every day of the window, quiet days included', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: phViews({ [D1]: 100 }) }), W)
    expect(r.views.days.map((d) => d.day)).toEqual(W.days)
    expect(r.views.days.find((d) => d.day === D3)).toMatchObject({ ours: 0, ph: 0, status: 'low-n' })
  })
})

describe('no gate passes with nothing compared', () => {
  // A 2026-09-17 review: low-n days are "never a failure", so a window where EVERY day was
  // low-n passed the views gate at any ratio, PostHog at zero included; and a PostHog-only
  // RATE of 0/0 read as 0%, so a mirror whose clicks never arrived passed both click gates.

  it('CRITICAL: views are NOT judged when too few days clear the low-n gate', () => {
    // 20 a day on our side, nothing from PostHog's page views: every day is low-n.
    const o = oursViews({ [D1]: 20, [D2]: 20, [D3]: 20 })
    const r = compare(oursSide(o), ph({ daily: [[D1, 'play', 1, 0]] }), W)
    const judged = r.criteria.find((c) => c.name === 'judged')
    expect(judged?.pass).toBe(false)
    expect(exitCode(r)).toBe(1)
  })

  it('the judged-days floor is a week, or the whole window when it is shorter', () => {
    // A 3-day window with all 3 judged clears it; 2 of 3 does not.
    const all = compare(oursSide(oursViews({ [D1]: 100, [D2]: 100, [D3]: 100 })), ph({ daily: phViews({ [D1]: 80, [D2]: 80, [D3]: 80 }) }), W)
    expect(all.criteria.find((c) => c.name === 'judged')?.pass).toBe(true)
    const two = compare(oursSide(oursViews({ [D1]: 100, [D2]: 100, [D3]: 5 })), ph({ daily: phViews({ [D1]: 80, [D2]: 80, [D3]: 4 }) }), W)
    expect(two.criteria.find((c) => c.name === 'judged')?.pass).toBe(false)
    expect(LIMITS.minJudgedDays).toBe(7)
  })

  it('CRITICAL: clicks we recorded that PostHog never saw at all fail, instead of reading 0%', () => {
    const o = oursViews({ [D1]: 100 }, { typeTimeline: [{ day: D1, type: 'ticket_click', count: 40 }] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 80 }) }), W)
    expect(r.criteria.find((c) => c.name === 'clicks')?.pass).toBe(false)
    expect(exitCode(r)).toBe(1)
  })

  it('no clicks on either side is not a click failure', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: phViews({ [D1]: 80 }) }), W)
    expect(r.criteria.find((c) => c.name === 'clicks')?.pass).toBe(true)
    expect(r.criteria.find((c) => c.name === 'entities')?.pass).toBe(true)
  })

  it('CRITICAL: the same holds per entity', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const o = oursViews({ [D1]: 100 }, { entities: [{ entity_type: 'tour_date', entity_id: id, type: 'ticket_click', count: 40 }] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 80 }) }), W)
    expect(r.criteria.find((c) => c.name === 'entities')?.pass).toBe(false)
  })
})

describe('clicks: mirrored, so compared tightly', () => {
  const clicks = (rows: [string, string, number][]): TypeRow[] => rows.map(([day, type, count]) => ({ day, type, count }))

  it('splits PostHog-only (door drop) from ours-only (ad blocker) per (day, type), without netting', () => {
    const o = oursViews({ [D1]: 100 }, { typeTimeline: clicks([[D1, 'play', 100], [D1, 'buy_click', 10]]) })
    // play: PostHog 99 (1 ours-only). buy_click: PostHog 12 (2 PostHog-only). They must not cancel.
    const p = ph({ daily: [...phViews({ [D1]: 100 }), [D1, 'play', 99, 0], [D1, 'buy_click', 12, 0]] })
    const r = compare(oursSide(o), p, W)
    expect(r.clicks).toMatchObject({ phTotal: 111, oursTotal: 110, phOnly: 2, oursOnly: 1 })
    expect(r.clicks.phOnlyRate).toBeCloseTo(2 / 111)
    expect(r.clicks.oursOnlyRate).toBeCloseTo(1 / 110)
  })

  it('gates PostHog-only at 1%: exactly 1% passes, just over fails', () => {
    const at = (phOnly: number) => {
      const o = oursViews({ [D1]: 100 }, { typeTimeline: clicks([[D1, 'link_click', 100 - phOnly]]) })
      return compare(oursSide(o), ph({ daily: [...phViews({ [D1]: 100 }), [D1, 'link_click', 100, 0]] }), W)
    }
    expect(at(1).criteria.find((c) => c.name === 'clicks')?.pass).toBe(true)
    expect(at(2).criteria.find((c) => c.name === 'clicks')?.pass).toBe(false)
    expect(exitCode(at(2))).toBe(1)
  })

  it('never gates on ours-only, however large', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100, [D3]: 100 }, { typeTimeline: clicks([[D1, 'ticket_click', 100]]) })
    const r = compare(oursSide(o), ph({ daily: [...phViews({ [D1]: 100, [D2]: 100, [D3]: 100 }), [D1, 'ticket_click', 50, 0]] }), W)
    expect(r.clicks.oursOnlyRate).toBe(0.5)
    expect(r.criteria.find((c) => c.name === 'clicks')?.pass).toBe(true)
    expect(exitCode(r)).toBe(0)
  })

  it('matches on the same (day, type) only: a click on another day is not a match', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100 }, { typeTimeline: clicks([[D1, 'video_click', 5]]) })
    const r = compare(oursSide(o), ph({ daily: [...phViews({ [D1]: 100, [D2]: 100 }), [D2, 'video_click', 5, 0]] }), W)
    expect(r.clicks).toMatchObject({ phOnly: 5, oursOnly: 5 })
  })

  it('ignores event types that are not compared clicks (a stray custom event is not a door drop)', () => {
    const o = oursViews({ [D1]: 100 })
    const r = compare(oursSide(o), ph({ daily: [...phViews({ [D1]: 100 }), [D1, '$autocapture', 50, 0]] }), W)
    expect(r.clicks.phTotal).toBe(0)
  })

  it('matches on entity id too, case-insensitively, and gates PostHog-only entities at 1%', () => {
    const id = 'AAAAAAAA-1111-2222-3333-444444444444'
    const entities: EntityRow[] = [
      { entity_type: 'release', entity_id: id.toLowerCase(), type: 'play', count: 50 },
      { entity_type: 'tour_date', entity_id: 'bbbbbbbb-1111-2222-3333-444444444444', type: 'ticket_click', count: 3 },
      { entity_type: 'release', entity_id: id.toLowerCase(), type: 'view', count: 999 }, // not a click: ignored
    ]
    const o = oursViews({ [D1]: 100 }, { entities })
    // PostHog: same play total but a DIFFERENT id for 5 of them, and the ticket clicks exactly.
    const p = ph({
      daily: phViews({ [D1]: 100 }),
      entities: [['play', id, 45], ['play', 'cccccccc-1111-2222-3333-444444444444', 5], ['ticket_click', 'bbbbbbbb-1111-2222-3333-444444444444', 3]],
    })
    const r = compare(oursSide(o), p, W)
    expect(r.clicks.entity).toMatchObject({ phTotal: 53, oursTotal: 53, phOnly: 5, oursOnly: 5 })
    expect(r.criteria.find((c) => c.name === 'entities')?.pass).toBe(false)
  })
})

describe('internal consistency: byType.view against the timeline', () => {
  it('passes when every day agrees, a missing row counting as zero on both readers', () => {
    const o = ours({ timeline: [{ day: D1, views: 0, visitors: 0, bots: 3 }], typeTimeline: [] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 1 }) }), W)
    expect(r.consistency.ok).toBe(true)
  })

  it('fails, naming the day, when the two readers disagree', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100 })
    o.typeTimeline = o.typeTimeline.map((t) => (t.day === D2 ? { ...t, count: 99 } : t))
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100, [D2]: 100 }) }), W)
    expect(r.consistency.mismatches).toEqual([{ day: D2, views: 100, typeView: 99 }])
    expect(r.criteria.find((c) => c.name === 'consistency')?.pass).toBe(false)
    expect(exitCode(r)).toBe(1)
  })
})

describe('visitors: not comparable', () => {
  it('reports ours for reference and never produces a ratio, whatever PostHog holds', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: phViews({ [D1]: 100 }) }), W)
    expect(r.visitors.comparable).toBe(false)
    expect(Object.keys(r.visitors).sort()).toEqual(['comparable', 'ours', 'reason'])
    expect(r.visitors.ours.find((v) => v.day === D1)?.visitors).toBe(50)
    expect(JSON.stringify(r)).not.toMatch(/visitor[a-z]*ratio|ratio[a-z]*visitor/i)
    expect(formatReport(r)).toMatch(/visitors.*not comparable/i)
  })
})

describe('sources', () => {
  const src = (referrer_host: string, views: number, source = 'other'): SourceRow => ({ source, referrer_host, views, visitors: 1 })

  it("strips PostHog's www., drops $direct and the site's own hosts, and joins on the host", () => {
    const o = oursViews({ [D1]: 100 }, { sources: [src('instagram.com', 20, 'instagram'), src('', 70, 'direct'), src('google.com', 10, 'google')] })
    const p = ph({
      daily: phViews({ [D1]: 100 }),
      hosts: [['www.skeenmusic.com', 90]],
      referrers: [['www.instagram.com', 18], ['$direct', 40], ['www.skeenmusic.com', 30], ['skeenmusic.com', 2], ['google.com', 9]],
    })
    const r = compare(oursSide(o), p, W)
    expect(r.sources.rows).toEqual([
      { host: 'instagram.com', ours: 20, ph: 18, flag: null },
      { host: 'google.com', ours: 10, ph: 9, flag: null },
    ])
    expect(r.sources.droppedSameSite).toEqual(['skeenmusic.com'])
    expect(r.criteria.find((c) => c.name === 'sources')?.pass).toBe(true)
  })

  it('treats a subdomain relation as same-site, like the door, derived from the hosts in the data', () => {
    const p = ph({ daily: phViews({ [D1]: 100 }), hosts: [['skeenmusic.com', 1]], referrers: [['shop.skeenmusic.com', 50]] })
    const r = compare(oursSide(oursViews({ [D1]: 100 })), p, W)
    expect(r.sources.rows).toEqual([])
    // The other direction: the page is on a subdomain, the referrer is the apex.
    const up = ph({ daily: phViews({ [D1]: 100 }), hosts: [['shop.skeenmusic.com', 1]], referrers: [['skeenmusic.com', 50], ['music.com', 9]] })
    const ru = compare(oursSide(oursViews({ [D1]: 100 })), up, W)
    expect(ru.sources.droppedSameSite).toEqual(['skeenmusic.com'])
    expect(ru.sources.rows.map((x) => x.host)).toEqual(['music.com'])
    // With a different site host, the same referrer is real traffic and must be flagged.
    const p2 = ph({ daily: phViews({ [D1]: 100 }), hosts: [['wren.site', 1]], referrers: [['shop.skeenmusic.com', 50]] })
    expect(compare(oursSide(oursViews({ [D1]: 100 })), p2, W).sources.rows).toEqual([{ host: 'shop.skeenmusic.com', ours: 0, ph: 50, flag: 'missing-ours' }])
  })

  it('flags a host with 5+ on one side that is missing on the other; 4 is below the gate', () => {
    const o = oursViews({ [D1]: 100 }, { sources: [src('tiktok.com', 5), src('bing.com', 4)] })
    const p = ph({ daily: phViews({ [D1]: 100 }), referrers: [['linktr.ee', 5], ['duckduckgo.com', 4]] })
    const r = compare(oursSide(o), p, W)
    const flags = Object.fromEntries(r.sources.rows.map((s) => [s.host, s.flag]))
    expect(flags).toEqual({ 'linktr.ee': 'missing-ours', 'tiktok.com': 'missing-ph', 'bing.com': null, 'duckduckgo.com': null })
    expect(r.sources.flagged).toBe(2)
    expect(r.criteria.find((c) => c.name === 'sources')?.pass).toBe(false)
  })

  it('sums our rows that share a host across sources', () => {
    const o = oursViews({ [D1]: 100 }, { sources: [src('instagram.com', 3, 'instagram'), src('instagram.com', 3, 'other')] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }) }), W)
    expect(r.sources.rows).toEqual([{ host: 'instagram.com', ours: 6, ph: 0, flag: 'missing-ph' }])
  })
})

describe('countries', () => {
  const place = (country: string, views: number, city = 'X'): PlaceRow => ({ country, region: '', city, views, visitors: 1, lat: null, lon: null })

  it('folds our cities to countries with the shared helper, ranks by views, and scores top-10 rank + top-5 overlap', () => {
    const o = oursViews({ [D1]: 100 }, { places: [place('US', 30, 'NYC'), place('US', 20, 'LA'), place('GB', 30), place('DE', 10), place('', 10)] })
    const p = ph({ daily: phViews({ [D1]: 100 }), countries: [['US', 45], ['GB', 25], ['DE', 8], [null, 3]] })
    const r = compare(oursSide(o), p, W)
    expect(r.countries.ours.map((c) => [c.code, c.views])).toEqual([['US', 50], ['GB', 30], ['DE', 10]])
    expect(r.countries.ph.map((c) => [c.code, c.views])).toEqual([['US', 45], ['GB', 25], ['DE', 8]])
    expect(r.countries.rankCorrelation).toBe(1)
    expect(r.countries.top5Overlap).toBe(3)
    expect(r.countries.warning).toBeNull()
  })

  it('reads -1 for a fully reversed order and null when there is nothing to rank', () => {
    expect(rankCorrelation(new Map([['A', 3], ['B', 2], ['C', 1]]), new Map([['A', 1], ['B', 2], ['C', 3]]))).toBe(-1)
    expect(rankCorrelation(new Map([['A', 3]]), new Map([['A', 1]]))).toBeNull()
    expect(rankCorrelation(new Map(), new Map())).toBeNull()
  })

  it('ranks only the union of the two top 10s, a country absent on one side counting as zero there', () => {
    const codes = Array.from({ length: 10 }, (_, i) => `C${i}`)
    // Ours: C0..C9 descending, plus an 11th country K. PostHog: C0..C9 fully REVERSED, no K.
    // Over the union of the top 10s that is exactly -1. Letting K in (last on both sides)
    // would pull the correlation above -1.
    const o = new Map<string, number>([...codes.map((c, i) => [c, 100 - i] as [string, number]), ['K', 1]])
    const p = new Map<string, number>(codes.map((c, i) => [c, 10 + i] as [string, number]))
    expect(rankCorrelation(o, p)).toBe(-1)
  })

  it('warns loudly when one country holds >90% of PostHog events: every event geolocated to a proxy edge', () => {
    const o = oursViews({ [D1]: 100 }, { places: [place('GB', 60), place('US', 40)] })
    const at = (us: number, other: number) =>
      compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }), countries: [['US', us], ['GB', other]] }), W).countries.warning
    expect(at(91, 9)).toMatch(/US.*91%.*proxy/i)
    expect(at(90, 10)).toBeNull()
    // Unlocated PostHog events count in the denominator: 90 of 100 is not over 90%.
    expect(compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }), countries: [['US', 90], [null, 10]] }), W).countries.warning).toBeNull()
    expect(formatReport(compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }), countries: [['US', 95], ['GB', 5]] }), W))).toMatch(/WARNING/)
  })

  it('does not warn on fewer PostHog events than the low-n gate', () => {
    const o = oursViews({ [D1]: 100 })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }), countries: [['US', LIMITS.lowN - 1]] }), W)
    expect(r.countries.warning).toBeNull()
    const r2 = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }), countries: [['US', LIMITS.lowN]] }), W)
    expect(r2.countries.warning).not.toBeNull()
  })

  it('never gates the verdict on countries', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100, [D3]: 100 }, { places: [place('GB', 100)] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100, [D2]: 100, [D3]: 100 }), countries: [['US', 100]] }), W)
    expect(r.criteria.map((c) => c.name)).not.toContain('countries')
    expect(exitCode(r)).toBe(0)
  })
})

describe('bots', () => {
  it("prints ours and PostHog's $virt_is_bot count; says so when PostHog's is unavailable", () => {
    const o = oursViews({ [D1]: 100 })
    const withBots = compare(oursSide(o), ph({ daily: [[D1, '$pageview', 110, 10]] }), W)
    expect(withBots.bots.ours.find((b) => b.day === D1)?.bots).toBe(1)
    expect(withBots.bots.ph?.find((b) => b.day === D1)?.bots).toBe(10)
    const without = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }) }, false), W)
    expect(without.bots.ph).toBeNull()
    expect(formatReport(without)).toMatch(/\$virt_is_bot.*unavailable/i)
  })
})

/* ── No data is not agreement ───────────────────────────────────────────────────── */

describe('no data → exit 2', () => {
  it('when PostHog has nothing: exit 2, a message naming PostHog, and no table', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph(), W)
    expect(r.noData).toMatch(/PostHog/)
    expect(exitCode(r)).toBe(2)
    const text = formatReport(r)
    expect(text).toMatch(/PostHog/)
    expect(text).not.toMatch(/\bday\b.*views/i)
    expect(text).not.toMatch(/PASS/)
  })

  it('when ours has nothing: exit 2 naming ours', () => {
    const r = compare(oursSide(ours()), ph({ daily: phViews({ [D1]: 100 }) }), W)
    expect(r.noData).toMatch(/ours|lone star/i)
    expect(r.noData).not.toMatch(/PostHog/)
    expect(exitCode(r)).toBe(2)
  })

  it('names both sides when both are empty', () => {
    const r = compare(oursSide(ours()), ph(), W)
    expect(r.noData).toMatch(/PostHog/)
    expect(r.noData).toMatch(/ours|lone star/i)
  })

  it('a side with clicks but no views still has data; bots alone do not count', () => {
    const o = ours({ typeTimeline: [{ day: D1, type: 'play', count: 1 }] })
    expect(compare(oursSide(o), ph({ daily: [[D1, 'play', 1, 0]] }), W).noData).toBeNull()
    const botsOnly = ours({ timeline: [{ day: D1, views: 0, visitors: 0, bots: 50 }] })
    expect(compare(oursSide(botsOnly), ph({ daily: phViews({ [D1]: 1 }) }), W).noData).toMatch(/ours|lone star/i)
    expect(compare(oursSide(oursViews({ [D1]: 1 })), ph({ daily: [[D1, '$pageview', 50, 50]] }), W).noData).toMatch(/PostHog/)
  })

  it('no-data outranks a failed criterion', () => {
    const o = oursViews({ [D1]: 100 })
    o.typeTimeline = [] // consistency would fail
    const r = compare(oursSide(o), ph(), W)
    expect(exitCode(r)).toBe(2)
  })
})

describe('the report', () => {
  it('passes with exit 0 and a PASS verdict when every criterion is met', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100, [D3]: 100 }, { typeTimeline: [{ day: D1, type: 'play', count: 10 }] })
    const r = compare(oursSide(o), ph({ daily: [...phViews({ [D1]: 80, [D2]: 80, [D3]: 80 }), [D1, 'play', 10, 0]] }), W)
    expect(exitCode(r)).toBe(0)
    expect(r.verdict).toMatch(/^PASS/)
    const text = formatReport(r)
    expect(text.trim().split('\n').at(-1)).toMatch(/^VERDICT: PASS/)
  })

  it('names the failed criteria in a FAIL verdict', () => {
    const o = oursViews({ [D1]: 100 }, { sources: [{ source: 'other', referrer_host: 'x.com', views: 9, visitors: 1 }] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }) }), W)
    expect(r.verdict).toMatch(/^FAIL/)
    expect(r.verdict).toContain('sources')
    expect(r.verdict).not.toContain('views')
  })

  it('prints a row per day with views ours/ph/ratio and o/p per click type, then SOURCES and COUNTRIES', () => {
    const o = oursViews({ [D1]: 100 }, { typeTimeline: [{ day: D1, type: 'buy_click', count: 7 }] })
    const text = formatReport(compare(oursSide(o), ph({ daily: [...phViews({ [D1]: 80 }), [D1, 'buy_click', 6, 0]] }), W))
    const row = text.split('\n').find((l) => l.startsWith(D1))!
    expect(row).toMatch(/100\s+80\s+0\.80/)
    expect(row).toMatch(/7\/6/)
    for (const t of COMPARED_CLICK_TYPES) expect(text).toContain(t)
    expect(text.indexOf('SOURCES')).toBeGreaterThan(text.indexOf(D1))
    expect(text.indexOf('COUNTRIES')).toBeGreaterThan(text.indexOf('SOURCES'))
  })

  it('marks low-n and outlier days in the table', () => {
    // r = 225 / 505 ≈ 0.45: D1 at 0.50 is inside the band, D2 at 0.20 is not, D3 is thin.
    const o = oursViews({ [D1]: 400, [D2]: 100, [D3]: 5 })
    const text = formatReport(compare(oursSide(o), ph({ daily: phViews({ [D1]: 200, [D2]: 20, [D3]: 5 }) }), W))
    const line = (d: string) => text.split('\n').find((l) => l.startsWith(d))!
    expect(line(D3)).toMatch(/low n/)
    expect(line(D2)).toMatch(/OUTLIER/)
    expect(line(D1)).not.toMatch(/OUTLIER|low n/)
  })
})

describe('oursSide', () => {
  it('coerces reader counts to numbers (bigint can arrive as a string)', () => {
    const o = ours({ timeline: [{ day: D1, views: '12' as unknown as number, visitors: 3, bots: 0 }], typeTimeline: [{ day: D1, type: 'view', count: '12' as unknown as number }] })
    expect(oursSide(o).views.get(D1)).toBe(12)
    expect(oursSide(o).clicks.size).toBe(0)
  })

  it('compare refuses a day of ours outside the window: today is partial and must not leak in', () => {
    const o = oursViews({ [D1]: 100, '2026-09-17': 5 })
    expect(() => compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }) }), W)).toThrow(/outside.*window/i)
  })
})

describe('the edges each rule turns on', () => {
  const place = (country: string, views: number, visitors = 1): PlaceRow => ({ country, region: '', city: 'X', views, visitors, lat: null, lon: null })

  it('lists dropped same-site hosts sorted, whatever order PostHog returned them in', () => {
    const p = ph({ daily: phViews({ [D1]: 100 }), hosts: [['b.site', 1], ['a.site', 1]], referrers: [['b.site', 1], ['a.site', 1]] })
    expect(compare(oursSide(oursViews({ [D1]: 100 })), p, W).sources.droppedSameSite).toEqual(['a.site', 'b.site'])
  })

  it('ignores PostHog entity rows that are not a compared click or carry no entity id', () => {
    const p = ph({ daily: phViews({ [D1]: 100 }), entities: [['$pageview', 'dddddddd-1111-2222-3333-444444444444', 5], ['play', null, 5], ['play', '', 3]] })
    expect(compare(oursSide(oursViews({ [D1]: 100 })), p, W).clicks.entity.phTotal).toBe(0)
  })

  it('does not count an event type outside the comparison as data on either side', () => {
    const o = ours({ typeTimeline: [{ day: D1, type: 'pageleave', count: 5 }] })
    expect(compare(oursSide(o), ph({ daily: phViews({ [D1]: 100 }) }), W).noData).toMatch(/ours/)
    expect(compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: [[D1, '$autocapture', 50, 0]] }), W).noData).toMatch(/PostHog/)
  })

  it('ranks countries by views (not visitors), ties broken by code, whatever order the rows came in', () => {
    const o = oursViews({ [D1]: 100 }, { places: [place('GB', 10, 99), place('US', 20, 1)] })
    const p = ph({ daily: phViews({ [D1]: 100 }), countries: [['DE', 5], ['US', 50], ['GB', 50]] })
    const r = compare(oursSide(o), p, W)
    expect(r.countries.ours.map((c) => c.code)).toEqual(['US', 'GB'])
    expect(r.countries.ph.map((c) => c.code)).toEqual(['GB', 'US', 'DE'])
  })

  it('has no rank correlation when one side cannot be ranked (every count tied)', () => {
    expect(rankCorrelation(new Map([['A', 1], ['B', 1]]), new Map([['A', 2], ['B', 1]]))).toBeNull()
    expect(rankCorrelation(new Map([['A', 2], ['B', 1]]), new Map([['A', 1], ['B', 1]]))).toBeNull()
  })

  it('reads a partial order as a partial correlation', () => {
    // Over A..D: ours 4,3,2,1; PostHog swaps the middle two. Spearman = 1 - 6·2/(4·15) = 0.8.
    const r = rankCorrelation(new Map([['A', 4], ['B', 3], ['C', 2], ['D', 1]]), new Map([['A', 4], ['B', 2], ['C', 3], ['D', 1]]))
    expect(r).toBeCloseTo(0.8, 10)
  })

  it('counts top-5 overlap between the two top 5s only', () => {
    const codes = ['A', 'B', 'C', 'D', 'E', 'F']
    const o = oursViews({ [D1]: 100 }, { places: codes.map((c, i) => place(c, 60 - i * 10)) })
    // PostHog top 5: F A B C G, then D sixth. Overlap with ours' A..E is A B C = 3.
    const p = ph({ daily: phViews({ [D1]: 100 }), countries: [['F', 60], ['A', 50], ['B', 40], ['C', 30], ['G', 20], ['D', 10]] })
    expect(compare(oursSide(o), p, W).countries.top5Overlap).toBe(3)
  })

  it('orders source rows by combined size, ties by host', () => {
    const src = (referrer_host: string, views: number): SourceRow => ({ source: 'other', referrer_host, views, visitors: 1 })
    const o = oursViews({ [D1]: 100 }, { sources: [src('c.com', 1), src('a.com', 3), src('b.com', 10)] })
    const p = ph({ daily: phViews({ [D1]: 100 }), referrers: [['c.com', 5], ['a.com', 3], ['d.com', 2]] })
    expect(compare(oursSide(o), p, W).sources.rows.map((x) => x.host)).toEqual(['b.com', 'a.com', 'c.com', 'd.com'])
  })

  it('gates PostHog-only entities at exactly 1%', () => {
    const id = 'eeeeeeee-1111-2222-3333-444444444444'
    const at = (phOnly: number) =>
      compare(
        oursSide(oursViews({ [D1]: 100 }, { entities: [{ entity_type: 'merch', entity_id: id, type: 'buy_click', count: 100 - phOnly }] })),
        ph({ daily: phViews({ [D1]: 100 }), entities: [['buy_click', id, 100]] }),
        W,
      ).criteria.find((c) => c.name === 'entities')!.pass
    expect(at(1)).toBe(true)
    expect(at(2)).toBe(false)
  })

  it('spells the verdict: NO DATA naming every empty side, FAIL listing every failed criterion', () => {
    const empty = compare(oursSide(ours()), ph(), W)
    expect(empty.verdict).toMatch(/^NO DATA: No data from ours \(the Lone Star readers\) or PostHog for 2026-09-14\.\.2026-09-16/)
    const o = oursViews({ [D1]: 400, [D2]: 100 }, { sources: [{ source: 'other', referrer_host: 'x.com', views: 9, visitors: 1 }] })
    const r = compare(oursSide(o), ph({ daily: phViews({ [D1]: 200, [D2]: 20 }) }), W)
    expect(r.verdict).toBe('FAIL: judged, views, sources')
  })

  it('keys each click row by its real day and type', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: phViews({ [D1]: 100 }) }), W)
    expect(r.clicks.days.slice(0, 2)).toEqual(COMPARED_CLICK_TYPES.slice(0, 2).map((type) => ({ day: D1, type, ours: 0, ph: 0 })))
  })

  it('prints the quiet case plainly: no PostHog bots, readers agree, nothing dropped, no countries, no warning', () => {
    const r = compare(oursSide(oursViews({ [D1]: 100 })), ph({ daily: phViews({ [D1]: 100 }) }, false), W)
    const text = formatReport(r)
    expect(text.split('\n').find((l) => l.startsWith(D1))).toMatch(/ 1\/- /)
    expect(text).toContain('byType.view vs timeline.views: agree\n')
    expect(text).not.toContain('same-site referrers dropped')
    expect(text).toContain('  ours     -\n  PostHog  -\n')
    expect(text).not.toMatch(/null|undefined/)
  })

  it('joins several mismatched days and dropped hosts with commas', () => {
    const o = oursViews({ [D1]: 100, [D2]: 100 })
    o.typeTimeline = []
    const p = ph({ daily: phViews({ [D1]: 100 }), hosts: [['a.site', 1], ['b.site', 1]], referrers: [['a.site', 1], ['b.site', 1]] })
    const text = formatReport(compare(oursSide(o), p, W))
    expect(text).toContain(`timeline.views: ${D1} 100≠0, ${D2} 100≠0\n`)
    expect(text).toContain('(PostHog same-site referrers dropped: a.site, b.site)')
  })

  it('prints the whole report: per-day table, clicks, sources, countries, criteria, verdict', () => {
    const o = oursViews(
      { [D1]: 400, [D2]: 100 },
      {
        typeTimeline: [{ day: D1, type: 'play', count: 12 }, { day: D2, type: 'buy_click', count: 3 }],
        sources: [{ source: 'instagram', referrer_host: 'instagram.com', views: 40, visitors: 9 }, { source: 'other', referrer_host: 'x.com', views: 6, visitors: 1 }],
        places: [place('US', 300), place('GB', 200)],
      },
    )
    o.timeline[1] = { ...o.timeline[1], bots: 7 }
    o.typeTimeline[1] = { ...o.typeTimeline[1], count: 99 } // D2 view: the readers disagree
    const p = ph({
      daily: [[D1, '$pageview', 200, 2], [D2, '$pageview', 20, 0], [D1, 'play', 11, 0], [D2, 'buy_click', 4, 1]],
      referrers: [['www.instagram.com', 35], ['www.skeen.com', 80]],
      hosts: [['skeen.com', 1]],
      countries: [['US', 190], ['GB', 10]],
    })
    expect(formatReport(compare(oursSide(o), p, W))).toMatchInlineSnapshot(`
      "PostHog cross-check  2026-09-14..2026-09-16 (3 days, UTC, today excluded)
      views ratio r = PostHog / ours = 0.44; a judged day must sit within ±25% of r

      day         views     ph  ratio         play   link_click ticket_click    buy_click  video_click   bots o/p  visitors(ours)  note
      2026-09-14    400    198   0.49        12/11          0/0          0/0          0/0          0/0        1/2             200 
      2026-09-15    100     20   0.20          0/0          0/0          0/0          3/3          0/0        7/1              50  OUTLIER
      2026-09-16      0      0      -          0/0          0/0          0/0          0/0          0/0        0/0               0  low n

      visitors: ours shown for reference only, not comparable (ours are visitor-days (a daily rotating hash); PostHog in memory persistence mints an id per page load)
      bots: ours = is_bot views; PostHog = events with $virt_is_bot (its SDK also drops known bots before sending)
      CLICKS    PostHog-only 0 of 14 (0.00%, gate ≤ 1.00%) · ours-only 1 of 15 (6.67%, not gated)
      ENTITIES  PostHog-only 0 of 0 (0.00%) · ours-only 0 of 0 (0.00%)
      CONSISTENCY  byType.view vs timeline.views: 2026-09-15 100≠99

      SOURCES   host  ours  ph
        instagram.com                    40     35
        x.com                             6      0  missing-ph
        (PostHog same-site referrers dropped: skeen.com)

      COUNTRIES
        ours     US 300, GB 200
        PostHog  US 190, GB 10
        top-10 rank correlation 1.00 · top-5 overlap 2/5 (reported, not gated)
        WARNING: US holds 95% of PostHog page views. That is what every event geolocated to a proxy edge looks like; PostHog's countries mean nothing until the proxy forwards the client IP.

        FAIL  consistency: byType.view = timeline.views on every day (1 mismatched)
        FAIL  judged: 2 day(s) with 30+ views (need 3); fewer and the views ratio proves nothing
        FAIL  views: 1 day(s) outside ±25% of r
        ok    clicks: PostHog-only 0.00% (gate ≤ 1.00%)
        ok    entities: PostHog-only by entity 0.00% (gate ≤ 1.00%)
        FAIL  sources: 1 host(s) with 5+ on one side missing on the other
      VERDICT: FAIL: consistency, judged, views, sources
      "
    `)
  })
})
