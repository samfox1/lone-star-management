/**
 * SETTINGS · GENERAL — the artist-level facts that have no other home (Sam, 2026-09-13): the
 * site's address and the platform address, both read-only. The name moved to Profile on
 * 2026-10-02 (PROFILE_TOOL_PLAN.md); the booking email moved to Settings › Email the same day
 * ("Remove email from General"), where it is the Booking row's first address
 * (lib/enquiries/booking.ts).
 *
 * Pure. The page reads and passes in; the view renders what comes out.
 */
import { publicSiteOrigin } from './custom-site'

export type SettingsArtist = { name: string; slug: string; site_kind?: string | null; custom_site_url?: string | null }

/** "skeenmusic.com" from "https://www.skeenmusic.com/" — an address as a person says it. */
export function displayAddress(url: string | null | undefined): string {
  if (!url) return ''
  return url
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
}

export type SettingsRow = { key: 'site' | 'address'; label: string; value: string }

/** The rows, in order. Both read-only: a domain is not something a manager changes from a
 *  settings page (Sam, 2026-09-13). Site shows only when it is somewhere ELSE: an artist with no
 *  site of their own has the platform page as both, and a second line saying the same address
 *  adds nothing (Sam, 2026-10-02: only text that adds value). */
export function settingsRows(artist: SettingsArtist): SettingsRow[] {
  const site = displayAddress(publicSiteOrigin(artist))
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const address = app ? `${displayAddress(app)}/${artist.slug}` : `/${artist.slug}`
  const rows: SettingsRow[] = []
  if (site && site !== address) rows.push({ key: 'site', label: 'Site', value: site })
  rows.push({ key: 'address', label: 'Address', value: address })
  return rows
}
