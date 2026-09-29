/**
 * The server knows which addresses belong to its own network (loopback, private ranges, the cloud
 * metadata address) and refuses them, whether it is handed a web address, an IP, or a name.
 *
 * Code:     src/lib/custom-site.ts (isPublicSiteUrl, isCustom), src/lib/net-guard.ts
 *           (isPrivateAddress, resolvePublic, isBlockedAddressError, guardedLookup)
 * Feature:  safe fetching: the address rule behind every server fetch (SEO/GEO checks, the old
 *           live check, IndexNow, link previews) and behind the public redirect to a custom site
 * Tier:     STRICT (AGENTS.md "Test depth"): security. A manager types the site address and the
 *           server fetches it, so a private address here is a request into our own network (SSRF).
 * Covers:   • a typed web address: private hosts, sneaky spellings (decimal, hex, userinfo,
 *             trailing dot), odd ports and non-web schemes are refused; real sites pass
 *           • the loopback hatch for local development opens loopback only, and only when asked
 *           • an IP address: every non-public IPv4 and IPv6 range, IPv4 hidden inside IPv6, and
 *             the public addresses right next to each range
 *           • a name: refused when ANY address it resolves to is private; a lookup that fails or
 *             answers nonsense is an error, never a yes
 *           • the socket's own lookup refuses the same way, in every shape Node asks for
 * Not here: that fetches really use these rules before connecting (blocked-before-connecting.test.ts),
 *           and on every redirect hop (redirects.test.ts).
 * Fixtures: no network. Names resolve through a fake DNS (tests/helpers/fake-dns.ts) or a
 *           hand-written resolver.
 */
import type net from 'node:net'
import { describe, expect, it } from 'vitest'
import { isCustom, isPublicSiteUrl } from '@/lib/custom-site'
import {
  BlockedAddressError,
  guardedLookup,
  isBlockedAddressError,
  isPrivateAddress,
  resolvePublic,
  type Resolver,
} from '@/lib/net-guard'
import { fakeDns } from '@tests/helpers/fake-dns'

/* ── a web address, as text ───────────────────────────────────────────────────────── */

