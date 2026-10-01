/**
 * ONE RUN of the 24 SEO / GEO tests: claim → read what Tapir knows → gather the evidence ONCE →
 * run every test in SEO_TEST_IDS order → store. The page only ever reads what this stored.
 *
 * What a run guarantees, each pinned by tests/unit/seo-tests/run.test.ts:
 *   • ONE AT A TIME, cool-downs, publish coalescing and a per-manager ceiling, enforced by the
 *     DATABASE (seo_test_claim; the rules live in the migration). A refused claim gathers nothing
 *     and fetches nothing, so a hammered button cannot hammer the artist's site or MusicBrainz.
 *   • NO BROWSER WRITES: claims and results go through the service-role writer only; a manager's
 *     session can read runs and nothing else.
 *   • ONE TEST CANNOT SINK THE RUN. Every test is wrapped: a throw, or an answer that is not a
 *     result for that test, becomes `unknown` ("this test broke") and the other 23 stand.
 *   • A TIME BUDGET for the whole gather. Whatever has not answered by then is `unknown` with
 *     "ran out of time", never `pass` and never `fail` (types.ts, honesty rule 1).
 *   • NO SITE is not a crash: 24 × `unknown`, "no site is connected", and nothing is fetched.
 *   • STALE SITE is recorded, not hidden: `site_fresh` (fresh.ts) says whether the live site was
 *     showing the latest publish when the run looked.
 *   • WHAT THE RUN SAW is stored too (types.ts SeoCrawl, "How crawlers see your site"): built by
 *     crawl.ts from the same evidence, plus two things only the run can find out, both inside the
 *     budget and neither able to sink the run: the site's OTHER SPELLING (www ↔ bare, checked
 *     once) and whether GOOGLE / BING list the opened pages, asked only where the site is
 *     registered (site_verifications, verified, read through the writer) at the registered
 *     address. No site, or a gather that failed, stores no crawl.
 *
 * The engine (the evidence gatherers and the 24 tests, written beside this file by other hands)
 * is INJECTED: `deps.engine`, else `./engine` loaded on first use. Unit tests run on fakes. The
 * Google / Bing clients are injected too (`deps.listingClients`); the default reads the server's
 * keys and is built only when a registration exists, so a unit test never reaches them.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { pickTransport } from '@/lib/net-guard'
import type { BingClient } from '@/lib/search-engines/bing'
import type { GoogleClient } from '@/lib/search-engines/google'
import { BROWSER_UA } from './bots'
import { buildCrawl, crawlPath } from './crawl'
import { sameSite } from './evidence'
import { siteFreshness } from './fresh'
import { guardedFetch } from './guarded-fetch'
import { readKnown as readKnownDefault } from './known'
import { claimRun, failRun, finishRun, type SeoClaimRefusal } from './store'
import { SEO_TEST_IDS, SEO_TEST_STATUSES, type SeoCrawl, type SeoEvidence, type SeoKnown, type SeoRunReach, type SeoRunTrigger, type SeoTest, type SeoTestId, type SeoTestResult } from './types'

/** What `gatherSiteEvidence` answers: the site's side of the evidence (everything but the share
 *  picture, MusicBrainz and what Tapir knows, which the run adds). */
export type SitePages = Omit<SeoEvidence, 'shareImage' | 'musicbrainz' | 'known'>

/** Passed to every gatherer. `signal` aborts when the run's budget runs out. */
export type GatherOptions = { fetcher?: typeof fetch; signal?: AbortSignal }

export type SeoEngine = {
  gatherSiteEvidence: (origin: string, opts: GatherOptions) => Promise<SitePages>
  fetchShareImage: (homeHtml: string | null, origin: string, opts: GatherOptions) => Promise<SeoEvidence['shareImage']>
  lookupMusicBrainz: (known: SeoKnown, opts: GatherOptions) => Promise<SeoEvidence['musicbrainz']>
  tests: Partial<Record<SeoTestId, SeoTest>>
  /** The Apple Music storefront fix: the link moved to the US store, or null when there is
   *  nothing to move (apple-storefront.ts `appleStorefrontFix(url)?.fixed`). */
  appleStorefrontFix: (url: string) => string | null
  /** The site's other spelling (www ↔ bare) and where it sends a visitor, for the crawl. Absent =
   *  not checked (a fake engine fetches nothing); the real engine gets `checkOtherHost`. */
  checkOtherHost?: (origin: string, opts: GatherOptions) => Promise<SeoCrawl['otherHost']>
}

