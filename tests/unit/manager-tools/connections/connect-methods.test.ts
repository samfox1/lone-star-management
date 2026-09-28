/**
 * How each platform asks to be connected (Sam, 2026-09-28: "Each site should ask you for as
 * minimal info as possible … if the user just wants to link an account, like this user's
 * case on x, they should simply be able to add their x handle, thats it").
 *
 * Derived from the bridge's SOCIAL_PLATFORMS (AGENTS.md rule 4): every platform a site can
 * show has a method, and every URL a handle builds is one the site recognises as that
 * platform — so a sixth social added to the bridge fails here until it has a way in.
 */
import { describe, expect, it } from 'vitest'
import { SOCIAL_PLATFORMS, platformFromUrl } from '../../../../packages/site-bridge/src/social'
import { CONNECT_METHODS, handleFromUrl, parseHandle, type HandleMethod } from '@/lib/connect-methods'

const handleMethod = (slug: string) => {
  const m = CONNECT_METHODS[slug]
  if (m?.kind !== 'handle') throw new Error(`${slug} is not a handle platform`)
  return m as HandleMethod
}

describe('CONNECT_METHODS', () => {
  it('CRITICAL: every platform a site can show has a way in', () => {
    expect(SOCIAL_PLATFORMS.map((p) => p.slug).filter((slug) => !CONNECT_METHODS[slug])).toEqual([])
  })

  it('CRITICAL: every handle builds a link the SITE recognises as that platform', () => {
    for (const p of SOCIAL_PLATFORMS) {
      const m = CONNECT_METHODS[p.slug]
      if (m.kind !== 'handle') continue
      const url = m.url(m.example)
      expect(platformFromUrl(url)?.slug, `${p.slug} → ${url}`).toBe(p.slug)
      expect(m.rule.test(m.example), `${p.slug}'s own example passes its rule`).toBe(true)
    }
  })

  it('the music services, whose artists have no handle, take their artist link', () => {
    for (const slug of ['spotify', 'apple music', 'deezer', 'tidal']) expect(CONNECT_METHODS[slug].kind, slug).toBe('link')
  })

  it('so do the 2026-09-28 platforms with no handle: an id or a channel in the link', () => {
    for (const slug of ['youtube music', 'amazon music', 'beatport', 'pandora', 'whatsapp', 'songkick', 'eventbrite'])
      expect(CONNECT_METHODS[slug].kind, slug).toBe('link')
  })

  it('CRITICAL: every host a handle platform takes is one the SITE reads as that platform', () => {
    // Otherwise a pasted twitter.com link would save as X but draw as a plain link, and
    // parseHandle's wrong-platform check (which asks platformFromUrl) would disagree.
    for (const p of SOCIAL_PLATFORMS) {
      const m = CONNECT_METHODS[p.slug]
      if (m.kind !== 'handle') continue
      for (const host of m.hosts) expect(platformFromUrl(`https://${host}/skeen`)?.slug, `${p.slug}: ${host}`).toBe(p.slug)
    }
  })
})

