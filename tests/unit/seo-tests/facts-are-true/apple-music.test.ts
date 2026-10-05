/**
 * Proves the "Your Apple Music link opens your home country's store" test compares the store
 * in each of the artist's Apple Music links with the country they are based in (Tapir's Facts
 * first), and that the store reader and the one-click fix behind it are exact.
 *
 * Code:     src/lib/seo-tests/facts.ts (`apple`), src/lib/seo-tests/apple-storefront.ts
 *           (`appleStorefrontFix`, `appleStorefrontOf`, `countryCode`, `countryName`)
 * Feature:  SEO test `apple` · Test tab "Facts are true"
 * Tier:     STRICT (AGENTS.md "Test depth"): the links come from the live page (untrusted),
 *           and the fix writes a link that goes onto the live site.
 * Covers:   • a link on the store of the country the artist is based in passes; another
 *             country's store fails, with a one-click fix only for a US artist's own Tapir link
 *           • where you're based: Tapir's published Country first, the card's only when Tapir
 *             has none, both shown; unknown when neither says
 *           • every Apple link of the artist's is judged (artist, album, song; card and
 *             buttons); another artist's link is listed, not judged; a link with no store passes
 *           • `na` with no Apple link on pages read in full; unknown when a page wasn't
 *           • the fix: only artist links on Apple's own host, keeps the path, drops the old
 *             language; country codes and names read the common spellings, never "the the"
 * Not here: a home page cut at the read cap, or unreachable (../honesty.test.ts); applying
 *           the fix as a draft (tests/unit/manager-tools/seo/test-actions.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy US artist whose Apple link is on the US store);
 *           `cardApple` and `withLinks` put chosen Apple links and countries on the page and
 *           in Tapir. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { appleStorefrontFix, appleStorefrontOf, countryCode, countryName } from '@/lib/seo-tests/apple-storefront'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { PROFILES, artistNode, evidence, expectPlainWords, graphBlock, homeHtml, known, page, rowOf } from '@tests/helpers/seo/page-fixture'

const a = FACTS_TESTS.apple
const NORWAY = 'https://music.apple.com/no/artist/skeen/1754431714'
const OWN_US = 'https://music.apple.com/us/artist/skeen/1754431714'
/** The healthy page without its Apple Music button. */
const noApple = (html: string) => html.replace(/<a href="https:\/\/music\.apple\.com[^"]*">Apple Music<\/a>/, '')
/** The card names `url` as the Apple link (null = none) and the artist's country (null = not
 *  said); Tapir's Apple link is that same url; Tapir's own country only when `tapir` gives one. */
const cardApple = (url: string | null, country: unknown = 'US', body = '', tapir: { country: string; countryCode: string | null } | null = null) => {
  const loc = { '@type': 'Place', address: { addressLocality: 'Chicago', addressRegion: 'IL', ...(country === null ? {} : { addressCountry: country }) } }
  const sameAs = url ? [PROFILES[0], url] : [PROFILES[0]]
  const links = known().published!.links.map((l) => (l.label === 'Apple Music' ? { ...l, url: url ?? l.url } : l))
  return evidence({
    home: noApple(homeHtml({ ld: [graphBlock([artistNode({ sameAs, foundingLocation: loc })])], body })),
    known: known({}, { links, country: tapir?.country ?? null, countryCode: tapir?.countryCode ?? null }),
  })
}
/** The page shows `hrefs` as Apple buttons; Tapir has the artist in `country` and, optionally, `tapirApple` as its Apple link. */
const withLinks = (hrefs: string[], country = 'US', tapirApple?: string) => {
  const body = hrefs.map((h) => `<a href="${h}">Apple</a>`).join('')
  const links = known().published!.links.filter((l) => l.label !== 'Apple Music')
  if (tapirApple) links.push({ label: 'Apple Music', url: tapirApple, onSite: false })
  const k = known({}, { links, countryCode: country, country: countryName(country).replace(/^the /, '') })
  return evidence({ home: noApple(homeHtml({ ld: [graphBlock([artistNode({ sameAs: [PROFILES[0]] })])], body })), known: k })
}
const US = { country: 'United States', countryCode: 'US' }

