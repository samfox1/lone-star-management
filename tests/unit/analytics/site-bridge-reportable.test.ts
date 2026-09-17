// @vitest-environment jsdom
// WHOSE TRAFFIC COUNTS. One rule, shared by the door reporter and the PostHog mirror.
//
// The 2026-09-15 accuracy audit, finding 5: "Test traffic counts as fan views. Vercel
// preview deploys and local development both send views to production." That is a real
// accuracy bug on its own, and it is worse during the 30-day cross-check: if the two
// pipelines disagreed about what counts, the comparison would manufacture a gap and we
// would spend the month chasing it. So both sides call the SAME predicate, and a test
// below reads every call site to prove it.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  createAnalytics,
  hostnameOf,
  isReportableContext,
  type AnalyticsDeps,
} from '../../../packages/site-bridge/src/analytics'
import { createMirror, MIRROR_SCRIPT_MARK, type MirrorDeps, type PostHogLike } from '../../../packages/site-bridge/src/mirror'

describe('a developer machine is not a fan', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'skeen.local', 'my-mac.localhost'])(
    'CRITICAL: %s never reports',
    (hostname) => {
      expect(isReportableContext({ hostname, pathname: '/' })).toBe(false)
    },
  )

  it('a bare LAN address is a developer testing on their phone', () => {
    // `next dev --hostname 0.0.0.0` plus a phone on the same wifi is the normal way to
    // check a site on a real device, and every one of those loads was landing in the
    // artist's production chart.
    expect(isReportableContext({ hostname: '192.168.1.14', pathname: '/' })).toBe(false)
    expect(isReportableContext({ hostname: '10.0.0.8', pathname: '/' })).toBe(false)
    expect(isReportableContext({ hostname: '172.16.0.5', pathname: '/' })).toBe(false)
    expect(isReportableContext({ hostname: '172.31.255.1', pathname: '/' })).toBe(false)
  })

  it('CRITICAL: the private ranges stop exactly at their edges', () => {
    // 172.15 and 172.32 are public. A range check off by one silences real traffic.
    expect(isReportableContext({ hostname: '172.15.0.1', pathname: '/' })).toBe(true)
    expect(isReportableContext({ hostname: '172.32.0.1', pathname: '/' })).toBe(true)
    expect(isReportableContext({ hostname: '192.169.0.1', pathname: '/' })).toBe(true)
    expect(isReportableContext({ hostname: '11.0.0.1', pathname: '/' })).toBe(true)
  })

  it('CRITICAL: a PUBLIC dotted quad is a fan, and a hostname merely containing one is too', () => {
    // Without a public quad in this file, "every IP address is unreportable" passed the
    // suite. And an unanchored pattern would silence a CDN host like the second one.
    expect(isReportableContext({ hostname: '203.0.113.5', pathname: '/' })).toBe(true)
    expect(isReportableContext({ hostname: 'cdn-10.0.0.1.example.com', pathname: '/' })).toBe(true)
    expect(isReportableContext({ hostname: '10.0.0.1.example.com', pathname: '/' })).toBe(true)
  })

  it('a real site still reports', () => {
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/' })).toBe(true)
    expect(isReportableContext({ hostname: 'www.skeenmusic.com', pathname: '/tour' })).toBe(true)
  })

  it('CRITICAL: a *.vercel.app site is a REAL site, not a preview', () => {
    // wren lives at wren-site-theta.vercel.app. Blanket-blocking vercel.app would silence
    // a whole artist's analytics, and it would look exactly like nobody visiting.
    expect(isReportableContext({ hostname: 'wren-site-theta.vercel.app', pathname: '/' })).toBe(true)
  })
})

describe('a preview deploy is not a fan either', () => {
  it('CRITICAL: only `production` reports when the site declares its environment', () => {
    // Vercel's own VERCEL_ENV, which the site passes through. A preview URL is a real
    // public https host, so nothing about the hostname can reveal it.
    expect(isReportableContext({ hostname: 'skeen-git-fix-abc.vercel.app', pathname: '/' }, 'preview')).toBe(false)
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/' }, 'development')).toBe(false)
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/' }, 'production')).toBe(true)
  })

  it('a site that declares nothing is trusted, because most sites are not on Vercel', () => {
    // Absent means "unknown", not "preview". Defaulting the other way would silently
    // switch off analytics for any site that never sets the variable.
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/' }, undefined)).toBe(true)
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/' }, '')).toBe(true)
  })

  it("CRITICAL: ANY declared environment other than production is not a fan", () => {
    // An allowlist of preview names only knows the hosts we thought of. Netlify calls its
    // previews `deploy-preview` and `branch-deploy`; a first draft let both through.
    for (const env of ['deploy-preview', 'branch-deploy', 'staging', 'Preview']) {
      expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/' }, env)).toBe(false)
    }
  })
})

describe('hostnameOf', () => {
  it('CRITICAL: a real location\'s hostname wins over its href', () => {
    // Every browser takes this branch. Disagreeing on purpose, so the test can tell which
    // one was read.
    expect(hostnameOf({ hostname: 'skeenmusic.com', href: 'http://localhost:3000/' })).toBe('skeenmusic.com')
  })

  it('parses the host out of an href when that is all it is given', () => {
    expect(hostnameOf({ href: 'https://skeenmusic.com:8443/tour?x=1' })).toBe('skeenmusic.com')
  })

  it('a malformed href, or nothing at all, is an empty host', () => {
    expect(hostnameOf({ href: 'not a url' })).toBe('')
    expect(hostnameOf({})).toBe('')
  })
})

