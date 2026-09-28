/**
 * How long a piece of site text may be. ONE table, read by the editor's text box (the
 * counter and the refusal) and by the server's save (the refusal), so the two can never
 * disagree about what fits.
 *
 * TOO LONG IS REFUSED, NEVER CUT (Sam, 2026-09-28). The save used to slice every value to
 * 2,000 characters and answer ok, so a long bio "saved" while the database kept only part
 * of it. That is the one state the editor's save model forbids: the panel and the DB
 * disagree and nothing on screen says so.
 *
 * None of these mirror a database constraint: `artists.name`, `artists.bio` and
 * `site_content.value` are plain `text` with no length check. So each cap is a product
 * call, set per kind of text:
 *
 *  • bio: 10,000. A bio renders as paragraphs on the site's about page and in the EPK,
 *    and a full press bio (well over 1,000 words) fits. 2,000 cut real bios short.
 *  • name: 200, the same cap the artist-request and application forms already use.
 *  • any other site text: 2,000. Headings, taglines and captions; a caption strip clips
 *    what overflows, so more than this is invisible on the page anyway.
 */
export const TEXT_LIMITS = { bio: 10_000, name: 200, text: 2_000 } as const

/** Where a text value is written, as far as its cap is concerned: an artist column, or
 *  anything else (site_content by key). Loose on purpose: callers hold several target
 *  shapes (manifest fields, a custom site's announced target) and only these two
 *  properties decide the cap. */
type TextTarget = { store?: string; column?: string } | null | undefined

/** The cap for a text field, by where it is written. */
export function textLimit(target: TextTarget): number {
  if (target?.store === 'artist' && target.column === 'bio') return TEXT_LIMITS.bio
  if (target?.store === 'artist' && target.column === 'name') return TEXT_LIMITS.name
  return TEXT_LIMITS.text
}

/** Whether a value is over its cap. Counts the TRIMMED text, the same thing the save
 *  stores, so spaces around a full-length value never make it "too long". */
export function isTooLong(value: string, max: number): boolean {
  return value.trim().length > max
}

/** When the box starts showing its counter: the last tenth of the allowance. */
export function nearLimit(value: string, max: number): boolean {
  return value.trim().length >= Math.floor(max * 0.9)
}

/** "10,000", not "10000". Fixed locale so the server and the panel print the same. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** The refusal, word for word the same from the panel and from the server. */
export function tooLongError(max: number): string {
  return `Too long to save. Keep it to ${formatCount(max)} characters.`
}
