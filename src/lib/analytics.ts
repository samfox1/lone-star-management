/**
 * Per-entity analytics for the dashboard cards. `entityCounts` reads the
 * `analytics_by_entity` RPC (owner-read via RLS) and shapes it into a lookup of
 * entity_id → { event_type: count } over a window, so a section can show a 30-day
 * stat on each card (release listens, ticket clicks, buy clicks). See
 * ANALYTICS_STATS_PLAN.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityCounts = Map<string, Record<string, number>>

export async function entityCounts(
  supabase: SupabaseClient,
  artistId: string,
  since: Date,
): Promise<EntityCounts> {
  const { data, error } = await supabase.rpc('analytics_by_entity', {
    p_artist_id: artistId,
    p_since: since.toISOString(),
  })
  if (error) throw new Error(error.message)

  const map: EntityCounts = new Map()
  for (const r of (data ?? []) as { entity_id: string; type: string; count: number }[]) {
    const rec = map.get(r.entity_id) ?? {}
    rec[r.type] = Number(r.count)
    map.set(r.entity_id, rec)
  }
  return map
}

/** Sum the given event types recorded for one entity id (0 if none). */
export function countFor(counts: EntityCounts, id: string, ...types: string[]): number {
  const rec = counts.get(id)
  if (!rec) return 0
  return types.reduce((n, t) => n + (rec[t] ?? 0), 0)
}

/**
 * The on-site metric shown on each content card — one home for which events define a
 * type's 30-day number and what it's called. A section asks for the metric instead of
 * re-deciding "merch = buy_click" in four places. `release` sums plays + DSP clicks
 * across its own id AND its tracks' (the caller passes those ids).
 */
export const ON_SITE_METRIC = {
  release: { label: 'listens', events: ['play', 'link_click'] },
  merch: { label: 'buy clicks', events: ['buy_click'] },
  tour_date: { label: 'ticket clicks', events: ['ticket_click'] },
  video: { label: 'clicks from your site', events: ['video_click'] },
} as const

export type MetricKind = keyof typeof ON_SITE_METRIC

/** 30-day metric value for one item = sum of its metric's events over the given entity
 *  ids (single-item types pass [id]; a release passes [releaseId, ...trackIds]). */
export function metricValue(counts: EntityCounts, kind: MetricKind, ids: string[]): number {
  const { events } = ON_SITE_METRIC[kind]
  return ids.reduce((n, id) => n + countFor(counts, id, ...events), 0)
}

export function metricLabel(kind: MetricKind): string {
  return ON_SITE_METRIC[kind].label
}

/** Days-ago Date for the standard dashboard 30-day window. */
export function daysAgo(days: number, nowMs: number = Date.now()): Date {
  return new Date(nowMs - days * 86_400_000)
}

/* ── The traffic window: what the Analytics tab reads ─────────────────────────
 *
 * One fetch for one window, so every block on the page describes the SAME slice.
 * The readers (20260911180000, 20260912120000) each union the day tallies with the
 * raw rows for days not yet rolled up, so a number never moves when last night's
 * roll-up runs.
 */

/** Whole UTC days, which is what every reader counts in. */
export type Window = { since: string; until: string; days: number }

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** The last `days` whole UTC days, today included. */
export function analyticsWindow(days: number, nowMs: number = Date.now()): Window {
  return { since: utcDay(nowMs - (days - 1) * 86_400_000), until: utcDay(nowMs), days }
}

/** The windows the page offers. A filter row, never a per-block control. */
export const WINDOWS = [7, 30, 90] as const
export type WindowDays = (typeof WINDOWS)[number]