describe('a web address a manager typed (isPublicSiteUrl)', () => {
  // Private targets are refused however they are spelled: this list is every trick that has
  // reached a server fetch somewhere, and the server echoes what it fetches back to the manager.
  it('CRITICAL: refuses loopback, private, link-local and unique-local targets', () => {
    for (const url of [
      'http://169.254.169.254/', // AWS / GCP instance metadata
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://2852039166/', // 169.254.169.254 in decimal: WHATWG normalises it
      'http://0x7f000001/', // 127.0.0.1 in hex
      'http://127.1/', // short form
      'http://127.0.0.1:3000/',
      'http://0.0.0.0/',
      'http://10.1.2.3/',
      'http://172.16.0.1/',
      'http://172.31.255.254/',
      'http://192.168.0.1/',
      'http://100.64.0.1/', // carrier-grade NAT
      'http://198.18.0.1/', // benchmarking
      'http://255.255.255.255/',
      'http://239.1.1.1/', // multicast
      'http://[::1]/',
      'http://[::]/',
      'http://[fd00::1]/', // unique-local
      'http://[fc00::1]/',
      'http://[fe80::1]/', // link-local
      'http://[::ffff:127.0.0.1]/', // IPv4-mapped loopback
      'http://[0:0:0:0:0:ffff:a9fe:a9fe]/', // IPv4-mapped metadata address
      'http://localhost/',
      'http://LOCALHOST:8000/',
      'http://api.localhost/',
      'http://metadata.google.internal/',
      'http://printer.local/',
      'http://box.home.arpa/',
      'http://intranet/', // a single label is never a site on the internet
      // A trailing dot is the same name (fully qualified). It must not step around the
      // suffix rule: `metadata.google.internal.` resolves exactly like the dotless one.
      'http://metadata.google.internal./',
      'http://api.localhost./',
      'http://printer.local./',
      'http://box.home.arpa./',
      'http://localhost./',
    ]) {
      expect(isPublicSiteUrl(url), url).toBe(false)
    }
  })

  // `http://www.example.com@169.254.169.254/` READS as the public host and GOES to the private
  // one: the guard must judge the host the browser would really use.
  it('CRITICAL: a user:password@ prefix does not smuggle a private host past the guard', () => {
    expect(isPublicSiteUrl('http://www.example.com@169.254.169.254/')).toBe(false)
    expect(isPublicSiteUrl('http://localhost:3000@169.254.169.254/')).toBe(false)
  })

  // An odd port on a public host is refused: otherwise the check becomes a port scanner for
  // anyone who can type an address. 80 and 443 are what a site runs on.
  it('CRITICAL: a non-standard port is refused even on a public host', () => {
    expect(isPublicSiteUrl('https://skeen.fm:8080/')).toBe(false)
    expect(isPublicSiteUrl('https://skeen.fm:22/')).toBe(false)
    expect(isPublicSiteUrl('https://skeen.fm:443/')).toBe(true)
    expect(isPublicSiteUrl('http://skeen.fm:80/')).toBe(true)
  })

  // The sites this app really connects to still pass: a guard that refuses everything would
  // make every refusal above meaningless.
  it('accepts the ordinary hosted sites this app actually connects to', () => {
    for (const url of [
      'https://skeen.fm',
      'https://www.skeen.fm/',
      'http://staging.skeen.fm',
      'https://wren-site-theta.vercel.app',
      'https://8.8.8.8/', // a public IP literal is unusual but not private
      '  https://skeen.fm/  ',
    ]) {
      expect(isPublicSiteUrl(url), url).toBe(true)
    }
  })

  // Anything that is not an http(s) address with a host (a script link, a file, a bare path,
  // no value at all) is refused rather than guessed at.
  it('refuses non-http(s), malformed and non-text values', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://skeen.fm/', '//skeen.fm', '/about', 'skeen.fm', 'https://', '', null, undefined, 42 as unknown as string]) {
      expect(isPublicSiteUrl(url as string), String(url)).toBe(false)
    }
  })

  // The same rule on the way IN: a private custom site address is not a usable site, which
  // closes both the server fetch and the public 308 redirect to it with one rule.
  it('CRITICAL: a private custom site address makes the artist not a custom site (isCustom)', () => {
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'http://169.254.169.254/' })).toBe(false)
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'http://localhost:3000' })).toBe(false)
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'https://skeen.fm' })).toBe(true)
  })
})

describe('the loopback hatch for local development', () => {
  // Local sites (`npm run site:custom -- skeen http://localhost:3001`) need loopback. The hatch
  // is an explicit argument, never "not production": vitest runs with NODE_ENV='test', so an
  // env-sniffing hatch would open inside this very file and make every refusal above pass
  // for the wrong reason.
  it('still refuses loopback by default', () => {
    expect(isPublicSiteUrl('http://localhost:3001')).toBe(false)
    expect(isPublicSiteUrl('http://127.0.0.1:3004')).toBe(false)
  })

  // Asked for on purpose, loopback in each spelling passes.
  it('accepts loopback only when the caller explicitly allows it', () => {
    expect(isPublicSiteUrl('http://localhost:3001', { allowLoopback: true })).toBe(true)
    expect(isPublicSiteUrl('http://127.0.0.1:3004', { allowLoopback: true })).toBe(true)
    expect(isPublicSiteUrl('http://[::1]:3001', { allowLoopback: true })).toBe(true)
  })

  // The hatch opens a developer's own machine and nothing else: the metadata address and
  // private ranges never become safe because a caller is in development.
  it('CRITICAL: the hatch opens loopback only, never the metadata address or a private range', () => {
    for (const bad of ['http://169.254.169.254/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://[fd00::1]/']) {
      expect(isPublicSiteUrl(bad, { allowLoopback: true }), bad).toBe(false)
    }
  })
})

/* ── an IP address ────────────────────────────────────────────────────────────────── */

