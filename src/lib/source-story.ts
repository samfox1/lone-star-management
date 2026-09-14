/**
 * One plain sentence about what a source's visitors tend to do, built from the
 * counts and nothing else. Sam, 2026-09-13: "a summarizing sentence describing
 * what each source user tends to do instead of only analytics."
 *
 * Every clause is derived: the lead action is the one the largest share of
 * visitors took, the fraction is that share, the comparison is against the same
 * share across every source. Nothing here guesses. The rates are of VISITORS
 * who acted, not of events — one person playing ten songs in a day is one
 * listener. (Visitors are daily-distinct, as everywhere on the page: the same
 * person on three days is three visitors, on both sides of every ratio.)
 *
 * Below MIN_SAMPLE visitors the sentence says so instead of reading a rate off
 * three people.
 */
import { EVENT_TYPES } from '@/lib/events'

/** Every non-view event type, with the words the sentence uses for it. */
export const ACTIONS = [
  { type: 'play', label: 'Plays', noun: 'plays', one: 'plays a song here', many: 'play a song here' },
  { type: 'link_click', label: 'Link clicks', noun: 'link clicks', one: 'clicks a social or streaming link', many: 'click a social or streaming link' },
  { type: 'ticket_click', label: 'Ticket clicks', noun: 'ticket clicks', one: 'goes for tickets', many: 'go for tickets' },
  { type: 'buy_click', label: 'Buy clicks', noun: 'purchases', one: 'clicks Buy', many: 'click Buy' },
  { type: 'video_click', label: 'Video clicks', noun: 'video clicks', one: 'clicks a video', many: 'click a video' },
] as const satisfies readonly { type: Exclude<(typeof EVENT_TYPES)[number]['type'], 'view'>; label: string; noun: string; one: string; many: string }[]
export type ActionType = (typeof ACTIONS)[number]['type']
export const ACTION_TYPES: readonly ActionType[] = ACTIONS.map((a) => a.type)

/** Distinct visitors who took each action. */
export type Actors = Record<ActionType, number>
export const noActors = (): Actors => Object.fromEntries(ACTION_TYPES.map((t) => [t, 0])) as Actors
/** Per action: events, and the distinct visitors behind them. */
export type ActionCounts = Record<ActionType, { count: number; visitors: number }>
export const noActionCounts = (): ActionCounts =>
  Object.fromEntries(ACTION_TYPES.map((t) => [t, { count: 0, visitors: 0 }])) as ActionCounts

export const MIN_SAMPLE = 5

/** `0.42` → "4 in 10", `0.04` → "1 in 25", `0.6` → "most". Tenths round DOWN, so
 *  a quarter never reads as "3 in 10" and 45% never reads as half. */
export function fraction(rate: number): string {
  if (!(rate > 0)) return 'none'
  if (rate >= 0.5) return 'most'
  if (rate >= 0.25) return `${Math.floor(rate * 10)} in 10`
  return `1 in ${Math.round(1 / rate)}`
}

const MULTIPLES: Record<number, string> = { 2: 'twice', 3: 'three times' }

/** How a source's rate sits against the rate across every source. */
export function versusSite(rate: number, siteRate: number): string {
  if (!(siteRate > 0)) return 'about the site average'
  const ratio = rate / siteRate
  if (ratio >= 2) {
    const n = Math.round(ratio)
    return `${MULTIPLES[n] ?? `${n} times`} the site average`
  }
  if (ratio >= 1.25) return 'above the site average'
  if (ratio > 0.8) return 'about the site average'
  return 'below the site average'
}

/** "no plays, link clicks, … or video clicks" — from the registry, never hand-listed. */
const NOTHING = (() => {
  const nouns = ACTIONS.map((a) => a.noun)
  return `no ${nouns.slice(0, -1).join(', ')} or ${nouns[nouns.length - 1]}`
})()

export function sourceStory(
  label: string,
  visitors: number,
  actors: Actors,
  site: { visitors: number; actors: Actors },
): string {
  if (visitors < MIN_SAMPLE) return `Too few visitors from ${label} yet to say what they do.`
  const rated = ACTIONS
    .map((a) => ({
      ...a,
      // Actors and visitors come from two tallies; a mismatch must not read as 140%.
      rate: Math.min(1, actors[a.type] / visitors),
      siteRate: site.visitors > 0 ? site.actors[a.type] / site.visitors : 0,
    }))
    .filter((a) => a.rate > 0)
    .sort((a, b) => b.rate - a.rate)
  if (rated.length === 0) return `Visitors from ${label} look and leave: ${NOTHING} yet.`

  const [lead, second] = rated
  const opening = lead.rate >= 0.5
    ? `Most visitors from ${label} ${lead.many}, ${versusSite(lead.rate, lead.siteRate)}.`
    : `Visitors from ${label} mostly ${lead.many}: ${fraction(lead.rate)} do, ${versusSite(lead.rate, lead.siteRate)}.`
  if (!second || second.rate < 0.02) return opening
  // "N in 10" is plural, "1 in N" is singular.
  const tail = second.rate >= 0.5
    ? `Most also ${second.many}.`
    : `${fraction(second.rate)} ${second.rate >= 0.25 ? second.many : second.one}.`
  return `${opening} ${tail}`
}
