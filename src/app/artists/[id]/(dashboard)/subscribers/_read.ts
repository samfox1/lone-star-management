import type { createClient } from '@/lib/supabase/server'
import type { Subscriber } from '@/lib/subscribers'

/** What we ask for per request. PostgREST caps a response at `max_rows` (1000 on this
 *  project), which is why this pages at all: one plain select silently stopped at 1000. */
const PAGE = 1000

/**
 * EVERY subscriber of one artist, through the CALLER's client, so RLS (owner-read, see the
 * subscribers migration) scopes it. Used by the page and by the CSV export alike.
 *
 * Paged OLDEST first on (created_at, id): a signup that lands mid-read goes to the END, so
 * the offsets of rows already read never shift and no row is read twice or skipped. The
 * caller sorts for display (`sortSubscribers`, `subscribersCsv`).
 *
 * It stops at the exact count PostgREST reports, not at a short page, so a server that pages
 * smaller than PAGE still yields the whole list. Null on any error: the caller must not show
 * a failed read as "No subscribers yet." or ship it as an empty CSV.
 */
export async function readSubscribers(supabase: Awaited<ReturnType<typeof createClient>>, artistId: string): Promise<Subscriber[] | null> {
  const rows: Subscriber[] = []
  for (;;) {
    const { data, error, count } = await supabase
      .from('subscribers')
      .select('email, created_at', { count: 'exact' })
      .eq('artist_id', artistId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(rows.length, rows.length + PAGE - 1)
    if (error) return null
    const page = data ?? []
    rows.push(...page)
    if (page.length === 0 || count === null || rows.length >= count) return rows
  }
}