describe('parseHandle — whatever the manager types, the one link the site needs', () => {
  const x = handleMethod('x')

  it('CRITICAL: a bare handle, with or without @, becomes the profile link', () => {
    expect(parseHandle(x, 'skeenmusic')).toEqual({ handle: 'skeenmusic', url: 'https://x.com/skeenmusic' })
    expect(parseHandle(x, '  @skeenmusic ')).toEqual({ handle: 'skeenmusic', url: 'https://x.com/skeenmusic' })
  })

  it('CRITICAL: a pasted profile link is read back to its handle, share junk and all', () => {
    for (const raw of [
      'https://x.com/skeenmusic',
      'x.com/skeenmusic/',
      'https://www.x.com/skeenmusic?s=21&t=abc',
      'https://twitter.com/skeenmusic', // the old domain still finds the account
      'https://mobile.twitter.com/@skeenmusic',
    ])
      expect(parseHandle(x, raw), raw).toEqual({ handle: 'skeenmusic', url: 'https://x.com/skeenmusic' })
  })

  it('says plainly what is wrong', () => {
    expect(parseHandle(x, '')).toEqual({ error: 'Enter the X handle.' })
    expect(parseHandle(x, '@')).toEqual({ error: 'Enter the X handle.' })
    expect(parseHandle(x, 'skeen music')).toEqual({ error: 'That doesn’t look like an X handle.' })
    expect(parseHandle(x, 'a'.repeat(16))).toEqual({ error: 'That doesn’t look like an X handle.' })
    expect(parseHandle(x, 'https://instagram.com/skeenmusic')).toEqual({ error: 'That’s an Instagram link, not X.' })
    expect(parseHandle(x, 'https://example.com/skeenmusic')).toEqual({ error: 'That isn’t an X link.' })
    expect(parseHandle(x, 'https://x.com/')).toEqual({ error: 'Enter the X handle.' })
    // A threads.net link (the old domain) must still be recognised as Threads here, not fall
    // through to "That isn't an X link" — platformFromUrl's aliasHosts is what makes this work.
    expect(parseHandle(x, 'https://www.threads.net/@skeen')).toEqual({ error: 'That’s a Threads link, not X.' })
  })

  it('the @ platforms build their links with the @', () => {
    expect(parseHandle(handleMethod('tiktok'), 'skeen.music')).toEqual({ handle: 'skeen.music', url: 'https://tiktok.com/@skeen.music' })
    expect(parseHandle(handleMethod('threads'), 'https://www.threads.net/@skeen')).toEqual({ handle: 'skeen', url: 'https://threads.com/@skeen' })
    expect(parseHandle(handleMethod('youtube'), '@SkeenMusic')).toEqual({ handle: 'SkeenMusic', url: 'https://youtube.com/@SkeenMusic' })
  })

  it('Threads moved to threads.com: a typed handle builds a threads.com link, and both threads.net and threads.com pastes normalise to it', () => {
    const threads = handleMethod('threads')
    expect(threads.before).toBe('threads.com/@')
    expect(parseHandle(threads, 'skeen')).toEqual({ handle: 'skeen', url: 'https://threads.com/@skeen' })
    expect(parseHandle(threads, '@skeen')).toEqual({ handle: 'skeen', url: 'https://threads.com/@skeen' })
    expect(parseHandle(threads, 'https://www.threads.net/@skeen')).toEqual({ handle: 'skeen', url: 'https://threads.com/@skeen' })
    expect(parseHandle(threads, 'https://www.threads.com/@skeen')).toEqual({ handle: 'skeen', url: 'https://threads.com/@skeen' })
  })

  it('CRITICAL: platformFromUrl recognises both threads.net and threads.com as Threads', () => {
    expect(platformFromUrl('https://threads.net/@skeen')?.slug).toBe('threads')
    expect(platformFromUrl('https://www.threads.net/@skeen')?.slug).toBe('threads')
    expect(platformFromUrl('https://threads.com/@skeen')?.slug).toBe('threads')
  })

  it('Substack keeps a pasted subdomain link as the subdomain; a bare handle or an @ profile link still build/keep the @ profile', () => {
    const substack = handleMethod('substack')
    expect(parseHandle(substack, 'skeen')).toEqual({ handle: 'skeen', url: 'https://substack.com/@skeen' })
    expect(parseHandle(substack, 'https://skeen.substack.com')).toEqual({ handle: 'skeen', url: 'https://skeen.substack.com' })
    expect(parseHandle(substack, 'https://skeen.substack.com/p/some-post')).toEqual({ handle: 'skeen', url: 'https://skeen.substack.com' })
    expect(parseHandle(substack, 'https://substack.com/@skeen')).toEqual({ handle: 'skeen', url: 'https://substack.com/@skeen' })
  })

  it('platformFromUrl recognises a substack subdomain link as Substack (registrable host)', () => {
    expect(platformFromUrl('https://skeen.substack.com')?.slug).toBe('substack')
  })

  it('YouTube keeps a channel link that has no handle in it, as it is', () => {
    const yt = handleMethod('youtube')
    expect(parseHandle(yt, 'https://www.youtube.com/channel/UC1234567890abcdefghijkl')).toEqual({
      handle: null,
      url: 'https://youtube.com/channel/UC1234567890abcdefghijkl',
    })
  })

  it('Bandcamp is a subdomain: the name goes BEFORE the address', () => {
    const bc = handleMethod('bandcamp')
    expect(bc.before).toBe('')
    expect(bc.after).toBe('.bandcamp.com')
    expect(parseHandle(bc, 'skeen')).toEqual({ handle: 'skeen', url: 'https://skeen.bandcamp.com' })
    expect(parseHandle(bc, 'https://skeen.bandcamp.com/album/x')).toEqual({ handle: 'skeen', url: 'https://skeen.bandcamp.com' })
  })

  it('Discord takes an invite code, from a code or either invite link', () => {
    const d = handleMethod('discord')
    expect(d.noun).toBe('invite code')
    for (const raw of ['AbC123', 'discord.gg/AbC123', 'https://discord.com/invite/AbC123'])
      expect(parseHandle(d, raw), raw).toEqual({ handle: 'AbC123', url: 'https://discord.gg/AbC123' })
  })
})

