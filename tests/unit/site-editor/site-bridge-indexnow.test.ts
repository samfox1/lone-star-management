// A connected site answers IndexNow's key-file request with the key, and nothing else.
/**
 * The bridge's IndexNow half (site-bridge 0.42.0, AI_VISIBILITY_AUDIT finding 1.4).
 *
 * lone-star writes one random key per artist into a reserved `site_content` key, it rides
 * the published payload, and the site serves it at `/indexnow.txt` so Bing and the other
 * IndexNow engines can check that a ping naming the site really came from its owner.
 *
 * What reaches the live site is STRICT (AGENTS.md "Test depth"): the key file is a public
 * response on the artist's own host, built from a value the payload carries. The shape
 * check is the boundary: a value that is not an IndexNow key is never served, so the file
 * can never become a place to put arbitrary text (or html) on the artist's domain.
 *
 * Imported by RELATIVE path, like the other site-bridge suites (stryker.config.json,
 * workspace caveat).
 */
import { describe, expect, it } from 'vitest'
import {
  INDEXNOW_CONTENT_KEY,
  INDEXNOW_KEY_PATH,
  INDEXNOW_VERSION_HEADER,
  indexNowKey,
  indexNowKeyFile,
  isIndexNowKey,
} from '../../../packages/site-bridge/src/indexnow'
import { PACKAGE_VERSION } from '../../../packages/site-bridge/src/manifest'

const KEY = '0123456789abcdef0123456789abcdef'
const site = (value: unknown) => ({ site_content: { [INDEXNOW_CONTENT_KEY]: value as string } })

describe('isIndexNowKey: the protocol shape (8–128 of a-z, A-Z, 0-9, -)', () => {
  it('accepts the shortest, the longest, mixed case and dashes', () => {
    for (const ok of ['a1b2c3d4', 'x'.repeat(128), 'ABCdef-0123-XYZ', KEY]) expect(isIndexNowKey(ok), ok).toBe(true)
  })

  it('refuses anything else', () => {
    for (const bad of [
      '',
      'a1b2c3d', // 7: one short
      'x'.repeat(129), // one long
      `${KEY}\n`, // a trailing newline is not part of a key
      ` ${KEY}`,
      'abcd_efgh', // underscore is not in the alphabet
      'abcd.efgh',
      'abcd/efgh',
      '<script>alert(1)</script>',
      'ключключключ', // letters, but not ASCII ones
    ]) {
      expect(isIndexNowKey(bad), JSON.stringify(bad)).toBe(false)
    }
    for (const notString of [null, undefined, 12345678, ['abcdefgh'], { k: 'abcdefgh' }]) expect(isIndexNowKey(notString)).toBe(false)
  })
})

describe('where the key lives', () => {
  it('the content key is one lone-star can store (site_content key shape)', () => {
    expect(INDEXNOW_CONTENT_KEY).toMatch(/^[a-z0-9_]{1,64}$/)
  })

  it('the key file sits at the ROOT, so its keyLocation covers every page of the host', () => {
    // IndexNow scopes a key file to its own directory: /catalog/key.txt may only vouch for
    // /catalog/*. A root file vouches for the whole site.
    expect(INDEXNOW_KEY_PATH).toMatch(/^\/[^/]+\.txt$/)
  })
})

describe('indexNowKey(payload)', () => {
  it('reads the published key', () => {
    expect(indexNowKey(site(KEY))).toBe(KEY)
  })

  it('is null when the payload has none, or one of the wrong shape', () => {
    expect(indexNowKey(null)).toBeNull()
    expect(indexNowKey(undefined)).toBeNull()
    expect(indexNowKey({ site_content: null })).toBeNull()
    expect(indexNowKey({ site_content: {} })).toBeNull()
    expect(indexNowKey(site('not a key'))).toBeNull()
    expect(indexNowKey(site(42))).toBeNull()
  })
})

describe('indexNowKeyFile(payload): the answer at /indexnow.txt', () => {
  it('CRITICAL: serves exactly the key, as UTF-8 plain text', async () => {
    const res = indexNowKeyFile(site(KEY))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe(KEY)
  })

  it('reports the bridge version, which lone-star checks before it pings', () => {
    expect(indexNowKeyFile(site(KEY)).headers.get(INDEXNOW_VERSION_HEADER)).toBe(PACKAGE_VERSION)
  })

  it('keeps the file itself out of the index', () => {
    expect(indexNowKeyFile(site(KEY)).headers.get('x-robots-tag')).toBe('noindex')
  })

  it('CRITICAL: a value that is not a key is never served: 404 and an empty body', async () => {
    for (const bad of ['<html><body>phish</body></html>', `${KEY}\n<script>`, 'short', '', 42, null]) {
      const res = indexNowKeyFile(site(bad))
      expect(res.status, JSON.stringify(bad)).toBe(404)
      expect(await res.text()).toBe('')
    }
  })

  it('an unconfigured or unpublished site answers 404', async () => {
    for (const payload of [null, undefined, { site_content: {} }]) {
      const res = indexNowKeyFile(payload)
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('')
    }
  })
})
