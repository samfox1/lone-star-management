// The host guard for a manager-typed site URL that the server fetches and the public redirects
//   to.
/**
 * `isPublicSiteUrl` — the host guard the SEO live check and the public redirect share.
 *
 * `custom_site_url` is manager-typed free text that the SERVER fetches (the SEO / GEO
 * page's "Run check") and that a PUBLIC route 308s a fan to. So the question this guard
 * answers is not "is it a URL" but "is it an address on the open internet": a loopback,
 * private, link-local or unique-local target is the server's own network, and fetching
 * one on a manager's say-so is SSRF with the body echoed back (`tag.slice(0, 80)`).
 *
 * Lives in a `seo-*` file rather than `custom-site.test.ts` on purpose: this is pure and
 * DB-free, and that file talks to the hosted database.
 */
import { describe, expect, it } from 'vitest'
import { isCustom, isPublicSiteUrl } from '@/lib/custom-site'

describe('isPublicSiteUrl', () => {
  it('CRITICAL: refuses loopback, private, link-local and unique-local targets', () => {
    for (const url of [
      'http://169.254.169.254/', // AWS / GCP instance metadata
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://2852039166/', // 169.254.169.254 in decimal — WHATWG normalises it
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
    ]) {
      expect(isPublicSiteUrl(url), url).toBe(false)
    }
  })

  it('CRITICAL: userinfo does not smuggle a private host past the guard', () => {
    // `http://www.example.com@169.254.169.254/` READS as the public host and RESOLVES to
    // the private one. The guard must judge the parsed hostname, never the string.
    expect(isPublicSiteUrl('http://www.example.com@169.254.169.254/')).toBe(false)
    expect(isPublicSiteUrl('http://localhost:3000@169.254.169.254/')).toBe(false)
  })

  it('CRITICAL: a non-standard port is refused even on a public host', () => {
    // Port-scanning the server's egress is the same primitive; 80/443 is what a site runs on.
    expect(isPublicSiteUrl('https://skeen.fm:8080/')).toBe(false)
    expect(isPublicSiteUrl('https://skeen.fm:22/')).toBe(false)
    expect(isPublicSiteUrl('https://skeen.fm:443/')).toBe(true)
    expect(isPublicSiteUrl('http://skeen.fm:80/')).toBe(true)
  })

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

  it('non-http(s), malformed and non-string values are refused', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://skeen.fm/', '//skeen.fm', '/about', 'skeen.fm', 'https://', '', null, undefined, 42 as unknown as string]) {
      expect(isPublicSiteUrl(url as string), String(url)).toBe(false)
    }
  })
})

describe('isCustom — the same guard on the way IN', () => {
  it('CRITICAL: a private custom_site_url is not a usable site', () => {
    // The value reaches the server fetch through `publicSiteOrigin`, and a fan through a
    // cached 308. Rejecting it here closes both with one rule.
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'http://169.254.169.254/' })).toBe(false)
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'http://localhost:3000' })).toBe(false)
    expect(isCustom({ site_kind: 'custom', custom_site_url: 'https://skeen.fm' })).toBe(true)
  })
})

describe('the loopback escape hatch — dev must still be able to connect a local site', () => {
  // FTBK's `custom_site_url` is `http://localhost:3004` in the live DB right now, and
  // lone-star's own docs tell you to set one (`npm run site:custom -- skeen
  // http://localhost:3001`). A guard with no hatch does not error — it silently demotes
  // the artist to a TEMPLATE site, and the editor iframe stops loading their real one.
  //
  // The hatch is an explicit ARGUMENT, never `NODE_ENV !== 'production'`. Vitest runs
  // with NODE_ENV='test', so an env-sniffing hatch would open itself inside this very
  // file and make every denial above vacuously true — the exact shape AGENTS.md rule 2
  // is about. Opting in has to be something a caller does on purpose.
  it('still refuses loopback by DEFAULT', () => {
    expect(isPublicSiteUrl('http://localhost:3001')).toBe(false)
    expect(isPublicSiteUrl('http://127.0.0.1:3004')).toBe(false)
  })

  it('accepts loopback ONLY when the caller explicitly allows it', () => {
    expect(isPublicSiteUrl('http://localhost:3001', { allowLoopback: true })).toBe(true)
    expect(isPublicSiteUrl('http://127.0.0.1:3004', { allowLoopback: true })).toBe(true)
    expect(isPublicSiteUrl('http://[::1]:3001', { allowLoopback: true })).toBe(true)
  })

  it('the hatch opens LOOPBACK ONLY — never the metadata address or a private range', () => {
    // The whole reason this finding was filed. Loopback is a developer's own machine;
    // 169.254.169.254 is a cloud metadata endpoint and 10.x is somebody's intranet, and
    // neither becomes safe because a caller is in dev.
    for (const bad of [
      'http://169.254.169.254/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://[fd00::1]/',
    ]) {
      expect(isPublicSiteUrl(bad, { allowLoopback: true }), bad).toBe(false)
    }
  })
})
