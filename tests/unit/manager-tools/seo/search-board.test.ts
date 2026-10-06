/**
 * What the Search page draws: the spot line per engine, the seen and clicks lines, and who AI
 * assistants sent.
 *
 * Code:     src/lib/manager-tools/seo/search-board.ts, src/lib/manager-tools/seo/ai-visits.ts
 * Feature:  SEO / GEO page · Search tab, rebuilt from mock r12 (Sam, 2026-10-06; "both side by
 *           side": Google and Bing on the same charts, never added together)
 * Tier:     STRICT (AGENTS.md "Test depth"): these decide what the artist is told about their own
 *           search audience.
 * Covers:   • the spot board: one engine or both on one row of days, blank where an engine has
 *             no reading, the unfinished days marked, colours by engine
 *           • the seen / clicks board: never summed, clicks heavier beside both engines
 *           • "Both" with one engine answering reads as that engine alone
 *           • the week-against-week change: two whole weeks or nothing
 *           • AI visits: by assistant, the big three always named
 * Not here: the spot itself (search-spot.test.ts); the page's layout (tests/components/
 *           manager-tools/seo/search-tab.test.tsx).
 * Fixtures: small hand-made SearchStats in search-stats.ts's own types.
 */
import { describe, expect, it } from 'vitest'
import { aiVisits } from '@/lib/manager-tools/seo/ai-visits'
import { reachBoard, reachFacts, spotBoard, weekGrowth } from '@/lib/manager-tools/seo/search-board'
import type { EngineStats, SearchDay, SearchDayRow, SearchPeriod, SearchStats } from '@/lib/manager-tools/seo/search-stats'

const P28: SearchPeriod = { key: '28d', days: 28, start: '2026-09-05', end: '2026-10-02' }
const day = (date: string, clicks: number, impressions: number, final = true): SearchDay => ({ date, clicks, impressions, final })
const sd = (key: string, date: string, impressions: number, position: number): SearchDayRow => ({ key, date, impressions, position })
const stats = (engine: 'google' | 'bing', over: Partial<SearchStats>): SearchStats => ({
  engine, period: P28, totals: { clicks: 0, impressions: 0, ctr: null, position: null }, series: [], queries: [], searchDays: [], unlisted: { clicks: 0, impressions: 0 }, coverage: null, preliminaryFrom: null, ...over,
})

const GOOGLE = stats('google', {
  series: [day('2026-09-29', 6, 23), day('2026-09-30', 5, 14, false), day('2026-10-01', 4, 19, false)],
  searchDays: [sd('skeen dj', '2026-09-29', 10, 2), sd('chicago dj', '2026-09-29', 50, 40), sd('skeen dj', '2026-09-30', 10, 1.5), sd('skeen', '2026-10-01', 4, 1)],
  preliminaryFrom: '2026-09-30',
})
const BING = stats('bing', {
  series: [day('2026-09-28', 1, 3), day('2026-09-29', 0, 2)],
  searchDays: [sd('skeen', '2026-09-28', 5, 3)], // Bing's rows are weekly
})

