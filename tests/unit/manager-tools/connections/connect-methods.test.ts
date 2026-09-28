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
