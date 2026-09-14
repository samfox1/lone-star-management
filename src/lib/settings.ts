/**
 * SETTINGS — the few artist-level facts that have no other home (Sam, 2026-09-13):
 * the booking email, the site's address, the name, and the platform address. Instant;
 * nothing here is published.
 *
 * Pure. The page reads and passes in; the view renders what comes out.
 */
import { publicSiteOrigin } from './custom-site'

export type SettingsArtist = { name: string; slug: string; site_kind?: string | null; custom_site_url?: string | null }

/** Where enquiries resolve today, as `booking_recipient_preview` reports it. */
export type Recipient = { to_email: string; recipient_source: string } | null

/** "skeenmusic.com" from "https://www.skeenmusic.com/" — an address as a person says it. */
export function displayAddress(url: string | null | undefined): string {
  if (!url) return ''
  return url
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
}

/**
 * The line under the booking email — STATE, never instruction. Says where enquiries go
 * when that is not simply the address above it: the resolver may still be answering from
 * the site's text or a booking link (a stale one, say), and the manager should see that
 * rather than assume.
 */
export function recipientLine(bookingEmail: string, recipient: Recipient): string | null {
  const own = bookingEmail.trim().toLowerCase()
  if (!recipient) return own ? null : 'No address for enquiries yet'
  if (recipient.to_email.trim().toLowerCase() === own) return 'Enquiries from the site go here'
  return `Enquiries currently go to ${recipient.to_email}`
}

export type SettingsRow = { key: 'booking_email' | 'site' | 'name' | 'address'; label: string; value: string; editable: boolean; mono: boolean; sub?: string | null }

/** The four rows, in order. Site and Address are read-only — a domain is not something
 *  a manager changes from a settings page (Sam, 2026-09-13). */
export function settingsRows(artist: SettingsArtist, bookingEmail: string, recipient: Recipient): SettingsRow[] {
  const site = displayAddress(publicSiteOrigin(artist))
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const address = app ? `${displayAddress(app)}/${artist.slug}` : `/${artist.slug}`
  return [
    { key: 'booking_email', label: 'Booking email', value: bookingEmail, editable: true, mono: true, sub: recipientLine(bookingEmail, recipient) },
    { key: 'site', label: 'Site', value: site || address, editable: false, mono: true },
    { key: 'name', label: 'Name', value: artist.name, editable: true, mono: false },
    { key: 'address', label: 'Address', value: address, editable: false, mono: true },
  ]
}
