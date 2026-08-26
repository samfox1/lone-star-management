/**
 * Alt-text recommendation (SEO_GEO_PLAN B6b). ONE rule, shared by the editor (the
 * preset it shows) and every site (what it renders when the manager typed nothing), so
 * the preview never promises an alt the site won't ship.
 *
 * It composes what the data already knows and never invents: who (the artist), what
 * (a caption or title), and how the image is listed (photo vs artwork). Shorthand a
 * manager types in a caption ("Tour w: Jigitz") is expanded so the sentence reads
 * aloud ("tour with Jigitz"): alt text is spoken by screen readers and quoted by
 * crawlers, neither of which knows "w:".
 */

export type AltInput = {
  /** The artist's name. */
  artist?: string | null
  /** A caption or title the manager already maintains (a polaroid strip, a works-pool label). */
  caption?: string | null
  /** `photo` (default) or `artwork` — flips the sentence shape. Anything else = photo. */
  kind?: string | null
}

/** "w:" / "w/" → "with", "feat." → "featuring", squashed whitespace, no trailing dots. */
export function tidyCaption(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\bw[:/]\s*/gi, 'with ')
    .replace(/\bfeat\.?\s+/gi, 'featuring ')
    .replace(/\s*[.。]+\s*$/u, '')
    .trim()
}

/**
 * The recommended alt. Photo: "Skeen, Tour with Jigitz" (who, what). Artwork: "Untitled
 * by Skeen" (what by whom). No artist and no caption → '' — an empty alt is honest;
 * "image" is not.
 */
/** The file name to match: "Skeen, Tour with Jigitz" → `skeen-tour-with-jigitz`.
 *  Lowercase ASCII, digits and single dashes, at most 80 chars, '' when nothing is left. */
export function recommendSlug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

export function recommendAlt(input: AltInput): string {
  const who = (input.artist ?? '').replace(/\s+/g, ' ').trim()
  const rawWhat = tidyCaption(input.caption ?? '')
  if (input.kind === 'artwork') {
    if (rawWhat && who) return `${rawWhat} by ${who}`
    return rawWhat || (who ? `Artwork by ${who}` : '')
  }
  // The caption keeps the manager's capitalisation: guessing proper nouns gets it wrong.
  return [who, rawWhat].filter(Boolean).join(', ')
}
