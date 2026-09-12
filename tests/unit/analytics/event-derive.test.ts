// Every rule the `event` door decides, pinned without I/O. supabase/functions/event/derive.ts
// and _shared/{hash,request}.ts are in the Stryker `mutate` slice, so each rule here must go
// red when its line is broken. Lookup tables are checked against an INDEPENDENT expected
// table (the map under test is never its own oracle); registries are iterated, never copied.
import { describe, expect, it } from 'vitest'
import { ENTITY_KINDS as TS_KINDS, EVENT_TYPES as TS_TYPES } from '@/lib/events'
import { SOURCE_KEYS } from '@/lib/analytics-sources'
import {
  BOT_UA_NAMES,
  ENTITY_KINDS,
  EVENT_TYPES,
  HOST_BUCKETS,
  NO_GEO,
  SOURCES,
  UTM_BUCKETS,
  bucketForHost,
  geoFromIpinfo,
  hostOf,
  ipHash,
  isBot,
  isEditShell,
  isLookupable,
  locateWith,
  pageMatchesOrigin,
  pagePath,
  parseAllowedOrigins,
  parseUa,
  referrerHost,
  reflectOrAllowlisted,
  sourceFor,
  utcDate,
  utcHour,
  utmOf,
  validateEvent,
  visitorHash,
  type GeoDeps,
} from '../../../supabase/functions/event/derive'
import { clientIp, normalizeIp } from '../../../supabase/functions/_shared/request'
import { hashIp, sha256Hex } from '../../../supabase/functions/_shared/hash'
import { corsHeaders, json, pickAllowedOrigin } from '../../../supabase/functions/_shared/cors'

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('the pinned registries mirror their originals', () => {
  it('event types (src/lib/events.ts)', () => {
    expect([...EVENT_TYPES].sort()).toEqual(TS_TYPES.map((e) => e.type).sort())
  })
  it('entity kinds (src/lib/events.ts)', () => {
    expect([...ENTITY_KINDS].sort()).toEqual([...TS_KINDS].sort())
  })
  it('source buckets (src/lib/analytics-sources.ts), same order', () => {
    expect([...SOURCES]).toEqual([...SOURCE_KEYS])
  })
})

