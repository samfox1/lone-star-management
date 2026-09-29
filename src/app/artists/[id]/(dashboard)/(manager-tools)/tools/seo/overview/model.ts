/**
 * THE OVERVIEW'S WORDS AND ARITHMETIC, pure (Sam, 2026-09-28: round 2's "Overview 3 ·
 * Timeline", prototypes/seo_variants_20260928_r2.html: what needs you now, then what happened
 * since you last published, then visits over 30 days). No DOM, no clock of its own: every time
 * comes in as an argument, so each sentence the tab shows is testable without rendering.
 *
 * Everything here is a READ of what lib/seo-tests/overview.ts returns. Nothing is invented:
 * there is no weekly test (nothing schedules one yet), so no "weekly test" line is ever made,
 * and a number that could not be read stays null and shows as "—", never 0.
 */
import { SEO_TEST_PRIORITY, type SeoOverview, type SeoTimelineEvent, type SeoTestChange } from '@/lib/seo-tests/overview'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoRunTrigger, SeoTestId, SeoTestResult, SeoTestStatus } from '@/lib/seo-tests/types'
import type { IconName } from '@/components/ui/icons'
import type { TestTabData } from '../test/load'
import { cooldownEnd, countResults, hasNoSite, hostOf, oldRunText, runHeadline, showStale, siteChanged, type RunHeadline } from '../test/model'

/* ── the to-do list ──────────────────────────────────────────────────────────────────── */

/** A to-do's mark: one of the app's icons, or a platform's own mark (bridge social-icons). */
export type TodoMark = { icon: IconName } | { platform: string }

/**
 * Each test as a to-do: what to DO about it (r2's "Create your MusicBrainz page"), and its
 * mark. ONE table, one title per test (Sam reads these). Words for the GOAL, never for one
 * cause: a test can miss for several reasons (a bio that is missing, or one that doesn't
 * name the genre, the city or a highlight), and "Add key facts to your bio" is true of every
 * one of them. The row shows the result's own short value beside it, which names the cause.
 * The bot tests only prove the site's own settings
 * don't turn a visitor away, so their to-dos say "let … in", never "read" (the UI review,
 * 2026-09-29, wording table A).
 *
 * `bingwm` can never be a to-do today (the test passes or says "couldn't check", never
 * "needs you"); it keeps a title so the table stays whole.
 *
 * A Record over the id union, so a new test is a compile error here until it has words.
 */
export const TODO: Record<SeoTestId, { title: string; mark: TodoMark }> = {
  allowed: { title: 'Let search engines list you', mark: { icon: 'eye' } },
  google: { title: 'Let Google into your site', mark: { icon: 'globe' } },
  bing: { title: 'Let Bing and Copilot in', mark: { icon: 'globe' } },
  chatgpt: { title: 'Let ChatGPT in', mark: { icon: 'globe' } },
  claude: { title: 'Let Claude in', mark: { icon: 'globe' } },
  perplexity: { title: 'Let Perplexity in', mark: { icon: 'globe' } },
  others: { title: 'Let Gemini, Apple and other AI in', mark: { icon: 'globe' } },
  list: { title: 'Give Google a list of your pages', mark: { icon: 'list' } },
  words: { title: 'Write your bio, releases and shows on your pages', mark: { icon: 'text' } },
  bingwm: { title: 'Link Bing Webmaster Tools', mark: { icon: 'analytics' } },
  title: { title: 'Say who you are in your page title', mark: { icon: 'search' } },
  desc: { title: 'Sum yourself up in your description', mark: { icon: 'note' } },
  bio: { title: 'Add key facts to your bio', mark: { icon: 'text' } },
  genre: { title: 'Name your genre', mark: { icon: 'tracks' } },
  place: { title: 'Say where you’re based', mark: { icon: 'map' } },
  mb: { title: 'Create your MusicBrainz page', mark: { platform: 'musicbrainz' } },
  share: { title: 'Fix your preview picture', mark: { icon: 'photo' } },
  preview: { title: 'Fix your link preview', mark: { icon: 'links' } },
  alt: { title: 'Describe your photos', mark: { icon: 'photo' } },
  profiles: { title: 'List all your profiles', mark: { icon: 'plug' } },
  apple: { title: 'Fix your Apple Music link', mark: { platform: 'apple music' } },
  shows: { title: 'Bring your show dates up to date', mark: { icon: 'tour' } },
  releases: { title: 'List your latest releases', mark: { icon: 'releases' } },
  card: { title: 'Fix the facts your site gives search engines', mark: { icon: 'note' } },
}

