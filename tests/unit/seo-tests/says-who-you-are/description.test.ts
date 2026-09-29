/**
 * Proves the "Your description is about you and a good length" test passes a 50 to 160
 * character description that mentions the artist, and fails a missing, filler, off-topic,
 * too-short or too-long one.
 *
 * Code:     src/lib/seo-tests/who.ts (`desc`)
 * Feature:  SEO test `desc` · Test tab "Says who you are"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and
 *           tells the artist a claim about it.
 * Covers:   • 50 to 160 characters that mention the name, city or sound passes (both edges)
 *           • none, only the name ("official site"), filler text, or not about the artist: a hard fail
 *           • under 50 or over 160: a soft fail ("Almost")
 *           • characters are counted after decoding entities
 * Not here: an unreachable or cut-short home page (../honesty.test.ts); the shared summary
 *           (../looks-right-when-shared/link-preview.test.ts).
 * Fixtures: _page-fixture.ts (a healthy site; each case changes the description). Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { evidence, expectPlainWords, homeHtml } from '@tests/unit/seo-tests/_page-fixture'

const d = WHO_TESTS.desc
const withDesc = (description: string | null) => d(evidence({ home: homeHtml({ description }) }))

describe('a description about you, of a good length, passes', () => {
  // The one exact-wording check: the pass sentence gives the length and says it mentions you.
  it('passes the healthy 102-character description', () => {
    const r = d(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('102 of 160')
    expect(r.sentence).toBe('Your description is 102 characters and mentions you.')
    expectPlainWords(r)
  })

  // 50 and 160 are inside the range, 49 and 161 are not: the edges are where a rule slips.
  it('passes 50 and 160 exactly, fails 49 and 161', () => {
    const of = (n: number) => withDesc(`Skeen ${'x'.repeat(n - 6)}`).status
    expect([of(49), of(50), of(160), of(161)]).toEqual(['fail', 'pass', 'pass', 'fail'])
  })

  // Naming your city and sound is about you even without your name. (verify-found D1)
  it('passes a description naming the city and sound but not the name', () => {
    expect(withDesc('Chicago DJ and producer playing house and tech house across the Midwest.').status).toBe('pass')
  })

  // "&amp;" counts as one character: the length is what a reader sees.
  it('counts characters after decoding entities', () => {
    const text = 'Skeen & friends play Chicago house records every weekend, all night long.'
    expect(withDesc(text).value).toBe(`${text.length} of 160`)
  })
})

describe('a missing or empty description fails outright', () => {
  // No description: Google picks words from the page instead. Points to the Listing tab.
  it('fails no description', () => {
    const r = withDesc(null)
    expect(r.status).toBe('fail')
    expect(r.value).toBe('no description')
    expect(r.action).toEqual(expect.objectContaining({ target: 'listing' }))
    expectPlainWords(r)
  })

  // "Skeen — official site" is the bridge's fallback when nothing was written: only the name, a hard fail (not "Almost" for being short).
  it('fails the "official site" fallback outright', () => {
    const r = withDesc('Skeen — official site')
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
  })

  // Placeholder text, one word repeated, or someone else's description: none of them is about you. (verify-found D1)
  it.each([
    ['Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.', 'filler text'],
    ['house house house house house house house house house house house', 'filler text'],
    ['Taylor Swift is an American singer-songwriter based in Nashville.', 'not about you'],
  ])('fails "%s" as %s', (description, value) => {
    const r = withDesc(description)
    expect(r.status).toBe('fail')
    expect(r.value).toBe(value)
  })
})

describe('a description of the wrong length fails softly', () => {
  // Under 50 characters says little: "Almost".
  it('fails under 50 characters softly', () => {
    const r = withDesc('Chicago DJ and producer.')
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })

  // Over 160 characters gets cut off by Google: "Almost".
  it('fails over 160 characters softly', () => {
    const r = withDesc('Skeen is a Chicago DJ and producer who plays house and tech house in clubs, warehouses and festivals across the Midwest, and films every night of it for his video diary.')
    expect(r.status).toBe('fail')
    expect(r.lead).toBe('Almost')
  })
})