describe('an IP address (isPrivateAddress)', () => {
  // Every IPv4 block that is not the open internet is refused, at both ends of each block.
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

  // IPv6 has its own private ranges, and several ways to wrap a private IPv4 inside an IPv6
  // address (mapped, compatible, NAT64, 6to4, Teredo): each wrapping is unwrapped and judged.
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

  // Something that is not an address at all (a name, a short or long dotted form, a bare
  // number) is refused: the rule never guesses what an odd answer meant.
  it('refuses what is not an address at all', () => {
    for (const s of ['', 'localhost', 'example.com', '1.2.3', '1.2.3.4.5', '::g', '2130706433']) {
      expect(isPrivateAddress(s), s).toBe(true)
    }
  })

  // Real public addresses pass, including the ones just outside each refused range and IPv6
  // that only LOOKS like a special form: the rule must be exact, not generous.
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

/* ── a name ───────────────────────────────────────────────────────────────────────── */

describe('where a name points (resolvePublic)', () => {
  // A name that points only at the internet comes back with every address, each with its family.
  it('hands back every address of a name that points only at the internet', async () => {
    const dns = fakeDns({ 'site.example': ['93.184.216.34', '2606:4700::6810:84e5'] })
    expect(await resolvePublic('site.example', dns)).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::6810:84e5', family: 6 },
    ])
  })

  // `169.254.169.254.nip.io` looks like any public name but resolves to the metadata address:
  // the text rule passes it, so the resolved address must be judged.
  it('CRITICAL: refuses a name that points at a private address (the nip.io trick)', async () => {
    const dns = fakeDns({ '169.254.169.254.nip.io': ['169.254.169.254'] })
    const err = await resolvePublic('169.254.169.254.nip.io', dns).catch((e) => e)
    expect(err).toBeInstanceOf(BlockedAddressError)
    expect(isBlockedAddressError(err)).toBe(true)
  })

  // One private address among public ones is still refused, wherever it sits in the list: the
  // socket may pick any of them.
  it('CRITICAL: refuses a name with several addresses when ANY one is private, wherever it sits', async () => {
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

  // A name that does not resolve, or resolves to nothing, is an error (ENOTFOUND), never an
  // empty "yes"; and it is not mistaken for a refusal.
  it('a failed lookup or an empty answer is an error, never an empty yes', async () => {
    const failed = await resolvePublic('nowhere.example', fakeDns({})).catch((e) => e)
    expect(failed).toBeInstanceOf(Error)
    expect((failed as { code?: string }).code).toBe('ENOTFOUND')
    expect(isBlockedAddressError(failed)).toBe(false)
    const empty = await resolvePublic('empty.example', fakeDns({ 'empty.example': [] })).catch((e) => e)
    expect((empty as { code?: string }).code).toBe('ENOTFOUND')
  })

  // A resolver is not trusted to be sane: a name instead of an address, null, a number or an
  // empty entry is refused, and never crashes the check.
  it('refuses an answer that is not an address, or a malformed entry, without crashing', async () => {
    const odd: Resolver = async () => [{ address: 'localhost', family: 4 }]
    expect(isBlockedAddressError(await resolvePublic('odd.example', odd).catch((e) => e))).toBe(true)
    for (const bad of [[null], [{ address: 42 }], [{}]] as unknown as { address: string }[][]) {
      const r: Resolver = async () => bad
      expect(isBlockedAddressError(await resolvePublic('bad.example', r).catch((e) => e)), JSON.stringify(bad)).toBe(true)
    }
  })

  // A resolver's own error keeps its code (EAI_AGAIN says "try again"); anything else it throws
  // becomes ENOTFOUND, so callers can always tell "no answer" from "refused".
  it('a resolver error keeps its own code; anything else it throws becomes ENOTFOUND', async () => {
    const again = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' })
    expect(await resolvePublic('x.example', async () => Promise.reject(again)).catch((e) => e)).toBe(again)
    for (const thrown of ['a string', new Error('no code'), null]) {
      const err = await resolvePublic('x.example', async () => Promise.reject(thrown)).catch((e) => e)
      expect((err as { code?: string }).code, String(thrown)).toBe('ENOTFOUND')
      expect(isBlockedAddressError(err)).toBe(false)
    }
  })

  // The family (IPv4 or IPv6) is read from the address itself, not from what the resolver
  // claims, so a lying resolver cannot steer the socket.
  it('judges the family from the address itself, not from what the resolver claims', async () => {
    const liar: Resolver = async () => [{ address: '8.8.8.8', family: 6 }]
    expect(await resolvePublic('liar.example', liar)).toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  // An IP typed as the host is judged as it stands, and DNS is never asked about it.
  it('an IP literal is judged as it stands, without asking DNS', async () => {
    const dns = fakeDns({})
    expect(await resolvePublic('8.8.8.8', dns)).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(isBlockedAddressError(await resolvePublic('[::1]', dns).catch((e) => e))).toBe(true)
    expect(isBlockedAddressError(await resolvePublic('127.0.0.1', dns).catch((e) => e))).toBe(true)
    expect(dns.calls).toEqual([])
  })

  // `2130706433` and `0x7f.1` are not IP literals to Node, but the system resolver reads both
  // as 127.0.0.1: they go to the resolver, and what comes back is judged.
  it('a numeric-looking NAME (2130706433, 0x7f.1) is judged by what it resolves to', async () => {
    const dns = fakeDns({ '2130706433': ['127.0.0.1'], '0x7f.1': ['127.0.0.1'] })
    for (const host of ['2130706433', '0x7f.1']) {
      expect(isBlockedAddressError(await resolvePublic(host, dns).catch((e) => e)), host).toBe(true)
    }
  })

  // `metadata.google.internal.` (with the final dot) is the same name as without it, and is
  // judged the same way.
  it('a trailing dot is the same name, and is judged the same way', async () => {
    const dns = fakeDns({ 'metadata.google.internal.': ['169.254.169.254'] })
    expect(isBlockedAddressError(await resolvePublic('metadata.google.internal.', dns).catch((e) => e))).toBe(true)
  })
})

describe('the refusal error (isBlockedAddressError)', () => {
  // A refusal is recognised however deep Node wraps it ("fetch failed" → cause → cause), and
  // by its code after a copy; nothing else is mistaken for one.
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

  // An error whose causes loop back on themselves ends the search instead of spinning forever.
  it('a cause chain that loops ends, and is not a refusal', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b', { cause: a })
    a.cause = b
    expect(isBlockedAddressError(a)).toBe(false)
  })
})

/* ── the socket's own lookup ──────────────────────────────────────────────────────── */

function lookupOnce(fn: net.LookupFunction, host: string, options: object) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
    fn(host, options as never, (err, address, family) => resolve({ err, address, family }))
  })
}

