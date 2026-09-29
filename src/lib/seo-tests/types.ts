/**
 * THE SEO / GEO TESTS: the contract every part builds against (Sam, 2026-09-28: "This test
 * should be a big part of this project and should be very helpful to users who dont know
 * technology" and "These tests should be verified to accurately detect what they say. If they
 * cant, thats fine, make a note").
 *
 *   evidence   what we fetched and what Tapir knows, gathered ONCE per run (evidence.ts)
 *   tests      pure functions over that evidence, one per `SeoTestId` (found / who / shared / facts)
 *   run        gathers, runs every test, stores the run (run.ts, store.ts)
 *   the page   reads stored runs; it never decides a result itself
 *
 * THE HONESTY RULES, which the types enforce:
 *   1. A test that could not LOOK is `unknown`, never `pass`. `unknown` is shown as "couldn't
 *      check", counts as not passing, and says why in its sentence.
 *   2. A test says what it CANNOT see in `limits` (one plain sentence), shown under "Show the
 *      details". A claim the evidence cannot support is cut from the sentence, not softened.
 *   3. `evidence` is plain text the run really observed (a status code, a header, a snippet):
 *      never a value copied from what Tapir expects to be there.
 */

export type SeoTestGroup = 'found' | 'who' | 'shared' | 'facts'

export const SEO_TEST_IDS = [
  'google', 'bing', 'chatgpt', 'claude', 'perplexity', 'others', 'allowed', 'list', 'words', 'bingwm',
  'title', 'desc', 'bio', 'genre', 'place', 'mb',
  'share', 'preview', 'alt',
  'profiles', 'apple', 'shows', 'releases', 'card',
] as const
export type SeoTestId = (typeof SEO_TEST_IDS)[number]

/** What a test IS: its group and its plain words. Results are separate (SeoTestResult). */
export type SeoTestDef = {
  id: SeoTestId
  group: SeoTestGroup
  /** A statement about the artist, true when the test passes: "Google can visit your site". */
  name: string
  /** One sentence, no jargon: what we did. */
  tested: string
  /** One sentence about fans / AI: why it matters. */
  why: string
  /** The fix happens on another service ("OUTSIDE TAPIR" tag). */
  outside?: 'Bing' | 'MusicBrainz'
  /** The answer comes from another tool's data ("Tour" / "Music" tag). */
  source?: 'Tour' | 'Music'
}

export type SeoTestStatus = 'pass' | 'fail' | 'unknown'

/** What the manager can do about a result. Drawn as an ICON button with a hover label. */
export type SeoTestAction =
  /** Open one of the page's own tabs / editors. */
  | { kind: 'edit'; target: 'listing' | 'facts' | 'bio' | 'share' | 'alt' | 'answers' | 'connections' | 'tour' | 'music'; label: string }
  /** Open another site in a new tab (https only). */
  | { kind: 'outside'; href: string; label: string }
  /** A change Tapir can make itself, as a DRAFT the manager then publishes. */
  | { kind: 'fix'; fix: 'apple-storefront'; label: string }

export type SeoTestResult = {
  id: SeoTestId
  status: SeoTestStatus
  /** The short value on the right of the row: "3 of 3 pages", "288 of 2,500". Under ~28 chars. */
  value: string
  /** One plain sentence. For a fail the page puts "Not yet:" (or `lead`) in front of it, so
   *  it starts lower-case: "your bio has 288 characters. Aim for 2,500." */
  sentence: string
  /** A softer opener for a near miss ("Almost:"). */
  lead?: 'Almost'
  /** For a fail: what good looks like, one line. Only when it is grounded, else omitted. */
  good?: string
  /** For a fail: what to do, one line. */
  todo?: string
  action?: SeoTestAction
  /** What the run observed, for "Show the details". Plain text only, never html. */
  evidence: { label: string; value: string }[]
  /** What this test cannot see, in one plain sentence (honesty rule 2). */
  limits?: string
}