describe('spotBoard — your spot when someone searches your name', () => {
  // One engine: only searches naming the artist make the line, and Google's unfinished days start the dotted part.
  it('CRITICAL: one engine: its name searches\' spot by day, a reach search left out, the days still counting marked', () => {
    const b = spotBoard('google', { google: GOOGLE }, 'Skeen')
    expect(b.days).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
    expect(b.lines).toEqual([{ key: 'google-spot', engine: 'google', label: 'Google ranking', values: [2, 1.5, 1], tone: 'ink', partialFrom: 1 }])
  })

  // Both: one row of days, each engine its own line, blank where it has no reading.
  it('CRITICAL: both: each engine its own line on one row of days, null where it has nothing — Google ink, Bing grey', () => {
    const b = spotBoard('both', { google: GOOGLE, bing: BING }, 'Skeen')
    expect(b.days).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'])
    expect(b.lines.map((l) => [l.key, l.label, l.tone, l.values, l.partialFrom])).toEqual([
      ['google-spot', 'Google ranking', 'ink', [null, 2, 1.5, 1], 2],
      ['bing-spot', 'Bing ranking', 'grey', [3, null, null, null], undefined], // Bing counts nothing still: never dotted
    ])
  })

  // Every day on the axis, readings or not (review, 2026-10-06: an axis of reading days only drew
  // Sep 25 and Oct 3 side by side, and a "site added" pin landed only on a day with a reading).
  it('CRITICAL: the axis is every day from the first reading to the last, blank where there is none — and can start earlier', () => {
    const gaps = stats('google', { searchDays: [sd('skeen', '2026-09-25', 4, 3), sd('skeen', '2026-10-03', 4, 2)] })
    const b = spotBoard('google', { google: gaps }, 'Skeen')
    expect(b.days).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(b.lines[0].values).toEqual([3, null, null, null, null, null, null, null, 2])
    // From the day the site was added, when that is earlier: the pin has a day to sit on.
    expect(spotBoard('google', { google: gaps }, 'Skeen', '2026-09-23').days[0]).toBe('2026-09-23')
    expect(spotBoard('google', { google: gaps }, 'Skeen', '2026-09-28').days[0]).toBe('2026-09-25')
  })

  // An unfinished day with no spot reading draws no dotted part.
  it('a day still being counted with no reading of the spot marks nothing', () => {
    const late = stats('google', { searchDays: [sd('skeen', '2026-09-29', 4, 2)], preliminaryFrom: '2026-10-01' })
    expect(spotBoard('google', { google: late }, 'Skeen').lines[0].partialFrom).toBeUndefined()
  })

  // No searches for the name: no line, and with none at all the chart is empty.
  it('an engine with no name searches draws no line; none at all is an empty board', () => {
    const quiet = stats('google', { searchDays: [sd('chicago dj', '2026-09-29', 5, 30)] })
    expect(spotBoard('google', { google: quiet }, 'Skeen')).toEqual({ days: [], lines: [] })
    expect(spotBoard('both', { google: GOOGLE, bing: stats('bing', {}) }, 'Skeen').lines.map((l) => l.key)).toEqual(['google-spot'])
  })
})

describe('both, with one engine answered', () => {
  // Both with one engine answering looks exactly like that engine alone.
  it('draws only the engine that answered — the other is no line, not a line of zeros — and reads as that engine alone', () => {
    expect(spotBoard('both', { google: GOOGLE }, 'Skeen')).toEqual(spotBoard('google', { google: GOOGLE }, 'Skeen'))
  })
})

