// The sentence about a source's visitors (built, not yet placed on the page), and the rules that keep it honest.
/**
 * Every clause is derived from counts: the lead action is the one the largest
 * share of a source's VISITORS took, the fraction is that share, the comparison
 * is against the same share across every source. These tests pin each rule by
 * fixture, because a sentence that reads well and says the wrong thing is worse
 * than a number.
 */
import { describe, expect, it } from 'vitest'
import { ACTIONS, ACTION_TYPES, MIN_SAMPLE, fraction, noActors, sourceStory, versusSite, type Actors } from '@/lib/source-story'
import { EVENT_TYPES } from '@/lib/events'

const actors = (partial: Partial<Actors>): Actors => ({ ...noActors(), ...partial })
const site = { visitors: 300, actors: actors({ play: 15, link_click: 90, ticket_click: 6, buy_click: 3 }) }
// Site rates: play 5%, link 30%, ticket 2%, buy 1%.

describe('sourceStory', () => {
  it('CRITICAL: leads with the action the largest share of VISITORS took, as a fraction of visitors', () => {
    // 150 visitors: 63 clicked a link (42%), 6 played (4%). Link leads, as "4 in 10".
    const s = sourceStory('Instagram', 150, actors({ link_click: 63, play: 6 }), site)
    expect(s).toBe('Visitors from Instagram mostly click a social or streaming link: 4 in 10 do, above the site average. 1 in 25 plays a song here.')
  })

  it('CRITICAL: compares against the share across every source, not against a fixed number', () => {
    // 40 visitors, 6 played = 15%, three times the 5% site rate.
    expect(sourceStory('YouTube', 40, actors({ play: 6 }), site)).toBe(
      'Visitors from YouTube mostly play a song here: 1 in 7 do, three times the site average.',
    )
    // Same source, a site where 15% play: about average.
    expect(sourceStory('YouTube', 40, actors({ play: 6 }), { visitors: 100, actors: actors({ play: 15 }) })).toMatch(/about the site average/)
    // A site with no visitors at all has no average to compare against — even
    // if the actor tally disagrees and says someone played (6 / 0 is not "below").
    expect(sourceStory('YouTube', 40, actors({ play: 6 }), { visitors: 0, actors: actors({ play: 6 }) })).toMatch(/about the site average/)
  })

  it('says "most" from exactly half up, and a fraction just under it', () => {
    expect(sourceStory('TikTok', 20, actors({ link_click: 12 }), site)).toBe(
      'Most visitors from TikTok click a social or streaming link, twice the site average.',
    )
    expect(sourceStory('TikTok', 20, actors({ link_click: 10 }), site)).toMatch(/^Most visitors from TikTok/)
    expect(sourceStory('TikTok', 20, actors({ link_click: 9 }), site)).toMatch(/^Visitors from TikTok mostly .*: 4 in 10 do/)
  })

  it('CRITICAL: refuses to read a rate off a handful of people', () => {
    expect(sourceStory('Bing', MIN_SAMPLE - 1, actors({ play: 3 }), site)).toBe('Too few visitors from Bing yet to say what they do.')
    expect(sourceStory('Bing', MIN_SAMPLE, actors({ play: 3 }), site)).not.toMatch(/too few/i)
  })

  it('says so when nobody did anything, naming every action from the registry', () => {
    const s = sourceStory('Google', 30, noActors(), site)
    expect(s).toBe('Visitors from Google look and leave: no plays, link clicks, ticket clicks, purchases or video clicks yet.')
    for (const a of ACTIONS) expect(s).toContain(a.noun)
  })

  it('drops the second clause when the second action is under 2% — a rate of one person is not a habit', () => {
    // 200 visitors: 80 links, 3 plays (1.5%).
    expect(sourceStory('Direct', 200, actors({ link_click: 80, play: 3 }), site)).not.toMatch(/song/)
    // 4 plays (2%) makes it.
    expect(sourceStory('Direct', 200, actors({ link_click: 80, play: 4 }), site)).toMatch(/1 in 50 plays a song here\.$/)
  })

  it('the second clause agrees in number: "1 in N plays", "N in 10 play", "Most also play"', () => {
    expect(sourceStory('Direct', 20, actors({ link_click: 14, play: 11 }), site)).toMatch(/Most also play a song here\.$/)
    expect(sourceStory('Direct', 20, actors({ link_click: 14, play: 10 }), site)).toMatch(/Most also play a song here\.$/)
    expect(sourceStory('Direct', 20, actors({ link_click: 14, play: 9 }), site)).toMatch(/ 4 in 10 play a song here\.$/)
    expect(sourceStory('Direct', 20, actors({ link_click: 14, play: 5 }), site), 'exactly a quarter is plural').toMatch(/ 2 in 10 play a song here\.$/)
    expect(sourceStory('Direct', 20, actors({ link_click: 14, play: 2 }), site)).toMatch(/ 1 in 10 plays a song here\.$/)
  })

  it('never reads more than everyone: actors above the visitor count clamp to "most", not 140%', () => {
    expect(sourceStory('Other', 5, actors({ play: 7 }), site)).toMatch(/^Most visitors from Other play a song here/)
  })

  it('breaks a tie in registry order, so the sentence is stable between renders', () => {
    expect(sourceStory('Direct', 20, actors({ link_click: 4, play: 4 }), site)).toMatch(/^Visitors from Direct mostly play a song here/)
  })

  it('reads "visitors from X" so every source label works — including "AI assistants"', () => {
    expect(sourceStory('AI assistants', 30, noActors(), site)).toMatch(/^Visitors from AI assistants look and leave/)
    expect(sourceStory('AI assistants', 2, noActors(), site)).toMatch(/^Too few visitors from AI assistants/)
  })

  it('CRITICAL: the actions are every event type the sites can send except view — a new type cannot vanish from the sentence', () => {
    const nonView = EVENT_TYPES.map((e) => e.type).filter((t) => t !== 'view')
    expect([...ACTION_TYPES].sort()).toEqual([...nonView].sort())
    expect(ACTIONS.some((a) => (a.type as string) === 'view')).toBe(false)
  })
})