describe('validateEvent', () => {
  const ok = { slug: 'skeen', type: 'view', url: 'https://skeenmusic.com/?utm_source=ig', referrer: '' }
  it('accepts the minimal body and defaults referrer + entity', () => {
    const v = validateEvent({ slug: 'skeen', type: 'view', url: 'https://skeenmusic.com/' })
    expect(v).toEqual({ kind: 'ok', value: { slug: 'skeen', type: 'view', url: 'https://skeenmusic.com/', referrer: '', entity: null } })
  })
  it('rejects a missing slug or url, a non-object, and an off-list type', () => {
    expect(validateEvent(null)).toEqual({ kind: 'error', error: 'missing_field' })
    expect(validateEvent('a string')).toEqual({ kind: 'error', error: 'missing_field' })
    expect(validateEvent(42)).toEqual({ kind: 'error', error: 'missing_field' })
    expect(validateEvent({ ...ok, slug: '' })).toEqual({ kind: 'error', error: 'missing_field' })
    expect(validateEvent({ ...ok, url: undefined })).toEqual({ kind: 'error', error: 'missing_field' })
    expect(validateEvent({ ...ok, type: 'pageview' })).toEqual({ kind: 'error', error: 'bad_type' })
  })
  it('an entity needs a registered kind and a uuid; the id is lower-cased; the label is optional and capped at 200', () => {
    const id = '0E4D3C2B-1A2B-4C3D-8E9F-0A1B2C3D4E5F'
    expect(validateEvent({ ...ok, entity: { kind: 'track', id, label: 'Navy Pier' } })).toMatchObject({ kind: 'ok', value: { entity: { kind: 'track', id: id.toLowerCase(), label: 'Navy Pier' } } })
    expect(validateEvent({ ...ok, entity: { kind: 'track', id } })).toMatchObject({ value: { entity: { kind: 'track', id: id.toLowerCase() } } })
    expect(validateEvent({ ...ok, entity: null })).toMatchObject({ value: { entity: null } })
    expect(validateEvent({ ...ok, entity: { kind: 'artist', id } })).toEqual({ kind: 'error', error: 'bad_entity' })
    expect(validateEvent({ ...ok, entity: { kind: 'track', id: 'not-a-uuid' } })).toEqual({ kind: 'error', error: 'bad_entity' })
    expect(validateEvent({ ...ok, entity: 'track' })).toEqual({ kind: 'error', error: 'bad_entity' })
    expect(validateEvent({ ...ok, entity: { kind: 'link', id, label: '' } })).toMatchObject({ value: { entity: { kind: 'link', id: id.toLowerCase() } } })
    const long = validateEvent({ ...ok, entity: { kind: 'link', id, label: 'L'.repeat(201) } })
    expect(long.kind === 'ok' && 'label' in (long.value.entity ?? {})).toBe(false)
    const exact = validateEvent({ ...ok, entity: { kind: 'link', id, label: 'L'.repeat(200) } })
    expect(exact.kind === 'ok' && exact.value.entity?.label?.length).toBe(200)
  })
  it('exact caps are accepted, one over is not; a long referrer is truncated, a non-string one is empty', () => {
    expect(validateEvent({ ...ok, slug: 's'.repeat(100) }).kind).toBe('ok')
    expect(validateEvent({ ...ok, slug: 'x'.repeat(101) })).toEqual({ kind: 'error', error: 'missing_field' })
    expect(validateEvent({ ...ok, url: 'https://a.example/' + 'x'.repeat(2048 - 18) }).kind).toBe('ok')
    expect(validateEvent({ ...ok, url: 'https://a.example/' + 'x'.repeat(2048) })).toEqual({ kind: 'error', error: 'missing_field' })
    const v = validateEvent({ ...ok, referrer: 'https://r.example/' + 'y'.repeat(5000) })
    expect(v.kind === 'ok' && v.value.referrer.length).toBe(2048)
    expect(validateEvent({ ...ok, referrer: 5 })).toMatchObject({ value: { referrer: '' } })
  })
})

describe('page path + edit shell', () => {
  it('strips query and hash, keeps exactly 200, and falls back to / (even for a pathless URL)', () => {
    expect(pagePath('https://skeenmusic.com/about?utm_source=ig#top')).toBe('/about')
    expect(pagePath('https://skeenmusic.com')).toBe('/')
    expect(pagePath('not a url')).toBe('/')
    expect(pagePath('foo://host')).toBe('/')
    expect(pagePath('https://a.example/' + 'p'.repeat(199)).length).toBe(200)
    expect(pagePath('https://a.example/' + 'p'.repeat(500)).length).toBe(200)
  })
  it('/edit and anything under it is the editor, /editorial is a page', () => {
    expect(isEditShell('/edit')).toBe(true)
    expect(isEditShell('/edit/tour')).toBe(true)
    expect(isEditShell('/editorial')).toBe(false)
    expect(isEditShell('/')).toBe(false)
  })
})

describe('hosts, referrer and origin', () => {
  it('hostOf lower-cases, strips www and a trailing dot; empty, junk or bare www → null', () => {
    expect(hostOf('https://WWW.Instagram.com/p/x')).toBe('instagram.com')
    expect(hostOf('https://instagram.com./p/x')).toBe('instagram.com')
    expect(hostOf('')).toBeNull()
    expect(hostOf('nope')).toBeNull()
    expect(hostOf('https://www./x')).toBeNull()
    expect(hostOf('https://www.instagram.com./x')).toBe('instagram.com')
  })
  it('same-site navigation is not a referrer, in either subdomain direction', () => {
    const page = 'https://www.skeenmusic.com/about'
    expect(referrerHost('https://skeenmusic.com/', page)).toBeNull()
    expect(referrerHost('https://shop.skeenmusic.com/', page)).toBeNull()
    expect(referrerHost('https://skeenmusic.com/', 'https://shop.skeenmusic.com/x')).toBeNull()
    expect(referrerHost('https://l.instagram.com/', page)).toBe('l.instagram.com')
    expect(referrerHost('https://notskeenmusic.com/', page)).toBe('notskeenmusic.com')
    expect(referrerHost('', page)).toBeNull()
  })
  it('the page must live on the Origin when there is one; no Origin → nothing to compare', () => {
    expect(pageMatchesOrigin('https://www.skeenmusic.com/tour', 'https://skeenmusic.com')).toBe(true)
    expect(pageMatchesOrigin('https://skeenmusic.com/tour', null)).toBe(true)
    expect(pageMatchesOrigin('https://skeenmusic.com/tour', 'https://evil.example')).toBe(false)
    expect(pageMatchesOrigin('https://shop.skeenmusic.com/', 'https://skeenmusic.com')).toBe(false)
    expect(pageMatchesOrigin('junk', 'https://skeenmusic.com')).toBe(false)
    expect(pageMatchesOrigin('https://skeenmusic.com/', 'null')).toBe(false)
  })
})

