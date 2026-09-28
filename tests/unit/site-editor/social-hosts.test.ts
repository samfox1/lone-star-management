// Which platform a link is: the host rules platformFromUrl (the bridge) and parseHandle share.
/**
 * WHICH PLATFORM A LINK IS (2026-09-28, the 18 new connections).
 *
 * `platformFromUrl` is what every connected site and the dashboard ask "is this link one of
 * ours, and whose?" (the editor's icon pick, the Connect form's wrong-platform check, the
 * site's JSON-LD `sameAs`). Two real bugs came with the new platforms:
 *
 *   • a platform on ONE subdomain of a bigger site: `music.youtube.com` collapsed to
 *     `youtube.com` and read as YouTube, so YouTube Music could never be told apart;
 *   • country domains: `eventbrite.co.uk` and `music.amazon.co.uk` collapsed to `co.uk`.
 *
 * BEFORE is the witness: every result below was captured by RUNNING platformFromUrl as it
 * stood at eadf771 (before this change), not derived from the code under test. The new rules
 * must leave every one of them alone. The cases that change on purpose are listed apart, and
 * were seen red before the fix.
 */
import { describe, expect, it } from 'vitest'
import { SOCIAL_PLATFORMS, platformFromUrl, registrableDomain } from '@samfox1/site-bridge/social'

/** platformFromUrl's answers at eadf771, captured by running it. */
const BEFORE: [string, string | null][] = [
  ['https://instagram.com/skeen', 'instagram'],
  ['https://www.instagram.com/skeen/', 'instagram'],
  ['https://WWW.Instagram.com/juniper', 'instagram'],
  ['https://tiktok.com/@skeen', 'tiktok'],
  ['https://www.tiktok.com/@skeen/video/1', 'tiktok'],
  ['https://m.tiktok.com/@skeen', 'tiktok'],
  ['https://youtube.com/@skeen', 'youtube'],
  ['https://www.youtube.com/channel/UC123', 'youtube'],
  ['https://m.youtube.com/@skeen', 'youtube'],
  ['https://studio.youtube.com/channel/UC1', 'youtube'],
  ['https://open.spotify.com/artist/26K', 'spotify'],
  ['https://spotify.com', 'spotify'],
  ['https://play.spotify.com/artist/26K', 'spotify'],
  ['https://open.spotify.com/playlist/0ML', 'spotify'],
  ['https://music.apple.com/us/artist/x/1', 'apple music'],
  ['https://itunes.apple.com/artist/x/1', 'apple music'],
  ['https://apple.com', 'apple music'],
  ['https://soundcloud.com/skeen', 'soundcloud'],
  ['https://m.soundcloud.com/skeen', 'soundcloud'],
  ['https://skeen.bandcamp.com', 'bandcamp'],
  ['https://bandcamp.com/skeen', 'bandcamp'],
  ['https://facebook.com/skeen', 'facebook'],
  ['https://m.facebook.com/skeen', 'facebook'],
  ['https://x.com/skeen', 'x'],
  ['https://threads.com/@skeen', 'threads'],
  ['https://threads.net/@skeen', 'threads'],
  ['https://www.threads.net/@skeen', 'threads'],
  ['https://substack.com/@skeen', 'substack'],
  ['https://skeen.substack.com', 'substack'],
  ['https://patreon.com/skeen', 'patreon'],
  ['https://www.patreon.com/c/skeen', 'patreon'],
  ['https://discord.gg/AbC123', 'discord'],
  ['https://twitch.tv/skeen', 'twitch'],
  ['https://m.twitch.tv/skeen', 'twitch'],
  ['https://deezer.com/artist/1', 'deezer'],
  ['https://www.deezer.com/en/artist/1', 'deezer'],
  ['https://tidal.com/artist/1', 'tidal'],
  ['https://listen.tidal.com/artist/1', 'tidal'],
  ['https://juniperhale.com', null],
  ['not a url', null],
  ['', null],
  ['mailto:a@b.com', null],
  ['http://localhost:3000', null],
  ['https://evilyoutube.com/@skeen', null],
  ['https://youtube.com.evil.com/@skeen', null],
  ['https://instagram.com.evil.net/skeen', null],
  ['https://evil.com/?u=https://instagram.com/skeen', null],
  ['https://instagram.co/skeen', null],
  ['https://amazon.com/dp/B00', null],
  ['https://www.bbc.co.uk/music', null],
  ['https://wa.me/15551234567', null],
]

describe('platformFromUrl — every existing answer stands', () => {
  it('CRITICAL: the 20 existing connections resolve exactly as before', () => {
    // A whole table at once, so one drifted answer names itself.
    expect(BEFORE.map(([url]) => [url, platformFromUrl(url)?.slug ?? null])).toEqual(BEFORE)
  })
})

describe('platformFromUrl — a platform on one subdomain wins that subdomain', () => {
  it('CRITICAL: music.youtube.com is YouTube Music; every other YouTube host stays YouTube', () => {
    expect(platformFromUrl('https://music.youtube.com/channel/UC123')?.slug).toBe('youtube music')
    expect(platformFromUrl('https://www.music.youtube.com/channel/UC123')?.slug).toBe('youtube music')
    expect(platformFromUrl('https://MUSIC.YouTube.com/browse/x')?.slug).toBe('youtube music')
    // `xmusic.youtube.com` is under youtube.com, not under music.youtube.com.
    for (const url of ['https://youtube.com/@skeen', 'https://www.youtube.com/channel/UC1', 'https://m.youtube.com/@skeen', 'https://youtu.be/abc', 'https://xmusic.youtube.com/x'])
      expect(platformFromUrl(url)?.slug, url).toBe('youtube')
  })

  it('CRITICAL: music.amazon.<country> is Amazon Music, and the rest of Amazon is nothing', () => {
    for (const tld of ['com', 'co.uk', 'de', 'fr', 'it', 'es', 'co.jp', 'ca', 'com.au', 'in', 'com.br', 'com.mx'])
      expect(platformFromUrl(`https://music.amazon.${tld}/artists/B00157GJ20`)?.slug, tld).toBe('amazon music')
    // An Amazon shop page is not an Amazon Music profile.
    for (const url of ['https://amazon.com/dp/B00', 'https://www.amazon.co.uk/dp/B00', 'https://amazon.de', 'https://smile.amazon.com'])
      expect(platformFromUrl(url), url).toBeNull()
  })
})

