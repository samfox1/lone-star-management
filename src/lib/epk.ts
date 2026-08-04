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
import type { SiteData } from '@/lib/site'
import { isOwnedStoragePath } from '@/lib/upload'
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

/* ── Press documents ────────────────────────────────────────────────────────────── */

/** The storage folder press documents live under, in the PRIVATE `documents` bucket. */
export const DOCUMENTS_FOLDER = 'documents'

export type PressDocumentKind = 'tech_rider' | 'stage_plot'

const DOCUMENT_COLUMN: Record<PressDocumentKind, string> = {
  tech_rider: 'tech_rider_path',
  stage_plot: 'stage_plot_path',
}

/**
 * Point one press document at an uploaded PDF, or clear it with `null`.
 *
 * Two guards on the path, because it arrives from the CLIENT — the browser uploads
 * direct-to-Storage and then asks us to record where it landed:
 *
 *  1. It must belong to this artist (`isOwnedStoragePath`), the same rule brand assets use.
 *  2. It must be in the `documents` folder. Without this a rider could be recorded at a
 *     path in the PUBLIC `media` bucket's layout, and a document the manager chooses who
 *     receives would be world-readable by URL — the whole reason documents got their own
 *     private bucket.
 *
 * Pure over an injected client; RLS scopes the write, and the action wrapper revalidates.
 */
export async function setPressDocument(
  supabase: SupabaseClient,
  artistId: string,
  kind: PressDocumentKind,
  storagePath: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (storagePath !== null) {
    if (!isOwnedStoragePath(artistId, storagePath))
      return { ok: false, error: 'That file location is not valid.' }
    if (!storagePath.startsWith(`${artistId}/${DOCUMENTS_FOLDER}/`))
      return { ok: false, error: 'A press document must be uploaded as a document.' }
  }

  const { error } = await supabase
    .from('artists')
    .update({ [DOCUMENT_COLUMN[kind]]: storagePath })
    .eq('id', artistId)
  return error ? { ok: false, error: error.message } : { ok: true }
}

/* ── The download gate ──────────────────────────────────────────────────────────── */

export type EpkRequirementKey = 'bio' | 'photo' | 'contact' | 'release'

export type EpkRequirement = {
  key: EpkRequirementKey
  /** What the manager is being asked for. */
  label: string
  /** Where to go and do something about it — the only place they learn WHY it's off. */
  hint: string
  met: boolean
}

/** A loose check, not RFC 5322: enough to catch a typo or a name typed into an email
 *  box, without rejecting the unusual-but-valid addresses real bookers use. */
const looksLikeEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/**
 * Can this artist's press kit be generated yet, and what is still missing?
 *
 * All four must be present (Sam, 2026-08-04): a half-empty press kit sent to a promoter
 * is worse than none, and the manager can't be expected to know what a promoter expects.
 *
 * Reads PUBLISHED data on purpose. The PDF is built from published content so the file
 * and the public link can never disagree, which means a gate reading working rows would
 * switch the button on while the PDF came out empty. `site: null` — nothing published at
 * all — therefore fails everything rather than passing vacuously.
 *
 * Photo and contact each accept more than one source, because the manager has more than
 * one place to put them and the question here is whether the press kit WORKS, not which
 * field got used. Both mirror what `/[slug]/epk` actually renders, so the gate can never
 * promise something the page won't show.
 */
export function epkReadiness(input: {
  site: SiteData | null
  /** Published releases (`get_public_releases`), which the EPK lists as the discography. */
  releaseCount: number
}): { requirements: EpkRequirement[]; ready: boolean } {
  const { site, releaseCount } = input

  const hasBio = !!site?.artist.bio?.trim()
  // The page renders profile_photo, falling back to the hero image. A gallery image is
  // neither, so a full gallery with no portrait still leaves the header empty.
  const hasPhoto =
    !!site?.media.some((m) => m.purpose === 'profile_photo') || !!site?.artist.hero_image_url?.trim()
  const hasContact =
    !!site?.links.some((l) => l.url?.toLowerCase().startsWith('mailto:')) ||
    looksLikeEmail(site?.site_content?.booking_email ?? '')

  const requirements: EpkRequirement[] = [
    { key: 'bio', label: 'A bio', hint: 'Add one on the Site page, then publish.', met: hasBio },
    {
      key: 'photo',
      label: 'A photo',
      hint: 'Add a profile photo or a hero image on the Site page, then publish.',
      met: hasPhoto,
    },
    {
      key: 'contact',
      label: 'A contact email',
      hint: 'Add a booking address on the Links page, then publish.',
      met: hasContact,
    },
    {
      key: 'release',
      label: 'At least one release',
      hint: 'Publish a release on the Music page.',
      met: !!site && releaseCount > 0,
    },
  ]

  return { requirements, ready: requirements.every((q) => q.met) }
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
