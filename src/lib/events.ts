/**
 * The on-site event contract — one home for what a fan interaction records and how
 * an emitter declares it. The public templates never hand-write `data-*` strings;
 * they call `trackAttrs`, which is the single typed seam that SiteAnalytics reads and
 * record_event ingests. The Postgres CHECK + record_event allowlist are the SQL-side
 * copy (TS↔SQL duplication is unavoidable, like ARTIST_SNAPSHOT).
 */
export const EVENT_TYPES = [
  { type: 'view', label: 'Views' },
  { type: 'play', label: 'Plays' },
  { type: 'link_click', label: 'Link clicks' },
  { type: 'ticket_click', label: 'Ticket clicks' },
  { type: 'buy_click', label: 'Buy clicks' },
  { type: 'video_click', label: 'Video clicks' },
] as const

export type OnSiteEvent = (typeof EVENT_TYPES)[number]['type']
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES.map((e) => e.type))

/** Content kinds an event can be ATTRIBUTED to (mirrors record_event's SQL allowlist). */
export const ENTITY_KINDS = ['release', 'track', 'merch', 'video', 'tour_date', 'link'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/** The item an event is about: its kind + id, plus an optional human label (the venue
 *  name / item title we store as `target` for readability). */
export type TrackedEntity = { kind: EntityKind; id: string; label?: string }

type TrackAttrs = {
  'data-track': OnSiteEvent
  'data-target'?: string
  'data-entity-id'?: string
  'data-entity-type'?: EntityKind
}

/**
 * The typed emitter seam. Spread the result onto a public-site element and its click
 * (or, for `view`, mount) records the event. Passing an `entity` attributes the event
 * to a specific content row — you can't forget an attribute or use an off-allowlist
 * type, which is exactly what used to break silently across the hand-written emitters.
 */
export function trackAttrs(
  event: OnSiteEvent,
  opts: { entity?: TrackedEntity; label?: string } = {},
): TrackAttrs {
  const attrs: TrackAttrs = { 'data-track': event }
  const label = opts.label ?? opts.entity?.label
  if (label) attrs['data-target'] = label
  if (opts.entity) {
    attrs['data-entity-id'] = opts.entity.id
    attrs['data-entity-type'] = opts.entity.kind
  }
  return attrs
}
