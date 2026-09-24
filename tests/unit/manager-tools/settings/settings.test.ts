// The Settings rows: what is editable, what is not, and what the line under the email says.
/**
 * lib/settings (2026-09-13). What has to hold:
 *
 *   - the addresses are read-only — a manager cannot change a domain from here;
 *   - the booking email and the name are the only editable rows;
 *   - an address reads as a person says it (no scheme, no www, no trailing slash);
 *   - the line under the email is STATE: where enquiries actually go, only when that
 *     differs from what is written above it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { displayAddress, recipientLine, settingsRows } from '@/lib/settings'

const ORIGINAL_APP = process.env.NEXT_PUBLIC_APP_URL
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP
})

describe('displayAddress', () => {
  it('drops the scheme, www and a trailing slash — each rule on its own', () => {
    // One input per rule, so a rule that stops working is the one test that goes red.
    expect(displayAddress('https://skeenmusic.com')).toBe('skeenmusic.com') // scheme only
    expect(displayAddress('HTTPS://skeenmusic.com')).toBe('skeenmusic.com') // any case
    expect(displayAddress('www.skeenmusic.com')).toBe('skeenmusic.com') // www only
    expect(displayAddress('skeenmusic.com//')).toBe('skeenmusic.com') // trailing slashes only
    expect(displayAddress('  https://www.skeenmusic.com/  ')).toBe('skeenmusic.com') // all three, padded
    expect(displayAddress('lonestar.site/skeen')).toBe('lonestar.site/skeen') // an inner slash stays
    expect(displayAddress(null)).toBe('')
    expect(displayAddress('')).toBe('')
  })
})

describe('recipientLine — state, not instruction', () => {
  it('says enquiries go here when the resolver agrees with the address above — case and padding aside', () => {
    expect(recipientLine('ross@example.com', { to_email: 'ross@example.com', recipient_source: 'mail_settings' })).toBe('Enquiries from the site go here')
    expect(recipientLine('Ross@Example.com', { to_email: 'ross@example.com', recipient_source: 'mail_settings' })).toBe('Enquiries from the site go here')
    expect(recipientLine('  ross@example.com ', { to_email: 'ross@example.com', recipient_source: 'mail_settings' })).toBe('Enquiries from the site go here')
    expect(recipientLine('ross@example.com', { to_email: ' ROSS@example.com ', recipient_source: 'mail_settings' })).toBe('Enquiries from the site go here')
  })

  it('CRITICAL: names where they ACTUALLY go when the resolver answers from somewhere else', () => {
    // The manager typed one address; a stale booking link still wins for some reason.
    // Hiding that would leave them sure enquiries arrive where they don't.
    expect(recipientLine('ross@example.com', { to_email: 'old@example.com', recipient_source: 'link' })).toBe('Enquiries currently go to old@example.com')
  })

  it('with no address and no resolution, says so; with an address and no resolution, says nothing', () => {
    expect(recipientLine('', null)).toBe('No address for enquiries yet')
    expect(recipientLine('ross@example.com', null)).toBeNull()
  })
})

describe('settingsRows', () => {
  const skeen = { name: 'Skeen', slug: 'skeen', site_kind: 'custom', custom_site_url: 'https://www.skeenmusic.com' }

  it('CRITICAL: Site and Address are read-only; Booking email and Name are the editable ones', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://lonestar.site/' // a trailing slash on the origin must not double up
    const rows = settingsRows(skeen, 'ross@example.com', null)
    expect(rows).toEqual([
      { key: 'booking_email', label: 'Booking email', value: 'ross@example.com', editable: true, mono: true, sub: null },
      { key: 'site', label: 'Site', value: 'skeenmusic.com', editable: false, mono: true },
      { key: 'name', label: 'Name', value: 'Skeen', editable: true, mono: false },
      { key: 'address', label: 'Address', value: 'lonestar.site/skeen', editable: false, mono: true },
    ])
  })

  it('a custom site shows its own domain as Site, and the platform page as Address', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://lonestar.site'
    const rows = settingsRows(skeen, '', null)
    expect(rows.find((r) => r.key === 'site')?.value).toBe('skeenmusic.com')
    expect(rows.find((r) => r.key === 'address')?.value).toBe('lonestar.site/skeen')
  })

  it('a template site shows the platform page as both, and a path alone when the app has no origin yet', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://lonestar.site'
    const template = { name: 'Wren', slug: 'wren', site_kind: 'template', custom_site_url: null }
    expect(settingsRows(template, '', null).find((r) => r.key === 'site')?.value).toBe('lonestar.site/wren')
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(settingsRows(template, '', null).find((r) => r.key === 'address')?.value).toBe('/wren')
  })

  it('the email row carries the state line; the others carry none', () => {
    const rows = settingsRows(skeen, 'ross@example.com', { to_email: 'ross@example.com', recipient_source: 'mail_settings' })
    expect(rows[0].sub).toBe('Enquiries from the site go here')
    expect(rows.slice(1).every((r) => !r.sub)).toBe(true)
  })
})
