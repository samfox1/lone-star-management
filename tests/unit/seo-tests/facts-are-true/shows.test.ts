/**
 * Proves the "Your show dates are up to date" test fails a past show listed as coming up or a
 * date search engines can't read, and checks the upcoming shows on the fact card match Tour.
 *
 * Code:     src/lib/seo-tests/facts.ts (`shows`), reading dates with src/lib/seo-tests/html.ts (`dayOf`)
 * Feature:  SEO test `shows` · Test tab "Facts are true" (source: Tour)
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted JSON-LD from the live site and
 *           compares it with Tour; a wrong date sends fans to the wrong night.
 * Covers:   • upcoming shows that match Tour pass; none anywhere passes as "none booked"
 *           • a past show still listed fails, naming it; a show today, tonight in a US city
 *             (already "tomorrow" in UTC), or still running is not past; a cancelled one is ignored
 *           • a date in any other format, an impossible date or none fails as unreadable
 *           • a Tour show missing from the site, or a site show Tour lacks, fails; a Tour show
 *             with no city is left out and said
 *           • unknown when the card can't be read or today's date isn't known
 * Not here: nothing published, a home page cut at the read cap, or unreachable (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site whose card lists one upcoming show, Oct 15 2026,
 *           matching Tour; today is 2026-09-28); `event` builds a show. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { FACTS_TESTS } from '@/lib/seo-tests/facts'
import { evidence, expectPlainWords, graphBlock, healthyGraph, homeHtml, known, rowOf, type Graph } from '@tests/helpers/seo/page-fixture'

const s = FACTS_TESTS.shows
const withGraph = (graph: Graph, more: Parameters<typeof evidence>[0] = {}) => evidence({ home: homeHtml({ ld: [graphBlock(graph)] }), ...more })
/** A show in `city` starting `startDate`, with `more` fields. */
const event = (startDate: unknown, city = 'Chicago', more: Record<string, unknown> = {}) => ({
  '@type': 'MusicEvent', name: `Skeen at X, ${city}`, ...(startDate === undefined ? {} : { startDate }), location: { '@type': 'Place', name: 'X', address: { '@type': 'PostalAddress', addressLocality: city } }, ...more,
})
/** The healthy card with its show swapped for `events`; Tour empty; today 2026-09-29. */
const onlyShows = (...events: Record<string, unknown>[]) => withGraph([...healthyGraph().filter((n) => n['@type'] !== 'MusicEvent'), ...events], { known: known({ today: '2026-09-29' }, { tourDates: [] }) })

describe('shows that are up to date pass', () => {
  // The one exact-wording check: the upcoming show matches Tour and nothing old is listed.
  it('passes when the upcoming shows match Tour', () => {
    const r = s(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe('1 upcoming')
    expect(r.sentence).toBe('Your 1 upcoming show matches Tour, and no old shows are listed as coming up.')
    expectPlainWords(r)
  })

  // No shows on the card and none in Tour: nothing to get wrong, said as "none booked".
  it('passes with no shows anywhere', () => {
    const r = s(withGraph(healthyGraph().filter((n) => n['@type'] !== 'MusicEvent'), { known: known({}, { tourDates: [] }) }))
    expect(r.status).toBe('pass')
    expect(r.value).toBe('none booked')
  })

  // A start with a time and zone matches Tour's date.
  it('matches a start given with a time and zone', () => {
    expect(s(withGraph([...healthyGraph().filter((n) => n['@type'] !== 'MusicEvent'), event('2026-10-15T21:00:00-05:00')])).status).toBe('pass')
  })

  // A show with no city in Tour is not expected on the card (search engines need a place), but the details say it was left out.
  it('does not expect a Tour show with no city, and says so', () => {
    const k = known({}, { tourDates: [...known().published!.tourDates, { date: '2026-11-01', venue: 'TBA', city: null, isPast: false }] })
    const r = s(evidence({ known: k }))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'in Tapir: left out (no city)')).toMatch(/Nov 1, 2026/)
  })

  // With no shows on the card and only a city-less show in Tour, the pass sentence still says Tour has one with no city. (verify-found SH4)
  it('says so in the sentence when the only Tour show has no city', () => {
    const e = onlyShows()
    e.known = known({ today: '2026-09-29' }, { tourDates: [{ date: '2026-11-01', venue: 'TBA', city: null, isPast: false }] })
    const r = s(e)
    expect(r.status).toBe('pass')
    expect(r.sentence).toMatch(/no city/)
  })
})

