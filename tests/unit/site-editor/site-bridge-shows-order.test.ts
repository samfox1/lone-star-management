// The one law for which shows are past and what order they appear in, editor and site alike.
/**
 * THE SHOWS ORDER LAW — proved here, consumed by every connected site.
 *
 * It lives in the bridge for the reason `orderMusicProjects` does: it was written once, in
 * ~/Desktop/skeen-website/lib/mapSite.ts, and no other site had it. The published door
 * (`get_public_site`) orders tour dates by date and `published_at` and ignores
 * `sort_order` entirely — so a site that does NOT re-implement skeen's block silently
 * drops the manager's dragged order, with nothing anywhere saying so.
 *
 * Every case below fails against that door's rule (date only), which is what a second site
 * would have shipped. Verified 2026-09-18 against a naive date-only implementation: all
 * nine assertions in `orderShows` went red, each for its own reason.
 */
import { describe, expect, it } from 'vitest'
import { isPastShow, orderShows } from '@samfox1/site-bridge/shows'

const TODAY = '2026-09-18'

/** Venue names double as ids, and the dates are deliberately out of insertion order so a
 *  date sort and "whatever order the payload held" can never agree by accident. */
const OLD = { venue: 'old', date: '2024-03-01', sort_order: null }
const RECENT = { venue: 'recent', date: '2026-08-02', sort_order: null }
const SOON = { venue: 'soon', date: '2026-10-05', sort_order: null }
const LATER = { venue: 'later', date: '2027-01-20', sort_order: null }
/** The scenario this whole law exists for (Sam, 2026-09-18): a PAST show with no date. */
const LOST = { venue: 'lost', date: null, is_past: true, sort_order: null }
/** No date, not flagged — announced, date TBA. */
const TBA = { venue: 'tba', date: null, sort_order: null }

const names = (shows: { venue: string }[]) => shows.map((s) => s.venue)

describe('isPastShow', () => {
  it('a date that has passed is past, flag or no flag', () => {
    expect(isPastShow({ date: '2024-03-01' }, TODAY)).toBe(true)
    expect(isPastShow({ date: '2026-10-05' }, TODAY)).toBe(false)
  })

  it("CRITICAL: the manager's flag is the ONLY way a dateless show can be past", () => {
    // There is nothing to compare, so the toggle decides. This is the scenario the law
    // was written for; without the flag arm a dateless old show is advertised as upcoming.
    expect(isPastShow({ date: null, is_past: true }, TODAY)).toBe(true)
    expect(isPastShow({ date: null }, TODAY)).toBe(false)
  })

  it('a show TODAY has not happened yet', () => {
    // Strictly-less-than, not <=: a date is a day, and the gig is tonight.
    expect(isPastShow({ date: TODAY }, TODAY)).toBe(false)
  })

  it('the flag also retires a FUTURE date (cancelled, or already played early)', () => {
    expect(isPastShow({ date: '2027-01-20', is_past: true }, TODAY)).toBe(true)
  })
})