describe('platformFromUrl — country domains', () => {
  it('CRITICAL: Eventbrite on its country sites, and on an organizer subdomain', () => {
    for (const url of [
      'https://eventbrite.com/o/skeen-123',
      'https://www.eventbrite.co.uk/o/skeen-123',
      'https://www.eventbrite.com.au/o/skeen-123',
      'https://eventbrite.ca/o/skeen-123',
      'https://www.eventbrite.ie/o/skeen-123',
      'https://www.eventbrite.de/o/skeen-123',
      'https://www.eventbrite.co.nz/o/skeen-123',
      'https://skeen.eventbrite.com',
      'https://skeen.eventbrite.co.uk',
    ])
      expect(platformFromUrl(url)?.slug, url).toBe('eventbrite')
  })

  it('registrableDomain keeps three labels under a listed multi-part suffix, two otherwise', () => {
    expect(registrableDomain('www.instagram.com')).toBe('instagram.com')
    expect(registrableDomain('open.spotify.com')).toBe('spotify.com')
    expect(registrableDomain('music.amazon.co.uk')).toBe('amazon.co.uk')
    expect(registrableDomain('www.eventbrite.com.au')).toBe('eventbrite.com.au')
    expect(registrableDomain('eventbrite.co.nz')).toBe('eventbrite.co.nz')
    expect(registrableDomain('bbc.co.uk')).toBe('bbc.co.uk')
    expect(registrableDomain('co.uk')).toBe('co.uk')
    expect(registrableDomain('t.me')).toBe('t.me')
    expect(registrableDomain('localhost')).toBe('localhost')
  })
})

describe('platformFromUrl — look-alikes are nobody', () => {
  it('CRITICAL: a stranger’s host that merely CONTAINS a platform’s name is not that platform', () => {
    for (const url of [
      'https://music.youtube.com.evil.com/channel/UC1',
      'https://evilyoutube.com/@skeen',
      'https://musicyoutube.com/channel/UC1',
      'https://notmusic.youtube.com.evil.net/x',
      'https://amazon.co.uk.evil.net/music',
      'https://music.amazon.co.uk.evil.net/artists/B00',
      'https://music.amazon.xyz/artists/B00',
      'https://music-amazon.com/artists/B00',
      'https://notmusic.amazon.com/artists/B00',
      'https://eventbrite.xyz/o/x-1',
      'https://eventbrite.co.uk.evil.net/o/x-1',
      'https://evileventbrite.co.uk/o/x-1',
      'https://co.uk/o/x-1',
      'https://evil.com/music.amazon.com/artists/B00',
      'https://music.youtube.com@evil.com/channel/UC1',
    ])
      expect(platformFromUrl(url), url).toBeNull()
  })

  it('only a web link is a platform link — not javascript:, not ftp:', () => {
    expect(platformFromUrl('javascript://instagram.com/%0Aalert(1)')).toBeNull()
    expect(platformFromUrl('ftp://instagram.com/skeen')).toBeNull()
    expect(platformFromUrl('http://instagram.com/skeen')?.slug).toBe('instagram')
  })
})

describe('platformFromUrl — the platforms’ own other domains', () => {
  it('the old or short domains their own links use', () => {
    expect(platformFromUrl('https://twitter.com/skeen')?.slug).toBe('x')
    expect(platformFromUrl('https://mobile.twitter.com/skeen')?.slug).toBe('x')
    expect(platformFromUrl('https://fb.com/skeen')?.slug).toBe('facebook')
    expect(platformFromUrl('https://discord.com/invite/AbC123')?.slug).toBe('discord')
    expect(platformFromUrl('https://telegram.me/skeenmusic')?.slug).toBe('telegram')
    expect(platformFromUrl('https://residentadvisor.net/dj/skeen')?.slug).toBe('resident advisor')
    expect(platformFromUrl('https://www.paypal.com/paypalme/skeen')?.slug).toBe('paypal')
  })

  it('CRITICAL: wa.me is NOT WhatsApp — its links are phone numbers (see the whatsapp service)', () => {
    expect(platformFromUrl('https://wa.me/15551234567')).toBeNull()
    expect(platformFromUrl('https://whatsapp.com/channel/0029VaSkeen')?.slug).toBe('whatsapp')
  })

  it('every alias is a host the matcher can reach — a country domain needs its suffix listed', () => {
    // A registrable alias under a multi-part suffix we forgot to list would collapse to that
    // suffix and never match; a subdomain-only platform's alias must be a subdomain.
    for (const p of SOCIAL_PLATFORMS)
      for (const alias of p.aliasHosts ?? []) {
        if (p.subdomainOnly) expect(registrableDomain(alias), `${p.slug}: ${alias}`).not.toBe(alias)
        else expect(registrableDomain(alias), `${p.slug}: ${alias}`).toBe(alias)
        expect(platformFromUrl(`https://${alias}/x`)?.slug, `${p.slug}: ${alias}`).toBe(p.slug)
      }
  })
})
