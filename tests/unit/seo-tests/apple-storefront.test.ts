/**
 * The Apple Music store in a link (music.apple.com/<cc>/artist/<name>/<id>) and the one-click
 * fix to the US store. A parser whose output becomes a link on the live site: strict.
 */
import { describe, expect, it } from 'vitest'
import { appleStorefrontFix, appleStorefrontOf, countryCode, countryName } from '@/lib/seo-tests/apple-storefront'

describe('appleStorefrontFix', () => {
  it('moves a Norway-store artist link to the US store, keeping the rest', () => {
    expect(appleStorefrontFix('https://music.apple.com/no/artist/skeen/1754431714')).toEqual({
      fixed: 'https://music.apple.com/us/artist/skeen/1754431714', from: 'no', to: 'us',
    })
  })
  it('works without the name slug, with a trailing slash, in capitals, and over http', () => {
    expect(appleStorefrontFix('https://music.apple.com/gb/artist/1754431714')?.fixed).toBe('https://music.apple.com/us/artist/1754431714')
    expect(appleStorefrontFix('https://music.apple.com/gb/artist/skeen/1754431714/')?.fixed).toBe('https://music.apple.com/us/artist/skeen/1754431714/')
    expect(appleStorefrontFix('https://MUSIC.apple.com/NO/artist/skeen/1754431714')).toEqual({ fixed: 'https://music.apple.com/us/artist/skeen/1754431714', from: 'no', to: 'us' })
    expect(appleStorefrontFix('http://music.apple.com/no/artist/skeen/1754431714')?.fixed).toBe('https://music.apple.com/us/artist/skeen/1754431714')
  })
  it('drops the old store’s language setting and keeps other settings', () => {
    expect(appleStorefrontFix('https://music.apple.com/no/artist/skeen/1754431714?l=nb&app=music')?.fixed).toBe('https://music.apple.com/us/artist/skeen/1754431714?app=music')
  })
  it('leaves a US link, a link with no store, and a geo link alone', () => {
    expect(appleStorefrontFix('https://music.apple.com/us/artist/skeen/1754431714')).toBeNull()
    expect(appleStorefrontFix('https://music.apple.com/artist/skeen/1754431714')).toBeNull()
    expect(appleStorefrontFix('https://geo.music.apple.com/no/artist/skeen/1754431714')).toBeNull()
  })
  it('only fixes ARTIST links on Apple’s own host', () => {
    expect(appleStorefrontFix('https://music.apple.com/no/album/outwest/123456')).toBeNull()
    expect(appleStorefrontFix('https://music.apple.com.evil.example/no/artist/x/1')).toBeNull()
    expect(appleStorefrontFix('https://evil.example/music.apple.com/no/artist/x/1')).toBeNull()
    expect(appleStorefrontFix('https://music.apple.com/no/artist/skeen/notanid')).toBeNull()
  })
  it('refuses junk without throwing', () => {
    for (const junk of ['', '   ', 'not a url', 'javascript:alert(1)', 'music.apple.com/no/artist/x/1', 'https://music.apple.com/n0/artist/x/1', 'https://music.apple.com/zz/artist/x/1']) {
      expect(appleStorefrontFix(junk), junk).toBeNull()
    }
  })
})

describe('appleStorefrontOf', () => {
  it('reads the store, or null for none / geo / not Apple', () => {
    expect(appleStorefrontOf('https://music.apple.com/no/artist/skeen/1754431714')).toBe('no')
    expect(appleStorefrontOf('https://music.apple.com/artist/1754431714')).toBeNull()
    expect(appleStorefrontOf('https://geo.music.apple.com/no/artist/1754431714')).toBeNull()
    expect(appleStorefrontOf('https://open.spotify.com/artist/x')).toBeNull()
  })
})

describe('countryCode / countryName', () => {
  it('reads a two-letter code or an English name', () => {
    expect(countryCode('US')).toBe('US')
    expect(countryCode('us')).toBe('US')
    expect(countryCode('United States')).toBe('US')
    expect(countryCode('USA')).toBe('US')
    expect(countryCode('United States of America')).toBe('US')
    expect(countryCode('UK')).toBe('GB')
    expect(countryCode('Norway')).toBe('NO')
    expect(countryCode('  norway ')).toBe('NO')
  })
  it('says null for anything else', () => {
    for (const x of ['Narnia', 'ZZ', 'XX', '', 'U', null, undefined]) expect(countryCode(x as string), String(x)).toBeNull()
  })
  it('names a country', () => {
    expect(countryName('NO')).toBe('Norway')
    expect(countryName('us')).toBe('the United States')
  })
})
