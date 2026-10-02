/**
 * WHAT A TOUR PULL WRITES, decided before anything is written (Eventbrite, Sam 2026-09-28:
 * shows arrive as drafts, "never duplicated on re-pull", "never overwriting a manager's
 * edits").
 *
 * The older tour syncs (Bandsintown, Ticketmaster: `syncExternal` in lib/sync.ts) refresh
 * every column of a row they own on every pull, so a manager's fix to a venue name is undone
 * by the next Pull now (that file's header says so). This is the rule that replaces it for
 * Eventbrite, a THREE-WAY MERGE per column:
 *
 *   every pulled row remembers what the pull last wrote (`tour_dates.pulled`, column →
 *   value). On the next pull a column changes only while the row still holds that value.
 *   A column the manager changed (or emptied) no longer does, so it keeps the manager's
 *   value for good; a column nobody touched follows the source (the venue moved: it moves).
 *
 * Matching is by the source's stable id (`eventbrite_id`), so the same event is one row
 * however often it is pulled, and a row another source owns is never written.
 *
 * Pure: no database, no network. The writer is `syncEventbriteTourDates` (lib/sync.ts).
 */
import { slotByDate, type DatedRow } from './insert-position'

/** The columns a pull writes, and so the only ones it remembers. A manager-only column
 *  (support acts, the past flag, on-site, order) is never in here. */
export const PULLED_COLUMNS = ['date', 'venue', 'city', 'state', 'country', 'ticket_url', 'latitude', 'longitude'] as const
type PulledColumn = (typeof PULLED_COLUMNS)[number]
type PulledValues = Record<PulledColumn, string | number | null>

/** One show as the source sends it: its stable id and the columns it owns. */
export type IncomingShow = { externalId: string; values: PulledValues }

/** A working row as the pull reads it. `pulled` is what the pull wrote last time. */
export type ExistingTourRow = {
  id: string
  source: string
  eventbrite_id: string | null
  pulled: Partial<Record<string, unknown>> | null
} & Partial<Record<PulledColumn, unknown>>

export type TourPullPlan = {
  inserts: IncomingShow[]
  /** `patch` is what the manager will see change (possibly nothing); `pulled` is the new
   *  memory, always written with it. */
  updates: { id: string; externalId: string; patch: Partial<PulledValues>; pulled: PulledValues }[]
  /** Matched, and nothing at all to write. */
  unchanged: number
  /** Left alone on purpose: a row another source owns, or a manager's edit that kept a
   *  change from the source out. */
  skipped: number
}

/** Same value? Null and undefined are both "empty". A float read back from Postgres and the
 *  one stored in json are the same double, so plain equality is exact. */
function same(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null)
}

export function planTourPull(existing: readonly ExistingTourRow[], incoming: readonly IncomingShow[], idColumn: 'eventbrite_id' = 'eventbrite_id', source = 'eventbrite'): TourPullPlan {
  const byId = new Map<string, ExistingTourRow>()
  for (const row of existing) {
    const ext = row[idColumn]
    if (ext) byId.set(ext, row)
  }
  // The source can repeat an event; one row per id, last wins.
  const deduped = Array.from(new Map(incoming.map((s) => [s.externalId, s])).values())

  const plan: TourPullPlan = { inserts: [], updates: [], unchanged: 0, skipped: 0 }
  for (const show of deduped) {
    const row = byId.get(show.externalId)
    if (!row) {
      plan.inserts.push(show)
      continue
    }
    if (row.source !== source) {
      plan.skipped++
      continue
    }
    const memory = row.pulled ?? {}
    const patch: Partial<PulledValues> = {}
    let kept = false
    let memoryChanged = false
    for (const col of PULLED_COLUMNS) {
      const next = show.values[col]
      // Untouched = the row still holds exactly what the pull wrote. No memory of a pull
      // for this column means the pull never wrote it: the value is the manager's.
      const untouched = Object.prototype.hasOwnProperty.call(memory, col) && same(row[col], memory[col])
      if (!same(memory[col], next)) memoryChanged = true
      if (same(row[col], next)) continue
      if (untouched) patch[col] = next
      else kept = true
    }
    const changed = Object.keys(patch).length > 0
    if (changed || memoryChanged) {
      plan.updates.push({ id: row.id, externalId: show.externalId, patch, pulled: { ...show.values } })
    } else plan.unchanged++
    if (!changed && kept && memoryChanged) plan.skipped++
  }
  return plan
}

/**
 * Where the new rows go: the full id order with each slotted in by date, or null when the
 * list has never been dragged (the door and the site already order by date, and numbering
 * rows now would flip the list into manual mode — `slotByDate`'s rule, which the tour
 * page's own Add uses).
 */
export function slotNewRows(rows: readonly DatedRow[], added: readonly { id: string; date: string | null }[]): string[] | null {
  const dates = new Map<string, string | null>([...rows.map((r) => [r.id, r.date] as const), ...added.map((a) => [a.id, a.date] as const)])
  let current: DatedRow[] = [...rows]
  let order: string[] | null = null
  // One at a time, each into the order the last one made. The order they come in does not
  // change where they land: each goes after the last show dated on or before it.
  for (const a of added) {
    order = slotByDate(current, a.id, a.date)
    if (!order) return null
    current = order.map((id, i) => ({ id, date: dates.get(id) ?? null, sort_order: i }))
  }
  return order
}
