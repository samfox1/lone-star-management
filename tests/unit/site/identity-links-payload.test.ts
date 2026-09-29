// The preview payload's identity_links follow the door's rule exactly: published url == the stored verdict.
/**
 * `getWorkingSitePayload` (lib/site.ts) is the preview's copy of `get_public_site`, posted to
 * a custom site over `init-data`. 20260928170000 gave the door `identity_links` (the artist's
 * connected profiles that identify them, button or not) and this is its TypeScript half,
 * pinned DB-free; the live comparison is in tests/integration/site/identity-links.test.ts.
 *
 * The door's rule, on working rows: a link rides `identity_links` only while its url EQUALS
 * the verdict TypeScript stored (`links.identity_url`). Nothing else decides it here: not
 * the label, not `on_site`, not whether the url looks like a profile.
 */
import { describe, expect, it } from 'vitest'
import { identityLinksPayload } from '@/lib/site'

const SPOTIFY = 'https://open.spotify.com/artist/26K'

describe('identityLinksPayload', () => {
  it('CRITICAL: a row whose url equals its verdict rides, as url + label only, button or not', () => {
    expect(
      identityLinksPayload([
        { id: 'a', label: 'Spotify', url: SPOTIFY, on_site: false, role: null, identity_url: SPOTIFY },
        { id: 'b', label: 'Instagram', url: 'https://instagram.com/x', on_site: true, role: null, identity_url: 'https://instagram.com/x' },
      ]),
    ).toEqual([
      { url: SPOTIFY, label: 'Spotify' },
      { url: 'https://instagram.com/x', label: 'Instagram' },
    ])
  })

  it('CRITICAL: no verdict, no link — a payment handle with no verdict never rides', () => {
    expect(identityLinksPayload([{ id: 'p', label: 'PayPal', url: 'https://paypal.me/x', on_site: false, identity_url: null }])).toEqual([])
  })

  it('CRITICAL: a verdict for another url vouches for nothing (a url changed without being judged)', () => {
    expect(identityLinksPayload([{ id: 'a', label: 'Spotify', url: 'https://open.spotify.com/playlist/0', identity_url: SPOTIFY }])).toEqual([])
  })

  it('a row read before the column exists rides nothing', () => {
    expect(identityLinksPayload([{ id: 'a', label: 'Spotify', url: SPOTIFY }])).toEqual([])
  })
})
