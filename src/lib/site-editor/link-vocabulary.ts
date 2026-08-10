/**
 * WHAT MAY BE ADDED TO AN ARTIST'S LINK ROW — one pure rule, called at the user-facing
 * door.
 *
 * Two constraints, both of which exist because THE LABEL IS THE ADDRESS. A connected
 * site maps a social to its mark by the label (`item:link:instagram`), and the editor
 * routes a frame click back the same way:
 *
 *   • a KNOWN platform only (Sam, 2026-08-10: "I would remove the possibility for an
 *     unknown platform to be added… Remove the way to add another site"). An
 *     unrecognized label has no mark to draw, so it lands as raw text in a row of
 *     glyphs — and on a site that skips what it cannot draw, it lands as nothing at all.
 *   • ONCE. Two rows labelled "Instagram" render two identical icons a manager cannot
 *     tell apart, and make the frame→panel select ambiguous.
 *
 * CONTACT LINKS ARE EXEMPT. A `mailto:`/`tel:` row is a booking address, not a social;
 * it has its own group in the editor and never renders in the socials row.
 *
 * WHY IT LIVES AT THE ACTION, NOT IN `createContent`: the data-layer primitive is also
 * how fixtures and sync write rows, and a global uniqueness rule there coupled every
 * live-DB suite through one shared seed artist — tests colliding on each other's labels,
 * which is the failure AGENTS.md rule 6 describes. Keeping the rule pure and calling it
 * from `addContentAction` closes both user doors (the editor's picker and the /links
 * page's form) without constraining the primitive.
 */
import { socialPlatform, socialSlug } from '@samfox1/site-bridge/social'
import { isContactLink } from '@/lib/url'

/**
 * Why this link may not be added, or null when it may.
 *
 * `existingLabels` is every label the artist already has. Pure, so the caller owns the
 * read and this stays trivially testable.
 */
export function linkAddError(existingLabels: readonly string[], label: string, url: string): string | null {
  const slug = socialSlug(label)
  // A blank label is a column constraint, not a vocabulary problem. Answering here would
  // turn a NOT NULL violation into a confusing "already on this site".
  if (!slug) return null
  if (isContactLink(url)) return null

  if (!socialPlatform(label)) return `“${label.trim()}” isn’t a platform we know. Pick one from the list.`
  if (existingLabels.some((l) => socialSlug(l) === slug)) return `${label.trim()} is already on this site.`
  return null
}
