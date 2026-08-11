/**
 * Per-template editable site-text schema. Each template declares which
 * site_content keys it uses, the editor label, a type-tag (drives validation +
 * XSS-safe rendering), and the hardcoded default (render fallback when unset).
 * Adding a template = adding an entry here + reading the keys in its render path
 * (ADR-0004: "each template declares its editable field schema").
 *
 * Kept free of React so server actions can import it.
 */
import type { SiteContent } from '@/lib/site'
import { CURSOR_CONTENT_KEYS, CURSOR_TRAIL_STYLES } from '@samfox1/site-bridge/cursor'

export type FieldType = 'text' | 'email'

export type SiteContentField = {
  key: string
  label: string
  type: FieldType
  default: string
}

// A CURATED set, not every string in each template. Headings, hero copy, and
// the booking email are editable; fixed chrome (the "Contact" nav label, empty
// states like "No upcoming dates", mute-button labels) stays hardcoded for now.
// Lifting more = add the field here + read it via fieldValue in that template.
export const TEMPLATE_FIELDS: Record<string, SiteContentField[]> = {
  cinematic: [
    { key: 'hero_tagline', label: 'Hero tagline', type: 'text', default: 'DJ & Producer' },
    { key: 'hero_cta', label: 'Hero button label', type: 'text', default: 'Upcoming Shows' },
    { key: 'shows_heading', label: 'Shows heading', type: 'text', default: 'Shows' },
    { key: 'work_heading', label: 'Work heading', type: 'text', default: 'Work' },
    { key: 'videos_heading', label: 'Videos heading', type: 'text', default: 'Videos' },
    { key: 'about_heading', label: 'About heading', type: 'text', default: 'About' },
    { key: 'bookings_heading', label: 'Bookings heading', type: 'text', default: 'Bookings' },
    {
      key: 'booking_inquiry_copy',
      label: 'Booking inquiry text',
      type: 'text',
      default: 'For show & booking enquiries:',
    },
    { key: 'booking_email', label: 'Booking email', type: 'email', default: '' },
  ],
  classic: [
    { key: 'tracks_heading', label: 'Tracks heading', type: 'text', default: 'Tracks' },
    { key: 'videos_heading', label: 'Videos heading', type: 'text', default: 'Videos' },
    { key: 'tour_dates_heading', label: 'Tour dates heading', type: 'text', default: 'Tour dates' },
    { key: 'merch_heading', label: 'Merch heading', type: 'text', default: 'Merch' },
    { key: 'links_heading', label: 'Links heading', type: 'text', default: 'Links' },
    { key: 'community_heading', label: 'Email signup heading', type: 'text', default: 'Stay in touch' },
    // Where contact-form enquiries are delivered. `cinematic` has had this since it
    // renders a mailto: block; `classic` needs it too now that the /contact Edge
    // Function resolves the recipient from it (rung 3 of resolve_booking_recipient).
    // Custom sites carry the same thing as a links row with role='booking' instead.
    // NOTE: this takes effect on enquiries IMMEDIATELY, without a publish — routing is
    // operational config, so correcting a dead address must not require shipping every
    // other in-progress edit alongside it.
    { key: 'booking_email', label: 'Booking email', type: 'email', default: '' },
  ],
}

/** The fields a template exposes for editing (empty if the template has none). */
export function fieldsFor(template: string): SiteContentField[] {
  return TEMPLATE_FIELDS[template] ?? []
}

/**
 * Cross-template SEO overrides. Stored as ordinary `site_content` keys, so they
 * ride the same draft→publish pipeline and surface in `SiteData.site_content`;
 * `lib/seo.ts` reads them for the public `<head>`. All optional — each falls back
 * to an artist-derived default (name, bio, hero image), so an unset field is not
 * "empty SEO", it's "auto".
 */
export const SEO_FIELDS: SiteContentField[] = [
  { key: 'seo_title', label: 'Browser & tab title', type: 'text', default: '' },
  { key: 'seo_description', label: 'Search & social description', type: 'text', default: '' },
  { key: 'og_image', label: 'Social preview image URL', type: 'text', default: '' },
]

/**
 * Site-wide cursor settings (Sam, 2026-08-11). Ordinary `site_content` keys — they
 * publish and reach a connected site with no migration — but they are NOT SiteContentField
 * text: two are URLs that end up inside a `cursor: url("…")` CSS value on the site, one
 * is a closed enum, one is a hex. So they get their own registry + validator instead of
 * widening FieldType (see the fieldHref docblock below for why url-typed text is a trap).
 * DERIVED from the package's constants (AGENTS.md rule 4): the editor, the wire message,
 * and the site applier can never disagree on a key name.
 */
export const CURSOR_KEYS: readonly string[] = Object.values(CURSOR_CONTENT_KEYS)

// httpS only — media URLs come from Supabase storage, which is always https, and an
// http cursor on an https site is mixed content the browser silently drops (the artist
// would just see a default arrow, with nothing to debug).
const CURSOR_URL_RE = /^https:\/\/[^\s"'\\]+$/i
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/

/** Why a cursor value can't persist, or null when it can. '' always clears. */
export function cursorValueError(key: string, value: string): string | null {
  if (!CURSOR_KEYS.includes(key)) return 'Unknown cursor field.'
  if (value === '') return null
  if (key === CURSOR_CONTENT_KEYS.image || key === CURSOR_CONTENT_KEYS.click)
    return CURSOR_URL_RE.test(value) ? null : 'Cursor image must be an https URL.'
  if (key === CURSOR_CONTENT_KEYS.trail)
    return (CURSOR_TRAIL_STYLES as readonly string[]).includes(value) ? null : 'Unknown trail style.'
  return HEX_RE.test(value) ? null : 'Trail color must be a hex value.'
}

const EMAIL_RE = /^[^\s:@]+@[^\s:@]+\.[^\s:@]+$/

/** Whether a raw value is acceptable to persist for a field (write-side guard;
 *  emails must look like an address so junk/scheme payloads never store). */
export function acceptsValue(field: SiteContentField, raw: string): boolean {
  if (field.type === 'email') return EMAIL_RE.test(raw)
  return true
}

/** Resolve a site-text key for rendering: the published/working override, else
 *  the template default. An empty override counts as "unset" → default. */
export function fieldValue(content: SiteContent, template: string, key: string): string {
  const field = TEMPLATE_FIELDS[template]?.find((f) => f.key === key)
  const override = content[key]
  return override != null && override !== '' ? override : (field?.default ?? '')
}

/**
 * A SAFE href for a link-bearing site-text field, or undefined (caller renders no
 * link). The XSS guard for kv site text: a stored `javascript:` never becomes a live
 * link.
 *
 * EMAIL is the only link-bearing type. Text fields never reach here — they render as
 * React-escaped text, not hrefs — and there is no url-typed TEMPLATE_FIELDS entry. A
 * `safeHref` fallthrough for one lived here and was unreachable: the only value ever
 * passed in is booking_email, and the SEO_FIELDS url (og_image) is not in
 * TEMPLATE_FIELDS at all, so it could never resolve here (lib/seo.ts sanitizes it
 * directly). Adding a url-typed field means adding its safeHref branch back here first.
 */
export function fieldHref(content: SiteContent, template: string, key: string): string | undefined {
  const field = TEMPLATE_FIELDS[template]?.find((f) => f.key === key)
  if (field?.type !== 'email') return undefined
  const value = fieldValue(content, template, key)
  // Only a plausible address becomes a mailto; a scheme payload renders no link.
  return value && acceptsValue(field, value) ? `mailto:${value}` : undefined
}