describe('parseHandle — the 2026-09-28 handle platforms', () => {
  it('YouTube: a music.youtube.com link is YouTube Music’s, not a YouTube channel', () => {
    expect(parseHandle(handleMethod('youtube'), 'https://music.youtube.com/channel/UC1234567890abcdefghijkl')).toEqual({ error: 'That’s a YouTube Music link, not YouTube.' })
    expect(parseHandle(handleMethod('youtube'), 'https://youtu.be/@skeenmusic')).toEqual({ handle: 'skeenmusic', url: 'https://youtube.com/@skeenmusic' })
  })

  it('CRITICAL: Cash App — the $ is part of the address, typed or pasted, and an amount never rides along', () => {
    const cash = handleMethod('cash app')
    for (const raw of ['skeenmusic', '$skeenmusic', 'https://cash.app/$skeenmusic', 'cash.app/$skeenmusic/25', 'https://cash.app/$skeenmusic?amount=25'])
      expect(parseHandle(cash, raw), raw).toEqual({ handle: 'skeenmusic', url: 'https://cash.app/$skeenmusic' })
    expect(parseHandle(cash, '$$skeen')).toEqual({ error: 'That doesn’t look like a Cash App handle.' })
    expect(parseHandle(cash, '12345')).toEqual({ error: 'That doesn’t look like a Cash App handle.' })
  })

  it('CRITICAL: PayPal — a PayPal.Me name from either shape, and never another paypal.com page', () => {
    const pp = handleMethod('paypal')
    for (const raw of ['skeenmusic', 'paypal.me/skeenmusic', 'https://paypal.me/skeenmusic/25', 'https://www.paypal.com/paypalme/skeenmusic'])
      expect(parseHandle(pp, raw), raw).toEqual({ handle: 'skeenmusic', url: 'https://paypal.me/skeenmusic' })
    // A donate-button or sign-in link must not become paypal.me/donate — a stranger's page.
    for (const raw of ['https://www.paypal.com/donate/?hosted_button_id=ABC123', 'https://www.paypal.com/signin', 'https://paypal.com/paypalme'])
      expect(parseHandle(pp, raw), raw).toEqual({ error: 'Enter the PayPal page name.' })
  })

  it('Venmo: /u/<name> on either host; a payment request keeps only the name', () => {
    const v = handleMethod('venmo')
    for (const raw of ['skeenmusic', 'https://venmo.com/u/skeenmusic', 'https://account.venmo.com/u/skeenmusic', 'https://venmo.com/u/skeenmusic?txn=pay&amount=5'])
      expect(parseHandle(v, raw), raw).toEqual({ handle: 'skeenmusic', url: 'https://venmo.com/u/skeenmusic' })
  })

  it('Bluesky, Snapchat, Resident Advisor: the name sits after a fixed path', () => {
    expect(parseHandle(handleMethod('bluesky'), 'https://bsky.app/profile/skeen.bsky.social')).toEqual({ handle: 'skeen.bsky.social', url: 'https://bsky.app/profile/skeen.bsky.social' })
    expect(parseHandle(handleMethod('bluesky'), 'skeen.com')).toEqual({ handle: 'skeen.com', url: 'https://bsky.app/profile/skeen.com' })
    expect(parseHandle(handleMethod('bluesky'), 'skeen')).toEqual({ error: 'That doesn’t look like a Bluesky handle.' })
    expect(parseHandle(handleMethod('snapchat'), 'https://www.snapchat.com/add/skeenmusic')).toEqual({ handle: 'skeenmusic', url: 'https://snapchat.com/add/skeenmusic' })
    expect(parseHandle(handleMethod('resident advisor'), 'https://ra.co/dj/skeen')).toEqual({ handle: 'skeen', url: 'https://ra.co/dj/skeen' })
    expect(parseHandle(handleMethod('resident advisor'), 'https://www.residentadvisor.net/dj/skeen')).toEqual({ handle: 'skeen', url: 'https://ra.co/dj/skeen' })
  })

  it('Telegram: t.me or the old telegram.me; a phone-number link is not a username', () => {
    const t = handleMethod('telegram')
    expect(parseHandle(t, 'https://telegram.me/skeenmusic')).toEqual({ handle: 'skeenmusic', url: 'https://t.me/skeenmusic' })
    expect(parseHandle(t, 'https://t.me/+15551234567')).toEqual({ error: 'That doesn’t look like a Telegram username.' })
  })
})

describe('handleFromUrl — an existing link, shown as its handle again', () => {
  it('reads the handle back from a stored link, or null when the link is not a plain profile', () => {
    expect(handleFromUrl(handleMethod('x'), 'https://x.com/skeenmusic')).toBe('skeenmusic')
    expect(handleFromUrl(handleMethod('bandcamp'), 'https://skeen.bandcamp.com')).toBe('skeen')
    expect(handleFromUrl(handleMethod('youtube'), 'https://youtube.com/channel/UC1234567890abcdefghijkl')).toBeNull()
    expect(handleFromUrl(handleMethod('x'), 'https://instagram.com/skeen')).toBeNull()
  })

  it('Substack: both stored shapes read back to the same handle', () => {
    const substack = handleMethod('substack')
    expect(handleFromUrl(substack, 'https://skeen.substack.com')).toBe('skeen')
    expect(handleFromUrl(substack, 'https://substack.com/@skeen')).toBe('skeen')
  })

  it('Threads: a stored threads.net link (from before the move) still reads back', () => {
    expect(handleFromUrl(handleMethod('threads'), 'https://threads.net/@skeen')).toBe('skeen')
    expect(handleFromUrl(handleMethod('threads'), 'https://threads.com/@skeen')).toBe('skeen')
  })
})
