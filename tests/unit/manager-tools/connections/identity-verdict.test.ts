// Which connection links vouch for the artist's identity (the fact card's `sameAs`), and the backfill's plan.
/**
 * IDENTITY LINKS (AI_VISIBILITY_AUDIT.md 1.2, Sam 2026-09-28: "add all the connections and
 * links"). The public door now sends `identity_links`: the artist's connected profiles that
 * say WHO the artist is, whether or not they are a button on the site. Most connections
 * start off the site, so without this they never reached `sameAs`.
 *
 * THE PRIVACY RULE. The door must never publish a link the manager did not choose to show
 * unless TypeScript judged it an identity profile. SQL cannot run the bridge's judgement,
 * so the judgement is made here and STORED (`links.identity_url`); the door only reads it.
 * These tests pin the judgement against the REAL bridge rule (`isIdentityProfileUrl`), on
 * clear-cut cases: a payment handle or an invite is somebody's money or a chat, never an identity.
 *
 * `identity_url` is the URL judged, not a yes/no: it can vouch only for that exact string,
 * so a url changed by any path that skipped the judgement is never published by it.
 */
import { describe, expect, it } from 'vitest'
import { identityUrlOf, planIdentityBackfill, type LinkRowLike } from '@/lib/connections'

const row = (label: string, url: string, extra: Partial<LinkRowLike> = {}): LinkRowLike => ({ id: 'l1', label, url, role: null, ...extra })

describe('identityUrlOf — the verdict a link row stores', () => {
  it('CRITICAL: an artist profile on an identity platform vouches for its own url', () => {
    for (const [label, url] of [
      ['Spotify', 'https://open.spotify.com/artist/26KkyYBR3k3Ynp9tdb9Z4W'],
      ['Instagram', 'https://instagram.com/skeenmusic'],
      ['SoundCloud', 'https://soundcloud.com/skeenmusic'],
    ] as const) {
      expect(identityUrlOf(row(label, url)), url).toBe(url)
    }
  })

  it('creator pages that name the artist ARE identities (Ko-fi, Patreon; decided 2026-09-28)', () => {
    expect(identityUrlOf(row('Ko-fi', 'https://ko-fi.com/skeenmusic'))).toBe('https://ko-fi.com/skeenmusic')
    expect(identityUrlOf(row('Patreon', 'https://patreon.com/skeenmusic'))).toBe('https://patreon.com/skeenmusic')
  })

  // A payment handle can carry a personal legal name.
  it('CRITICAL: a payment handle is never an identity (PayPal, Cash App, Venmo)', () => {
    for (const [label, url] of [
      ['PayPal', 'https://paypal.me/skeenmusic'],
      ['Cash App', 'https://cash.app/$skeenmusic'],
      ['Venmo', 'https://venmo.com/u/skeenmusic'],
    ] as const) {
      expect(identityUrlOf(row(label, url)), url).toBeNull()
    }
  })

  it('CRITICAL: an invite is never an identity (Discord, WhatsApp)', () => {
    expect(identityUrlOf(row('Discord', 'https://discord.gg/AbCdEf'))).toBeNull()
    expect(identityUrlOf(row('WhatsApp', 'https://whatsapp.com/channel/0029VaSkeen'))).toBeNull()
  })

  it('a playlist on an identity platform is not the artist', () => {
    expect(identityUrlOf(row('Spotify', 'https://open.spotify.com/playlist/37i9dQZF1DX0'))).toBeNull()
  })

  it('CRITICAL: only a CONNECTION’s profile row is judged: a role-bound button, a contact row and an unknown label are not', () => {
    const artistPage = 'https://open.spotify.com/artist/26KkyYBR3k3Ynp9tdb9Z4W'
    // The control: the same url on a connection row IS an identity, so the three below
    // are refused for what the row is, not for the url.
    expect(identityUrlOf(row('Spotify', artistPage))).toBe(artistPage)
    expect(identityUrlOf(row('Spotify', artistPage, { role: 'usb' }))).toBeNull()
    expect(identityUrlOf(row('My site', artistPage))).toBeNull()
    expect(identityUrlOf(row('Booking', 'mailto:book@skeen.com'))).toBeNull()
  })

  it('an empty or missing url has nothing to vouch for', () => {
    expect(identityUrlOf(row('Spotify', ''))).toBeNull()
    expect(identityUrlOf({ id: 'l1', label: 'Spotify', url: null })).toBeNull()
  })
})

describe('planIdentityBackfill — what the script would write', () => {
  const artistPage = 'https://open.spotify.com/artist/26KkyYBR3k3Ynp9tdb9Z4W'

  it('CRITICAL: flags an unjudged identity profile, and leaves an unjudged payment handle alone', () => {
    const plan = planIdentityBackfill([
      { id: 's', artist_id: 'a1', label: 'Spotify', url: artistPage, role: null, on_site: false, identity_url: null },
      { id: 'p', artist_id: 'a1', label: 'PayPal', url: 'https://paypal.me/skeenmusic', role: null, on_site: false, identity_url: null },
    ])
    expect(plan).toEqual([{ id: 's', artist_id: 'a1', label: 'Spotify', url: artistPage, on_site: false, from: null, to: artistPage }])
  })

  it('CRITICAL: clears a verdict that no longer holds, and re-judges one left on an old url', () => {
    const plan = planIdentityBackfill([
      // Flagged once, but a payment handle (a bridge rule changed, or a hand write).
      { id: 'p', artist_id: 'a1', label: 'PayPal', url: 'https://paypal.me/skeenmusic', role: null, identity_url: 'https://paypal.me/skeenmusic' },
      // The url moved to a playlist through a path that did not re-judge it.
      { id: 's', artist_id: 'a1', label: 'Spotify', url: 'https://open.spotify.com/playlist/37i9dQZF1DX0', role: null, identity_url: artistPage },
    ])
    expect(plan.map((c) => [c.id, c.from, c.to])).toEqual([
      ['p', 'https://paypal.me/skeenmusic', null],
      ['s', artistPage, null],
    ])
  })

  it('a row whose stored verdict is right is not in the plan (a re-run writes nothing)', () => {
    expect(
      planIdentityBackfill([
        { id: 's', artist_id: 'a1', label: 'Spotify', url: artistPage, role: null, identity_url: artistPage },
        { id: 'p', artist_id: 'a1', label: 'PayPal', url: 'https://paypal.me/skeenmusic', role: null, identity_url: null },
      ]),
    ).toEqual([])
  })

  it('a row read before the column exists counts as unjudged', () => {
    expect(planIdentityBackfill([{ id: 's', artist_id: 'a1', label: 'Spotify', url: artistPage, role: null }]).map((c) => c.to)).toEqual([artistPage])
  })
})
