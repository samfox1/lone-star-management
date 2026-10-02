/**
 * Proves the "Your YouTube channel says who you are" test passes only when the channel's own
 * description names the artist's site AND their city or genre, that the channel is found from
 * the YouTube link in Connections, and that "couldn't ask YouTube" is never turned into a fail.
 *
 * Code:     src/lib/seo-tests/youtube.ts (youtubeChannelRef, channelSelectors, siteMentionIn,
 *           lookupYouTube, youtubeKey), src/lib/seo-tests/who.ts (`youtube`)
 * Feature:  SEO test `youtube` · Test tab "Says who you are" (OUTSIDE_PROFILES_PLAN.md, step 2)
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads outside text with Tapir's key, parses links
 *           the manager typed into a request, and tells the artist to go edit another site.
 * Covers:   • the channel link: each URL shape (@handle, /channel/UC…, /c/, /user/) and every link
 *             that is not a YouTube channel
 *           • the site in free text, any spelling (scheme, www, path, punctuation, case), and
 *             look-alikes that are not the site
 *           • the lookup: one channels.list request with the right selector and parts; /c/ falls
 *             back to a legacy username; no link or no key asks nothing; every way of not getting
 *             an answer is `looked: false`; the key is never in what comes back
 *           • the test: pass / fail (what is missing, by name) / na (no YouTube link) / unknown
 *             (couldn't ask, not asked, nothing published); WHAT WE SAW quotes the description;
 *             WHAT TO DO opens YouTube Studio
 *           • the key loader refuses to run under vitest
 * Not here: the run's budget around the lookup (tests/unit/seo-tests/runs/running.test.ts); the
 *           Profiles tab's YouTube row (tests/unit/manager-tools/seo/bio-state.test.ts,
 *           tests/components/manager-tools/seo/bio-rows.test.tsx).
 * Fixtures: tests/fixtures/youtube-channels.json: REAL channels.list answers fetched 2026-10-02
 *           for Skeen (his Connections link @Sskeen, which YouTube no longer knows, and his real
 *           channel by id). `ytFetch` fakes YouTube's replies in order and records what was
 *           asked. The key is a made-up string; nothing reaches the network.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { channelSelectors, lookupYouTube, siteMentionIn, youtubeChannelRef, youtubeKey } from '@/lib/seo-tests/youtube'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import type { SeoEvidence } from '@/lib/seo-tests/types'
import { ORIGIN, evidence, expectPlainWords, known, rowOf } from '@tests/helpers/seo/page-fixture'

const FIX = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/youtube-channels.json'), 'utf8'))
const KEY = 'made-up-test-key-123'
/** Skeen's YouTube link in Connections today. */
const SKEEN_LINK = 'https://www.youtube.com/@Sskeen'
/** The channel his synced videos come from (now @skeenmusic). */
const SKEEN_ID = 'UCpa4vYE3su6wUjHg_ck33zw'
const SKEEN_CHANNEL = `https://www.youtube.com/channel/${SKEEN_ID}`

type Reply = { status?: number; json?: unknown; text?: string } | Error
function ytFetch(...replies: Reply[]) {
  const queue = [...replies]
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const r = queue.shift()
    if (!r) throw new Error(`no more replies (asked ${String(input)})`)
    if (r instanceof Error) throw r
    const body = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json))
    return new Response(body, { status: r.status ?? 200, headers: { 'content-type': 'application/json; charset=UTF-8' } })
  })
}
const asked = (f: ReturnType<typeof ytFetch>, call = 0) => new URL(String(f.mock.calls[call][0]))

/** The healthy fixture artist, with a YouTube link added to what Tapir published. */
const withYouTube = (url: string) => known({}, { links: [...known().published!.links, { label: 'YouTube', url, onSite: true }] })