describe('UTM', () => {
  it('reads the three tags verbatim, trimmed and capped; absent → null', () => {
    expect(utmOf('https://a.example/?utm_source=Instagram&utm_medium=%20story%20&utm_campaign=tour-sep')).toEqual({ source: 'Instagram', medium: 'story', campaign: 'tour-sep' })
    expect(utmOf('https://a.example/?utm_source=&utm_medium=x')).toEqual({ source: null, medium: 'x', campaign: null })
    expect(utmOf('https://a.example/?utm_campaign=' + 'c'.repeat(300)).campaign?.length).toBe(100)
    expect(utmOf('garbage')).toEqual({ source: null, medium: null, campaign: null })
  })
})

describe('source bucket', () => {
  // Independent expected tables. Key-set equality forces a conscious update when the
  // implementation grows; per-entry checks catch a wrong bucket or a mangled host.
  const EXPECTED_HOSTS: Record<string, string> = {
    'instagram.com': 'instagram', 'l.instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'youtube.com': 'youtube', 'youtu.be': 'youtube', 'm.youtube.com': 'youtube',
    'facebook.com': 'facebook', 'l.facebook.com': 'facebook', 'lm.facebook.com': 'facebook', 'fb.com': 'facebook', 'm.facebook.com': 'facebook',
    'x.com': 'x', 't.co': 'x', 'twitter.com': 'x',
    'open.spotify.com': 'spotify', 'spotify.com': 'spotify',
    'music.apple.com': 'apple_music',
    'soundcloud.com': 'soundcloud',
    'bandcamp.com': 'bandcamp',
    'google.com': 'google', 'google.co.uk': 'google', 'google.ca': 'google', 'google.com.au': 'google', 'google.de': 'google', 'google.fr': 'google',
    'bing.com': 'bing',
    'chatgpt.com': 'ai', 'chat.openai.com': 'ai', 'openai.com': 'ai', 'perplexity.ai': 'ai', 'gemini.google.com': 'ai',
    'copilot.microsoft.com': 'ai', 'claude.ai': 'ai', 'you.com': 'ai',
    'linktr.ee': 'linktree', 'linktree.com': 'linktree',
    'bandsintown.com': 'bandsintown',
    'songkick.com': 'songkick',
    'mail.google.com': 'email', 'outlook.live.com': 'email', 'outlook.office.com': 'email', 'mail.yahoo.com': 'email',
  }
  const EXPECTED_UTM: Record<string, string> = {
    instagram: 'instagram', ig: 'instagram', tiktok: 'tiktok', youtube: 'youtube', yt: 'youtube', facebook: 'facebook', fb: 'facebook',
    x: 'x', twitter: 'x', spotify: 'spotify', applemusic: 'apple_music', apple: 'apple_music', soundcloud: 'soundcloud',
    bandcamp: 'bandcamp', google: 'google', bing: 'bing', chatgpt: 'ai', perplexity: 'ai', gemini: 'ai', copilot: 'ai', ai: 'ai',
    linktree: 'linktree', bandsintown: 'bandsintown', songkick: 'songkick', email: 'email', newsletter: 'email', mailchimp: 'email',
  }
  it('HOST_BUCKETS has exactly these keys and each (and any subdomain of it) resolves to its bucket', () => {
    expect(Object.keys(HOST_BUCKETS).sort()).toEqual(Object.keys(EXPECTED_HOSTS).sort())
    for (const [host, bucket] of Object.entries(EXPECTED_HOSTS)) {
      expect(bucketForHost(host), host).toBe(bucket)
      expect(bucketForHost(`sub.${host}`), `sub.${host}`).toBe(bucket)
    }
  })
  it('UTM_BUCKETS has exactly these keys and each wins over any referrer', () => {
    expect(Object.keys(UTM_BUCKETS).sort()).toEqual(Object.keys(EXPECTED_UTM).sort())
    for (const [key, bucket] of Object.entries(EXPECTED_UTM)) expect(sourceFor(key, 'google.com'), key).toBe(bucket)
  })
  it('every bucket either table can produce is a registered source', () => {
    for (const b of [...Object.values(HOST_BUCKETS), ...Object.values(UTM_BUCKETS)]) expect(SOURCES).toContain(b)
    expect(SOURCES).toContain('direct')
    expect(SOURCES).toContain('other')
  })
  it('walks whole labels only: parents match, look-alikes and bare labels do not', () => {
    expect(bucketForHost('a.b.c.instagram.com')).toBe('instagram')
    expect(bucketForHost('gemini.google.com')).toBe('ai') // the more specific key wins over google.com
    expect(bucketForHost('notinstagram.com')).toBeNull()
    expect(bucketForHost('xt.co')).toBeNull()
    expect(bucketForHost('instagram.com.evil')).toBeNull()
    expect(bucketForHost('localhost')).toBeNull()
    expect(bucketForHost(null)).toBeNull()
  })
  it('utm_source is normalised and wins; unknown utm → other; no referrer → direct; unknown referrer → other', () => {
    expect(sourceFor('Instagram', 'google.com')).toBe('instagram')
    expect(sourceFor('IG', null)).toBe('instagram')
    expect(sourceFor('Apple Music', null)).toBe('apple_music')
    expect(sourceFor('flyer-qr', 'google.com')).toBe('other')
    expect(sourceFor(null, null)).toBe('direct')
    expect(sourceFor(null, 'news.ycombinator.com')).toBe('other')
    expect(sourceFor(null, 'google.co.uk')).toBe('google')
  })
})