/* ── evidence ───────────────────────────────────────────────────────────────────────── */

/** A visitor we fetch as. `fetches` false = a robots.txt TOKEN only (no crawler of its own
 *  sends this name), so it is judged from robots.txt, never from a fetch. */
export type SeoBot = {
  key: string
  /** The name a person knows: "ChatGPT", "Google". */
  who: string
  /** The exact User-Agent string sent, from the vendor's own documentation. */
  userAgent: string | null
  /** The product token robots.txt rules are written against. */
  robotsToken: string
  fetches: boolean
  /** Which test reads it. */
  test: Extract<SeoTestId, 'google' | 'bing' | 'chatgpt' | 'claude' | 'perplexity' | 'others'>
}

export type SeoPageFetch = {
  /** Path on the site: "/", "/about". */
  path: string
  /** Where the answer finally came from, after redirects. */
  finalUrl: string | null
  /** null = no answer (refused before it left, threw, timed out, too many redirects). */
  status: number | null
  /** Lower-cased header names. Only the ones a test reads are kept. */
  headers: Record<string, string>
  /** The body when it was 2xx text/html, capped; else null. */
  html: string | null
  /** Why there is no answer, when status is null. */
  error?: string
}

/** What Tapir itself knows, read from the database for this artist. `published` is what the
 *  public door serves (get_public_site); `working` is the draft. Tests compare the LIVE SITE to
 *  `published`, never to `working`: a draft is not supposed to be on the site yet. */
export type SeoKnown = {
  artistName: string
  siteUrl: string | null
  today: string
  published: {
    bio: string | null
    genre: string | null
    location: string | null
    seoTitle: string | null
    seoDescription: string | null
    ogImage: string | null
    /** Every link the door serves, buttons and identity links alike. */
    links: { label: string | null; url: string; onSite: boolean }[]
    tourDates: { date: string | null; venue: string | null; city: string | null; isPast: boolean }[]
    releases: { title: string; releasedOn: string | null }[]
    photos: { url: string; alt: string | null }[]
    publishedAt: string | null
  } | null
}

export type SeoEvidence = {
  /** The site's origin as tested: "https://www.skeenmusic.com". */
  origin: string
  gatheredAt: string
  /** Paths tested: "/" plus same-origin sitemap pages, capped. */
  paths: string[]
  /** A plain visit (no bot name): what a person's browser is sent, scripts not run. */
  plain: SeoPageFetch[]
  /** Each fetching bot's visit to each path, keyed by SeoBot.key. */
  byBot: Record<string, SeoPageFetch[]>
  robots: { status: number | null; body: string | null }
  sitemap: { status: number | null; urls: string[]; lastmods: (string | null)[] } | null
  /** The share picture the home page names, fetched: null when the page names none. */
  shareImage: { url: string; status: number | null; contentType: string | null; width: number | null; height: number | null; bytes: number | null } | null
  /** MusicBrainz's answer to "which artist links to this site / these profiles". `looked`
   *  false = we could not ask (so the test is `unknown`, not `fail`). */
  musicbrainz: { looked: boolean; artistUrl: string | null; matchedOn: string | null; error?: string }
  known: SeoKnown
}

/** One test: pure, synchronous, total. Never throws: a missing piece of evidence is `unknown`. */
export type SeoTest = (evidence: SeoEvidence) => SeoTestResult

/* ── runs ───────────────────────────────────────────────────────────────────────────── */

export type SeoRunTrigger = 'manual' | 'publish' | 'scheduled'

export type SeoTestRun = {
  id: string
  artistId: string
  ranAt: string
  trigger: SeoRunTrigger
  siteUrl: string
  /** One per SeoTestId, in SEO_TEST_IDS order. */
  results: SeoTestResult[]
}

/** The last results of one test, oldest first, for the history dots. */
export type SeoTestHistory = { ranAt: string; status: SeoTestStatus }[]