describe('a link on your home country’s store passes', () => {
  // The one exact-wording check: the pass sentence names the store and says it is where you're based.
  it('passes an Apple link on the store of the country the artist is based in', () => {
    const r = a(evidence())
    expect(r.status).toBe('pass')
    expect(r.sentence).toBe('Your Apple Music link opens the United States store, where you’re based.')
    expectPlainWords(r)
  })

  // A Norway-store link is right for a Norway-based artist, whether the card says NO, Norway, or a Country object.
  it('passes a Norway-store link for a Norway-based artist', () => {
    expect(a(cardApple(NORWAY, 'NO')).status).toBe('pass')
    expect(a(cardApple(NORWAY, 'Norway')).status).toBe('pass')
    expect(a(cardApple(NORWAY, { '@type': 'Country', name: 'Norway' })).status).toBe('pass')
  })

  // A link with no store in it (or a geo link) lets Apple pick each fan's store: nothing to get wrong.
  it('passes a link with no store in it', () => {
    expect(a(cardApple('https://music.apple.com/artist/1754431714', null)).status).toBe('pass')
    expect(a(cardApple('https://geo.music.apple.com/artist/skeen/1754431714', null)).status).toBe('pass')
  })

  // Another artist's Apple link on the page (a support act) is listed, not called "your" link. (verify-found AP4)
  it('lists another artist’s Apple link without judging it', () => {
    const r = a(withLinks([OWN_US, 'https://music.apple.com/gb/artist/four-tet/4628083'], 'US', OWN_US))
    expect(r.status).toBe('pass')
    expect(rowOf(r, /other artists/i)).toMatch(/four-tet/)
  })
})

describe('a link on another country’s store fails', () => {
  // A Norway-store link for a US artist fails softly, with the one-click fix to the US store shown as Tapir's link after the fix.
  it('fails a Norway-store link for a US artist, offering the one-click fix', () => {
    const r = a(cardApple(NORWAY))
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
    expect(r.sentence).toMatch(/Norway/)
    expect(r.action).toEqual({ kind: 'fix', fix: 'apple-storefront', label: expect.any(String) })
    expect(rowOf(r, 'in Digital Tapir: after the fix')).toBe('https://music.apple.com/us/artist/skeen/1754431714')
    expectPlainWords(r)
  })

  // A link that isn't in Tapir (the site hard-codes it) gets no one-click fix: Tapir can't change it.
  it('offers no fix for a link that is not in Digital Tapir', () => {
    const e = cardApple(NORWAY)
    e.known = known()
    const r = a(e)
    expect(r.status).toBe('fail')
    expect(r.action?.kind).not.toBe('fix')
    expect(r.todo).toMatch(/isn’t from Digital Tapir/)
  })

  // A US-store link for a Canadian artist fails without the fix (it only writes /us/), and the advice names the Canada store.
  it('fails a US-store link for a Canadian artist, without the US-only fix', () => {
    const r = a(cardApple(OWN_US, 'CA'))
    expect(r.status).toBe('fail')
    expect(r.action?.kind).not.toBe('fix')
    expect(r.todo).toMatch(/Canada store/)
  })

  // Apple Music links shown as buttons are read too, not only the card's.
  it('reads Apple links the page shows as buttons', () => {
    expect(a(cardApple(null, 'US', `<a href="${NORWAY}?l=nb">Apple Music</a>`)).status).toBe('fail')
  })

  // Among several links, the wrong one is the one named.
  it('names the one wrong link among several', () => {
    const r = a(cardApple(NORWAY, 'US', `<a href="${OWN_US}">Apple</a>`))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'link')).toMatch(/\/no\//)
  })

  // A pinned album or song link opens its store too: it is judged, not passed as "each fan's own store". (verify-found AP1)
  it('judges a pinned album or song link', () => {
    for (const u of ['https://music.apple.com/no/album/home-again/1755555555', 'https://music.apple.com/gb/song/home-again/1755555556', 'https://music.apple.com/jp/album/x/1?i=2']) {
      const r = a(withLinks([u]))
      expect(r.status, u).toBe('fail')
      expect(r.sentence).not.toMatch(/each fan/)
    }
  })

  // A right artist link does not hide a wrong release link beside it. (verify-found AP2)
  it('fails a wrong release link beside a right artist link', () => {
    expect(a(withLinks([OWN_US, 'https://music.apple.com/no/album/home-again/1755555555'], 'US', OWN_US)).status).toBe('fail')
  })

  // "/uk/" is not an Apple store (Apple sends it to /us/): it fails, and is never called "the United Kingdom store". (verify-found AP7)
  it('does not read /uk/ as the UK store', () => {
    const uk = 'https://music.apple.com/uk/artist/skeen/1754431714'
    const r = a(withLinks([uk], 'GB', uk))
    expect(r.status).toBe('fail')
    expect(r.sentence).not.toMatch(/opens the (the )?United Kingdom store/)
  })

  // Country names that take "the" never read "the the", in a pass or a fail. (verify-found AP5)
  it('never says "the the"', () => {
    expect(a(withLinks([OWN_US], 'US', OWN_US)).sentence).not.toMatch(/the the/i)
    expect(a(withLinks([OWN_US], 'GB', OWN_US)).sentence).not.toMatch(/the the/i)
  })
})