describe('user agent', () => {
  const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0'
  const IG_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.0.0'
  const TIKTOK_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview'
  const FB_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/400]'
  const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
  const CHROME_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
  const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'
  const EDGE_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 EdgA/120.0'
  const EDGE_IOS = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17 EdgiOS/120.0 Mobile/15E148 Safari/605.1'
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
  it('device: phone, tablet, desktop', () => {
    expect(parseUa(IG_IOS).device).toBe('mobile')
    expect(parseUa(CHROME_ANDROID).device).toBe('mobile')
    expect(parseUa('Mozilla/5.0 (Linux; Android 14) Chrome/1 Mobi').device).toBe('mobile')
    expect(parseUa('Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) IEMobile/11').device).toBe('mobile')
    expect(parseUa(CHROME_TABLET).device).toBe('tablet')
    expect(parseUa('Mozilla/5.0 (Linux; Android 13; Tablet) Chrome/1').device).toBe('tablet')
    expect(parseUa(IPAD).device).toBe('tablet')
    expect(parseUa(SAFARI_MAC).device).toBe('desktop')
  })
  it('browser: in-app browsers win even when the UA also carries Chrome/ or Safari/', () => {
    expect(parseUa(IG_IOS).browser).toBe('instagram')
    expect(parseUa(IG_ANDROID).browser).toBe('instagram')
    expect(parseUa(TIKTOK_ANDROID).browser).toBe('tiktok')
    expect(parseUa(FB_IOS).browser).toBe('facebook')
    expect(parseUa('Mozilla/5.0 (iPhone) Safari/604.1 Snapchat/12').browser).toBe('snapchat')
  })
  it('browser families in the order that disambiguates them', () => {
    expect(parseUa(EDGE).browser).toBe('edge')
    expect(parseUa(EDGE_ANDROID).browser).toBe('edge')
    expect(parseUa(EDGE_IOS).browser).toBe('edge')
    expect(parseUa('Mozilla/5.0 (Windows) Chrome/120 Safari/537 OPR/100').browser).toBe('opera')
    expect(parseUa('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/23 Chrome/115').browser).toBe('samsung')
    expect(parseUa(FIREFOX).browser).toBe('firefox')
    expect(parseUa('Mozilla/5.0 (iPhone) FxiOS/120 Mobile/15E148 Safari/605').browser).toBe('firefox')
    expect(parseUa(CHROME_ANDROID).browser).toBe('chrome')
    expect(parseUa('Mozilla/5.0 (iPhone) CriOS/120 Mobile/15E148 Safari/605').browser).toBe('chrome')
    expect(parseUa(SAFARI_MAC).browser).toBe('safari')
    expect(parseUa('').browser).toBe('unknown')
    expect(parseUa('SomethingElse/1.0').browser).toBe('other')
  })
})