export async function loadEngine(): Promise<SeoEngine> {
  return { checkOtherHost, ...(await import('./engine')).SEO_ENGINE }
}

/** The whole gather (pages, share picture, MusicBrainz) must answer inside this. Each fetch has
 *  its own 10 s timeout (guarded-fetch); this bounds the sum. */
export const SEO_RUN_BUDGET_MS = 90_000

export type RunDeps = {
  engine?: SeoEngine
  readKnown?: (supabase: SupabaseClient, artistId: string, opts: { now?: number }) => Promise<SeoKnown>
  /** Every publish moment for the artist (publish_moments), for the stale-site verdict. */
  readMoments?: (supabase: SupabaseClient, artistId: string) => Promise<string[]>
  fetcher?: typeof fetch
  budgetMs?: number
  now?: () => number
  /** From the publish hook: what waiting for the site found. The run's own look wins. */
  freshness?: { fresh: boolean | null }
  /** A sentence to keep with the run (the publish hook's "we couldn't confirm…"). */
  note?: string | null
  /** Which search engines the site is REGISTERED with (verified). Default: `readRegistered`,
   *  site_verifications through the WRITER (the table is closed to every signed-in user). */
  readRegistered?: (writer: SupabaseClient, artistId: string) => Promise<SeoRegistration[]>
  /** The clients the listing asks. Default: `listingClientsFromEnv` (the server's keys), built
   *  only when a registration exists. */
  listingClients?: () => Promise<ListingClients>
}

/**
 * WHO writes the run. `writer` is the SERVICE-ROLE client (lib/supabase/admin): the only role that
 * may call seo_test_claim / seo_test_finish. `userId` is the signed-in manager the caller has
 * already checked owns the artist (null only for a scheduled run); the database's per-person
 * limits count it. `publishedAt`: for a publish run, the publish it is for.
 */
export type RunWho = { writer: SupabaseClient; userId: string | null; publishedAt?: string | null }

export type SeoRunOutcome =
  | { ok: true; runId: string; results: SeoTestResult[]; siteFresh: boolean | null; note: string | null }
  | { ok: false; reason: SeoClaimRefusal; error: string; retryInS?: number | null }

/* ── results the run writes itself ──────────────────────────────────────────────────── */

export function unknownResult(id: SeoTestId, value: string, sentence: string, limits?: string): SeoTestResult {
  return { id, status: 'unknown', value, sentence, evidence: [], ...(limits ? { limits } : {}) }
}

const BROKE = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'this test broke before it could check, so we don’t know yet.', 'A fault in the test itself, not in your site.')
const NOT_READY = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'this test isn’t ready yet.')
const NO_SITE = (id: SeoTestId) => unknownResult(id, 'No site', 'no site is connected, so there was nothing to check.')
const NO_ANSWER = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'your site didn’t answer in time, so we couldn’t check this.')
const OUT_OF_TIME = (id: SeoTestId) => unknownResult(id, 'Couldn’t check', 'we ran out of time before this part answered.')

/** Every status the contract has, `na` included: a test that does not apply says so. */
const STATUSES = new Set<string>(SEO_TEST_STATUSES)

/** A result FOR THIS TEST, in the contract's shape. Anything else is a broken test. */
function isResultFor(r: unknown, id: SeoTestId): r is SeoTestResult {
  if (!r || typeof r !== 'object' || typeof (r as { then?: unknown }).then === 'function') return false
  const x = r as Record<string, unknown>
  return x.id === id && STATUSES.has(x.status as string) && typeof x.value === 'string' && typeof x.sentence === 'string' && Array.isArray(x.evidence)
}

/** Run every test, in SEO_TEST_IDS order. Never throws. */
export function runAllTests(tests: Partial<Record<SeoTestId, SeoTest>>, evidence: SeoEvidence): SeoTestResult[] {
  return SEO_TEST_IDS.map((id) => {
    const test = tests[id]
    if (typeof test !== 'function') return NOT_READY(id)
    try {
      const r = test(evidence)
      return isResultFor(r, id) ? r : BROKE(id)
    } catch {
      return BROKE(id)
    }
  })
}

