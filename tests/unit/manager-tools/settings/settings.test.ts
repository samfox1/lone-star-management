// The Settings · General rows: the two addresses, read as a person says them.
/**
 * lib/settings (2026-09-13). What has to hold:
 *
 *   - the two rows are the site and the platform address, nothing else (the name moved to
 *     Profile and the booking email to Settings › Email, both 2026-10-02);
 *   - an address reads as a person says it (no scheme, no www, no trailing slash).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { displayAddress, settingsRows } from '@/lib/settings'

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

describe('settingsRows', () => {
  const skeen = { name: 'Skeen', slug: 'skeen', site_kind: 'custom', custom_site_url: 'https://www.skeenmusic.com' }

  it('CRITICAL: Site and Address, and no booking email (it lives in Settings › Email now)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://lonestar.site/' // a trailing slash on the origin must not double up
    expect(settingsRows(skeen)).toEqual([
      { key: 'site', label: 'Site', value: 'skeenmusic.com' },
      { key: 'address', label: 'Address', value: 'lonestar.site/skeen' },
    ])
  })

  it('a custom site shows its own domain as Site, and the platform page as Address', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://lonestar.site'
    const rows = settingsRows(skeen)
    expect(rows.find((r) => r.key === 'site')?.value).toBe('skeenmusic.com')
    expect(rows.find((r) => r.key === 'address')?.value).toBe('lonestar.site/skeen')
  })

  it('a template site has no Site row (it would repeat Address), and a path alone when the app has no origin yet', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://lonestar.site'
    const template = { name: 'Wren', slug: 'wren', site_kind: 'template', custom_site_url: null }
    expect(settingsRows(template)).toEqual([{ key: 'address', label: 'Address', value: 'lonestar.site/wren' }])
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(settingsRows(template)).toEqual([{ key: 'address', label: 'Address', value: '/wren' }])
  })
})