describe('bots', () => {
  it('every name in BOT_UA_NAMES is flagged, case-insensitively, inside a real-looking UA', () => {
    for (const n of BOT_UA_NAMES) expect(isBot(`Mozilla/5.0 (compatible; ${n.toUpperCase()}/1.0; +https://example.test)`), n).toBe(true)
  })
  it('real crawler, preview, headless and scripted UAs', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'AdsBot-Google (+http://www.google.com/adsbot.html)',
      'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      'curl/8.4.0',
      'python-requests/2.31',
      'GPTBot/1.0',
      'Slackbot-LinkExpanding 1.0',
      '',
      '   ',
      null,
    ]) expect(isBot(ua), String(ua)).toBe(true)
  })
  it('does not flag real browsers, a CUBOT_ phone, or a UA mentioning robots.txt', () => {
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0')).toBe(false)
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe(false)
    expect(isBot('Mozilla/5.0 (Linux; Android 11; CUBOT_X19) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe(false)
    expect(isBot('Mozilla/5.0 (Macintosh) Safari/605 see robots.txt')).toBe(false)
  })
})

describe('network (_shared/request.ts)', () => {
  it("clientIp trusts only the gateway's cf-connecting-ip; client-writable fallbacks are ignored", () => {
    expect(clientIp(headers({ 'cf-connecting-ip': ' 1.2.3.4 ', 'x-forwarded-for': '9.9.9.9, 3.2.58.46' }))).toBe('1.2.3.4')
    expect(clientIp(headers({ 'x-forwarded-for': '9.9.9.9, 3.2.58.46' }))).toBe('unknown')
    expect(clientIp(headers({ 'x-real-ip': '8.8.8.8' }))).toBe('unknown')
    expect(clientIp(headers({ 'cf-connecting-ip': '   ' }))).toBe('unknown')
    expect(clientIp(headers({}))).toBe('unknown')
  })
  it('normalizeIp: IPv4 as given; IPv6 reduced to its /64; mapped IPv4 unwrapped; junk → unknown', () => {
    expect(normalizeIp('65.29.160.74')).toBe('65.29.160.74')
    expect(normalizeIp(' 65.29.160.74 ')).toBe('65.29.160.74')
    expect(normalizeIp('2a02:1234:5678:9abc:def0:1111:2222:3333')).toBe('2a02:1234:5678:9abc::/64')
    expect(normalizeIp('2a02:1234:5678:9abc::1')).toBe('2a02:1234:5678:9abc::/64')
    expect(normalizeIp('2A02:1234::1')).toBe('2a02:1234:0:0::/64')
    expect(normalizeIp('::1')).toBe('0:0:0:0::/64')
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4')
    expect(normalizeIp('256.1.1.1')).toBe('unknown')
    expect(normalizeIp('1.2.3')).toBe('unknown')
    expect(normalizeIp('2a02:::1')).toBe('unknown')
    expect(normalizeIp('2a02:12345::1')).toBe('unknown')
    expect(normalizeIp('1:2:3:4:5:6:7:8:9')).toBe('unknown')
    expect(normalizeIp('1:2:3:4:5:6:7')).toBe('unknown')
    expect(normalizeIp('unknown')).toBe('unknown')
    expect(normalizeIp('')).toBe('unknown')
  })
  it('two addresses in one /64 share a key; two /64s do not', () => {
    expect(normalizeIp('2a02:1:2:3:aaaa::1')).toBe(normalizeIp('2a02:1:2:3:bbbb::9'))
    expect(normalizeIp('2a02:1:2:3::1')).not.toBe(normalizeIp('2a02:1:2:4::1'))
  })
})