describe('which channel: the YouTube link in Connections', () => {
  // Every shape a channel link comes in names the same kind of thing YouTube's channels.list asks by.
  it.each([
    ['https://www.youtube.com/@Sskeen', { kind: 'handle', value: 'Sskeen' }],
    ['https://youtube.com/@Sskeen/videos?si=abc', { kind: 'handle', value: 'Sskeen' }],
    ['https://m.youtube.com/@skeen.music', { kind: 'handle', value: 'skeen.music' }],
    ['http://www.youtube.com/@Sskeen', { kind: 'handle', value: 'Sskeen' }],
    ['https://youtube.com/@%E3%83%86%E3%82%B9%E3%83%88', { kind: 'handle', value: 'テスト' }],
    [`https://www.youtube.com/channel/${SKEEN_ID}/featured`, { kind: 'id', value: SKEEN_ID }],
    ['https://www.youtube.com/c/skeenmusic', { kind: 'custom', value: 'skeenmusic' }],
    ['https://www.youtube.com/user/skeenmusic/videos', { kind: 'username', value: 'skeenmusic' }],
  ])('%s', (url, ref) => {
    expect(youtubeChannelRef(url)).toEqual(ref)
  })

  // A video, a playlist, YouTube Music, another host dressed up as YouTube, or a malformed id is not a channel: nothing is asked about it.
  it.each([
    'https://www.youtube.com/watch?v=z5ERrgFl8G0',
    'https://youtu.be/z5ERrgFl8G0',
    'https://www.youtube.com/shorts/z5ERrgFl8G0',
    'https://www.youtube.com/playlist?list=PL123',
    `https://music.youtube.com/channel/${SKEEN_ID}`,
    'https://www.youtube.com.evil.example/@Sskeen',
    'https://evil.example/www.youtube.com/@Sskeen',
    'https://www.youtube.com/channel/UCshort',
    'https://www.youtube.com/@a',
    'https://www.youtube.com/@has%20space',
    'https://www.youtube.com/',
    'https://www.youtube.com/c/',
    'javascript:alert(1)//youtube.com/@x',
    'ftp://youtube.com/@Sskeen',
    'not a url',
  ])('not a channel: %s', (url) => {
    expect(youtubeChannelRef(url)).toBeNull()
  })

  // Each kind becomes the channels.list selector for it; a /c/ name is tried as a handle first (YouTube made most of them handles), then as a legacy username.
  it('asks by id, by handle, or by legacy username', () => {
    expect(channelSelectors({ kind: 'id', value: SKEEN_ID })).toEqual([`id=${SKEEN_ID}`])
    expect(channelSelectors({ kind: 'handle', value: 'Sskeen' })).toEqual(['forHandle=%40Sskeen'])
    expect(channelSelectors({ kind: 'custom', value: 'skeenmusic' })).toEqual(['forHandle=%40skeenmusic', 'forUsername=skeenmusic'])
    expect(channelSelectors({ kind: 'username', value: 'skeenmusic' })).toEqual(['forUsername=skeenmusic'])
  })
})

describe('the site, spelled any way, in the description', () => {
  const SITE = 'https://www.skeenmusic.com'

  // A description names the site however it is typed: bare, www, a scheme, a page on it, a label before it, punctuation after it, any case.
  it.each([
    ['skeenmusic.com', 'skeenmusic.com'],
    ['Shows: www.skeenmusic.com', 'www.skeenmusic.com'],
    ['https://www.skeenmusic.com/', 'https://www.skeenmusic.com/'],
    ['tickets at http://skeenmusic.com/shows', 'http://skeenmusic.com/shows'],
    ['Website: skeenmusic.com.', 'skeenmusic.com'],
    ['Website:skeenmusic.com', 'skeenmusic.com'],
    ['(SkeenMusic.com)', 'SkeenMusic.com'],
    ['→skeenmusic.com/tour!', 'skeenmusic.com/tour'],
    ['listen https://skeenmusic.com?ref=yt\nmore', 'https://skeenmusic.com?ref=yt'],
  ])('finds the site in %j', (text, found) => {
    expect(siteMentionIn(text, SITE)).toBe(found)
  })

  // Look-alikes are not the site: the name alone, another ending, a longer name, the site's name inside another host, an email address, another subdomain, the site in a path elsewhere.
  it.each([
    'skeenmusic',
    'skeenmusic.co',
    'notskeenmusic.com',
    'skeenmusic.com.evil.example',
    'book@skeenmusic.com',
    'shop.skeenmusic.com',
    'https://evil.example/skeenmusic.com',
    'https://skeenmusic.com@evil.example',
    '',
  ])('not the site: %j', (text) => {
    expect(siteMentionIn(text, SITE)).toBeNull()
  })
})