describe('reachBoard — how often the site was seen in search, and clicked, for the engines switched on', () => {
  const ok = (stats: SearchStats): EngineStats => ({ engine: stats.engine, state: 'ok', stats })
  const none = (engine: 'google' | 'bing'): EngineStats => ({ engine, state: 'no_data', period: P28 })

  // One engine on: seen in ink, clicks in grey, by day.
  it('CRITICAL: one engine on: seen (ink) then clicks (grey) by day, the days still counting marked', () => {
    const b = reachBoard(['google'], { google: ok(GOOGLE), bing: ok(BING) })
    expect(b.days).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
    expect(b.lines).toEqual([
      { key: 'google-seen', engine: 'google', metric: 'seen', label: 'Seen in Google', values: [23, 14, 19], final: [true, false, false], tone: 'ink', partialFrom: 1 },
      { key: 'google-clicks', engine: 'google', metric: 'clicks', label: 'Clicks from Google', values: [6, 5, 4], final: [true, false, false], tone: 'grey', partialFrom: 1 },
    ])
  })

  // Both on: Google's and Bing's numbers stay apart, never summed into one line.
  it('CRITICAL: both on: never added together — each engine its own seen and clicks lines, engine by colour, clicks heavier', () => {
    const b = reachBoard(['google', 'bing'], { google: ok(GOOGLE), bing: ok(BING) })
    expect(b.days).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'])
    expect(b.lines.map((l) => [l.key, l.label, l.tone, l.thick ?? false, l.values])).toEqual([
      ['google-seen', 'Google seen', 'ink', false, [null, 23, 14, 19]],
      ['bing-seen', 'Bing seen', 'grey', false, [3, 2, null, null]],
      ['google-clicks', 'Google clicks', 'ink', true, [null, 6, 5, 4]],
      ['bing-clicks', 'Bing clicks', 'grey', true, [1, 0, null, null]],
    ])
    // Each line dotted from ITS first day still being counted: Google's from Oct 1's row of days
    // (index 2); Bing's, finished, never (review, 2026-10-06).
    expect(b.lines.map((l) => [l.key, l.partialFrom])).toEqual([['google-seen', 2], ['bing-seen', undefined], ['google-clicks', 2], ['bing-clicks', undefined]])
  })

  // An engine with nothing yet stays at 0 beside the other (Sam, 2026-10-06: "it can just stay at 0").
  it('CRITICAL: an engine switched on with nothing yet is a line at zero across the days — not missing', () => {
    const b = reachBoard(['google', 'bing'], { google: ok(GOOGLE), bing: none('bing') })
    expect(b.lines.map((l) => [l.key, l.values])).toEqual([
      ['google-seen', [23, 14, 19]], ['bing-seen', [0, 0, 0]], ['google-clicks', [6, 5, 4]], ['bing-clicks', [0, 0, 0]],
    ])
  })

  // Alone with nothing yet, the zero line runs the whole period.
  it('alone with nothing yet: zero across every day of the period', () => {
    const b = reachBoard(['bing'], { google: ok(GOOGLE), bing: none('bing') })
    expect(b.days).toHaveLength(28)
    expect(b.days[0]).toBe('2026-09-05')
    expect(b.days[27]).toBe('2026-10-02')
    expect(b.lines.every((l) => l.values.every((v) => v === 0))).toBe(true)
  })

  // An engine switched off, or one Tapir couldn't ask, draws nothing; nothing on, nothing drawn.
  it('an engine switched off, or one that could not be asked, draws nothing', () => {
    expect(reachBoard(['google'], { google: ok(GOOGLE), bing: ok(BING) }).lines.map((l) => l.engine)).toEqual(['google', 'google'])
    const broke: EngineStats = { engine: 'bing', state: 'error', period: P28 }
    expect(reachBoard(['google', 'bing'], { google: ok(GOOGLE), bing: broke }).lines.map((l) => l.key)).toEqual(['google-seen', 'google-clicks'])
    expect(reachBoard([], { google: ok(GOOGLE), bing: ok(BING) })).toEqual({ days: [], lines: [] })
  })

  // Bing has no unfinished days, so nothing is dotted.
  it('an engine counting nothing still (Bing never does) marks no day', () => {
    expect(reachBoard(['bing'], { bing: ok(BING) }).lines.every((l) => l.partialFrom === undefined)).toBe(true)
  })
})

describe('reachFacts — the numbers beside the seen / clicked chart', () => {
  const ok = (stats: SearchStats): EngineStats => ({ engine: stats.engine, state: 'ok', stats })
  const flat = (n: number, last: number[]) => stats('google', {
    series: [...Array.from({ length: 14 }, (_, i) => day(`2026-09-${String(10 + i).padStart(2, '0')}`, 1, n)),
      ...last.map((v, i) => day(`2026-09-${String(24 + i)}`, 1, v, false))],
    preliminaryFrom: '2026-09-24',
  })

  // The review's case (2026-10-06): a flat 100 a day whose last two days Google is still counting
  // (70, 15). Counting them read as a ▼16.4% fall; the days still being counted are left out of
  // the change and the per-day average, and stay in the total (they are real, just not finished).
  it('CRITICAL: days still being counted stay in the total but out of the change and the per-day average', () => {
    const [seen] = reachFacts(reachBoard(['google'], { google: ok(flat(100, [70, 15])) }).lines)
    expect(seen.key).toBe('google-seen')
    expect(seen.total).toBe(1400 + 85)
    expect(seen.perDay).toBe(100)
    expect(seen.growth).toBe(0)
  })

  // A zero line (an engine with nothing yet) is all zeros: no change, nothing per day.
  it('an engine with nothing yet: zero total, zero a day, no change', () => {
    const none: EngineStats = { engine: 'bing', state: 'no_data', period: P28 }
    const facts = reachFacts(reachBoard(['google', 'bing'], { google: ok(flat(100, [])), bing: none }).lines)
    expect(facts.find((f) => f.key === 'bing-seen')).toEqual({ key: 'bing-seen', total: 0, perDay: 0, growth: null })
  })
})

