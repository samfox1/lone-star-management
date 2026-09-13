// The window the Analytics tab reads, and the two rules that keep its blocks honest.
/**
 * Every block on the page describes the SAME slice, so the window is computed once and
 * passed down. Two things here are worth a test of their own:
 *
 *   - the timeline is ZERO-FILLED. The readers return only days that had traffic, so a
 *     quiet Tuesday comes back absent, not as a zero. Charted raw, a week with two busy
 *     days draws as a two-point line and the artist reads a cliff that is really a gap.
 *   - `topBars` folds the tail into "Other" rather than drawing a fifteenth bar, because
 *     past about seven a reader is reading a table.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_SINCE,
  METRICS,
  analyticsWindow,
  metrics,
  previousWindow,
  summarizeDevices,
  summarizeSources,
  topContent,
  CONTENT_KINDS,
  reachesBeforeContext,
  topBars,
  trafficWindow,
  windowDays,
  WINDOWS,
} from '@/lib/analytics'
import type { SupabaseClient } from '@supabase/supabase-js'

const NOW = Date.parse('2026-09-12T18:00:00Z')

/** A Supabase stand-in that answers each reader from a table of canned rows. */
function fakeClient(rows: Record<string, unknown[]>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return Promise.resolve({ data: rows[fn] ?? [], error: null })
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('the window itself', () => {
  it('is whole UTC days, today included — the unit every reader counts in', () => {
    expect(analyticsWindow(7, NOW)).toEqual({ since: '2026-09-06', until: '2026-09-12', days: 7 })
    expect(analyticsWindow(1, NOW)).toEqual({ since: '2026-09-12', until: '2026-09-12', days: 1 })
    expect(analyticsWindow(30, NOW).since).toBe('2026-08-14')
  })

  it('?days= accepts only the offered windows; anything else is 30', () => {
    for (const n of WINDOWS) expect(windowDays(String(n))).toBe(n)
    for (const junk of [undefined, '', '0', '31', 'all', '-7', '7.5', '1e2']) {
      expect(windowDays(junk), String(junk)).toBe(30)
    }
  })

  it('knows when the window reaches back past the day context started', () => {
    expect(reachesBeforeContext(analyticsWindow(30, NOW))).toBe(true)
    // A window that starts exactly on the cut-over is wholly inside it.
    expect(reachesBeforeContext({ since: CONTEXT_SINCE, until: CONTEXT_SINCE, days: 1 })).toBe(false)
    expect(reachesBeforeContext({ since: '2026-09-11', until: CONTEXT_SINCE, days: 2 })).toBe(true)
  })
})

describe('trafficWindow', () => {
  it('asks every reader for the SAME slice — one window, or the blocks disagree', async () => {
    const { client, calls } = fakeClient({})
    await trafficWindow(client, 'artist-1', 7, NOW)
    expect(calls.map((c) => c.fn).sort()).toEqual([
      'analytics_devices', 'analytics_places', 'analytics_sources', 'analytics_sources',
      'analytics_timeline', 'analytics_type_timeline',
    ])
    const thisWindow = { p_artist_id: 'artist-1', p_since: '2026-09-06', p_until: '2026-09-12' }
    const previous = { p_artist_id: 'artist-1', p_since: '2026-08-30', p_until: '2026-09-05' }
    // Exactly one call reads the window BEFORE this one, and only for sources.
    const [prevCall, ...rest] = calls.filter((c) => c.args.p_since !== thisWindow.p_since)
    expect(rest).toEqual([])
    expect(prevCall).toEqual({ fn: 'analytics_sources', args: previous })
    for (const c of calls.filter((c) => c !== prevCall)) expect(c.args, c.fn).toEqual(thisWindow)
  })

  it('CRITICAL: zero-fills the quiet days — a day with no traffic is a zero, not a gap', async () => {
    const { client } = fakeClient({
      analytics_timeline: [
        { day: '2026-09-08', views: 40, visitors: 12, bots: 3 },
        { day: '2026-09-12', views: 10, visitors: 4, bots: 0 },
      ],
    })
    const w = await trafficWindow(client, 'a', 7, NOW)
    expect(w.timeline).toHaveLength(7)
    expect(w.timeline.map((d) => d.day)).toEqual([
      '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
    ])
    expect(w.timeline.map((d) => d.views)).toEqual([0, 0, 40, 0, 0, 0, 10])
    // The totals come from the filled series, so they cannot drift from the chart.
    expect(w.totals).toEqual({ views: 50, visitors: 16, bots: 3 })
  })

  it('reads counts as numbers — PostgREST hands bigint back as a string', async () => {
    const { client } = fakeClient({
      analytics_timeline: [{ day: '2026-09-12', views: '7', visitors: '3', bots: '1' }],
      analytics_sources: [{ source: 'instagram', referrer_host: 'l.instagram.com', views: '5', visitors: '2' }],
    })
    const w = await trafficWindow(client, 'a', 7, NOW)
    expect(w.totals.views).toBe(7)
    expect(w.sources[0]).toEqual({ source: 'instagram', referrer_host: 'l.instagram.com', views: 5, visitors: 2 })
    expect(typeof w.sources[0].views).toBe('number')
  })

  it('survives a reader that returns nothing at all', async () => {
    const { client } = fakeClient({})
    const w = await trafficWindow(client, 'a', 30, NOW)
    expect(w.timeline).toHaveLength(30)
    expect(w.totals).toEqual({ views: 0, visitors: 0, bots: 0 })
    expect([w.sources, w.places, w.devices]).toEqual([[], [], []])
  })
})

describe('the per-metric series the sparklines draw', () => {
  const window7 = (rows: Record<string, unknown[]>) => trafficWindow(fakeClient(rows).client, 'a', 7, NOW)

  it('CRITICAL: every series is as long as the timeline, so a pill and the chart agree', async () => {
    const w = await window7({
      analytics_timeline: [{ day: '2026-09-12', views: 10, visitors: 4, bots: 1 }],
      analytics_type_timeline: [{ day: '2026-09-10', type: 'play', count: 3 }],
    })
    for (const m of metrics(w)) {
      expect(m.series, m.key).toHaveLength(w.timeline.length)
    }
    // The quiet days are zeros, not absent: a play on one day of seven.
    expect(w.byType.play).toEqual([0, 0, 0, 0, 3, 0, 0])
  })

  it('CRITICAL: a metric with no rows at all is a zero series, never an empty one', async () => {
    const w = await window7({})
    const buy = metrics(w).find((m) => m.key === 'buy_clicks')!
    expect(buy.series).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(buy.total).toBe(0)
  })

  it('offers every metric in the registry — the page never hand-lists them', async () => {
    const w = await window7({})
    // Derived from METRICS, so a metric added later cannot be silently dropped.
    expect(metrics(w).map((m) => m.key)).toEqual(METRICS.map((m) => m.key))
  })

  it('counts visitors and bots off the timeline, not off the event types', async () => {
    const w = await window7({
      analytics_timeline: [
        { day: '2026-09-11', views: 10, visitors: 4, bots: 2 },
        { day: '2026-09-12', views: 6, visitors: 3, bots: 1 },
      ],
      // A bogus 'visitors' type must not be what the visitors metric reads.
      analytics_type_timeline: [{ day: '2026-09-12', type: 'visitors', count: 999 }],
    })
    const by = Object.fromEntries(metrics(w).map((m) => [m.key, m]))
    expect(by.visitors.total).toBe(7)
    expect(by.bots.total).toBe(3)
    expect(by.views.total).toBe(16)
  })

  it('a total is the sum of its own series, so a pill cannot disagree with its sparkline', async () => {
    const w = await window7({
      analytics_timeline: [{ day: '2026-09-12', views: 5, visitors: 2, bots: 0 }],
      analytics_type_timeline: [
        { day: '2026-09-11', type: 'ticket_click', count: 2 },
        { day: '2026-09-12', type: 'ticket_click', count: 5 },
      ],
    })
    for (const m of metrics(w)) {
      expect(m.series.reduce((n, v) => n + v, 0), m.key).toBe(m.total)
    }
    expect(metrics(w).find((m) => m.key === 'ticket_clicks')!.total).toBe(7)
  })

  it('reads counts as numbers — PostgREST hands bigint back as a string', async () => {
    const w = await window7({
      analytics_type_timeline: [{ day: '2026-09-12', type: 'play', count: '4' }],
    })
    expect(w.byType.play.at(-1)).toBe(4)
    expect(typeof w.byType.play.at(-1)).toBe('number')
  })
})

describe('previousWindow', () => {
  it('is the same length and ends the day before this one starts — no gap, no overlap', () => {
    const w = analyticsWindow(7, NOW) // 2026-09-06 → 2026-09-12
    expect(previousWindow(w)).toEqual({ since: '2026-08-30', until: '2026-09-05', days: 7 })
    expect(previousWindow(analyticsWindow(30, NOW))).toEqual({ since: '2026-07-15', until: '2026-08-13', days: 30 })
  })
})

describe('summarizeSources', () => {
  const row = (source: string, referrer_host: string, visitors: number, views = visitors * 2) =>
    ({ source, referrer_host, visitors, views })

  it('rolls a source up across its hosts and ranks hosts by visitors', () => {
    const [ig] = summarizeSources([
      row('instagram', 'l.instagram.com', 30),
      row('instagram', 'instagram.com', 70),
    ])
    expect(ig.visitors).toBe(100)
    expect(ig.views).toBe(200)
    expect(ig.hosts.map((h) => h.host)).toEqual(['instagram.com', 'l.instagram.com'])
  })

  it('CRITICAL: shares are of ALL visitors and sum to one — a ring is a share of everyone', () => {
    const out = summarizeSources([row('instagram', 'a', 60), row('youtube', 'b', 30), row('direct', '', 10)])
    expect(out.map((s) => s.share)).toEqual([0.6, 0.3, 0.1])
    expect(out.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 10)
  })

  it('CRITICAL: the trend is against the previous window, and withheld when there was none', () => {
    const out = summarizeSources(
      [row('instagram', 'a', 150), row('youtube', 'b', 40)],
      [row('instagram', 'a', 100)],
    )
    const by = Object.fromEntries(out.map((s) => [s.source, s]))
    expect(by.instagram.trend).toBeCloseTo(0.5, 10)
    // YouTube had nothing last window: no percentage, not "+∞" and not "+100%".
    expect(by.youtube.trend).toBeNull()
  })

  it('drops rows with no source and sources with no visitors', () => {
    const out = summarizeSources([row('', 'x', 9), row('google', 'google.com', 0), row('tiktok', 't', 3)])
    expect(out.map((s) => s.source)).toEqual(['tiktok'])
  })

  it('labels from the registry, and falls back to the raw key', () => {
    const out = summarizeSources([row('apple_music', 'm', 1), row('mystery', 'm', 1)])
    expect(out.map((s) => s.label).sort()).toEqual(['Apple Music', 'mystery'])
  })

  it('a window with no visitors at all yields no rings, not a division by zero', () => {
    expect(summarizeSources([])).toEqual([])
    expect(summarizeSources([row('instagram', 'a', 0)])).toEqual([])
  })
})

describe('summarizeDevices', () => {
  const row = (device: string, browser: string, visitors: number) => ({ device, browser, visitors, views: visitors * 2 })

  it('CRITICAL: phones and tablets are MOBILE, desktops are WEB, and the unclassified are counted not drawn', () => {
    const d = summarizeDevices([
      row('mobile', 'instagram', 198), row('tablet', 'safari', 13), row('desktop', 'chrome', 88), row('', '', 9),
    ])
    expect(d.mobile.map((r) => r.browser)).toEqual(['instagram', 'safari'])
    expect(d.web.map((r) => r.browser)).toEqual(['chrome'])
    expect(d.mobileVisitors).toBe(211)
    expect(d.webVisitors).toBe(88)
    expect(d.otherVisitors).toBe(9)
  })

  it('CRITICAL: one maximum across BOTH groups, so a web bar and a mobile bar share a scale', () => {
    const d = summarizeDevices([row('mobile', 'instagram', 198), row('desktop', 'chrome', 88)])
    expect(d.max).toBe(198)
  })

  it('sums the same device × browser across days and ranks by visitors', () => {
    const d = summarizeDevices([row('desktop', 'safari', 5), row('desktop', 'chrome', 40), row('desktop', 'safari', 30)])
    expect(d.web.map((r) => [r.browser, r.visitors])).toEqual([['chrome', 40], ['safari', 35]])
  })

  it('an empty window has a floor of 1, never a divide by zero', () => {
    expect(summarizeDevices([]).max).toBe(1)
  })
})

describe('topContent', () => {
  const ev = (entity_type: string, entity_id: string, type: string, count: number) => ({ entity_type, entity_id, type, count })
  const SONG = { entity: 'track', type: 'play' }
  const refs = [
    { id: 'a', title: 'Summer Sun', image: 'x', sub: null },
    { id: 'b', title: 'Home Again', image: null, sub: 'Home' },
  ]

  it('joins events to their thing and ranks by count', () => {
    const out = topContent([ev('track', 'b', 'play', 3), ev('track', 'a', 'play', 9)], SONG, refs, 12)
    expect(out.items.map((s) => [s.title, s.count])).toEqual([['Summer Sun', 9], ['Home Again', 3]])
  })

  it('CRITICAL: says how many events named a thing and how many did not — the list must not look short', () => {
    const out = topContent([ev('track', 'a', 'play', 9), ev('track', 'b', 'play', 3)], SONG, refs, 70)
    expect(out.attributed).toBe(12)
    expect(out.unattributed).toBe(58)
  })

  it('CRITICAL: counts only the ONE event that names this kind — a ticket click on a date is not a play on a song', () => {
    const out = topContent([
      ev('track', 'a', 'play', 2),
      ev('tour_date', 'a', 'ticket_click', 5),
      ev('track', 'a', 'link_click', 4),
    ], SONG, refs, 2)
    expect(out.items).toEqual([{ ...refs[0], count: 2 }])
    expect(out.attributed).toBe(2)
  })

  it('an event on a deleted thing stays attributed but is not listed', () => {
    const out = topContent([ev('track', 'gone', 'play', 4), ev('track', 'a', 'play', 1)], SONG, refs, 5)
    expect(out.items.map((s) => s.id)).toEqual(['a'])
    expect(out.attributed).toBe(5)
    expect(out.unattributed).toBe(0)
  })

  it('reads counts as numbers — PostgREST hands bigint back as a string', () => {
    const out = topContent([{ entity_type: 'track', entity_id: 'a', type: 'play', count: '7' as unknown as number }], SONG, refs, 7)
    expect(out.items[0].count).toBe(7)
  })

  it('never reports negative unattributed events if the tallies disagree by a day', () => {
    expect(topContent([ev('track', 'a', 'play', 9)], SONG, refs, 5).unattributed).toBe(0)
  })

  it('offers exactly the kinds the site attaches an entity to — and never video', () => {
    expect(CONTENT_KINDS.map((k) => k.entity)).toEqual(['track', 'tour_date', 'merch'])
    // Widened on purpose: the type already forbids 'video', so the check has to be a runtime one.
    expect((CONTENT_KINDS as readonly { entity: string }[]).some((k) => k.entity === 'video')).toBe(false)
  })
})

describe('topBars', () => {
  const bar = (key: string, value: number) => ({ key, label: key, value })

  it('orders by size and drops the empties', () => {
    expect(topBars([bar('a', 1), bar('b', 9), bar('c', 0)]).map((b) => b.key)).toEqual(['b', 'a'])
  })

  it('CRITICAL: folds the tail into one Other rather than drawing a fifteenth bar', () => {
    const many = Array.from({ length: 15 }, (_, i) => bar(`s${i}`, 15 - i))
    const bars = topBars(many)
    expect(bars).toHaveLength(7)
    expect(bars.slice(0, 6).map((b) => b.key)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5'])
    const other = bars[6]
    expect(other.key).toBe('other')
    // Nothing is lost in the fold: the tail's total is the bar's value.
    expect(other.value).toBe(many.slice(6).reduce((n, b) => n + b.value, 0))
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(many.reduce((n, b) => n + b.value, 0))
  })

  it('leaves a list that already fits alone — no Other bar for seven', () => {
    const seven = Array.from({ length: 7 }, (_, i) => bar(`s${i}`, 7 - i))
    expect(topBars(seven).map((b) => b.key)).toEqual(seven.map((b) => b.key))
  })
})

describe('the clock is read once', () => {
  it('uses the injected now, so a window never straddles midnight mid-render', () => {
    const spy = vi.spyOn(Date, 'now')
    analyticsWindow(30, NOW)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