describe('origins', () => {
  it('parseAllowedOrigins trims, drops trailing slashes and blanks', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([])
    expect(parseAllowedOrigins(' https://a.example/, https://b.example ,, ')).toEqual(['https://a.example', 'https://b.example'])
  })
  it('_shared pickAllowedOrigin (the /contact rule): listed → itself, unlisted → the first, none → null', () => {
    expect(pickAllowedOrigin('https://b.example', ['https://a.example', 'https://b.example'])).toBe('https://b.example')
    expect(pickAllowedOrigin('https://evil.example', ['https://a.example'])).toBe('https://a.example')
    expect(pickAllowedOrigin('https://a.example', [])).toBe('null')
    expect(pickAllowedOrigin(null, [])).toBe('null')
  })
  it('the door reflects the caller ONLY when there is no allowlist; with one it is the /contact rule', () => {
    expect(reflectOrAllowlisted('https://any.example', [])).toBe('https://any.example')
    expect(reflectOrAllowlisted(null, [])).toBe('*')
    expect(reflectOrAllowlisted('https://evil.example', ['https://a.example'])).toBe('https://a.example')
    expect(reflectOrAllowlisted('https://b.example', ['https://a.example', 'https://b.example'])).toBe('https://b.example')
  })
})

describe('hashes (_shared/hash.ts + derive.ts)', () => {
  it('sha256Hex is real SHA-256 with zero-padded bytes (known answers with leading-zero nibbles)', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await hashIp('salt', '8.8.8.8')).toBe('0c28d2b93a7da3491ed065d94a8edb83')
    expect(await ipHash('salt', '8.8.8.8')).toBe('0c28d2b93a7da3491ed065d94a8edb83') // the door's ipHash IS the shared hashIp
    expect(await visitorHash('pepper', '2026-09-11', '1.2.3.4', 'UA')).toBe('461f4d374004d4070609e50e4aff540a')
  })
  it('ipHash: 32 hex, salted, no date', async () => {
    const a = await ipHash('salt', '1.2.3.4')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(await ipHash('salt', '1.2.3.4')).toBe(a)
    expect(await ipHash('other', '1.2.3.4')).not.toBe(a)
    expect(await ipHash('salt', '1.2.3.5')).not.toBe(a)
  })
  it('visitorHash: same person same day → same; new day, new UA or new salt → different; never equal to ipHash', async () => {
    const a = await visitorHash('salt', '2026-09-11', '1.2.3.4', 'UA')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(await visitorHash('salt', '2026-09-11', '1.2.3.4', 'UA')).toBe(a)
    expect(await visitorHash('salt', '2026-09-12', '1.2.3.4', 'UA')).not.toBe(a)
    expect(await visitorHash('salt', '2026-09-11', '1.2.3.4', 'UB')).not.toBe(a)
    expect(await visitorHash('pepper', '2026-09-11', '1.2.3.4', 'UA')).not.toBe(a)
    expect(a).not.toBe(await ipHash('salt', '1.2.3.4'))
  })
  it('utcDate / utcHour are the UTC calendar day and hour, defaulting to now', () => {
    expect(utcDate(new Date('2026-09-11T23:59:59Z'))).toBe('2026-09-11')
    expect(utcDate(new Date('2026-09-12T00:00:00Z'))).toBe('2026-09-12')
    expect(utcHour(new Date('2026-09-11T23:59:59Z'))).toBe('2026-09-11T23')
    expect(utcDate()).toBe(new Date().toISOString().slice(0, 10))
    expect(utcHour()).toBe(new Date().toISOString().slice(0, 13))
  })
})

