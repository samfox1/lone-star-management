/**
 * The analytics event types — one source for the client tracker (validation) and
 * the dashboard insights (labels). The Postgres CHECK + record_event allowlist
 * are the SQL-side copy (TS↔SQL duplication is unavoidable, like ARTIST_SNAPSHOT).
 */
export const EVENT_TYPES = [
  { type: 'view', label: 'Views' },
  { type: 'play', label: 'Plays' },
  { type: 'link_click', label: 'Link clicks' },
  { type: 'ticket_click', label: 'Ticket clicks' },
  { type: 'buy_click', label: 'Buy clicks' },
] as const

export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES.map((e) => e.type))
