// A connected site puts Google's and Bing's ownership codes in its <head>, and nothing else.
/**
 * The bridge's half of "Add website" (site-bridge 0.44.0, ADD_WEBSITE_PLAN.md step 3).
 *
 * lone-star keeps one Google and one Bing verification code per artist in the service-only
 * `site_verifications` table (20260930120000), and `get_public_site` hands them to the site as
 * `verification: { google, bing }`. The site spreads `siteVerification(payload)` into its root
 * metadata, so the codes land in `<head>` as `<meta name="google-site-verification">` and
 * `<meta name="msvalidate.01">`, where Google and Bing look for them.
 *
 * STRICT (AGENTS.md "Test depth"): this is what the live site receives, and it lands in an HTML
 * attribute on the artist's own domain. The shape check is the boundary: a value that is not a
 * code in its provider's shape is never emitted, so a code can't carry a quote, a bracket or a
 * space into the page. The shapes are the database's own CHECKs (pinned below against the
 * migration's text), so the two can't drift.
 *
 * Imported by RELATIVE path, like the other site-bridge suites (stryker.config.json, workspace
 * caveat).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BING_VERIFICATION_SHAPE,
  GOOGLE_VERIFICATION_SHAPE,
  isBingVerification,
  isGoogleVerification,
  siteVerification,
  type SiteVerificationCodes,
} from '../../../packages/site-bridge/src/verification'

const GOOGLE = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const BING = 'DFA80FE427DDB6FD866F4B6A6564E412'
const OWN = 'ptl8bmwM1LyyV7c1h9f8Jkz9aQ-lsnRVg5ZlwCmG1ZI'
/** A payload carrying these values. Typed as the wire type on purpose: the hostile values below
 *  are exactly what a wrong type on the wire would look like at run time. */
const site = (google: unknown, bing: unknown) => ({ verification: { google, bing } }) as { verification: SiteVerificationCodes }

/** Values that must never reach the page, for either provider. */
const HOSTILE: unknown[] = [
  '',
  ' ',
  `${GOOGLE} `,
  ` ${BING}`,
  `${GOOGLE}\n`,
  '"><script>alert(1)</script>',
  "abc'def0123456789012345",
  'abc def 0123456789012345',
  'abcdef<0123456789012345',
  'ключключключключключключ',
  null,
  undefined,
  12345678901234567890,
  // A list or object whose text form IS a valid code: only a real string may pass.
  [GOOGLE],
  [BING],
  { code: GOOGLE },
]

describe('the shapes', () => {
  // Google's token is base64url: letters, digits, _ and -; 20 to 128 of them.
  it('a Google code is 20 to 128 of a-z, A-Z, 0-9, _ and -', () => {
    for (const ok of [GOOGLE, OWN, 'a'.repeat(20), 'Z'.repeat(128), 'ab_cd-ef_gh-ij_kl-mn_op']) expect(isGoogleVerification(ok), ok).toBe(true)
    for (const bad of ['a'.repeat(19), 'a'.repeat(129), 'abcdefghij.klmnopqrst', 'abcdefghij/klmnopqrst', 'abcdefghij=klmnopqrst']) {
      expect(isGoogleVerification(bad), bad).toBe(false)
    }
  })

  // Bing's msvalidate.01 is 32 hex digits; the samples are upper case, so either case passes.
  it('a Bing code is exactly 32 hex digits, either case', () => {
    for (const ok of [BING, BING.toLowerCase(), '0'.repeat(32)]) expect(isBingVerification(ok), ok).toBe(true)
    for (const bad of [BING.slice(1), `${BING}0`, `${BING.slice(1)}G`, GOOGLE]) expect(isBingVerification(bad), bad).toBe(false)
  })

  // Nothing that could break out of an attribute passes either check.
  it('refuses every hostile or non-string value for both providers', () => {
    for (const bad of HOSTILE) {
      expect(isGoogleVerification(bad), JSON.stringify(bad)).toBe(false)
      expect(isBingVerification(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  // The bridge and the database must agree, or a stored code would be refused on the page (or
  // a code the database refuses would be accepted here). Read from the migration itself.
  it('matches the database CHECKs in 20260930120000_site_verifications.sql', () => {
    const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20260930120000_site_verifications.sql'), 'utf8')
    expect(sql).toContain(`code ~ '${GOOGLE_VERIFICATION_SHAPE.source}'`)
    expect(sql).toContain(`code ~ '${BING_VERIFICATION_SHAPE.source}'`)
  })
})

describe('siteVerification(payload)', () => {
  // The normal case once a site is registered: both codes, in the shape Next's metadata takes.
  it('emits both codes', () => {
    expect(siteVerification(site(GOOGLE, BING))).toEqual({ google: [GOOGLE], other: { 'msvalidate.01': BING } })
  })

  // Registered with one provider so far.
  it('emits only the code that is there', () => {
    expect(siteVerification(site(GOOGLE, null))).toEqual({ google: [GOOGLE] })
    expect(siteVerification(site(null, BING))).toEqual({ other: { 'msvalidate.01': BING } })
  })

  // Before registration, on an older door without the field, or with no site at all: no tags.
  it('emits nothing when there is nothing to emit', () => {
    for (const payload of [site(null, null), { verification: null }, {}, null, undefined]) {
      expect(siteVerification(payload as never), JSON.stringify(payload)).toBeUndefined()
    }
  })

  // A bad value is dropped, never repaired: a trimmed or escaped code would not verify anyway.
  it('drops a malformed code and keeps the good one', () => {
    for (const bad of HOSTILE) {
      expect(siteVerification(site(bad, BING)), JSON.stringify(bad)).toEqual({ other: { 'msvalidate.01': BING } })
      expect(siteVerification(site(GOOGLE, bad)), JSON.stringify(bad)).toEqual({ google: [GOOGLE] })
    }
  })

  // Skeen already proves ownership with its own env-var code; Tapir's joins it, never replaces it.
  it('keeps the site’s own Google code beside Digital Tapir’s, Digital Tapir’s first', () => {
    expect(siteVerification(site(GOOGLE, BING), { google: OWN })).toEqual({ google: [GOOGLE, OWN], other: { 'msvalidate.01': BING } })
    expect(siteVerification(site(null, null), { google: OWN })).toEqual({ google: [OWN] })
  })

  // The same code twice is one tag.
  it('says a code once when the site’s own and Digital Tapir’s are the same', () => {
    expect(siteVerification(site(GOOGLE, null), { google: GOOGLE })).toEqual({ google: [GOOGLE] })
  })

  // The site's own value is checked just as strictly: an env var is not a trusted source either.
  it('drops a malformed own code', () => {
    for (const bad of HOSTILE) expect(siteVerification(site(GOOGLE, null), { google: bad as string }), JSON.stringify(bad)).toEqual({ google: [GOOGLE] })
  })

  // A pure read: the payload a site renders elsewhere is not touched.
  it('does not change the payload', () => {
    const payload = site(GOOGLE, BING)
    const before = JSON.stringify(payload)
    siteVerification(payload, { google: OWN })
    expect(JSON.stringify(payload)).toBe(before)
  })
})
