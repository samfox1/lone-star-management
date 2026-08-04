/**
 * Cross-artist enquiry rollup: the manager-facing "who needs answering" view.
 *
 * The counts come from `enquiry_counts_by_artist`, a `security_invoker` view over
 * `enquiries` — the same shape `subscriber_counts_by_artist` uses for the Book. That
 * means no second permission model: RLS on `enquiries` (is_admin() OR is_manager_of)
 * flows straight through the group-by, so a manager can never see another tenant's
 * volume, let alone their messages.
 */

export type EnquiryRosterRow = {
  id: string
  name: string
  /** Every enquiry this artist has received, read or not. */
  total: number
  unread: number
  /** The most recent enquiry's timestamp, or null when there are none. */
  latestAt: string | null
}

/**
 * Order the roster the way a manager triages it.
 *
 * `unread` is treated as a BOOLEAN, not a magnitude, and that is the one judgement call
 * in here. The brief says "unread first, then most recent", and separately that the page
 * answers "who needs attention today" — which disagree when an artist has a big stale
 * pile and another has one fresh message. Recency wins: a backlog is not an alert, and
 * sorting by pile size would bury the message that actually arrived this morning.
 *
 * Name is the final key so two quiet artists don't swap places between renders.
 * Returns a new array; the caller's data is left alone.
 */
export function sortByAttention(rows: EnquiryRosterRow[]): EnquiryRosterRow[] {
  return [...rows].sort((a, b) => {
    const aUnread = a.unread > 0 ? 1 : 0
    const bUnread = b.unread > 0 ? 1 : 0
    if (aUnread !== bUnread) return bUnread - aUnread

    // Null (never had an enquiry) sorts last within its group.
    const aAt = a.latestAt ? Date.parse(a.latestAt) : -Infinity
    const bAt = b.latestAt ? Date.parse(b.latestAt) : -Infinity
    if (aAt !== bAt) return bAt - aAt

    return a.name.localeCompare(b.name)
  })
}

/** Shape of one `enquiry_counts_by_artist` row, as PostgREST returns it. */
export type EnquiryCountRow = {
  artist_id: string
  total: number
  unread: number
  latest_at: string | null
}

/**
 * Join the manager's artists to their counts.
 *
 * An artist with no enquiries has NO row in the view (it groups over `enquiries`), so the
 * absence is normal and means zero — not missing data. Keeping that mapping here rather
 * than in the page is what lets the ordering above be tested without a database.
 */
export function buildRoster(
  artists: { id: string; name: string }[],
  counts: EnquiryCountRow[],
): EnquiryRosterRow[] {
  const byArtist = new Map(counts.map((c) => [c.artist_id, c]))
  return sortByAttention(
    artists.map((a) => {
      const c = byArtist.get(a.id)
      return {
        id: a.id,
        name: a.name,
        total: Number(c?.total ?? 0),
        unread: Number(c?.unread ?? 0),
        latestAt: c?.latest_at ?? null,
      }
    }),
  )
}
