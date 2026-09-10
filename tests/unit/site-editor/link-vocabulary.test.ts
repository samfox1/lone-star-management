/**
 * WHAT MAY BE ADDED TO AN ARTIST'S LINK ROW.
 *
 * Two rules, both because THE LABEL IS THE ADDRESS a connected site maps a social to its
 * mark by (`item:link:instagram`) and the editor routes a frame click back through:
 *
 *   • a KNOWN platform only (Sam, 2026-08-10: "I would remove the possibility for an
 *     unknown platform to be added… Remove the way to add another site")
 *   • ONCE ("make sure to add a checker that a social cant be added to the same section
 *     twice")
 *
 * The editor's picker enforces neither — it disables what is present and offers only the
 * shared vocabulary, but that is presentation: a second tab, a stale panel, or the
 * /links page's own form all walk past it. This is the rule itself, pure, so both doors
 * call the same thing and it can be tested without a database.
 */
import { describe, expect, it } from 'vitest'
import { linkAddError } from '@/lib/site-editor/link-vocabulary'
import { SOCIAL_PLATFORMS } from '@samfox1/site-bridge/social'

describe('only a KNOWN platform can be added', () => {
  it('CRITICAL: an unrecognized label is refused', () => {
    // An unknown label has no mark to draw, so it lands as raw text in a row of glyphs —
    // and on a site that skips what it cannot draw, as nothing at all.
    expect(linkAddError([], 'Fred’s Zine', 'https://zine')).toMatch(/isn’t a platform we know/i)
  })

  it('the message quotes the label TRIMMED — it is read by the person who typed it', () => {
    // Stryker survivor (2026-08-10): dropping `.trim()` here changed no test, because
    // every assertion used a tidy label. The message quotes user input straight back, so
    // the padding would be visible inside the quotes.
    expect(linkAddError([], '  Fred’s Zine  ', 'https://zine')).toContain('“Fred’s Zine”')
  })

  it('CRITICAL: every platform the picker offers is accepted', () => {
    // Derived from the registry (AGENTS.md rule 4), so a platform added tomorrow is
    // proven addable the moment it exists. The two lists disagreeing would mean an
    // offered tile that always errors.
    for (const p of SOCIAL_PLATFORMS) {
      expect(linkAddError([], p.label, `${p.urlHint}handle`), p.label).toBeNull()
    }
  })

  it('a CONTACT link keeps its own name — it is not a social', () => {
    // A mailto:/tel: row is a booking address, has its own group in the editor, and never
    // renders in the socials row. Refusing it would break the contact ladder.
    expect(linkAddError([], 'Bookings', 'mailto:book@x.com')).toBeNull()
    expect(linkAddError([], 'Call us', 'tel:+15125550100')).toBeNull()
    // A BARE address too. The live data already holds one (skeen's booking row, audited
    // 2026-08-10), and `isContactLink` only knows the mailto:/tel: schemes — so without
    // this a manager retyping their booking email would be told it is not a platform.
    expect(linkAddError([], 'Booking email', 'ross@everesttm.com')).toBeNull()
    // …and padded, the way a paste arrives.
    expect(linkAddError([], 'Booking email', '  ross@everesttm.com  ')).toBeNull()
  })

  it('a URL that merely CONTAINS an address is still a social, and still refused', () => {
    // The email test is anchored on purpose (Stryker survivors, 2026-08-10: dropping ^
    // or $ changed no test). Without the anchors, any link with an @ in its path would
    // slip through the vocabulary rule as if it were a booking address.
    expect(linkAddError([], 'Fred’s Zine', 'https://zine.example/contact@x.com')).toMatch(/isn’t a platform/i)
    expect(linkAddError([], 'Fred’s Zine', 'mail@x.com/not-really')).toMatch(/isn’t a platform/i)
  })
})

describe('a social cannot be added to the same site twice', () => {
  it('CRITICAL: a duplicate is refused', () => {
    expect(linkAddError(['Instagram'], 'Instagram', 'https://ig/2')).toMatch(/already on this site/i)
  })

  it('its message quotes the label TRIMMED too', () => {
    // Same Stryker survivor, other branch.
    expect(linkAddError(['Instagram'], '  Instagram  ', 'https://ig/2')).toBe('Instagram is already on this site.')
  })

  it('CRITICAL: compared on the SAME normalization the frame joins on', () => {
    // The marker is the label lowercased, so "instagram" and "Instagram " address the
    // very same element. A case-sensitive check would let both rows exist and leave the
    // select pointing at whichever came first.
    expect(linkAddError(['Instagram'], '  instagram ', 'https://ig/2')).toMatch(/already on this site/i)
  })

  it('a DIFFERENT platform still goes in', () => {
    // The negatives above are only meaningful beside this: a rule that refused everything
    // would pass them and break the feature.
    expect(linkAddError(['Instagram'], 'TikTok', 'https://tiktok.com/@x')).toBeNull()
  })

  it('an artist with no links yet can add their first', () => {
    expect(linkAddError([], 'Instagram', 'https://ig/1')).toBeNull()
  })

  it('a blank label is left to the column constraints, not answered here', () => {
    // Answering would turn a NOT NULL violation into a confusing vocabulary error.
    expect(linkAddError(['Instagram'], '', 'https://x')).toBeNull()
  })
})

import { platformFromUrl } from '@samfox1/site-bridge/social'

describe('platformFromUrl — infer the platform from a link (Sam, 2026-08-12)', () => {
  it('CRITICAL: every platform is recognised from a URL built on its own hint', () => {
    // Derived from the registry (rule 4): a platform added tomorrow is auto-covered.
    for (const p of SOCIAL_PLATFORMS) {
      expect(platformFromUrl(`${p.urlHint}handle`)?.slug, p.label).toBe(p.slug)
    }
  })

  it('ignores www. and subdomains, and is case-insensitive on the host', () => {
    expect(platformFromUrl('https://WWW.Instagram.com/juniper')?.slug).toBe('instagram')
    expect(platformFromUrl('https://open.spotify.com/artist/x')?.slug).toBe('spotify')
    expect(platformFromUrl('https://music.apple.com/us/artist/x')?.slug).toBe('apple music')
  })

  it('returns null for an unknown host or an unparseable string', () => {
    expect(platformFromUrl('https://juniperhale.com')).toBeNull()
    expect(platformFromUrl('not a url')).toBeNull()
    expect(platformFromUrl('')).toBeNull()
  })
})