describe('what the socket is told (guardedLookup)', () => {
  const dns = fakeDns({ 'both.example': ['93.184.216.34', '2606:4700::1'], 'bad.example': ['93.184.216.34', '10.1.1.1'] })

  // Node asks for every address at once (Happy Eyeballs): it gets exactly the checked ones.
  it('answers the all:true shape (Happy Eyeballs) with every checked address', async () => {
    const r = await lookupOnce(guardedLookup(dns), 'both.example', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toEqual([{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1', family: 6 }])
  })

  // Asked for one address, it honours a requested family, spelled as a number or as text.
  it('answers the single shape, honouring a requested family however it is spelled', async () => {
    expect(await lookupOnce(guardedLookup(dns), 'both.example', {})).toMatchObject({ err: null, address: '93.184.216.34', family: 4 })
    expect(await lookupOnce(guardedLookup(dns), 'both.example', { family: 6 })).toMatchObject({ err: null, address: '2606:4700::1', family: 6 })
    expect(await lookupOnce(guardedLookup(dns), 'both.example', { family: 'IPv6' })).toMatchObject({ err: null, address: '2606:4700::1', family: 6 })
    expect(await lookupOnce(guardedLookup(dns), 'both.example', { family: 'IPv4', all: true })).toMatchObject({ err: null, address: [{ address: '93.184.216.34', family: 4 }] })
  })

  // In every shape, a name with a private address gives the socket an error, never an address
  // to connect to.
  it('CRITICAL: hands the socket an error, never an address, when any answer is private', async () => {
    for (const options of [{ all: true }, {}, { family: 4 }]) {
      const r = await lookupOnce(guardedLookup(dns), 'bad.example', options)
      expect(isBlockedAddressError(r.err), JSON.stringify(options)).toBe(true)
    }
  })

  // The tests-only hatch lets exactly the loopback answers through; every other private
  // answer is still refused.
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

  // Asking for IPv6 from a name that has only IPv4 is "not found", not an empty list the
  // socket would choke on.
  it('a requested family with no address of that family is ENOTFOUND, not an empty list', async () => {
    const r = await lookupOnce(guardedLookup(fakeDns({ 'v4.example': ['93.184.216.34'] })), 'v4.example', { family: 6, all: true })
    expect(r.err?.code).toBe('ENOTFOUND')
  })
})