describe('where you’re based', () => {
  // Neither Tapir nor the card says a country: "couldn't check", pointing to Profile.
  it('is unknown when neither Digital Tapir nor the site says the country', () => {
    const r = a(cardApple(NORWAY, null))
    expect(r.status).toBe('unknown')
    expect(r.action).toEqual(expect.objectContaining({ target: 'facts' }))
  })

  // CRITICAL: the country comes from the Facts published in Tapir first; a card from an older bridge states none, and the test still judges (with the fix).
  it('uses the country published in Digital Tapir when the card has none', () => {
    const r = a(cardApple(NORWAY, null, '', US))
    expect(r.status).toBe('fail')
    expect(r.action).toEqual(expect.objectContaining({ kind: 'fix' }))
    expect(rowOf(r, 'in Digital Tapir: you’re based in')).toBe('US = the United States')
    expectPlainWords(r)
  })

  // CRITICAL: Tapir's country wins over a card that says otherwise, and both are shown, each labelled with where it came from.
  it('prefers Digital Tapir’s country over the card’s, showing both', () => {
    const r = a(cardApple(NORWAY, 'US', '', { country: 'Norway', countryCode: 'NO' }))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'in Digital Tapir: you’re based in')).toBe('NO = Norway')
    expect(rowOf(r, 'fact card: based in')).toBe('US = the United States')
  })

  // With no country in Tapir, the card's is used and labelled as the site's, never as Tapir's.
  it('falls back to the card’s country, labelled as the site’s', () => {
    const r = a(cardApple(OWN_US, 'CA'))
    expect(rowOf(r, 'fact card: based in')).toBe('CA = Canada')
    expect(r.evidence.some((e) => /^in Digital Tapir: you/.test(e.label))).toBe(false)
  })

  // A country Tapir holds without a code is read by its English name; one no table knows ("Atlantis") is not used.
  it('reads a Digital Tapir country by its English name, else leaves it out', () => {
    expect(a(cardApple(NORWAY, null, '', { country: 'Norway', countryCode: null })).status).toBe('pass')
    expect(a(cardApple(NORWAY, null, '', { country: 'Atlantis', countryCode: null })).status).toBe('unknown')
  })
})

describe('no Apple Music link', () => {
  // CRITICAL: no Apple Music link on the site: no store to get wrong, so the test does not apply (`na`, not a pass), says why, and offers nothing to do.
  it('does not apply when the site has no Apple Music link', () => {
    const r = a(cardApple(null))
    expect(r.status).toBe('na')
    expect(r.value).toMatch(/no Apple/i)
    expect(r.sentence).toMatch(/no Apple Music link/)
    expect(r.action).toBeUndefined()
  })

  // No Apple link found while a page could not be read is "couldn't check", not "doesn't apply": the unread page may have one. (verify-found AP3)
  it('is unknown, not `na`, when a page could not be read', () => {
    const home = noApple(homeHtml({ ld: [graphBlock([artistNode({ sameAs: [PROFILES[0]] })])] }))
    expect(a(evidence({ pages: [page('/', home), page('/music', null, null, { error: 'timeout' })] })).status).toBe('unknown')
  })
})