/** `?days=` → one of the offered windows. Anything else is 30. */
export function windowDays(raw: string | undefined): WindowDays {
  const n = Number(raw)
  return (WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 30
}

export type TimelineDay = { day: string; views: number; visitors: number; bots: number }
export type SourceRow = { source: string; referrer_host: string; views: number; visitors: number }
export type PlaceRow = { country: string; region: string; city: string; views: number; visitors: number }
export type DeviceRow = { device: string; browser: string; views: number; visitors: number }

export type TrafficWindow = {
  window: Window
  /** One entry per day in the window, zero-filled — a quiet day is a gap in the
   *  data but not a gap in the chart. */
  timeline: TimelineDay[]
  sources: SourceRow[]
  places: PlaceRow[]
  devices: DeviceRow[]
  totals: { views: number; visitors: number; bots: number }
}

const num = (v: unknown) => Number(v ?? 0)

/** Every block's data, in one parallel wave. */
export async function trafficWindow(
  supabase: SupabaseClient,
  artistId: string,
  days: number,
  nowMs: number = Date.now(),
): Promise<TrafficWindow> {
  const w = analyticsWindow(days, nowMs)
  const args = { p_artist_id: artistId, p_since: w.since, p_until: w.until }
  const [timeline, sources, places, devices] = await Promise.all([
    supabase.rpc('analytics_timeline', args),
    supabase.rpc('analytics_sources', args),
    supabase.rpc('analytics_places', args),
    supabase.rpc('analytics_devices', args),
  ])

  const byDay = new Map<string, TimelineDay>()
  for (const r of (timeline.data ?? []) as Record<string, unknown>[]) {
    byDay.set(String(r.day), { day: String(r.day), views: num(r.views), visitors: num(r.visitors), bots: num(r.bots) })
  }
  // Zero-fill, so the chart's x axis is the window and not just the busy days.
  const filled: TimelineDay[] = []
  for (let i = 0; i < w.days; i++) {
    const day = utcDay(nowMs - (w.days - 1 - i) * 86_400_000)
    filled.push(byDay.get(day) ?? { day, views: 0, visitors: 0, bots: 0 })
  }

  return {
    window: w,
    timeline: filled,
    sources: ((sources.data ?? []) as Record<string, unknown>[]).map((r) => ({
      source: String(r.source ?? ''), referrer_host: String(r.referrer_host ?? ''),
      views: num(r.views), visitors: num(r.visitors),
    })),
    places: ((places.data ?? []) as Record<string, unknown>[]).map((r) => ({
      country: String(r.country ?? ''), region: String(r.region ?? ''), city: String(r.city ?? ''),
      views: num(r.views), visitors: num(r.visitors),
    })),
    devices: ((devices.data ?? []) as Record<string, unknown>[]).map((r) => ({
      device: String(r.device ?? ''), browser: String(r.browser ?? ''),
      views: num(r.views), visitors: num(r.visitors),
    })),
    totals: filled.reduce(
      (t, d) => ({ views: t.views + d.views, visitors: t.visitors + d.visitors, bots: t.bots + d.bots }),
      { views: 0, visitors: 0, bots: 0 },
    ),
  }
}

/**
 * Rows summed to one bar list: a key, a label, and the number the bar is drawn from.
 * `other` collects the tail, because past about seven bars a reader is reading a
 * table and should be given one.
 */
export type Bar = { key: string; label: string; value: number; sub?: string }

export function topBars(rows: Bar[], limit = 7): Bar[] {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value)
  if (sorted.length <= limit) return sorted
  const head = sorted.slice(0, limit - 1)
  const tail = sorted.slice(limit - 1)
  return [...head, { key: 'other', label: 'Other', value: tail.reduce((n, r) => n + r.value, 0) }]
}

/**
 * The day every connected site moved onto the `/event` door.
 *
 * It is the boundary in this table and the page has to say so. Rows before it were
 * written by the old anon door, which recorded a type and a target and nothing
 * else: no source, no location, no device, and no visitor hash — and they can
 * never be given one, because the user agent was never stored. They were never
 * bot-filtered either, so their view counts run high against everything after.
 *
 * Views are still comparable across it, which is why the history was kept (Sam,
 * 2026-09-12) rather than wiped. Everything else starts here.
 */
export const CONTEXT_SINCE = '2026-09-12'

/** Does this window reach back before the sites started sending context? */
export function reachesBeforeContext(w: Window): boolean {
  return w.since < CONTEXT_SINCE
}
