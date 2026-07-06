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
import { safeHref } from '@/lib/url'

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
 * A SAFE href for an email/url-typed field, or undefined (caller renders no
 * link). The XSS guard for kv site text: a stored `javascript:` never becomes a
 * live link. Text fields don't use this — they render as React-escaped text.
 */
export function fieldHref(content: SiteContent, template: string, key: string): string | undefined {
  const field = TEMPLATE_FIELDS[template]?.find((f) => f.key === key)
  if (!field) return undefined
  const value = fieldValue(content, template, key)
  if (!value) return undefined
  if (field.type === 'email') {
    // Only a plausible address becomes a mailto; a scheme payload renders no link.
    return acceptsValue(field, value) ? `mailto:${value}` : undefined
  }
  return safeHref(value)
}