/* ── the gather, inside the budget ──────────────────────────────────────────────────── */

const TIMEOUT = Symbol('timeout')
const FAILED = Symbol('failed')
type Late = typeof TIMEOUT | typeof FAILED

/** Which tests a missing part of the evidence leaves unanswerable. */
const DEPENDS: Record<'shareImage' | 'musicbrainz', SeoTestId[]> = { shareImage: ['share'], musicbrainz: ['mb'] }

type Gathered =
  | { ok: true; evidence: SeoEvidence; missed: ('shareImage' | 'musicbrainz')[]; timedOut: boolean; otherHost: SeoCrawl['otherHost'] }
  | { ok: false; timedOut: boolean }

async function gather(engine: SeoEngine, known: SeoKnown, origin: string, deps: { fetcher?: typeof fetch; deadline: number; now: () => number }): Promise<Gathered> {
  const controller = new AbortController()
  const opts: GatherOptions = { fetcher: deps.fetcher, signal: controller.signal }
  const timers: ReturnType<typeof setTimeout>[] = []
  /** The promise's value, or TIMEOUT at the deadline, or FAILED if it threw. */
  const within = <T>(p: Promise<T>): Promise<T | Late> =>
    Promise.race([
      p.then((v) => v, () => FAILED as Late),
      new Promise<Late>((resolve) => {
        timers.push(setTimeout(() => resolve(TIMEOUT), Math.max(0, deps.deadline - deps.now())))
      }),
    ])
  const start = <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return Promise.resolve(f())
    } catch (e) {
      return Promise.reject(e)
    }
  }
  try {
    const mb = within(start(() => engine.lookupMusicBrainz(known, opts)))
    const pages = await within(start(() => engine.gatherSiteEvidence(origin, opts)))
    if (pages === TIMEOUT || pages === FAILED) return { ok: false, timedOut: pages === TIMEOUT }
    const home = pages.plain?.find((p) => p.path === '/')?.html ?? null
    // The other spelling of the origin the site ANSWERED on, beside the share picture. Not a test
    // input: a check that fails or runs out of time is "not checked" and changes nothing else.
    const landed = typeof pages.origin === 'string' && pages.origin ? pages.origin : origin
    const otherP = engine.checkOtherHost ? within(start(() => engine.checkOtherHost!(landed, opts))) : Promise.resolve(null)
    const [share, brainz, other] = await Promise.all([within(start(() => engine.fetchShareImage(home, origin, opts))), mb, otherP])
    const missed: ('shareImage' | 'musicbrainz')[] = []
    if (share === TIMEOUT || share === FAILED) missed.push('shareImage')
    if (brainz === TIMEOUT || brainz === FAILED) missed.push('musicbrainz')
    const evidence: SeoEvidence = {
      ...pages,
      // A share picture we never finished fetching is NOT "the page names none": the `share`
      // result is replaced with `unknown` below, whatever the test made of this null.
      shareImage: share === TIMEOUT || share === FAILED ? null : share,
      musicbrainz:
        brainz === TIMEOUT || brainz === FAILED
          ? { looked: false, artistUrl: null, matchedOn: null, error: brainz === TIMEOUT ? 'ran out of time' : 'the lookup failed' }
          : brainz,
      known,
    }
    const otherHost = other === TIMEOUT || other === FAILED ? null : (other ?? null)
    return { ok: true, evidence, missed, timedOut: share === TIMEOUT || brainz === TIMEOUT, otherHost }
  } finally {
    for (const t of timers) clearTimeout(t)
    controller.abort() // stragglers stop; a gatherer that honours the signal frees its sockets
  }
}

/* ── the crawl: the other spelling ──────────────────────────────────────────────────── */

const OTHER_HOST_TIMEOUT_MS = 5_000

/**
 * The origin's other spelling, "www.<name>" ↔ "<name>", as an address; null when it isn't clear.
 * Dropping "www." is always clear. Adding it is only for a two-label name ("skeen.com"): without
 * a public-suffix list "skeen.co.uk" can't be told from "shop.skeen.com", so it is left alone.
 */