describe('orderShows', () => {
  it('CRITICAL: a dateless FLAGGED show lands in Past, and a dateless unflagged one is upcoming TBA', () => {
    const { upcoming, past } = orderShows([LOST, TBA], TODAY)
    expect(names(past)).toEqual(['lost'])
    expect(names(upcoming)).toEqual(['tba'])
  })

  it('upcoming runs ASCENDING (the next show first), past runs DESCENDING (the last one first)', () => {
    const { upcoming, past } = orderShows([LATER, OLD, SOON, RECENT], TODAY)
    expect(names(upcoming)).toEqual(['soon', 'later'])
    expect(names(past)).toEqual(['recent', 'old'])
  })

  it('undated shows follow the dated ones, sequenced by sort_order', () => {
    const { upcoming } = orderShows(
      [
        { venue: 'tba-b', date: null, sort_order: 9 },
        { venue: 'tba-a', date: null, sort_order: 4 },
        SOON,
      ],
      TODAY,
    )
    expect(names(upcoming)).toEqual(['soon', 'tba-a', 'tba-b'])
  })

  it('CRITICAL: ONE numbered dated row puts the whole bucket in MANUAL MODE', () => {
    // Sam, 2026-08-17. The first drag renumbers the rows it touched; from then on the
    // manager's order IS the order. `later` is the FURTHEST OUT and numbered FIRST, so
    // passing this under a date sort is impossible.
    const { upcoming } = orderShows(
      [
        { ...SOON, sort_order: 1 },
        { ...LATER, sort_order: 0 },
      ],
      TODAY,
    )
    expect(names(upcoming)).toEqual(['later', 'soon'])
  })

  it('in manual mode, date only breaks ties for rows the drag never numbered', () => {
    // `soon` is numbered and wins outright; the two unnumbered rows fall in date order
    // behind it rather than in payload order.
    const { upcoming } = orderShows(
      [LATER, { venue: 'mid', date: '2026-11-11', sort_order: null }, { ...SOON, sort_order: 0 }],
      TODAY,
    )
    expect(names(upcoming)).toEqual(['soon', 'mid', 'later'])
  })

  it('KNOWN ASYMMETRY: in manual mode an UNNUMBERED dateless show sorts to the front, not the back', () => {
    // Pinned as it BEHAVES, not as it reads. Manual mode breaks ties with the date, and a
    // dateless row tie-breaks on '' — which sorts before every real date ascending. So a
    // TBA jumps ahead of the dated shows here, while the chronological branch above puts
    // undated rows last. Ported verbatim from skeen (lib/mapSite.ts), quirk included,
    // because changing it would silently re-order a live site's tour list.
    //
    // Narrow in practice: it needs a dated row numbered and a dateless row NOT, i.e. a
    // partial drag. A drag that touches every row gives them all numbers and this branch
    // never consults the date at all. Flagged for Sam, 2026-09-18 — if the answer is
    // "TBAs always last", the fix is one comparator and this test is where it goes red.
    const { upcoming } = orderShows(
      [LATER, { venue: 'tba', date: null, sort_order: null }, { ...SOON, sort_order: 0 }],
      TODAY,
    )
    expect(names(upcoming)).toEqual(['soon', 'tba', 'later'])
  })

  it('manual mode is decided PER BUCKET — a dragged past list does not renumber upcoming', () => {
    const { upcoming, past } = orderShows(
      [{ ...OLD, sort_order: 0 }, { ...RECENT, sort_order: 1 }, LATER, SOON],
      TODAY,
    )
    // Past was dragged: `old` is the OLDEST and numbered first, which descending-by-date
    // would never produce.
    expect(names(past)).toEqual(['old', 'recent'])
    // Upcoming was untouched, so it keeps the chronological default.
    expect(names(upcoming)).toEqual(['soon', 'later'])
  })

  it('an UNTOUCHED list (every sort_order null) stays chronological', () => {
    const { upcoming, past } = orderShows([SOON, OLD, LATER, RECENT], TODAY)
    expect(names(upcoming)).toEqual(['soon', 'later'])
    expect(names(past)).toEqual(['recent', 'old'])
  })

  it('a sort_order on an UNDATED row alone does not trigger manual mode', () => {
    // The trigger is a DATED row carrying a number — that is what proves a drag happened
    // over the real list. Undated rows have always carried sort_order as their only
    // sequence, and reading that as a drag would strand the dated shows behind them.
    const { upcoming } = orderShows([{ ...TBA, sort_order: 0 }, SOON, LATER], TODAY)
    expect(names(upcoming)).toEqual(['soon', 'later', 'tba'])
  })

  it('returns the callers OWN objects, and never mutates the input', () => {
    // The orderMusicProjects convention: pass your rows in, get your rows back, with
    // whatever else they carry still on them.
    const input = [SOON, OLD] as const
    const { upcoming, past } = orderShows(input, TODAY)
    expect(upcoming[0]).toBe(SOON)
    expect(past[0]).toBe(OLD)
    expect(names([...input])).toEqual(['soon', 'old'])
  })
})