/* ── the headline ────────────────────────────────────────────────────────────────────── */

/**
 * What the top of the timeline says. A finished run is said through the Test tab's own helper
 * (test/model.ts `runHeadline`: "N of M tests pass", `na` out of both sides, never "All M pass"
 * while anything couldn't be checked; "We couldn't reach your site" when it didn't answer), so
 * the two tabs never disagree about one run. Around it, the states only the Overview has:
 *   off      testing isn't switched on (its table isn't there yet)
 *   noSite   no site is connected
 *   error    the results couldn't be read
 *   never    never tested (or tested only before a site was connected)
 *   moved    the site's address changed since the last test: its results are the old site's
 *   run      the latest run, and how many of its tests need you
 */
export type Headline =
  | { kind: 'off' }
  | { kind: 'error' }
  | { kind: 'noSite' }
  | { kind: 'never'; tests: number }
  | { kind: 'moved'; tested: string; now: string }
  | { kind: 'run'; run: RunHeadline; fail: number }

export function headlineText(h: Headline): string {
  switch (h.kind) {
    case 'off':
      return 'Site tests are coming soon'
    case 'error':
      return 'Couldn’t read the test results'
    case 'noSite':
      return 'No site connected'
    case 'never':
      return 'Not tested yet'
    case 'moved':
      return 'Your site’s address changed'
    case 'run':
      // r2's "5 things need you" leads when something does; otherwise the run's own words.
      if (h.run.kind === 'score' && h.fail) return h.fail === 1 ? '1 thing needs you' : `${h.fail} things need you`
      return h.run.title
  }
}

/** The quiet line under the headline, or null. */
export function headlineSub(h: Headline): string | null {
  switch (h.kind) {
    case 'off':
      return 'Nothing for you to do.'
    case 'never':
      return `${h.tests} tests · about a minute`
    case 'noSite':
      return 'There’s nothing to test until a site is connected.'
    case 'moved':
      return `These results are for ${h.tested}, an old address. Test again to check ${h.now}.`
    case 'run': {
      // The score always shows; "N need you" is the headline already, so it isn't repeated.
      const detail = h.run.kind === 'score' && h.fail ? h.run.detail.slice(1) : h.run.detail
      const line = h.run.kind === 'score' && h.fail ? [h.run.title, ...detail] : detail
      return line.length ? line.join(' · ') : null
    }
    default:
      return null
  }
}

/** Results most important first (overview.ts SEO_TEST_PRIORITY). */
const byPriority = (a: SeoTestResult, b: SeoTestResult) => (SEO_TEST_PRIORITY[a.id] ?? 99) - (SEO_TEST_PRIORITY[b.id] ?? 99)

/* ── the timeline ────────────────────────────────────────────────────────────────────── */

type TestEvent = Extract<SeoTimelineEvent, { kind: 'test' }>
type PublishEvent = Extract<SeoTimelineEvent, { kind: 'publish' }>

/** A row of the timeline as the page draws it: a publish, a test, or a publish and the test
 *  it set off, said as one moment ("You published. We tested your site."). */
export type OverviewEvent = { kind: 'publish'; at: string; publish: PublishEvent } | { kind: 'test'; at: string; test: TestEvent; publish: PublishEvent | null }

/** How long after a publish its own test can start and still be "the test it set off". A
 *  publish's run waits for the site to update first, so it is minutes, not seconds, later. */
export const PUBLISH_TEST_WINDOW_MS = 15 * 60_000

/**
 * The events, newest first, with each test that a publish set off (`trigger: 'publish'`)
 * joined to the NEAREST publish before it, inside the window. A publish joins one test at
 * most; a test run by hand is never joined, even right after a publish.
 */