export function otherSpelling(origin: string): string | null {
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return null
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.port !== '') return null
  // An address (1.2.3.4, [::1]) never has two labels or a leading "www", so it falls out below.
  const labels = u.hostname.toLowerCase().replace(/\.$/, '').split('.')
  if (labels[0] === 'www') return labels.length >= 3 ? `${u.protocol}//${labels.slice(1).join('.')}/` : null
  return labels.length === 2 ? `${u.protocol}//www.${labels.join('.')}/` : null
}

/**
 * Open the other spelling ONCE, as a person's browser, following it only within the site (www or
 * bare, http or https): its final answer and where it landed. With no final answer (a redirect to
 * another site, which is not followed, or a hop that didn't answer), `to` is where the last
 * redirect pointed, else null. Never throws (guardedFetch never does).
 */
export async function checkOtherHost(origin: string, opts: GatherOptions = {}): Promise<SeoCrawl['otherHost']> {
  const url = otherSpelling(origin)
  if (!url) return null
  // Never the global fetch (lib/net-guard); the run's signal ends it with the run.
  const base = pickTransport(opts.fetcher)
  let pointedAt: string | null = null
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal && opts.signal ? AbortSignal.any([init.signal, opts.signal]) : (init?.signal ?? opts.signal)
    const res = await base(input, { ...init, signal })
    try {
      const loc = res.headers?.get?.('location')
      pointedAt = loc ? new URL(loc, String(input)).toString() : null
    } catch {
      pointedAt = null
    }
    return res
  }) as typeof fetch
  const r = await guardedFetch(url, { fetcher, userAgent: BROWSER_UA, timeoutMs: OTHER_HOST_TIMEOUT_MS, maxBytes: 1024, as: 'bytes', allow: (u) => sameSite(u, origin) })
  return { url, status: r.status, to: r.finalUrl ?? pointedAt }
}

/* ── the crawl: is it listed on Google / Bing? ──────────────────────────────────────── */

/** A search engine the site is registered with (site_verifications, verified), at the address
 *  it was registered as: the Search Console property / the Bing site, exactly. */
export type SeoRegistration = { provider: 'google' | 'bing'; siteUrl: string }

export type ListingClients = {
  google: Pick<GoogleClient, 'inspectUrl'> | null
  bing: Pick<BingClient, 'urlInfo'> | null
}

/** Pages asked about: the ones the run opened ("/" and up to 4 more). */
const LISTING_PAGES = 5

/** A registered address in the shape the migration allows: https, a host, the root, nothing else. */
function registeredUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password && u.port === '' ? v : null
  } catch {
    return null
  }
}

/** The site's VERIFIED registrations, read through the WRITER (service role): site_verifications
 *  is closed to every signed-in user. [] when there are none or the read fails. */
export async function readRegistered(writer: SupabaseClient, artistId: string): Promise<SeoRegistration[]> {
  const { data, error } = await writer.from('site_verifications').select('provider, site_url, verified_at').eq('artist_id', artistId)
  if (error || !Array.isArray(data)) return []
  const out: SeoRegistration[] = []
  for (const row of data as Record<string, unknown>[]) {
    const provider = row?.provider
    if ((provider !== 'google' && provider !== 'bing') || typeof row.verified_at !== 'string' || !row.verified_at) continue
    const siteUrl = registeredUrl(row.site_url)
    if (siteUrl && !out.some((r) => r.provider === provider)) out.push({ provider, siteUrl })
  }
  return out
}

/** The clients, from the server's keys: a missing key is that provider's null. Loaded lazily, so
 *  a run with nothing registered never reads a key. */
export async function listingClientsFromEnv(): Promise<ListingClients> {
  // Tests load .env.local (vitest.setup.ts), so a test that forgot to inject its own clients would
  // call the real Google and Bing with the real keys. Under vitest this refuses instead.
  if (process.env.VITEST) throw new Error('listingClientsFromEnv is not for tests: inject deps.listingClients')
  const [{ googleClient, googleCredsFromEnv }, { bingClient }] = await Promise.all([import('@/lib/search-engines/google'), import('@/lib/search-engines/bing')])
  const creds = googleCredsFromEnv(process.env.GOOGLE_SEARCH_SERVICE_ACCOUNT_B64)
  const key = process.env.BING_WEBMASTER_API_KEY?.trim()
  return { google: creds ? googleClient(creds) : null, bing: key ? bingClient(key) : null }
}