describe('location', () => {
  it('geoFromIpinfo: 2-letter country upper-cased, strings trimmed and capped, junk → nulls', () => {
    expect(geoFromIpinfo({ country: 'us', region: ' Texas ', city: 'Austin' })).toEqual({ country: 'US', region: 'Texas', city: 'Austin' })
    expect(geoFromIpinfo({ country: 'gb' }).country).toBe('GB')
    expect(geoFromIpinfo({ country: 'USA', region: 7, city: '' })).toEqual(NO_GEO)
    expect(geoFromIpinfo({ country: 12, region: '   ', city: '\t' })).toEqual(NO_GEO)
    expect(geoFromIpinfo(null)).toEqual(NO_GEO)
    expect(geoFromIpinfo({ city: 'c'.repeat(300) }).city?.length).toBe(100)
  })
  it('private, loopback, link-local, carrier-NAT, mapped, zero and unknown addresses are not looked up', () => {
    for (const ip of ['unknown', '', '10.0.0.1', '127.0.0.1', '192.168.1.1', '172.16.0.1', '172.31.9.9', '169.254.1.1', '100.64.0.1', '100.127.255.1', '0.0.0.0', '::1', '::', '::ffff:1.2.3.4', 'fe80::1', 'fd00::1', 'fc00::1', '0:0:0:0::/64']) {
      expect(isLookupable(ip), ip).toBe(false)
    }
    for (const ip of ['65.29.160.74', '100.128.0.1', '172.32.0.1', '2a02:1234:5678:9abc::/64', '8.8.8.8']) expect(isLookupable(ip), ip).toBe(true)
  })

  const geo = { country: 'US', region: 'TX', city: 'Austin' }
  // Every dependency is counted, overridden or not, so an assertion on `calls` means
  // what it says regardless of which stub a test swapped in.
  const deps = (over: Partial<GeoDeps> = {}) => {
    const calls = { cacheGet: 0, cachePut: [] as unknown[], budget: 0, fetchGeo: 0 }
    const base: GeoDeps = {
      cacheGet: async () => null,
      cachePut: async () => {},
      budget: async () => true,
      fetchGeo: async () => geo,
      ...over,
    }
    const d: GeoDeps = {
      cacheGet: async (k) => { calls.cacheGet++; return base.cacheGet(k) },
      cachePut: async (k, g) => { calls.cachePut.push(g); return base.cachePut(k, g) },
      budget: async () => { calls.budget++; return base.budget() },
      fetchGeo: async (ip) => { calls.fetchGeo++; return base.fetchGeo(ip) },
    }
    return { d, calls }
  }
  it('disabled (no token) or an unlookupable address → nothing, and no dependency is touched', async () => {
    const { d, calls } = deps()
    expect(await locateWith(d, '65.29.160.74', 'k', false)).toEqual(NO_GEO)
    expect(await locateWith(d, '10.0.0.1', 'k', true)).toEqual(NO_GEO)
    expect(calls).toEqual({ cacheGet: 0, cachePut: [], budget: 0, fetchGeo: 0 })
  })
  it('cache hit → returned, no budget spent, no fetch', async () => {
    const { d, calls } = deps({ cacheGet: async () => geo })
    expect(await locateWith(d, '65.29.160.74', 'k', true)).toEqual(geo)
    expect(calls.budget + calls.fetchGeo).toBe(0)
  })
  it('cache miss → one fetch, the shaped answer cached and returned', async () => {
    const { d, calls } = deps({ fetchGeo: async () => ({ country: 'gb', city: ' London ' }) })
    expect(await locateWith(d, '65.29.160.74', 'k', true)).toEqual({ country: 'GB', region: null, city: 'London' })
    expect(calls.fetchGeo).toBe(1)
    expect(calls.cachePut).toEqual([{ country: 'GB', region: null, city: 'London' }])
  })
  it('budget exhausted → nothing, no fetch, nothing cached (the next hour may succeed)', async () => {
    const { d, calls } = deps({ budget: async () => false })
    expect(await locateWith(d, '65.29.160.74', 'k', true)).toEqual(NO_GEO)
    expect(calls.fetchGeo).toBe(0)
    expect(calls.cachePut).toEqual([])
  })
  it('a failed lookup is cached as "no location" so it is not retried per event', async () => {
    const { d, calls } = deps({ fetchGeo: async () => null })
    expect(await locateWith(d, '65.29.160.74', 'k', true)).toEqual(NO_GEO)
    expect(calls.cachePut).toEqual([NO_GEO])
  })
  it('a throwing dependency never escapes: nothing, and the event still proceeds', async () => {
    const { d } = deps({ cacheGet: async () => { throw new Error('db down') } })
    expect(await locateWith(d, '65.29.160.74', 'k', true)).toEqual(NO_GEO)
    const { d: d2 } = deps({ fetchGeo: async () => { throw new Error('net') } })
    expect(await locateWith(d2, '65.29.160.74', 'k', true)).toEqual(NO_GEO)
  })
})

