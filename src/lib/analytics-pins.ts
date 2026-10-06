/**
 * The moments the Analytics chart pins (the r12 mock's markers above the lines), worked out
 * from the window's own numbers, so a pin never claims what the pipeline did not record (Sam,
 * 2026-09-13: only what is trackable):
 *
 *   counting  the day visitors were first counted (and bots first filtered), when that day falls
 *             inside the window, after its first day: before it, those lines do not exist.
 *   busiest   the day with the most views, in a window of a week or more (the first of a tie).
 *   bots      the day with the most bots filtered, when it is a SPIKE: at least 10, and at least
 *             three times the usual day. The usual day is taken over the days bots were counted;
 *             the zeros before counting began are not quiet days.
 *
 * Each pin names the line it sits on (`series`), so the chart can hide it when that line is off.
 * In day order; on one day, in the order above.
 */
export type PinKind = 'counting' | 'busiest' | 'bots'
export type ChartPin = { day: string; kind: PinKind; series: 'views' | 'visitors' | 'bots'; title: string; note: string }


const MIN_BUSIEST_DAYS = 7
const MIN_BOT_SPIKE = 10
const BOT_SPIKE_TIMES = 3

export function analyticsPins({ days, views, bots, countedSince }: {
  days: string[]
  views: number[]
  bots: number[]
  /** The first day visitors and bots were counted (CONTEXT_SINCE). */
  countedSince?: string
}): ChartPin[] {
  // Pushed in the order a day's pins show in; the sort below keeps that order within a day.
  const pins: ChartPin[] = []
  if (countedSince && countedSince > days[0] && countedSince <= days[days.length - 1]) {
    pins.push({ day: countedSince, kind: 'counting', series: 'visitors', title: 'Visitors counted from here', note: 'and bots filtered' })
  }

  const most = Math.max(0, ...views)
  if (days.length >= MIN_BUSIEST_DAYS && most > 0) {
    pins.push({ day: days[views.indexOf(most)], kind: 'busiest', series: 'views', title: `Busiest day: ${most.toLocaleString('en-US')} views`, note: '' })
  }

  // Bots over the days they were counted only; none at all when the window ends before counting began.
  const from = countedSince ? days.findIndex((d) => d >= countedSince) : 0
  const counted = from < 0 ? [] : bots.slice(from)
  const spike = Math.max(0, ...counted)
  const usual = counted.reduce((a, b) => a + b, 0) / Math.max(1, counted.length)
  if (spike >= MIN_BOT_SPIKE && spike >= BOT_SPIKE_TIMES * usual) {
    pins.push({ day: days[from + counted.indexOf(spike)], kind: 'bots', series: 'bots', title: `${spike.toLocaleString('en-US')} bot visits filtered`, note: 'kept out of every number' })
  }

  // Stable, so pins on one day keep the order they were pushed in.
  return pins.sort((a, b) => a.day.localeCompare(b.day))
}
