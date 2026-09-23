/**
 * Enquiry kinds: turning a manager's typed label into the slug their website will post.
 *
 * THE SLUG IS NOT A NAME. It is the value the artist's site sends as `purpose`, and
 * `resolve_enquiry_recipients` matches it by equality against `enquiry_kinds.slug` to find
 * that kind's recipient list. It is also IMMUTABLE — a trigger refuses any change, because
 * renaming it would leave the site posting a word that matches no kind and every enquiry of
 * that kind would quietly fall back to the primary with its list skipped, no error anywhere
 * (see 20260921120000). The label is the part a human reads and can be changed at will.
 *
 * So the derivation below has exactly one hard requirement: whatever it returns must satisfy
 * `ek_slug_fmt`, `^[a-z0-9][a-z0-9-]{0,39}$`. A malformed slug is not an ugly name, it is a
 * failed insert — or, if that CHECK ever loosened, a kind nothing can route to and nobody
 * can rename.
 *
 * Pure and DB-free on purpose: this is the piece worth mutation-testing, so it lives here
 * rather than inside the server action that calls it.
 */

/**
 * Mirrors `ek_slug_fmt`'s length bound on enquiry_kinds.
 *
 * There is deliberately NO exported SLUG_RE beside it. One was here and nothing used it:
 * this module never tests a slug, it BUILDS one, and the only real check is the database's
 * own CHECK. An exported copy would be a second statement of the same rule that could drift
 * from the SQL with nothing to notice — and mutation testing found it immediately, because
 * five separate mutations of that regex changed no behaviour anyone could observe. The
 * test file keeps its own literal copy on purpose: there it is the SPECIFICATION being
 * asserted against, not an implementation detail to import.
 */
export const SLUG_MAX = 40

/** What a label yields when nothing in it survives (punctuation, or a non-Latin script we
 *  cannot transliterate). Returning '' would simply fail the CHECK, and the caller has no
 *  better answer to offer than a generic word the manager can see and re-label. */
const SLUG_FALLBACK = 'kind'

/**
 * A label ("Sync licensing") as the slug a site will post ("sync-licensing").
 *
 * Accents are STRIPPED TO THEIR BASE LETTER rather than dropped: 'Café' is 'cafe', not
 * 'caf'. Dropping the character silently changes the word, and the manager never sees the
 * slug again to notice.
 */
export function slugFromLabel(label: string): string {
  const slug = (label ?? '')
    // Decompose, then remove the combining marks — é becomes e + ́ and the mark goes.
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Everything that is not a slug character becomes a separator, then runs collapse.
    // One pass, so `A  --  B` cannot leave `a--b`.
    .replace(/[^a-z0-9]+/g, '-')
    // `-+` rather than `-` is belt and braces: the line above already guarantees single
    // hyphens, so mutating either quantifier here changes nothing observable and Stryker
    // reports it as survived. Kept anyway — the cost is a known-equivalent mutant, and the
    // alternative is a trim that silently under-trims if the collapse is ever reordered.
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    // The slice can land mid-run and leave a trailing hyphen, which fails the CHECK.
    .replace(/-+$/, '')

  return slug === '' ? SLUG_FALLBACK : slug
}

/**
 * `base`, or the first `base-N` that nobody has claimed.
 *
 * `(artist_id, slug)` is UNIQUE, so without this a second kind labelled "Press" is a raw
 * 23505 for the manager to decipher when the obvious intent was a second list.
 *
 * The BASE gives ground when a suffix would push past 40, never the suffix — the suffix is
 * the only part making it unique, so trimming that instead would loop forever.
 */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((s) => s.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base

  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const head = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')
    const candidate = `${head || SLUG_FALLBACK}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

// ---------------------------------------------------------------------------
// The kind as the dashboard reads it
// ---------------------------------------------------------------------------
/** The slug every unrecognised purpose is filed under. Seeded on every artist, undeletable. */
export const PURPOSE_FALLBACK = 'other'

/** Mirrors `ek_label_clean` on enquiry_kinds. */
export const LABEL_MAX = 60

/** Mirrors the cap trigger on enquiry_recipients (`enforce_enquiry_recipient_cap`). */
export const RECIPIENT_CAP = 10

export type EnquiryKindRow = {
  id: string
  slug: string
  label: string
  sortOrder: number
  recipients: { id: string; email: string; label: string | null }[]
}

/** The shape PostgREST returns for `enquiry_kinds(…, enquiry_recipients(…))`. */
export type RawKindRow = {
  id: string
  slug: string
  label: string
  sort_order: number
  enquiry_recipients: { id: string; email: string; label: string | null; created_at: string }[] | null
}

/**
 * The embedded select as rows the page and the modal read. Each list is ordered by
 * `created_at` then `id` — the SAME order `resolve_enquiry_recipients` addresses them in,
 * so what the manager sees is the order the To: header will carry.
 */
export function toKindRows(raw: RawKindRow[] | null | undefined): EnquiryKindRow[] {
  return (raw ?? []).map((k) => ({
    id: k.id,
    slug: k.slug,
    label: k.label,
    sortOrder: k.sort_order,
    recipients: [...(k.enquiry_recipients ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((r) => ({ id: r.id, email: r.email, label: r.label })),
  }))
}

/**
 * What a slug reads as when no kind carries a label for it — `initcap(replace(slug, '-',
 * ' '))`, the same fallback `submit_enquiry` uses for the email subject, so the inbox and
 * the mail never disagree about a kind that has since been deleted.
 */
export function labelFromSlug(slug: string): string {
  // No lowercasing of the tail: a slug is lowercase by `ek_slug_fmt` and the purpose CHECK,
  // so that call could never change anything — and mutation testing said so.
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * A slug → label lookup for one artist's kinds, falling back to `labelFromSlug`. The inbox
 * used to carry its own three-entry map; kinds are the artist's to rename and invent now,
 * so the only correct source is the table.
 */
export function kindLabeller(kinds: readonly { slug: string; label: string }[]): (slug: string) => string {
  const byslug = new Map(kinds.map((k) => [k.slug, k.label]))
  return (slug) => byslug.get(slug) ?? labelFromSlug(slug)
}

/**
 * ASCII-only, printable, one `@`, a dot in the domain. Stricter than the storage CHECK on
 * purpose: an address carrying a pasted zero-width space passes `er_email_fmt` and
 * `pickRecipients` alike, and Resend then rejects the WHOLE send — every recipient,
 * including the primary. The dashboard is the one place a human can be told.
 */
export const RECIPIENT_EMAIL_RE = /^[\x21-\x3f\x41-\x7e]+@[\x21-\x3f\x41-\x7e]+\.[\x21-\x3f\x41-\x7e]+$/

/**
 * Why a candidate address cannot join a list, or null if it can. The database enforces
 * every one of these too; this is what lets the dashboard say so BEFORE a save rather than
 * after — and, since the save is atomic, a refusal there now costs nothing either.
 */
export function recipientProblem(existing: readonly string[], candidate: string): string | null {
  const email = candidate.trim()
  if (!RECIPIENT_EMAIL_RE.test(email)) return 'That does not look like an email address.'
  if (existing.some((e) => e.trim().toLowerCase() === email.toLowerCase())) return 'That address is already on the list.'
  if (existing.length >= RECIPIENT_CAP) return `A list holds at most ${RECIPIENT_CAP} people.`
  return null
}