describe('the editor shell is folded into the same rule', () => {
  it('so that one predicate is the whole answer to "does this count"', () => {
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/edit' })).toBe(false)
    expect(isReportableContext({ hostname: 'skeenmusic.com', pathname: '/edit/music' })).toBe(false)
  })
})

/* ── Both pipelines, one rule ─────────────────────────────────────────────────────── */

function wiredPair(hostname: string, environment?: string) {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  const loc = { href: `https://${hostname}/tour`, pathname: '/tour', hostname }

  const doc = document.implementation.createHTMLDocument('pair')
  const win = { posthog: undefined as PostHogLike | undefined }
  const phCalls: unknown[][] = []
  const mirrorDeps: MirrorDeps = {
    window: win as unknown as Window & { posthog?: PostHogLike },
    document: doc,
    location: loc,
  }
  const mirror = createMirror({ key: 'phc_test', slug: 'skeen', environment }, mirrorDeps)
  win.posthog = {
    init: () => phCalls.push(['init']),
    register: () => phCalls.push(['register']),
    capture: (e: string) => phCalls.push(['capture', e]),
  } as PostHogLike
  for (const s of Array.from(doc.querySelectorAll('script'))) s.dispatchEvent(new Event('load'))

  const a = createAnalytics(
    { supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon', slug: 'skeen', environment },
    { fetch: fetchSpy as unknown as typeof fetch, location: loc, referrer: () => '', mirror } as AnalyticsDeps,
  )
  return { a, doorSends: () => fetchSpy.mock.calls.length, phEvents: () => phCalls }
}

describe('CRITICAL: the two pipelines agree on what counts', () => {
  it('a real visit reaches both', () => {
    const { a, doorSends, phEvents } = wiredPair('skeenmusic.com')
    a.pageview()
    a.track('buy_click', { label: 'Tee' })
    expect(doorSends()).toBe(2)
    // PostHog counts its own page views, so only the click is mirrored.
    expect(phEvents().filter(([m]) => m === 'capture')).toEqual([['capture', 'buy_click']])
  })

  it('localhost reaches NEITHER — the gap the comparison must not invent', () => {
    // If only one side were guarded, a month of a developer running `next dev` would show
    // up as that side over-counting, and the whole cross-check would be reporting on us.
    const { a, doorSends, phEvents } = wiredPair('localhost')
    a.pageview()
    a.track('buy_click', { label: 'Tee' })
    expect(doorSends()).toBe(0)
    expect(phEvents()).toEqual([])
  })

  it('a preview deploy reaches NEITHER', () => {
    const { a, doorSends, phEvents } = wiredPair('skeen-git-fix-abc.vercel.app', 'preview')
    a.pageview()
    a.track('buy_click', { label: 'Tee' })
    expect(doorSends()).toBe(0)
    expect(phEvents()).toEqual([])
  })

  it('the mirror does not even load its script off a real site', () => {
    const doc = document.implementation.createHTMLDocument('pair')
    createMirror(
      { key: 'phc_test', slug: 'skeen', environment: 'preview' },
      { window: {} as Window & { posthog?: PostHogLike }, document: doc, location: { hostname: 'x.vercel.app', pathname: '/' } },
    )
    expect(doc.querySelectorAll(`script[${MIRROR_SCRIPT_MARK}]`)).toHaveLength(0)
  })
})

// These read SOURCE TEXT, so they are static checks with nothing to say about a mutant, and
// under Stryker the files they read are instrumented (every literal rewritten), which makes
// them fail for a reason that is not a bug. They skip ONLY when they can see that
// instrumentation, so an ordinary `vitest run` can never skip them.
const instrumented = readFileSync(`${process.cwd()}/packages/site-bridge/src/analytics.ts`, 'utf8').includes('stryMutAct_')

describe.skipIf(instrumented)('one definition, not two', () => {
  const read = (p: string) => readFileSync(`${process.cwd()}/packages/site-bridge/src/${p}`, 'utf8')

  it('CRITICAL: the mirror IMPORTS the rule from analytics.ts', () => {
    // A review showed the first version of this test was theatre: it looked for the NAME
    // anywhere in the file, which a comment or an unused import satisfies. It now reads
    // the import specifier and the call.
    const mirror = read('mirror.ts')
    expect(mirror).toMatch(/import\s*\{[^}]*\bisReportableContext\b[^}]*\}\s*from\s*["']\.\/analytics["']/)
    expect(mirror).toMatch(/\bisReportableContext\(\s*\{/)
  })

  it('CRITICAL: the mirror re-types none of the literals the rule is made of', () => {
    // DERIVED from analytics.ts, not hand-listed (AGENTS.md rule 4): every string literal
    // inside the loopback set and the rule's body is banned from mirror.ts. A re-typed copy
    // that behaves identically TODAY is the drift this names, and no behavioural test can
    // see it until the two copies disagree.
    const analytics = read('analytics.ts')
    const loopback = /const LOOPBACK_HOSTS = new Set\(\[(.*?)\]\);/.exec(analytics)
    const rule = /export function isReportableContext[\s\S]*?\n\}/.exec(analytics)
    expect(loopback, 'LOOPBACK_HOSTS moved; update this test to find it').not.toBeNull()
    expect(rule, 'isReportableContext moved; update this test to find it').not.toBeNull()
    const literals = [...`${loopback![1]}${rule![0]}`.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(literals.length).toBeGreaterThan(5)
    const mirror = read('mirror.ts')
    for (const literal of literals) expect(mirror, `mirror.ts re-types "${literal}"`).not.toContain(`"${literal}"`)
  })
})
