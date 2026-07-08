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
