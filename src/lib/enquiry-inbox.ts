/**
 * The inbox's pure rules.
 *
 * Kept out of the component on purpose: what a row says before you open it, and what is
 * open when you arrive, are product decisions worth stating and testing plainly. The
 * component is then only responsible for the split pane.
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
}

export type InboxFilter = 'all' | 'unread'

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

export function filterRows(rows: InboxRow[], filter: InboxFilter): InboxRow[] {
  return filter === 'unread' ? rows.filter((r) => !r.read_at) : rows
}

/**
 * Which message is open when the page loads.
 *
 * The newest UNREAD, not simply the newest. The reason a manager opens this page is the
 * thing they have not read yet; landing on something they already dealt with makes them
 * do the finding themselves. Falls back to the newest when everything is read, so the
 * pane is never empty for no reason.
 *
 * `rows` is expected newest-first, as the page queries it.
 */
export function initialSelection(rows: InboxRow[]): string | null {
  if (rows.length === 0) return null
  return (rows.find((r) => !r.read_at) ?? rows[0]).id
}
