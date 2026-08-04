/**
 * Press-kit (EPK) fields: the only two pieces of the press kit a manager types in
 * by hand. Everything else on the EPK is DERIVED from already-published content
 * (bio, photo, releases, contact link) — see `src/app/[slug]/epk/page.tsx`.
 *
 *  • pitch  — one line a journalist can lift straight into a piece.
 *  • quotes — what reviewers said, with who said it and where.
 *
 * Both live on `artists` and ride ARTIST_SNAPSHOT, so they publish with the
 * profile and no new publish button appears (decision 2, 2026-08-04: the PDF and
 * the public /[slug]/epk link must never disagree, so both read PUBLISHED rows).
 *
 * There is deliberately NO press-contact column here. A booking address already
 * resolves from `links` (a mailto row) and, once the enquiries thread lands,
 * `site_content.booking_email`. A fourth copy is a fourth thing to disagree.
 *
 * READ and WRITE are separate on purpose. `cleanPressQuotes` guards the write;
 * `parsePressQuotes` has to survive revisions published before this feature
 * existed, where the key is simply absent. The EPK page must not 500 on an old
 * revision, so parsing coerces rather than throws.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeHref } from '@/lib/url'

export type PressQuote = {
  quote: string
  /** Who said it ('' when the manager didn't say). */
  source: string
  /** Where to read it, or null when absent or unsafe. */
  url: string | null
}

/** A pull-quote, not an essay. */
export const QUOTE_MAX = 300
export const SOURCE_MAX = 120
/** One line, roughly a tweet. */
export const PITCH_MAX = 200
/** More than this is a wall of praise nobody reads, and it stops the list being
 *  an unbounded write into a snapshotted column. */
export const QUOTES_MAX = 8

/** `safeHref` with the EPK's storage rule: unsafe or empty becomes null, never ''. */
function quoteUrl(raw: unknown): string | null {
  return typeof raw === 'string' ? (safeHref(raw) ?? null) : null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Coerce whatever is in a published revision into quotes we can render. Never
 * throws: unknown shapes become [], bad rows are dropped, missing fields are
 * filled. A quote with no text is not a quote, so it goes.
 */
export function parsePressQuotes(raw: unknown): PressQuote[] {
  if (!Array.isArray(raw)) return []
  const out: PressQuote[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const quote = str(r.quote).trim()
    if (quote === '') continue
    out.push({ quote, source: str(r.source).trim(), url: quoteUrl(r.url) })
  }
  return out
}

/** Guard the WRITE: trim, drop blanks, cap length and count, refuse unsafe URLs.
 *  Order is the manager's, so it is preserved rather than sorted. */
export function cleanPressQuotes(input: unknown): PressQuote[] {
  return parsePressQuotes(input)
    .slice(0, QUOTES_MAX)
    .map((q) => ({ ...q, quote: q.quote.slice(0, QUOTE_MAX), source: q.source.slice(0, SOURCE_MAX) }))
}

/** Trim to one line and cap it. Blank means the manager cleared it, which is null
 *  (an empty string would publish as a present-but-empty field). */
export function cleanPressPitch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  return oneLine === '' ? null : oneLine.slice(0, PITCH_MAX)
}

/**
 * Read the quote rows out of the press-kit form. The form posts one entry per row per
 * field (`quote`, `source`, `quote_url`), so the three lists are ZIPPED BY INDEX — the
 * browser preserves document order within a name, which is what keeps row 2's source
 * attached to row 2's quote.
 *
 * A row the manager blanked out disappears here rather than needing a delete button:
 * `cleanPressQuotes` drops anything with no quote text.
 */
export function readPressQuotesFromForm(formData: FormData): PressQuote[] {
  const quotes = formData.getAll('quote')
  const sources = formData.getAll('source')
  const urls = formData.getAll('quote_url')
  return cleanPressQuotes(
    quotes.map((q, i) => ({ quote: q, source: sources[i] ?? '', url: urls[i] ?? '' })),
  )
}

/**
 * Write the press-kit fields to the DRAFT. Pure over an injected client (RLS scopes the
 * write to the caller's tenant) so it is testable without the server-action cookie
 * context; the action wrapper adds revalidation. Nothing here is live until the profile
 * is published.
 */
export async function savePressKit(
  supabase: SupabaseClient,
  artistId: string,
  input: { pitch: unknown; quotes: unknown },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('artists')
    .update({ press_pitch: cleanPressPitch(input.pitch), press_quotes: cleanPressQuotes(input.quotes) })
    .eq('id', artistId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