describe('weekGrowth — the last week against the first', () => {
  // The change needs two whole weeks to compare; from nothing it says nothing.
  it('CRITICAL: needs two whole weeks of readings; nothing to compare, nothing said', () => {
    expect(weekGrowth([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toBeNull() // 13 days
    expect(weekGrowth([...Array(7).fill(10), ...Array(7).fill(20)])).toBeCloseTo(1, 10) // 70 → 140: +100%
    expect(weekGrowth([...Array(7).fill(0), ...Array(7).fill(5)])).toBeNull() // from nothing: no percent
  })
  // Blank days are not readings; the middle day of an odd count is in neither week.
  it('days a line has nothing do not count as readings, or as weeks', () => {
    expect(weekGrowth([null, null, ...Array(7).fill(10), ...Array(6).fill(5)])).toBeNull() // 13 readings
    expect(weekGrowth([null, ...Array(7).fill(10), 99, ...Array(7).fill(5)])).toBeCloseTo((35 - 70) / 70, 10) // the middle day is in neither week
  })
})

describe('aiVisits — fans sent by AI assistants', () => {
  const src = (referrer_host: string, visitors: number, source = 'ai') => ({ source, referrer_host, views: visitors, visitors })
  // Only AI visits count, an assistant's addresses add up, most first, the big three always listed.
  it('CRITICAL: AI rows only, by assistant (its several addresses together), most first; the big three always named', () => {
    expect(aiVisits([src('chatgpt.com', 4), src('chat.openai.com', 2), src('perplexity.ai', 1), src('instagram.com', 99, 'instagram'), src('claude.ai', 3)])).toEqual([
      { name: 'ChatGPT', visitors: 6 },
      { name: 'Claude', visitors: 3 },
      { name: 'Perplexity', visitors: 1 },
      { name: 'Gemini', visitors: 0 },
    ])
  })
  // Every known AI address maps to its assistant's name, any capitals, with or without www.
  it('each assistant by its name, whatever address or capitals it came from', () => {
    const one = (host: string) => aiVisits([src(host, 1)]).find((r) => r.visitors === 1)!.name
    expect(['chatgpt.com', 'chat.openai.com', 'openai.com', 'www.ChatGPT.com'].map(one)).toEqual(['ChatGPT', 'ChatGPT', 'ChatGPT', 'ChatGPT'])
    expect(['perplexity.ai', 'www.perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai', 'you.com'].map(one))
      .toEqual(['Perplexity', 'Perplexity', 'Gemini', 'Copilot', 'Claude', 'You.com'])
    expect(one('newbot.example')).toBe('newbot.example') // an assistant the list does not know yet keeps its address
  })

  // No AI visits yet: the big three at zero; a visit with no address is Other AI.
  it('nobody yet: the big three at zero; an AI visit with no address is "Other AI"', () => {
    expect(aiVisits([])).toEqual([{ name: 'ChatGPT', visitors: 0 }, { name: 'Gemini', visitors: 0 }, { name: 'Perplexity', visitors: 0 }])
    expect(aiVisits([src('', 2)]).find((r) => r.name === 'Other AI')).toEqual({ name: 'Other AI', visitors: 2 })
  })
})
