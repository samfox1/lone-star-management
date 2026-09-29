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
import { failingInPriority, type SeoOverview, type SeoTimelineEvent, type SeoTestChange } from '@/lib/seo-tests/overview'
import { SEO_TEST_DEFS } from '@/lib/seo-tests/defs'
import type { SeoRunTrigger, SeoTestId, SeoTestStatus } from '@/lib/seo-tests/types'
import type { IconName } from '@/components/ui/icons'
import type { TestTabData } from '../test/load'
import { countResults, hasNoSite, isStale } from '../test/model'

/* ── the to-do list ──────────────────────────────────────────────────────────────────── */

/** A to-do's mark: one of the app's icons, or a platform's own mark (bridge social-icons). */
export type TodoMark = { icon: IconName } | { platform: string }

/**
 * Each test as a to-do: what to DO about it (r2's "Create your MusicBrainz page"), and its
 * mark. Words for the GOAL, never for one cause: a test can miss for several reasons (a bio
 * that is short or missing), and "Grow your bio" is true of every one of them. The row shows
 * the result's own short value beside it ("288 of 2,500"), which names the cause.
 *
 * A Record over the id union, so a new test is a compile error here until it has words.
 */
export const TODO: Record<SeoTestId, { title: string; mark: TodoMark }> = {
  allowed: { title: 'Let search engines list you', mark: { icon: 'eye' } },
  google: { title: 'Let Google into your site', mark: { icon: 'globe' } },
  bing: { title: 'Let Bing and Copilot in', mark: { icon: 'globe' } },
  words: { title: 'Put your words in the page itself', mark: { icon: 'text' } },
  chatgpt: { title: 'Let ChatGPT read your site', mark: { icon: 'globe' } },
  claude: { title: 'Let Claude read your site', mark: { icon: 'globe' } },
  perplexity: { title: 'Let Perplexity read your site', mark: { icon: 'globe' } },
  others: { title: 'Let Gemini, Apple and other AI in', mark: { icon: 'globe' } },
  list: { title: 'Give Google a list of your pages', mark: { icon: 'list' } },
  title: { title: 'Say who you are in your page title', mark: { icon: 'search' } },
  desc: { title: 'Sum yourself up in your description', mark: { icon: 'note' } },
  bio: { title: 'Grow your bio', mark: { icon: 'text' } },
  place: { title: 'Say where you’re based', mark: { icon: 'map' } },
  genre: { title: 'Name your sound', mark: { icon: 'tracks' } },
  card: { title: 'Fix your fact card', mark: { icon: 'note' } },
  share: { title: 'Fix your share picture', mark: { icon: 'photo' } },
  preview: { title: 'Fix your link preview', mark: { icon: 'links' } },
  profiles: { title: 'List all your profiles', mark: { icon: 'plug' } },
  apple: { title: 'Fix your Apple Music link', mark: { platform: 'apple music' } },
  shows: { title: 'Bring your show dates up to date', mark: { icon: 'tour' } },
  releases: { title: 'List your latest releases', mark: { icon: 'releases' } },
  alt: { title: 'Describe your photos', mark: { icon: 'photo' } },
  mb: { title: 'Create your MusicBrainz page', mark: { platform: 'musicbrainz' } },
  bingwm: { title: 'Link Bing Webmaster Tools', mark: { icon: 'analytics' } },
}

/* ── the headline ────────────────────────────────────────────────────────────────────── */

/**
 * What the top of the timeline says, one state each, in the order they are decided:
 *   off       testing isn't switched on (its table isn't there yet)
 *   error     the results couldn't be read
 *   noSite    no site is connected, or the last run had none
 *   never     switched on, never tested
 *   needs     N things need you
 *   clear     every test that applies passes (couldn't-checks said beside it, never hidden)
 */
export type Headline =
  | { kind: 'off' }
  | { kind: 'error' }
  | { kind: 'noSite' }
  | { kind: 'never'; tests: number }
  | { kind: 'needs'; fail: number; unknown: number }
  | { kind: 'clear'; pass: number; applicable: number; unknown: number }

export function headlineText(h: Headline): string {
  switch (h.kind) {
    case 'off':
      return 'Testing isn’t switched on yet'
    case 'error':
      return 'Couldn’t read the test results'
    case 'noSite':
      return 'No site connected'
    case 'never':
      return 'Not tested yet'
    case 'needs':
      return h.fail === 1 ? '1 thing needs you' : `${h.fail} things need you`
    case 'clear':
      return h.applicable === 1 ? 'Your 1 test passes' : `All ${h.applicable} tests pass`
  }
}

/** The quiet line under the headline, or null. */
export function headlineSub(h: Headline): string | null {
  switch (h.kind) {
    case 'never':
      return `${h.tests} tests · about a minute`
    case 'noSite':
      return 'There’s nothing to test until a site is connected.'
    case 'needs':
    case 'clear':
      return h.unknown ? `${h.unknown} couldn’t be checked` : null
    default:
      return null
  }
}

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
  if (total === 0) return 'No test applied.'
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

export type OverviewView = {
  headline: Headline
  /** The tests that need you, most important first (overview.ts `failingInPriority`). */
  todo: TodoItem[]
  /** A test is running right now (a publish's, or one started on the Test tab). */
  running: boolean
  /** The last run may have seen the site before it caught up with the publish. */
  stale: boolean
  /** What happened, newest first. null = couldn't be read (a half list would hide things). */
  events: OverviewEvent[] | null
  /** The newest publish, when the full list can't be read (testing not switched on yet):
   *  said alone, so the page still shows what it can. */
  lastPublishedAt: string | null
  /** The last 30 days. null = couldn't be read, shown as "—", never 0. */
  visits: { search: number | null; ai: number | null }
}

/**
 * The Overview from what the page read: the Test tab's own read (`loadTestTab`, which alone can
 * tell "not switched on" from "couldn't read") for the headline and the to-do list, and the
 * overview reader for the timeline and the visits. `overview` null = that read failed whole.
 */
export function buildOverview(input: { tab: TestTabData; overview: SeoOverview | null; siteConnected: boolean }): OverviewView {
  const { tab, overview, siteConnected } = input
  const latest = tab.state === 'ready' ? tab.latest : null
  const tested = !!latest && !hasNoSite(latest)
  const counts = tested ? countResults(latest.results) : null

  let headline: Headline
  if (tab.state === 'off') headline = { kind: 'off' }
  else if (!siteConnected) headline = { kind: 'noSite' }
  else if (tab.state === 'error') headline = { kind: 'error' }
  // Never tested, or tested only before a site was connected: nothing real to report yet.
  else if (!counts) headline = { kind: 'never', tests: SEO_TEST_DEFS.length }
  else if (counts.fail) headline = { kind: 'needs', fail: counts.fail, unknown: counts.unknown }
  else headline = { kind: 'clear', pass: counts.pass, applicable: counts.applicable, unknown: counts.unknown }

  const todo: TodoItem[] =
    tested && headline.kind === 'needs' ? failingInPriority(latest.results).filter((r) => r.status === 'fail').map((r) => ({ id: r.id, value: r.value ?? '' })) : []

  const events = overview?.timeline ? mergeTimeline(overview.timeline) : null
  return {
    headline,
    todo,
    running: !!overview?.running || (tab.state === 'ready' && !!tab.running),
    stale: tested && isStale(latest),
    events,
    lastPublishedAt: events ? null : (overview?.lastPublishedAt ?? null),
    visits: { search: overview?.visits.search ?? null, ai: overview?.visits.ai ?? null },
  }
}
