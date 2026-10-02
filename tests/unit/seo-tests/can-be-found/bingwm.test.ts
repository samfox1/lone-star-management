/**
 * "Your site is linked to Bing Webmaster Tools" passes only on a real Bing code on the site, and
 * never fails: without one it says it saw no sign, since a site can be linked in ways we can't see.
 *
 * Code:     src/lib/seo-tests/found.ts (bingwm)
 * Feature:  bingwm (Test tab group "Can be found", tagged OUTSIDE TAPIR: Bing)
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads codes off the live site and tells the manager
 *           whether to go and set something up.
 * Covers:   • Bing's code in the home page's msvalidate.01 tag, or in /BingSiteAuth.xml, passes
 *           • an empty or placeholder code is not a code
 *           • no sign is "couldn't check" with the way to link it, never a fail
 *           • a home page we couldn't read is said as that, not "no sign"
 *           • the details say what the Bing file answered (refused, no answer, not checked)
 * Not here: whether /BingSiteAuth.xml holds a real code (evidence.test.ts reads the file); the
 *           rules shared by all ten tests (contract.test.ts).
 * Fixtures: ../_found-fixtures.ts: a healthy two-page site with no Bing code and a 404 for Bing's file;
 *           each case adds a tag to the home page or changes what the Bing file answered.
 */
import { describe, expect, it } from 'vitest'
import { FOUND_TESTS } from '@/lib/seo-tests/found'
import type { SeoEvidence } from '@/lib/seo-tests/types'
import { ABOUT, HOME, details, evidence, run, type Fixture } from '@tests/unit/seo-tests/_found-fixtures'

/** The home page carrying Bing's meta tag with `code`. */
const withCode = (code: string): Fixture => ({ pages: { '/': HOME.replace('<head>', `<head><meta name="msvalidate.01" content="${code}">`), '/about': ABOUT } })

describe('a sign of Bing Webmaster Tools', () => {
  // Bing's 32-character code in the home page's tag, or a Bing file naming a user, is the sign
  // that the site was linked: a pass, with where it was found in the details.
  it.each<[string, Fixture, string]>([
    ['the msvalidate.01 tag on the home page', withCode('0123456789ABCDEF0123456789ABCDEF'), 'msvalidate.01: found (a 32-character code)'],
    ['a BingSiteAuth.xml naming a user', { bing: { siteAuth: { status: 200, hasUser: true } } }, 'BingSiteAuth.xml: 200, holds a code'],
  ])('%s: pass', (_name, f, row) => {
    const r = run('bingwm', f)
    expect(r).toMatchObject({ status: 'pass', value: 'code found' })
    expect(details(r)).toContain(row)
  })
  // An empty tag, or one still holding a placeholder, is not Bing's code. (verify-found F29)
  it.each([
    ['an empty tag', ' '],
    ['a placeholder', 'YOUR_CODE_HERE'],
  ])('%s is not a sign', (_name, code) => {
    expect(run('bingwm', withCode(code)).status).toBe('unknown')
  })
})

describe('no sign', () => {
  // With no sign it is "couldn't check", never a fail (a site can be linked in ways we can't
  // see), in these exact words, with a button to Bing and the way to do it.
  it('couldn’t check, word for word, with the way to link it', () => {
    const r = run('bingwm')
    expect(r.status).toBe('unknown')
    expect(r.sentence).toBe('we saw no sign of Bing Webmaster Tools on your site. It may be linked in a way we can’t see.')
    expect(r.action).toEqual({ kind: 'outside', href: 'https://www.bing.com/webmasters', label: expect.any(String) })
    expect(r.todo).toMatch(/sign in to Bing Webmaster Tools/)
  })
  // A home page we couldn't read is where the tag would be: we say so, not "no sign".
  it('a home page we couldn’t read: said as that, not “no sign”', () => {
    const r = run('bingwm', { plain: { '/': { status: 403, html: null } } })
    expect(r).toMatchObject({ status: 'unknown', sentence: expect.stringMatching(/couldn’t read your home page/) })
    expect(details(r)).toContain('msvalidate.01: home page not read')
  })
  // The details say what Bing's file answered: refused is not "no Bing file". (verify-found F29)
  it.each<[string, SeoEvidence['bing'], string]>([
    ['refused to us', { siteAuth: { status: 401, hasUser: false } }, 'BingSiteAuth.xml: refused to us (401)'],
    ['no answer', { siteAuth: { status: null, hasUser: false } }, 'BingSiteAuth.xml: no answer'],
    ['not asked for', undefined, 'BingSiteAuth.xml: not checked'],
  ])('Bing’s file %s: said so in the details', (_name, bing, row) => {
    const e = evidence()
    e.bing = bing
    expect(details(FOUND_TESTS.bingwm(e))).toContain(row)
  })
})