/** `p`'s value, or `fallback` once the deadline passes or if it throws. */
function beforeDeadline<T>(p: () => Promise<T>, fallback: T, deadline: number, now: () => number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, deadline - now()))
  })
  let run: Promise<T>
  try {
    run = p().catch(() => fallback)
  } catch {
    run = Promise.resolve(fallback)
  }
  return Promise.race([run, late]).finally(() => clearTimeout(timer))
}

/** Ask one provider about each page: the first alone (its sign-in is then cached), the rest
 *  together. A page whose answer failed keeps `empty`. */
async function askPages<R, E>(paths: string[], ask: (path: string) => Promise<{ ok: true; value: R } | { ok: false }>, fill: (path: string, value: R) => E, empty: (path: string) => E): Promise<E[]> {
  const one = async (path: string): Promise<E> => {
    try {
      const r = await ask(path)
      return r.ok ? fill(path, r.value) : empty(path)
    } catch {
      return empty(path)
    }
  }
  if (!paths.length) return []
  const first = await one(paths[0])
  return [first, ...(await Promise.all(paths.slice(1).map(one)))]
}

/**
 * Whether Google and Bing list the opened pages. A provider the site isn't registered with is
 * null (it couldn't be asked); a registered one gives one entry per page, with nulls where the
 * answer failed, the key is missing or the budget ran out. Never throws.
 */
export async function askListing(registered: SeoRegistration[], openedPaths: string[], makeClients: () => Promise<ListingClients>, deadline: number, now: () => number): Promise<SeoCrawl['listing']> {
  const google = registered.find((r) => r.provider === 'google') ?? null
  const bing = registered.find((r) => r.provider === 'bing') ?? null
  if (!google && !bing) return { google: null, bing: null }
  const paths = openedPaths.slice(0, LISTING_PAGES)
  const pageUrl = (siteUrl: string, path: string) => `${siteUrl.replace(/\/+$/, '')}${path}`
  // Asked, no answer (failed, timed out, no key): `answered: false`, so the page never reads it as
  // "not listed" or "no visit on record".
  const nullG = (path: string) => ({ path: crawlPath(path), answered: false, verdict: null, coverage: null, lastCrawl: null })
  const nullB = (path: string) => ({ path: crawlPath(path), answered: false, lastCrawled: null, status: null })
  const clients = await beforeDeadline(makeClients, { google: null, bing: null } as ListingClients, deadline, now)
  const [g, b] = await Promise.all([
    google
      ? beforeDeadline(
          async () => {
            const c = clients.google
            if (!c) return paths.map(nullG)
            return askPages(paths, (p) => c.inspectUrl(google.siteUrl, pageUrl(google.siteUrl, p)), (p, v) => ({ path: crawlPath(p), answered: true, verdict: v.verdict, coverage: v.coverage, lastCrawl: v.lastCrawl }), nullG)
          },
          paths.map(nullG),
          deadline,
          now,
        )
      : null,
    bing
      ? beforeDeadline(
          async () => {
            const c = clients.bing
            if (!c) return paths.map(nullB)
            return askPages(paths, (p) => c.urlInfo(bing.siteUrl, pageUrl(bing.siteUrl, p)), (p, v) => ({ path: crawlPath(p), answered: true, lastCrawled: v.lastCrawled, status: v.status }), nullB)
          },
          paths.map(nullB),
          deadline,
          now,
        )
      : null,
  ])
  return { google: g, bing: b }
}

/* ── the run ────────────────────────────────────────────────────────────────────────── */

/** Every publish moment for the artist, newest first; [] when unreadable (the stale-site
 *  verdict then says "couldn't tell", never "fresh"). */
export async function readPublishMoments(supabase: SupabaseClient, artistId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('publish_moments', { p_artist_id: artistId })
  if (error) return []
  return ((data ?? []) as { published_at?: unknown }[]).map((r) => String(r.published_at ?? '')).filter(Boolean)
}

/**
 * Run the tests for one artist and store the run. Never throws.
 *
 * `supabase` is the READER: the signed-in manager's own session, so what the run reads about the
 * artist is RLS-scoped exactly as the page is. Every WRITE goes through `who.writer` (the service
 * role). The caller has already checked the manager owns the artist (test-actions.ts, the publish
 * hook); the claim function checks again against `who.userId`.
 */