export function mergeTimeline(events: readonly SeoTimelineEvent[]): OverviewEvent[] {
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const joined = new Set<PublishEvent>()
  const partner = new Map<TestEvent, PublishEvent>()
  for (const e of sorted) {
    if (e.kind !== 'test' || e.trigger !== 'publish') continue
    const at = Date.parse(e.at)
    let best: PublishEvent | null = null
    for (const p of sorted) {
      if (p.kind !== 'publish' || joined.has(p)) continue
      const pt = Date.parse(p.at)
      if (!(pt <= at && at - pt <= PUBLISH_TEST_WINDOW_MS)) continue
      if (!best || pt > Date.parse(best.at)) best = p
    }
    if (best) {
      joined.add(best)
      partner.set(e, best)
    }
  }
  const out: OverviewEvent[] = []
  for (const e of sorted) {
    if (e.kind === 'publish') {
      if (!joined.has(e)) out.push({ kind: 'publish', at: e.at, publish: e })
    } else {
      out.push({ kind: 'test', at: e.at, test: e, publish: partner.get(e) ?? null })
    }
  }
  return out
}

const TEST_SAID: Record<SeoRunTrigger, string> = {
  manual: 'You tested your site.',
  publish: 'We tested your site after you published.',
  scheduled: 'We tested your site.',
}