describe('an old show listed as coming up fails', () => {
  // A past show still listed as coming up fails, and the details name its date.
  it('fails a past show still listed', () => {
    const r = s(withGraph([...healthyGraph(), event('2026-09-01')]))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('1 old show')
    expect(rowOf(r, 'past, listed as coming up')).toMatch(/Sep 1, 2026/)
    expectPlainWords(r)
  })

  // A show today is upcoming, and one that started earlier but is still running (an end date) is not old.
  it('treats a show today as upcoming, and a running one as not old', () => {
    const k = known({}, { tourDates: [{ date: '2026-10-15', venue: 'Smartbar', city: 'Chicago', isPast: false }, { date: '2026-09-28', venue: 'X', city: 'Chicago', isPast: false }, { date: '2026-09-27', venue: 'Fest', city: 'Chicago', isPast: false }] })
    const r = s(withGraph([...healthyGraph(), event('2026-09-28'), event('2026-09-27', 'Chicago', { endDate: '2026-09-29' })], { known: k }))
    expect(r.status).toBe('pass')
  })

  // Tonight's 10pm show in Chicago is already "tomorrow" in UTC: it is not past. (verify-found SH1)
  it('does not call tonight’s show past', () => {
    expect(s(onlyShows(event('2026-09-28T22:00:00-05:00'))).status).toBe('pass')
  })

  // A show two days ago is past: the one day of grace does not stretch. (verify-found SH1)
  it('calls a show two days ago past', () => {
    expect(s(onlyShows(event('2026-09-27'))).status).toBe('fail')
  })

  // A cancelled past show is not "listed as coming up".
  it('ignores a cancelled past show', () => {
    const r = s(withGraph([...healthyGraph(), event('2026-09-01', 'Chicago', { eventStatus: 'https://schema.org/EventCancelled' })]))
    expect(r.status).toBe('pass')
    expect(rowOf(r, 'past, listed as coming up')).toBeUndefined()
  })

  // A date written another way, an impossible date, or none is never skipped silently: search engines can't read it. (verify-found SH2)
  it.each(['08/01/2026', '2026-8-1', 'October 10, 2026', '2026-02-30', undefined])('fails a show dated "%s" as unreadable', (d) => {
    const r = s(onlyShows(event(d)))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'dates search engines can’t read')).toBeTruthy()
  })
})

describe('the site and Tour must agree', () => {
  // An upcoming Tour show missing from the site fails, named as Tapir's.
  it('fails an upcoming Tour show missing from the site', () => {
    const k = known({}, { tourDates: [...known().published!.tourDates, { date: '2026-11-01', venue: 'Miramar', city: 'Milwaukee', isPast: false }] })
    const r = s(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'in Tapir: in Tour, not on your site')).toMatch(/Milwaukee/)
  })

  // A show on the site that Tour no longer has as upcoming (marked past or cancelled) fails, and is named.
  it('fails a show on the site that Tour does not have', () => {
    const k = known({}, { tourDates: [{ date: '2026-10-15', venue: 'Smartbar', city: 'Chicago', isPast: true }] })
    const r = s(evidence({ known: k }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'on your site, not in Tour')).toMatch(/Oct 15, 2026/)
  })
})

describe('when it can’t tell', () => {
  // A fact card that doesn't parse may hide shows, and a run that doesn't know today can't say past: both "couldn't check".
  it('is unknown with a card that can’t be read, or no date for today', () => {
    expect(s(evidence({ home: homeHtml({ ld: ['<script type="application/ld+json">{oops</script>'] }) })).status).toBe('unknown')
    expect(s(evidence({ known: known({ today: 'soon' }) })).status).toBe('unknown')
  })
})