describe('_shared/cors.ts — the headers every door answers with', () => {
  it('corsHeaders carries the origin, Vary, the two headers everyone forgets, methods and max-age', () => {
    const h = corsHeaders('https://a.example')
    expect(h['Access-Control-Allow-Origin']).toBe('https://a.example')
    expect(h.Vary).toBe('Origin')
    expect(h['Access-Control-Allow-Headers'].split(/,\s*/)).toEqual(expect.arrayContaining(['authorization', 'apikey', 'content-type', 'x-client-info']))
    expect(h['Access-Control-Allow-Methods'].split(/,\s*/)).toEqual(expect.arrayContaining(['POST', 'OPTIONS']))
    expect(h['Access-Control-Max-Age']).toBe('86400')
  })
  it('json() ALWAYS carries the CORS headers and content-type, plus any extra (Retry-After on a 429)', async () => {
    const res = json(429, { ok: false, error: 'rate_limited' }, 'https://a.example', { 'Retry-After': '60' })
    expect(res.status).toBe(429)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://a.example')
    expect(res.headers.get('vary')).toBe('Origin')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('retry-after')).toBe('60')
    expect(await res.json()).toEqual({ ok: false, error: 'rate_limited' })
  })
})

describe('_shared/request.ts — address boundaries', () => {
  it('IPv4: every octet 0–255, no leading zeros, exactly four', () => {
    for (const ok of ['0.0.0.0', '255.255.255.255', '1.2.3.4', '100.64.0.1', '9.99.199.249', '10.0.0.10']) expect(normalizeIp(ok), ok).toBe(ok)
    for (const bad of ['256.1.1.1', '1.256.1.1', '1.1.1.256', '01.2.3.4', '1.2.3.04', '1.2.3', '1.2.3.4.5', '1.2.3.-4', 'a.b.c.d', '1.2.3.4x']) expect(normalizeIp(bad), bad).toBe('unknown')
  })
  it('IPv6: mapped IPv4 must itself be valid; more than one ::, more than 8 groups, empty or 5-char groups, and 7 groups without :: are all unknown', () => {
    expect(normalizeIp('::ffff:999.1.1.1')).toBe('unknown')
    expect(normalizeIp('1::2::3')).toBe('unknown')
    expect(normalizeIp('1:2:3:4:5:6:7:8::9')).toBe('unknown')
    expect(normalizeIp('1:2:3:4::5:6:7:8')).toBe('unknown')
    expect(normalizeIp('1:2:3:4:5:6:7:8')).toBe('1:2:3:4::/64')
    expect(normalizeIp('2001:db8::')).toBe('2001:db8:0:0::/64')
    expect(normalizeIp('::')).toBe('0:0:0:0::/64')
    expect(normalizeIp('2001:0db8:0000:0000:0000:ff00:0042:8329')).toBe('2001:db8:0:0::/64')
    expect(normalizeIp('2001:db8::g1')).toBe('unknown')
    expect(normalizeIp('2001:db8:::1')).toBe('unknown')
    expect(normalizeIp('12345::1')).toBe('unknown')
  })
})
