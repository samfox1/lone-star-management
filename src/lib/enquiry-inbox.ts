/**
 * The enquiries table's pure rules.
 *
 * A TABLE, not a mail client. These messages are a record kept in case something is lost
 * — nobody replies to a booking from in here, they reply from their own mail. So the job
 * is dense, scannable, filterable storage, and the rules worth stating are what a row
 * says and what each filter means.
 *
 * (There is no `initialSelection` any more. An inbox opens something for you because you
 * came to read; an archive opens nothing, because you came to look something up.)
 */

export type InboxRow = {
  id: string
  purpose: string
  name: string
  email: string
  message: string
  read_at: string | null
  created_at: string
  demo_url: string | null
  /** Shown as a badge in the list, so the manager can see a demo has audio without
   *  opening it. A count, not the files — signing happens on open. */
  attachmentCount: number
  /** Which artist this came in for. Always present, because the same inbox serves the
   *  whole roster and one artist — the difference is whether the LABEL is shown, not
   *  whether the data is there. Read/unread writes need it too. */
  artistId: string
  artistName: string
  /** 'queued' | 'sent' | 'failed' | 'unroutable'. Surfaced because a manager reading this
   *  table would otherwise assume the message was emailed — and while mail is not
   *  configured, none of them are. */
  status: string
}

export type InboxFilter = 'all' | 'unread' | 'demos'

/**
 * One line of the message, for the list.
 *
 * Newlines and runs of whitespace collapse, because a raw message would blow the row
 * height apart and the list would stop being scannable — which is the only reason the
 * list exists. Truncation cuts on a WORD boundary: "Can you play the Aug…" reads like a
 * preview, "Can you play the Au…" reads like a bug.
 */
export function snippet(message: string, max = 90): string {
  const flat = (message ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat

  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  // Only honour the word boundary if it isn't absurdly early (one very long word).
  const body = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut
  return `${body.replace(/[.,;:!?-]+$/, '')}…`
}

/** `demos` is a KIND, not a status, so it deliberately ignores read state: the manager
 *  batching demos wants all of them, not only the new ones. */
export function filterRows(rows: InboxRow[], filter: InboxFilter): InboxRow[] {
  if (filter === 'unread') return rows.filter((r) => !r.read_at)
  if (filter === 'demos') return rows.filter((r) => r.purpose === 'demo')
  return rows
}

/** The artists that actually appear in these rows, for the roster-wide filter. Built from
 *  the rows rather than the roster on purpose: an artist with no enquiries would be an
 *  option that can only ever return an empty table. */
export function artistsIn(rows: InboxRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) if (!seen.has(r.artistId)) seen.set(r.artistId, r.artistName)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** `'all'` means no filtering, so the caller can hold one string for both states. */
export function filterByArtist(rows: InboxRow[], artistId: string): InboxRow[] {
  return artistId === 'all' ? rows : rows.filter((r) => r.artistId === artistId)
}