describe('the one-click fix to the US store', () => {
  // A Norway-store artist link moves to the US store, the rest of the address kept.
  it('moves a Norway-store artist link to the US store', () => {
    expect(appleStorefrontFix(NORWAY)).toEqual({ fixed: OWN_US, from: 'no', to: 'us' })
  })

  // Links as people paste them (no name, a trailing slash, capitals, http) are fixed, and always come out https.
  it('fixes a link with no name, a trailing slash, capitals, or http', () => {
    expect(appleStorefrontFix('https://music.apple.com/gb/artist/1754431714')?.fixed).toBe('https://music.apple.com/us/artist/1754431714')
    expect(appleStorefrontFix('https://music.apple.com/gb/artist/skeen/1754431714/')?.fixed).toBe('https://music.apple.com/us/artist/skeen/1754431714/')
    expect(appleStorefrontFix('https://MUSIC.apple.com/NO/artist/skeen/1754431714')).toEqual({ fixed: OWN_US, from: 'no', to: 'us' })
    expect(appleStorefrontFix('http://music.apple.com/no/artist/skeen/1754431714')?.fixed).toBe(OWN_US)
  })

  // The old store's language (?l=nb) is dropped; other settings are kept.
  it('drops the old store’s language and keeps other settings', () => {
    expect(appleStorefrontFix('https://music.apple.com/no/artist/skeen/1754431714?l=nb&app=music')?.fixed).toBe('https://music.apple.com/us/artist/skeen/1754431714?app=music')
  })

  // A US link, a link with no store, and a geo link need no fix.
  it('leaves a US link, a link with no store, and a geo link alone', () => {
    expect(appleStorefrontFix(OWN_US)).toBeNull()
    expect(appleStorefrontFix('https://music.apple.com/artist/skeen/1754431714')).toBeNull()
    expect(appleStorefrontFix('https://geo.music.apple.com/no/artist/skeen/1754431714')).toBeNull()
  })

  // Only ARTIST links on Apple's own host are fixed: never an album, a look-alike host, a path that mentions Apple, or a non-number id.
  it('only fixes artist links on Apple’s own host', () => {
    expect(appleStorefrontFix('https://music.apple.com/no/album/outwest/123456')).toBeNull()
    expect(appleStorefrontFix('https://music.apple.com.evil.example/no/artist/x/1')).toBeNull()
    expect(appleStorefrontFix('https://evil.example/music.apple.com/no/artist/x/1')).toBeNull()
    expect(appleStorefrontFix('https://music.apple.com/no/artist/skeen/notanid')).toBeNull()
  })

  // Junk (empty, not a link, a script, no scheme, a store that isn't a country) is refused, never thrown on.
  it('refuses junk without throwing', () => {
    for (const junk of ['', '   ', 'not a url', 'javascript:alert(1)', 'music.apple.com/no/artist/x/1', 'https://music.apple.com/n0/artist/x/1', 'https://music.apple.com/zz/artist/x/1']) {
      expect(appleStorefrontFix(junk), junk).toBeNull()
    }
  })

  // The store of an artist link is read, and there is none for a link with no store, a geo link, or another site.
  it('reads the store of an artist link', () => {
    expect(appleStorefrontOf(NORWAY)).toBe('no')
    expect(appleStorefrontOf('https://music.apple.com/artist/1754431714')).toBeNull()
    expect(appleStorefrontOf('https://geo.music.apple.com/no/artist/1754431714')).toBeNull()
    expect(appleStorefrontOf('https://open.spotify.com/artist/x')).toBeNull()
  })
})

describe('reading and naming a country', () => {
  // A code or an English name, in any case, with common spellings ("USA", "UK", "Czech Republic", "México", "The Netherlands"), reads as the right code. (verify-found AP9)
  it('reads a two-letter code or a common English name', () => {
    expect(['US', 'us', 'United States', 'USA', 'United States of America', 'the United States', '  norway ', 'Norway', 'UK'].map((c) => countryCode(c))).toEqual(['US', 'US', 'US', 'US', 'US', 'US', 'NO', 'NO', 'GB'])
    expect(['Turkey', 'Czech Republic', 'Hong Kong', 'México', 'Ivory Coast', 'The Netherlands'].map((c) => countryCode(c))).toEqual(['TR', 'CZ', 'HK', 'MX', 'CI', 'NL'])
  })

  // Anything else (a made-up place, an unused code, nothing) is no country.
  it('says null for anything else', () => {
    for (const x of ['Narnia', 'ZZ', 'XX', '', 'U', null, undefined]) expect(countryCode(x as string), String(x)).toBeNull()
  })

  // A country is named as a sentence needs it: "the United States", "Norway", and never "the Czechia". (verify-found AP8)
  it('names a country for a sentence', () => {
    expect(countryName('NO')).toBe('Norway')
    expect(countryName('us')).toBe('the United States')
    expect(countryName('CZ')).toBe('Czechia')
  })
})