describe('asking YouTube', () => {
  // Skeen's Connections link today: one channels.list request, by his handle, for the description parts, with the key; YouTube's real answer has no channel there.
  it('asks once, by the link’s handle, for snippet and brandingSettings, with the key', async () => {
    const f = ytFetch({ json: FIX.forHandle_Sskeen })
    const r = await lookupYouTube(withYouTube(SKEEN_LINK), { apiKey: KEY, fetcher: f })
    expect(r).toEqual({ link: SKEEN_LINK, looked: true, channel: null })
    expect(f).toHaveBeenCalledTimes(1)
    const u = asked(f)
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/youtube/v3/channels')
    expect(u.searchParams.get('part')).toBe('snippet,brandingSettings')
    expect(u.searchParams.get('forHandle')).toBe('@Sskeen')
    expect(u.searchParams.get('key') === KEY).toBe(true)
  })

  // His real channel, by id: its id, name, handle and description come back as YouTube sent them.
  it('reads the channel: id, name, handle and description', async () => {
    const f = ytFetch({ json: FIX[`id_${SKEEN_ID}`] })
    const r = await lookupYouTube(withYouTube(SKEEN_CHANNEL), { apiKey: KEY, fetcher: f })
    expect(r).toEqual({ link: SKEEN_CHANNEL, looked: true, channel: { id: SKEEN_ID, title: 'Skeen', handle: '@skeenmusic', description: 'skeeeeeeen\n' } })
    expect(asked(f).searchParams.get('id')).toBe(SKEEN_ID)
  })

  // A /c/ name YouTube doesn't know as a handle is asked again as a legacy username: two requests, the second finds it.
  it('a /c/ name: by handle, then as a legacy username', async () => {
    const f = ytFetch({ json: FIX.forHandle_Sskeen }, { json: FIX[`id_${SKEEN_ID}`] })
    const r = await lookupYouTube(withYouTube('https://www.youtube.com/c/skeenmusic'), { apiKey: KEY, fetcher: f })
    expect(r.channel?.id).toBe(SKEEN_ID)
    expect(f).toHaveBeenCalledTimes(2)
    expect(asked(f, 0).searchParams.get('forHandle')).toBe('@skeenmusic')
    expect(asked(f, 1).searchParams.get('forUsername')).toBe('skeenmusic')
  })

  // No YouTube channel link (none at all, or only a video link): nothing is asked, even with a key, and the answer says there is no link.
  it('no channel link: nothing asked, link null', async () => {
    for (const k of [known(), withYouTube('https://www.youtube.com/watch?v=z5ERrgFl8G0'), known({ published: null })]) {
      const f = ytFetch()
      expect(await lookupYouTube(k, { apiKey: KEY, fetcher: f })).toEqual({ link: null, looked: false, channel: null })
      expect(f).not.toHaveBeenCalled()
    }
  })

  // No key on the server: nothing is asked, and the answer says it couldn't ask (never "no channel").
  it('no key: nothing asked, looked false', async () => {
    const f = ytFetch()
    const r = await lookupYouTube(withYouTube(SKEEN_LINK), { apiKey: null, fetcher: f })
    expect(r).toMatchObject({ link: SKEEN_LINK, looked: false, channel: null })
    expect(r.error).toMatch(/key/i)
    expect(f).not.toHaveBeenCalled()
  })

  // Every way of not getting a readable answer is "couldn't ask": a thrown fetch, the daily quota, a refused key, a server error, junk, a non-channel answer. The key is never in what comes back.
  it.each([
    ['a thrown fetch', new Error('ECONNRESET'), /reach YouTube/],
    ['the daily quota', { status: 403, json: { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } } }, /daily limit/],
    ['a refused key', { status: 400, json: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest', domain: 'global' }], details: [{ reason: 'API_KEY_INVALID' }] } } }, /key/],
    ['a server error', { status: 500, text: 'oops' }, /error 500/],
    ['junk', { text: '<html>not json</html>' }, /couldn’t read/],
    ['another shape', { json: { kind: 'youtube#videoListResponse', items: [] } }, /couldn’t read/],
    ['a channel with a bad id', { json: { kind: 'youtube#channelListResponse', items: [{ id: 'nope', snippet: { title: 'x', description: 'y' } }] } }, /couldn’t read/],
  ] as [string, Reply, RegExp][])('%s: looked false', async (_, reply, why) => {
    const r = await lookupYouTube(withYouTube(SKEEN_LINK), { apiKey: KEY, fetcher: ytFetch(reply) })
    expect(r).toMatchObject({ link: SKEEN_LINK, looked: false, channel: null })
    expect(r.error).toMatch(why)
    expect(JSON.stringify(r).includes(KEY)).toBe(false)
  })

  // The run ran out of time before asking: nothing is sent.
  it('an aborted run asks nothing', async () => {
    const f = ytFetch()
    const r = await lookupYouTube(withYouTube(SKEEN_LINK), { apiKey: KEY, fetcher: f, signal: AbortSignal.abort() })
    expect(r.looked).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  // A key the server holds is read once, explicitly, and never under vitest: a test that forgot to inject one would otherwise call YouTube with the real key.
  it('the key loader refuses under vitest', () => {
    expect(() => youtubeKey('anything')).toThrow(/not for tests/)
  })
})

describe('the YouTube test', () => {
  const t = WHO_TESTS.youtube
  const answer = (description: string, link = SKEEN_CHANNEL): NonNullable<SeoEvidence['youtube']> => ({
    link,
    looked: true,
    channel: { id: SKEEN_ID, title: 'Skeen', handle: '@skeenmusic', description },
  })
  const run = (y: SeoEvidence['youtube'], k = withYouTube(SKEEN_CHANNEL)) => t(evidence({ known: k, youtube: y }))

  // Skeen today, end to end from YouTube's real answer: his Connections link opens no channel, so the fix is the link, in Connections.
  it('Skeen’s link today: no channel there, so fix the link in Connections', async () => {
    const y = await lookupYouTube(withYouTube(SKEEN_LINK), { apiKey: KEY, fetcher: ytFetch({ json: FIX.forHandle_Sskeen }) })
    const r = run(y, withYouTube(SKEEN_LINK))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('no channel there')
    expect(r.action).toEqual({ kind: 'edit', target: 'connections', label: 'Open Connections' })
    expect(rowOf(r, 'in Tapir: your YouTube link')).toBe('www.youtube.com/@Sskeen')
    expectPlainWords(r)
  })

  // Skeen's real channel description ("skeeeeeeen") names neither the site nor his city or genre: a fail naming both, quoting what's there, sending him to YouTube Studio.
  it('Skeen’s real description: fails, naming the site and his city and genres', async () => {
    const y = await lookupYouTube(withYouTube(SKEEN_CHANNEL), { apiKey: KEY, fetcher: ytFetch({ json: FIX[`id_${SKEEN_ID}`] }) })
    const r = run(y)
    expect(r.status).toBe('fail')
    expect(r.lead).toBeUndefined()
    expect(r.sentence).toContain('doesn’t link your site')
    expect(r.sentence).toContain('doesn’t say Chicago, House or Tech House')
    expect(rowOf(r, 'description')).toBe('skeeeeeeen')
    expect(r.action).toEqual({ kind: 'outside', href: 'https://studio.youtube.com/', label: 'Open YouTube Studio' })
    expectPlainWords(r)
  })

  // The site and the city: a pass. The details quote the lines that say them.
  it('passes when the description links the site and says the city', () => {
    const r = run(answer('Videos every week.\nChicago DJ and producer. Shows: example-artist.com/shows'))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'description')).toBe('Chicago DJ and producer. Shows: example-artist.com/shows')
    expect(rowOf(r, 'your site')).toBe('example-artist.com/shows')
    expect(rowOf(r, 'city')).toBe('Chicago')
    expectPlainWords(r)
  })

  // A genre is enough in place of the city.
  it('passes with the site and a genre, no city', () => {
    const r = run(answer('Tech house from the ground up · https://www.example-artist.com'))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'genre')).toBe('Tech House')
  })

  // Half right is "Almost", and names exactly what is missing.
  it('the site but no city or genre: Almost, naming them', () => {
    const r = run(answer('Daily vlogs. www.example-artist.com'))
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).toContain('doesn’t say Chicago, House or Tech House')
    expect(r.sentence).not.toContain('site')
  })

  // The other half: the city is there, the site isn't, so only the site is named.
  it('the city but no site: Almost, naming the site', () => {
    const r = run(answer('Chicago house DJ. Bookings by email.'))
    expect(r).toMatchObject({ status: 'fail', lead: 'Almost' })
    expect(r.sentence).toContain('doesn’t link your site')
    expect(r.sentence).not.toContain('Chicago')
  })

  // A long description: the line that says it is quoted, not just the start.
  it('quotes the relevant line of a long description', () => {
    const filler = Array.from({ length: 30 }, (_, i) => `Episode ${i + 1} is up now.`).join('\n')
    const r = run(answer(`${filler}\nBased in Chicago · example-artist.com`))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'description')).toBe('Based in Chicago · example-artist.com')
  })

  // An empty description says so.
  it('an empty description fails and says it is empty', () => {
    const r = run(answer(''))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'description')).toBe('empty')
  })

  // Tapir has no city or genre: only the site can be asked for, so the site alone passes (a fact Tapir doesn't have is never held against the artist).
  it('with no city or genre in Tapir, the site alone passes', () => {
    const k = known({}, { location: null, genre: null, links: [...known().published!.links, { label: 'YouTube', url: SKEEN_CHANNEL, onSite: true }] })
    expect(run(answer('example-artist.com'), k).status).toBe('pass')
  })

  // No YouTube link: the test does not apply.
  it('no YouTube link: does not apply', () => {
    const r = run({ link: null, looked: false, channel: null }, known())
    expect(r.status).toBe('na')
    expect(rowOf(r, 'in Tapir: YouTube')).toBe('no channel linked')
  })

  // Couldn't ask YouTube (no key, quota, timeout), or the run never asked: "couldn't check", never a fail.
  it('could not ask, or never asked: unknown, saying why', () => {
    const r = run({ link: SKEEN_LINK, looked: false, channel: null, error: 'Tapir’s daily limit for YouTube ran out' })
    expect(r.status).toBe('unknown')
    expect(r.sentence).toContain('daily limit')
    expect(run(undefined).status).toBe('unknown')
  })

  // Nothing published from Tapir: no city, genre or link to compare, so it says so.
  it('nothing published: unknown', () => {
    const r = run(answer('Chicago · example-artist.com'), known({ published: null }))
    expect(r.status).toBe('unknown')
    expect(r.sentence).toMatch(/haven’t published/)
  })

  // The site the test looks for is the one Tapir tests (ORIGIN), labelled as Tapir's.
  it('labels what it looked for as Tapir’s', () => {
    const r = run(answer('nothing here'))
    expect(rowOf(r, 'in Tapir: site')).toBe(ORIGIN.replace('https://', ''))
    expect(rowOf(r, 'in Tapir: city')).toBe('Chicago')
    expect(rowOf(r, 'in Tapir: genre')).toBe('House, Tech House')
  })
})
