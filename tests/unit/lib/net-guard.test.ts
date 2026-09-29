/**
 * net-guard: where a NAME points, judged at the moment the socket connects (STRICT: security,
 * AGENTS.md "Test depth"). `isPublicSiteUrl` reads the address TEXT only, so a name like
 * `169.254.169.254.nip.io`, or a manager's own DNS record pointing at 10.x, passed it and the
 * server fetched it. These tests pin the resolved-address rule, the connect-time lookup that
 * closes the check-then-connect gap (DNS rebinding), and the transport built on it.
 *
 * No internet: every name goes through an injected resolver. The transport tests use ONE
 * loopback server as a witness: it counts connections, so "refused" means no socket reached
 * it, not merely that a promise rejected.
 */
import http from 'node:http'
import net from 'node:net'
import zlib from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BlockedAddressError,
  createSafeFetch,
  guardedLookup,
  isBlockedAddressError,
  isPrivateAddress,
  resolvePublic,
  type Resolver,
} from '@/lib/net-guard'
import { fakeDns } from '@tests/helpers/fake-dns'

/* ── the address rule ─────────────────────────────────────────────────────────────── */

describe('isPrivateAddress', () => {
  it('CRITICAL: refuses every non-public IPv4 range', () => {
    for (const ip of [
      '0.0.0.0', '0.1.2.3', // this network
      '10.0.0.1', '10.255.255.255', // RFC1918
      '100.64.0.1', '100.127.255.254', // carrier-grade NAT
      '127.0.0.1', '127.255.255.254', // loopback
      '169.254.169.254', '169.254.0.1', // link-local: the cloud metadata address
      '172.16.0.1', '172.31.255.255', // RFC1918
      '192.0.0.8', // IETF protocol assignments
      '192.0.2.1', '198.51.100.7', '203.0.113.9', // documentation
      '192.88.99.1', // 6to4 relay anycast
      '192.168.1.1', // RFC1918
      '198.18.0.1', '198.19.255.255', // benchmarking
      '224.0.0.1', '239.255.255.250', // multicast
      '240.0.0.1', '255.255.255.255', // reserved + broadcast
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('CRITICAL: refuses every non-public IPv6 range, and IPv4 hiding inside IPv6', () => {
    for (const ip of [
      '::', '::1', // unspecified, loopback
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:10.0.0.1', // IPv4-mapped
      '0:0:0:0:0:ffff:a9fe:a9fe', // the same, spelled long
      '::127.0.0.1', '::a9fe:a9fe', // IPv4-compatible (deprecated)
      '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', // NAT64 of a private IPv4
      '64:ff9b:1::1', // local-use NAT64
      '100::1', // discard-only
      '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
      '2001:db8::1', '3fff::1', // documentation
      '2002:a9fe:a9fe::1', '2002:7f00:1::', // 6to4 of the metadata address / loopback
      'fc00::1', 'fd12:3456::1', // unique-local
      'fe80::1', 'fe80::1%en0', 'febf::1', // link-local, with and without a zone
      'fec0::1', // site-local (deprecated)
      'ff02::1', // multicast
      '5f00::1', // SRv6, never on the open internet
      '[::1]', // bracketed as a URL spells it
      '::808:808', // IPv4-compatible, even of a PUBLIC IPv4: the whole ::/96 is refused
      '64:ff9b:1::808:808', // local-use NAT64, even of a public IPv4
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('refuses what is not an address at all', () => {
    for (const s of ['', 'localhost', 'example.com', '1.2.3', '1.2.3.4.5', '::g', '2130706433']) {
      expect(isPrivateAddress(s), s).toBe(true)
    }
  })

  it('lets real public addresses through, including the edges of the refused ranges', () => {
    for (const ip of [
      '1.1.1.1', '8.8.8.8', '93.184.216.34',
      '9.255.255.255', '11.0.0.0', // around 10/8
      '100.63.255.255', '100.128.0.0', // around CGNAT
      '172.15.255.255', '172.32.0.0', // around 172.16/12
      '192.0.3.1', '192.167.255.255', '192.169.0.0',
      '198.17.255.255', '198.20.0.0', // around 198.18/15
      '223.255.255.255', // the last unicast /8
      '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::1',
      '2001:200::1', // just past the IETF 2001::/23 block
      '::ffff:8.8.8.8', // IPv4-mapped PUBLIC
      '::ffff:93.184.216.34', '0:0:0:0:0:ffff:93.184.216.34', // …with multi-digit octets
      '64:ff9b::808:808', '64:ff9b::5db8:d822', // NAT64 of a public IPv4
      '2002:808:808::1', // 6to4 of a public IPv4
      // Global unicast that merely LOOKS like a special form is judged as itself:
      '2606:4700:0:0:0:ffff:a9fe:a9fe', // ffff in group 6, but not ::ffff:0:0/96
      '2606:ff9b::a9fe:a9fe', // ff9b in group 2, but not 64:ff9b::/96
      '2620:0:ccc::2', // a small second group outside 2001::/23
      '2400:db8::1', // db8 outside 2001:db8::/32
      '3fff:1000::1', // just past 3fff::/20
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})

/* ── resolving a name ─────────────────────────────────────────────────────────────── */

describe('resolvePublic', () => {
  it('hands back every address of a name that points only at the internet', async () => {
    const dns = fakeDns({ 'site.example': ['93.184.216.34', '2606:4700::6810:84e5'] })
    expect(await resolvePublic('site.example', dns)).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::6810:84e5', family: 6 },
    ])
  })

  it('CRITICAL: refuses a name that points at a private address (the nip.io trick)', async () => {
    const dns = fakeDns({ '169.254.169.254.nip.io': ['169.254.169.254'] })
    const err = await resolvePublic('169.254.169.254.nip.io', dns).catch((e) => e)
    expect(err).toBeInstanceOf(BlockedAddressError)
    expect(isBlockedAddressError(err)).toBe(true)
  })

  it('CRITICAL: refuses a name with SEVERAL addresses when ANY one is private, wherever it sits', async () => {
    for (const list of [
      ['93.184.216.34', '127.0.0.1'],
      ['10.0.0.7', '93.184.216.34'],
      ['2606:4700::1', '::1', '93.184.216.34'],
      ['93.184.216.34', '::ffff:169.254.169.254'],
    ]) {
      const err = await resolvePublic('multi.example', fakeDns({ 'multi.example': list })).catch((e) => e)
      expect(isBlockedAddressError(err), list.join(' ')).toBe(true)
    }
  })

  it('a lookup that fails is an error, never an empty yes', async () => {
    const err = await resolvePublic('nowhere.example', fakeDns({})).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { code?: string }).code).toBe('ENOTFOUND')
    expect(isBlockedAddressError(err)).toBe(false)
  })

  it('an EMPTY answer is an error too', async () => {
    const err = await resolvePublic('empty.example', fakeDns({ 'empty.example': [] })).catch((e) => e)
    expect((err as { code?: string }).code).toBe('ENOTFOUND')
  })

  it('refuses an answer that is not an address (a resolver is not trusted to be sane)', async () => {
    const odd: Resolver = async () => [{ address: 'localhost', family: 4 }]
    expect(isBlockedAddressError(await resolvePublic('odd.example', odd).catch((e) => e))).toBe(true)
  })

  it('refuses a malformed answer entry (null, a number) as blocked, never crashes', async () => {
    for (const bad of [[null], [{ address: 42 }], [{}]] as unknown as { address: string }[][]) {
      const r: Resolver = async () => bad
      expect(isBlockedAddressError(await resolvePublic('bad.example', r).catch((e) => e)), JSON.stringify(bad)).toBe(true)
    }
  })

  it('a resolver error keeps its own code; anything else it throws becomes ENOTFOUND', async () => {
    const again = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' })
    expect(await resolvePublic('x.example', async () => Promise.reject(again)).catch((e) => e)).toBe(again)
    for (const thrown of ['a string', new Error('no code'), null]) {
      const err = await resolvePublic('x.example', async () => Promise.reject(thrown)).catch((e) => e)
      expect((err as { code?: string }).code, String(thrown)).toBe('ENOTFOUND')
      expect(isBlockedAddressError(err)).toBe(false)
    }
  })

  it('judges the family from the address itself, not from what the resolver claims', async () => {
    const liar: Resolver = async () => [{ address: '8.8.8.8', family: 6 }]
    expect(await resolvePublic('liar.example', liar)).toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  it('an IP literal is judged as it stands, without asking DNS', async () => {
    const dns = fakeDns({})
    expect(await resolvePublic('8.8.8.8', dns)).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(isBlockedAddressError(await resolvePublic('[::1]', dns).catch((e) => e))).toBe(true)
    expect(isBlockedAddressError(await resolvePublic('127.0.0.1', dns).catch((e) => e))).toBe(true)
    expect(dns.calls).toEqual([])
  })

  it('a numeric-looking NAME (2130706433, 0x7f.1) is judged by what it resolves to', async () => {
    // getaddrinfo reads both as 127.0.0.1. Neither is an IP literal to net.isIP, so they
    // reach the resolver; what comes back is what is judged.
    const dns = fakeDns({ '2130706433': ['127.0.0.1'], '0x7f.1': ['127.0.0.1'] })
    for (const host of ['2130706433', '0x7f.1']) {
      expect(isBlockedAddressError(await resolvePublic(host, dns).catch((e) => e)), host).toBe(true)
    }
  })

  it('a trailing dot is the same name, and is judged the same way', async () => {
    const dns = fakeDns({ 'metadata.google.internal.': ['169.254.169.254'] })
    expect(isBlockedAddressError(await resolvePublic('metadata.google.internal.', dns).catch((e) => e))).toBe(true)
  })
})

describe('isBlockedAddressError', () => {
  it('finds the refusal however it is wrapped, and nothing else', () => {
    const blocked = new BlockedAddressError('x.example', '10.0.0.1')
    expect(isBlockedAddressError(blocked)).toBe(true)
    expect(isBlockedAddressError(new Error('fetch failed', { cause: new Error('connect', { cause: blocked }) }))).toBe(true)
    // Its code survives a copy that is no longer the class (structured clone, a log round-trip).
    expect(isBlockedAddressError({ code: 'ERR_ADDRESS_BLOCKED' })).toBe(true)
    for (const other of [new Error('ECONNREFUSED'), { code: 'ENOTFOUND' }, 'ERR_ADDRESS_BLOCKED', null, undefined, 7]) {
      expect(isBlockedAddressError(other), String(other)).toBe(false)
    }
  })

  it('a cause chain that loops ends, and is not a refusal', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b', { cause: a })
    a.cause = b
    expect(isBlockedAddressError(a)).toBe(false)
  })
})

/* ── the connect-time lookup ──────────────────────────────────────────────────────── */

function lookupOnce(fn: net.LookupFunction, host: string, options: object) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
    fn(host, options as never, (err, address, family) => resolve({ err, address, family }))
  })
}

describe('guardedLookup (what the socket is told)', () => {
  const dns = fakeDns({ 'both.example': ['93.184.216.34', '2606:4700::1'], 'bad.example': ['93.184.216.34', '10.1.1.1'] })

  it('answers the all:true shape (Happy Eyeballs) with every checked address', async () => {
    const r = await lookupOnce(guardedLookup(dns), 'both.example', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toEqual([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1', family: 6 }])
  })

  it('answers the single shape, honouring a requested family', async () => {
    expect(await lookupOnce(guardedLookup(dns), 'both.example', {})).toMatchObject({ err: null, address: '93.184.216.34', family: 4 })
    expect(await lookupOnce(guardedLookup(dns), 'both.example', { family: 6 })).toMatchObject({ err: null, address: '2606:4700::1', family: 6 })
  })

  it('CRITICAL: hands the socket an error, never an address, when any answer is private', async () => {
    for (const options of [{ all: true }, {}, { family: 4 }]) {
      const r = await lookupOnce(guardedLookup(dns), 'bad.example', options)
      expect(isBlockedAddressError(r.err), JSON.stringify(options)).toBe(true)
    }
  })

  it('understands the family spelled as a string too', async () => {
    expect(await lookupOnce(guardedLookup(dns), 'both.example', { family: 'IPv6' })).toMatchObject({ err: null, address: '2606:4700::1', family: 6 })
    expect(await lookupOnce(guardedLookup(dns), 'both.example', { family: 'IPv4', all: true })).toMatchObject({ err: null, address: [{ address: '93.184.216.34', family: 4 }] })
  })

  it('allowLoopback (tests only) passes exactly the loopback answers', async () => {
    const f = (list: string[]) => guardedLookup(fakeDns({ 'l.test': list }), { allowLoopback: true })
    for (const ip of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1']) {
      expect((await lookupOnce(f([ip]), 'l.test', { all: true })).err, ip).toBeNull()
    }
    for (const ip of ['10.0.0.1', '::2', 'fe80::1', '::ffff:10.0.0.1', '0.0.0.0', 'not-an-ip']) {
      expect(isBlockedAddressError((await lookupOnce(f([ip]), 'l.test', {})).err), ip).toBe(true)
    }
    expect((await lookupOnce(f([]), 'l.test', {})).err?.code).toBe('ENOTFOUND')
  })

  it('a requested family with no address of that family is ENOTFOUND, not an empty list', async () => {
    const r = await lookupOnce(guardedLookup(fakeDns({ 'v4.example': ['93.184.216.34'] })), 'v4.example', { family: 6, all: true })
    expect(r.err?.code).toBe('ENOTFOUND')
  })
})

/* ── the transport, against a real socket ─────────────────────────────────────────── */

describe('createSafeFetch', () => {
  let server: http.Server
  let port = 0
  let connections = 0
  let lastRequest: { method?: string; host?: string; body: string; headers: http.IncomingHttpHeaders } | null = null

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        lastRequest = { method: req.method, host: req.headers.host, body, headers: req.headers }
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://evil.example/' })
          res.end('moved')
        } else if (req.url === '/gzip') {
          res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
          res.end(zlib.gzipSync('hello, unzipped'))
        } else if (req.url === '/deflate') {
          res.writeHead(200, { 'content-encoding': 'deflate' })
          res.end(zlib.deflateSync('hello, inflated'))
        } else if (req.url === '/br') {
          res.writeHead(200, { 'content-encoding': 'br' })
          res.end(zlib.brotliCompressSync('hello, unbrotlied'))
        } else if (req.url === '/weird-encoding') {
          res.writeHead(200, { 'content-encoding': 'zstd-ish' })
          res.end('left as it came')
        } else if (req.url === '/empty') {
          res.writeHead(204)
          res.end()
        } else if (req.url === '/slow') {
          res.writeHead(200, { 'content-type': 'text/plain' })
          res.write('first ')
          // …and never finishes.
        } else {
          res.writeHead(200, { 'content-type': 'text/html', 'X-Thing': 'yes' })
          res.end('<p>hi</p>')
        }
      })
    })
    server.on('connection', () => connections++)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as net.AddressInfo).port
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('witness: the loopback server really is reachable (so "no connection" below means something)', async () => {
    const before = connections
    await new Promise<void>((resolve, reject) => http.get(`http://127.0.0.1:${port}/`, (res) => res.resume().on('end', resolve)).on('error', reject))
    expect(connections).toBe(before + 1)
  })

  it('CRITICAL: a name that resolves to a private address is refused before any socket opens', async () => {
    const before = connections
    const dns = fakeDns({ 'site.test': ['127.0.0.1'] })
    const err = await createSafeFetch({ resolver: dns })(`http://site.test:${port}/`).catch((e) => e)
    expect(isBlockedAddressError(err)).toBe(true)
    expect(dns.calls).toEqual(['site.test'])
    expect(connections).toBe(before)
  })

  it('CRITICAL: DNS rebinding — a name that answered PUBLIC to an earlier check and PRIVATE at connect is refused', async () => {
    const before = connections
    // The first answer is what a check-then-fetch caller (lib/og) sees; the second is the
    // one the socket would use. Only a check AT CONNECT sees the second.
    const dns = fakeDns({ 'rebind.test': (n) => (n === 1 ? ['93.184.216.34'] : ['127.0.0.1']) })
    expect(await resolvePublic('rebind.test', dns)).toEqual([{ address: '93.184.216.34', family: 4 }])
    const err = await createSafeFetch({ resolver: dns })(`http://rebind.test:${port}/`).catch((e) => e)
    expect(isBlockedAddressError(err)).toBe(true)
    expect(dns.calls).toEqual(['rebind.test', 'rebind.test'])
    expect(connections).toBe(before)
  })

  it('CRITICAL: a private IP LITERAL is refused before any socket opens (no lookup happens for one)', async () => {
    const before = connections
    const dns = fakeDns({})
    for (const url of [`http://127.0.0.1:${port}/`, `http://[::ffff:127.0.0.1]:${port}/`, `http://2130706433:${port}/`, `http://0x7f.1:${port}/`]) {
      const err = await createSafeFetch({ resolver: dns })(url).catch((e) => e)
      expect(isBlockedAddressError(err), url).toBe(true)
    }
    expect(dns.calls).toEqual([])
    expect(connections).toBe(before)
  })

  it('a lookup that fails sends nothing and rejects with the DNS error', async () => {
    const before = connections
    const err = await createSafeFetch({ resolver: fakeDns({}) })(`http://localhost:${port}/`).catch((e) => e)
    expect((err as { code?: string }).code).toBe('ENOTFOUND')
    expect(connections).toBe(before)
  })

  it('IDN: the name is looked up in its punycode form, and judged like any other', async () => {
    const dns = fakeDns({ 'xn--bcher-kva.test': ['127.0.0.1'] })
    const err = await createSafeFetch({ resolver: dns })(`http://bücher.test:${port}/`).catch((e) => e)
    expect(isBlockedAddressError(err)).toBe(true)
    expect(dns.calls).toEqual(['xn--bcher-kva.test'])
  })

  it('refuses anything but http(s), and credentials in the address', async () => {
    const f = createSafeFetch({ resolver: fakeDns({}) })
    for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'http://user:pw@example.com/', 'http://user@example.com/', 'http://:pw@example.com/']) {
      expect(await f(url).catch((e) => e), url).toBeInstanceOf(TypeError)
    }
  })

  /* The bridge from node:http to a web Response. `allowLoopback` lets these reach the
     witness; the refusals above run WITHOUT it. */
  describe('what it brings back (allowLoopback, test-only)', () => {
    const local = () => createSafeFetch({ resolver: fakeDns({ 'site.test': ['127.0.0.1'] }), allowLoopback: true })

    it('allowLoopback opens loopback and nothing else', async () => {
      for (const ip of ['10.0.0.1', '169.254.169.254', '::ffff:10.0.0.1']) {
        const f = createSafeFetch({ resolver: fakeDns({ 'x.test': [ip] }), allowLoopback: true })
        expect(isBlockedAddressError(await f(`http://x.test:${port}/`).catch((e) => e)), ip).toBe(true)
      }
    })

    it('connects BY NAME: the Host header is the name, the socket is the checked address', async () => {
      const r = await local()(`http://site.test:${port}/page?q=1`, { headers: { 'user-agent': 'TapirSiteCheck/1.0' } })
      expect(r.status).toBe(200)
      expect(r.headers.get('x-thing')).toBe('yes')
      expect(await r.text()).toBe('<p>hi</p>')
      expect(r.url).toBe(`http://site.test:${port}/page?q=1`)
      expect(lastRequest).toMatchObject({ method: 'GET', host: `site.test:${port}` })
      expect(lastRequest?.headers['user-agent']).toBe('TapirSiteCheck/1.0')
    })

    it('never follows a redirect itself: the 3xx comes back with its Location', async () => {
      const r = await local()(`http://site.test:${port}/redirect`, { redirect: 'follow' })
      expect(r.status).toBe(302)
      expect(r.headers.get('location')).toBe('http://evil.example/')
      await r.body?.cancel()
    })

    it('unzips a gzip body, as fetch does', async () => {
      const r = await local()(`http://site.test:${port}/gzip`)
      expect(await r.text()).toBe('hello, unzipped')
      expect(r.headers.get('content-encoding')).toBe('gzip')
    })

    it('inflates deflate and brotli; leaves an encoding it does not know alone', async () => {
      expect(await (await local()(`http://site.test:${port}/deflate`)).text()).toBe('hello, inflated')
      expect(await (await local()(`http://site.test:${port}/br`)).text()).toBe('hello, unbrotlied')
      expect(await (await local()(`http://site.test:${port}/weird-encoding`)).text()).toBe('left as it came')
    })

    it('asks for compressed answers and anything, unless the caller says otherwise', async () => {
      await (await local()(`http://site.test:${port}/`)).text()
      expect(lastRequest?.headers).toMatchObject({ accept: '*/*', 'accept-encoding': 'gzip, deflate, br' })
      await (await local()(`http://site.test:${port}/`, { headers: { accept: 'text/html', 'accept-encoding': 'identity' } })).text()
      expect(lastRequest?.headers).toMatchObject({ accept: 'text/html', 'accept-encoding': 'identity' })
    })

    it('a HEAD answer has no body', async () => {
      const r = await local()(`http://site.test:${port}/`, { method: 'head' })
      expect(r.status).toBe(200)
      expect(r.body).toBeNull()
      expect(lastRequest?.method).toBe('HEAD')
    })

    it('takes a Request as input: its url, method and headers', async () => {
      const r = await local()(new Request(`http://site.test:${port}/from-request`, { method: 'DELETE', headers: { 'x-from': 'request' } }))
      await r.text()
      expect(lastRequest).toMatchObject({ method: 'DELETE' })
      expect(lastRequest?.headers['x-from']).toBe('request')
    })

    it('sends form, byte and ArrayBuffer bodies; refuses a stream body before connecting', async () => {
      await (await local()(`http://site.test:${port}/`, { method: 'POST', body: new URLSearchParams({ a: '1', b: 'x y' }) })).text()
      expect(lastRequest).toMatchObject({ body: 'a=1&b=x+y' })
      expect(lastRequest?.headers['content-type']).toBe('application/x-www-form-urlencoded;charset=UTF-8')
      await (await local()(`http://site.test:${port}/`, { method: 'POST', body: new TextEncoder().encode('bytes!').subarray(1) })).text()
      expect(lastRequest).toMatchObject({ body: 'ytes!' })
      expect(lastRequest?.headers['content-length']).toBe('5')
      expect(lastRequest?.headers['content-type']).toBeUndefined() // the form type is for form bodies only
      await (await local()(`http://site.test:${port}/`, { method: 'POST', body: new TextEncoder().encode('buf').buffer as ArrayBuffer })).text()
      expect(lastRequest).toMatchObject({ body: 'buf' })
      const before = connections
      const err = await local()(`http://site.test:${port}/`, { method: 'POST', body: new ReadableStream() }).catch((e) => e)
      expect(err).toBeInstanceOf(TypeError)
      expect(connections).toBe(before)
    })

    it('a connection that goes quiet is dropped as a TimeoutError', async () => {
      const f = createSafeFetch({ resolver: fakeDns({ 'site.test': ['127.0.0.1'] }), allowLoopback: true, idleTimeoutMs: 100 })
      const r = await f(`http://site.test:${port}/slow`)
      const err = await r.text().catch((e) => e)
      expect(err).toBeInstanceOf(Error)
    })

    it('an abort with a reason of its own is still an AbortError', async () => {
      const c = new AbortController()
      c.abort('because')
      const err = await local()(`http://site.test:${port}/`, { signal: c.signal }).catch((e) => e)
      expect((err as Error).name).toBe('AbortError')
      expect((err as Error & { cause?: unknown }).cause).toBe('because')
    })

    it('a nonsense address is a TypeError', async () => {
      expect(await local()('not a url').catch((e) => e)).toBeInstanceOf(TypeError)
    })

    it('a 204 has no body', async () => {
      const r = await local()(`http://site.test:${port}/empty`)
      expect(r.status).toBe(204)
      expect(r.body).toBeNull()
    })

    it('sends a POST body with its length', async () => {
      const r = await local()(`http://site.test:${port}/`, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })
      await r.text()
      expect(lastRequest).toMatchObject({ method: 'POST', body: '{"a":1}' })
      expect(lastRequest?.headers['content-length']).toBe('7')
    })

    it('an abort signal stops a body that never ends', async () => {
      const r = await local()(`http://site.test:${port}/slow`, { signal: AbortSignal.timeout(150) })
      const t = Date.now()
      const err = await r.text().catch((e) => e)
      expect(err).toBeInstanceOf(Error)
      expect(Date.now() - t).toBeLessThan(2000)
    })

    it('an already-aborted signal sends nothing', async () => {
      const before = connections
      const c = new AbortController()
      c.abort()
      const err = await local()(`http://site.test:${port}/`, { signal: c.signal }).catch((e) => e)
      expect((err as Error).name).toBe('AbortError')
      expect(connections).toBe(before)
    })
  })
})