/** The event's bold line. */
export function eventTitle(e: OverviewEvent): string {
  if (e.kind === 'publish') return 'You published.'
  if (e.publish) return 'You published. We tested your site.'
  return TEST_SAID[e.test.trigger]
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** The event's quiet line: what went live, or how the test went. */
export function eventLine(e: OverviewEvent): string {
  if (e.kind === 'publish') {
    const n = e.publish.changed
    return `${n} ${plural(n, 'change', 'changes')} went live.`
  }
  const { passed, total } = e.test
  if (total === 0) return 'Nothing to count.'
  return total === 1 ? `${passed} of 1 test passes.` : `${passed} of ${total} tests pass.`
}

/** What a change says about a test: "now passes", "now needs you". */
export const CHANGE_WORD: Record<SeoTestStatus, string> = {
  pass: 'now passes',
  fail: 'now needs you',
  unknown: 'couldn’t be checked',
  na: 'no longer applies',
}

/** A run's changes, as the event lists them: at most `max`, and how many more there are. */
export function changesShown(changes: readonly SeoTestChange[] | null, max = 3): { shown: SeoTestChange[]; more: number } | null {
  if (changes === null) return null
  return { shown: changes.slice(0, max), more: Math.max(0, changes.length - max) }
}

/* ── visits ──────────────────────────────────────────────────────────────────────────── */

/** A count as shown: null (couldn't read) is "—", never 0. */
export function countText(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US')
}

/* ── times, in the manager's own time zone ───────────────────────────────────────────── */

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * The timeline's left column: the day ("Today", "Yesterday", "Sep 21") and the time
 * ("9:14 PM"). null for a date that doesn't parse.
 */
export function whenParts(iso: string, now: Date, locale?: string): { day: string; time: string } | null {
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return null
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  const day = sameDay(at, now)
    ? 'Today'
    : sameDay(at, y)
      ? 'Yesterday'
      : at.toLocaleDateString(locale, at.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return { day, time: at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) }
}

/* ── the whole view ──────────────────────────────────────────────────────────────────── */

export type TodoItem = { id: SeoTestId; value: string }
/** A couldn't-check, with why: the result's own sentence, starting with a capital. */
export type UnknownItem = { id: SeoTestId; why: string }

/** The Test tab's words for these states (test/test-tab.tsx COPY), so both tabs say one thing. */
export const STALE_WORDS = 'Your site may not have updated yet. Test again in a minute.'
export const oldWords = (ago: string) => `Last tested ${ago}. Test again to see where you stand now.`
export const failedWords = (when: string) => `Your last test${when ? `, ${when},` : ''} couldn’t finish. Test again in a minute.`

export type OverviewView = {
  headline: Headline
  /** The tests that need you, most important first. Never a "couldn't check", and none at all
   *  when the site didn't answer (the headline says that once). */
  todo: TodoItem[]
  /** Tests that couldn't be checked, most important first, with the short why each one gave.
   *  Said apart from the to-dos: they blame nobody. Only beside a real score. */
  unknown: UnknownItem[]
  /** A test is running right now (a publish's, or one started on the Test tab). */
  running: boolean
  /** The last run may have seen the site before it caught up with the publish (a fresh run). */
  stale: boolean
  /** "6 weeks ago", for a run older than the timeline reaches; else null. */
  oldRun: string | null
  /** A test that didn't finish, newer than the results shown. */
  failedAt: string | null
  /** What happened, newest first. null = couldn't be read (a half list would hide things). */
  events: OverviewEvent[] | null
  /** The newest publish, when the full list can't be read (testing not switched on yet):
   *  said alone, so the page still shows what it can. */
  lastPublishedAt: string | null
  /** The last 30 days. null = couldn't be read, shown as "—", never 0. */
  visits: { search: number | null; ai: number | null }
  /** "Test again" from the Overview: whether it can run, and the cool-down it would meet. */
  test: { can: boolean; cooldownEnd: number | null }
}

/**
 * The Overview from what the page read: the Test tab's own read (`loadTestTab`: "not switched
 * on" vs "couldn't read", the latest run, a newer failed attempt) for the headline and the lists,
 * the overview reader for the timeline and the visits, and the site's address NOW. `overview`
 * null = that read failed whole.
 */
export function buildOverview(input: {
  tab: TestTabData
  overview: SeoOverview | null
  /** The address a test would visit now (known.ts `seoSiteOrigin`), or null: no site. */
  siteUrl: string | null
  nowMs?: number
}): OverviewView {
  const { tab, overview, siteUrl } = input
  const nowMs = input.nowMs ?? Date.now()
  const ready = tab.state === 'ready' ? tab : null
  const latest = ready?.latest ?? null
  const tested = !!latest && !hasNoSite(latest)

  let headline: Headline
  if (tab.state === 'off') headline = { kind: 'off' }
  else if (!siteUrl) headline = { kind: 'noSite' }
  else if (tab.state === 'error') headline = { kind: 'error' }
  // Never tested, or tested only before a site was connected: nothing real to report yet.
  else if (!tested) headline = { kind: 'never', tests: SEO_TEST_DEFS.length }
  else if (siteChanged(latest.siteUrl, siteUrl)) headline = { kind: 'moved', tested: hostOf(latest.siteUrl), now: hostOf(siteUrl) }
  else headline = { kind: 'run', run: runHeadline(latest), fail: countResults(latest.results).fail }

  // Lists only beside a real score: not when the site didn't answer, nothing applied, or the
  // results are another address's.
  const scored = headline.kind === 'run' && headline.run.kind === 'score'
  const results = scored && latest ? latest.results : []
  const todo = results.filter((r) => r.status === 'fail').sort(byPriority).map((r) => ({ id: r.id, value: r.value ?? '' }))
  const unknown = results
    .filter((r) => r.status === 'unknown')
    .sort(byPriority)
    .map((r) => {
      const why = typeof r.sentence === 'string' ? r.sentence.trim() : ''
      return { id: r.id, why: why ? why.charAt(0).toUpperCase() + why.slice(1) : '' }
    })

  const events = overview?.timeline ? mergeTimeline(overview.timeline) : null
  const failed = ready?.lastFailed ?? null
  const failedAt = failed && (!latest || Date.parse(failed.ranAt) > Date.parse(latest.ranAt)) ? failed.ranAt : null
  const running = !!overview?.running || !!ready?.running
  return {
    headline,
    todo,
    unknown,
    running,
    stale: tested && headline.kind === 'run' && headline.run.kind === 'score' && showStale(latest, nowMs),
    oldRun: tested ? oldRunText(latest.ranAt, nowMs) : null,
    failedAt,
    events,
    lastPublishedAt: events ? null : (overview?.lastPublishedAt ?? null),
    visits: { search: overview?.visits.search ?? null, ai: overview?.visits.ai ?? null },
    test: { can: !!ready && !!siteUrl && !running, cooldownEnd: cooldownEnd(latest?.ranAt) },
  }
}