describe('fraction', () => {
  it('is "most" from a half, tenths (rounded DOWN) from a quarter, and "1 in N" below', () => {
    expect(fraction(0.5)).toBe('most')
    expect(fraction(0.45)).toBe('4 in 10')
    expect(fraction(0.42)).toBe('4 in 10')
    expect(fraction(0.25)).toBe('2 in 10')
    expect(fraction(0.24)).toBe('1 in 4')
    expect(fraction(0.04)).toBe('1 in 25')
  })

  it('has a word for nothing rather than "1 in Infinity"', () => {
    expect(fraction(0)).toBe('none')
    expect(fraction(-1)).toBe('none')
    expect(fraction(NaN)).toBe('none')
  })
})

describe('versusSite', () => {
  it('names the multiple from twice up, and the direction inside that', () => {
    expect(versusSite(0.1, 0.05)).toBe('twice the site average')
    expect(versusSite(5, 2), '2.5× rounds up to three').toBe('three times the site average')
    expect(versusSite(0.15, 0.05)).toBe('three times the site average')
    expect(versusSite(0.2, 0.05)).toBe('4 times the site average')
    expect(versusSite(0.07, 0.05)).toBe('above the site average')
    expect(versusSite(0.0625, 0.05), 'exactly 1.25× is above').toBe('above the site average')
    expect(versusSite(0.05, 0.05)).toBe('about the site average')
    expect(versusSite(0.041, 0.05)).toBe('about the site average')
    expect(versusSite(0.4, 0.5), 'exactly 0.8× is below').toBe('below the site average')
    expect(versusSite(0.04, 0.05)).toBe('below the site average')
  })

  it('has nothing to compare against when no one on the site did the thing', () => {
    expect(versusSite(0.1, 0)).toBe('about the site average')
  })
})