export async function runSeoTests(supabase: SupabaseClient, artistId: string, trigger: SeoRunTrigger, who: RunWho, deps: RunDeps = {}): Promise<SeoRunOutcome> {
  const now = deps.now ?? Date.now
  const writer = who.writer
  const claim = await claimRun(writer, artistId, trigger, { userId: who.userId, publishedAt: who.publishedAt ?? null })
  if (!claim.ok) return { ok: false, reason: claim.reason, error: claim.error, retryInS: claim.retryInS }
  const deadline = now() + (deps.budgetMs ?? SEO_RUN_BUDGET_MS)

  try {
    const known = await (deps.readKnown ?? readKnownDefault)(supabase, artistId, { now: now() })
    let results: SeoTestResult[]
    let siteFresh: boolean | null = null
    // Did the site answer? The gather's own verdict; null when there is no site, or when OUR
    // code broke before it could look (that says nothing about the site).
    let reach: SeoRunReach | null = null
    // What the run saw, for "How crawlers see your site"; null = no site, or nothing was seen.
    let crawl: SeoCrawl | null = null
    const notes: string[] = deps.note ? [deps.note] : []

    if (!known.siteUrl) {
      results = SEO_TEST_IDS.map(NO_SITE)
    } else {
      const engine = deps.engine ?? (await loadEngine())
      const [got, moments] = await Promise.all([
        gather(engine, known, known.siteUrl, { fetcher: deps.fetcher, deadline, now }),
        (deps.readMoments ?? readPublishMoments)(supabase, artistId).catch(() => [] as string[]),
      ])
      if (!got.ok) {
        if (got.timedOut) reach = { state: 'no-answer', status: null, error: 'timeout' }
        results = SEO_TEST_IDS.map(got.timedOut ? OUT_OF_TIME : NO_ANSWER)
        notes.push(got.timedOut ? 'Your site took too long to answer, so nothing could be checked.' : 'We couldn’t read your site, so nothing could be checked.')
      } else {
        reach = got.evidence.reach ?? null
        results = runAllTests(engine.tests, got.evidence)
        for (const part of got.missed) {
          for (const id of DEPENDS[part]) {
            const at = results.findIndex((r) => r.id === id)
            // `na` needs no look (a visual artist's `mb` never asks MusicBrainz), so a missing
            // part of the evidence cannot make it "couldn't check".
            if (at >= 0 && results[at].status !== 'na') results[at] = OUT_OF_TIME(id)
          }
        }
        if (got.timedOut) notes.push('Part of the check ran out of time.')
        const verdict = siteFreshness(got.evidence.sitemap?.lastmods, known.published?.publishedAt ?? null, moments, known.published?.contentAt ?? null)
        siteFresh = verdict ?? deps.freshness?.fresh ?? null
        if (siteFresh === false && !deps.note) notes.push('Your site was still showing an older publish when we tested.')
        // Google / Bing, only where the site is registered. Nothing here can sink the run.
        const registered = await (deps.readRegistered ?? readRegistered)(writer, artistId).catch(() => [] as SeoRegistration[])
        const opened = Array.isArray(got.evidence.paths) ? got.evidence.paths.filter((p): p is string => typeof p === 'string') : []
        const listing = await askListing(registered, opened, deps.listingClients ?? listingClientsFromEnv, deadline, now).catch(() => ({ google: null, bing: null }))
        try {
          crawl = buildCrawl(got.evidence, { otherHost: got.otherHost, listing })
        } catch {
          crawl = null
        }
      }
    }

    const saved = await finishRun(writer, claim.runId, {
      results,
      siteUrl: known.siteUrl,
      siteFresh,
      publishedAt: known.published?.publishedAt ?? null,
      note: notes.length ? notes.join(' ') : null,
      reach,
      crawl,
    })
    if (!saved.ok) {
      // Refused (the size check) or not running any more: never leave it "running", or the
      // artist reads as busy until the 5-minute sweep.
      await failRun(writer, claim.runId, 'The test finished but its results couldn’t be saved.')
      return { ok: false, reason: 'error', error: saved.error }
    }
    return { ok: true, runId: claim.runId, results, siteFresh, note: notes.length ? notes.join(' ') : null }
  } catch {
    await failRun(writer, claim.runId, 'The test couldn’t finish.')
    return { ok: false, reason: 'error', error: 'The test couldn’t finish. Try again in a minute.' }
  }
}
