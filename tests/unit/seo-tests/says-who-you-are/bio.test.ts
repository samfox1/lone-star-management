/**
 * Proves the "Your bio names your genre, city and a highlight" test finds the bio as words on
 * the pages read, and passes only when it has 100 words or more and names the genre, the city
 * and a release or show that Tapir published.
 *
 * Code:     src/lib/seo-tests/who.ts (`bio`), with src/lib/seo-tests/match.ts (word counts,
 *           sentences, whole-word matching)
 * Feature:  SEO test `bio` · Test tab "Says who you are"
 * Tier:     STRICT (AGENTS.md "Test depth"): it reads untrusted html from the live site and
 *           tells the artist what their bio is missing.
 * Covers:   • 100+ words naming all three facts passes; under 100 words or a missing fact fails,
 *             and says everything missing at once, with an example from the artist's own data
 *           • only the part of the bio a page SHOWS counts; a bio only in the fact card, or a
 *             short common sentence, is "not on your pages"
 *           • facts match as whole words, in any case and typography; a fact Tapir doesn't
 *             have is skipped and said, never held against the bio
 *           • a highlight is a release or show from Tapir, not a menu word or the home city
 *           • no bio in Tapir is said about Tapir; a page we couldn't read is "couldn't check"
 *           • scripts without spaces are counted; a sentence pasted many times counts once
 * Not here: nothing published, or no page answered (../honesty.test.ts).
 * Fixtures: tests/helpers/seo/page-fixture.ts (a healthy site with a 133-word bio on /about); `run(text)`
 *           publishes `text` as the bio and shows it on /about. Nothing is fetched.
 */
import { describe, expect, it } from 'vitest'
import { WHO_TESTS } from '@/lib/seo-tests/who'
import { LONG_BIO, aboutHtml, artistNode, evidence, expectPlainWords, graphBlock, homeHtml, known, page, rowOf } from '@tests/helpers/seo/page-fixture'

const b = WHO_TESTS.bio
const words = (s: string) => [...new Intl.Segmenter('und', { granularity: 'word' }).segment(s)].filter((x) => x.isWordLike).length
const filler = 'He films every night for a video diary about building a career in dance music from the ground up, one small room at a time, with friends.'
/** A bio made of `facts` plus distinct filler sentences until it has at least `min` words. */
const bioWith = (facts: string, min = 110) => {
  const parts = [facts]
  for (let i = 1; words(parts.join(' ')) < min; i++) parts.push(filler.replace('small room', `small room number ${i}`))
  return parts.join(' ')
}
/** A bio in Tapir written with straight quotes and dashes, and a page that shows `text`. */
const STRAIGHT = 'Skeen\'s "big" night -- the warehouse show in Chicago was loud. He played until the sun came up over the lake.'
const onPage = (text: string) => evidence({ home: homeHtml({ ld: [] }), about: `<html><body><p>${text}</p></body></html>`, known: known({}, { bio: STRAIGHT }) })
/** `text` published as the bio, in the fact card, and shown on /about. */
const run = (text: string, pub: Parameters<typeof known>[1] = {}) =>
  b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: text })])] }), about: aboutHtml(text), known: known({}, { bio: text, ...pub }) }))

describe('a bio of 100+ words with all three facts passes', () => {
  // The healthy bio: shown on /about, names House, Chicago and a release; the 100-word floor is said to be Tapir's own.
  it('passes the healthy bio, naming where it was shown and each fact found', () => {
    const r = b(evidence())
    expect(r.status).toBe('pass')
    expect(r.value).toBe(`${words(LONG_BIO)} words · 3 of 3 facts`)
    expect(rowOf(r, 'shown on')).toBe('/about')
    expect(rowOf(r, 'genre in your bio')).toMatch(/house/i)
    expect(rowOf(r, 'city in your bio')).toBe('Chicago')
    expect(rowOf(r, 'highlight in your bio')).toMatch(/OutWest|Smartbar|Navy Pier/)
    expect(r.limits).toMatch(/100-word floor is Digital Tapir[’']s own/)
    expectPlainWords(r)
  })

  // Sam, 2026-09-29: the test checks key facts, not length ("a bio of 2500 seems huge"): the old 2,500 goal must never come back.
  it('never mentions a 2,500 or a length goal', () => {
    for (const e of [evidence(), evidence({ about: aboutHtml('Short bio here about Skeen in Chicago playing house at Smartbar.') })]) {
      expect(JSON.stringify(b(e))).not.toMatch(/2,500|2500|length goal/i)
    }
  })

  // Facts match as whole words in any case and typography: "warehouse" is not "house", "Chicagoland" is not "Chicago", CAPITALS and curly quotes still match.
  it('matches facts as whole words, in any case and typography', () => {
    const r = run(bioWith('Skeen plays warehouse parties across Chicagoland. His EP OutWest came out in 2024.'))
    expect(rowOf(r, 'genre in your bio')).toBe('not found')
    expect(rowOf(r, 'city in your bio')).toBe('not found')
    expect(run(bioWith('SKEEN IS A CHICAGO HOUSE DJ. HIS EP “OUTWEST” CAME OUT IN 2024.')).status).toBe('pass')
  })

  // Curly quotes, an em dash, a soft hyphen and a zero-width space on the page still match the plain bio in Tapir. (verify-found B1)
  it('finds a bio the site typeset differently', () => {
    const typeset = 'Skeen’s “big” night — the ware&shy;house show in Chi​cago was loud. He played until the sun came up over the lake.'
    const r = b(onPage(typeset))
    expect(r.value).toMatch(new RegExp(`^${words(STRAIGHT)} words`))
    expect(rowOf(r, 'city in your bio')).toBe('Chicago')
  })

  // A fact Tapir doesn't have (no genre, no city) is skipped and said, never held against the bio.
  it('skips a fact Digital Tapir doesn’t have, and says so', () => {
    const r = run(bioWith('Skeen is a DJ and producer. His EP OutWest came out in 2024.'), { genre: null, location: null })
    expect(r.status).toBe('pass')
    expect(r.value).toMatch(/1 of 1 fact/)
    expect(rowOf(r, 'genre in your bio')).toMatch(/not set in Digital Tapir/)
    expect(rowOf(r, 'city in your bio')).toMatch(/not set in Digital Tapir/)
  })
})

describe('a short bio, or one missing a fact, fails', () => {
  // The one exact-wording check (the Skeen bio as it was): short AND missing two facts, all said in one sentence.
  it('says everything that is missing at once', () => {
    const skeen = 'My name is Skeen I am a Chicago DJ, producer, and filmmaker. I\'m documenting what it looks like to build a career in dance music from the ground up. I spend my days in the studio or somewhere with my USB, three cameras, and a ridiculous idea. Hopefully I\'ll see you in your city soon!'
    const r = run(skeen)
    expect(r.status).toBe('fail')
    expect(r.sentence).toBe('your bio has 55 words, under Digital Tapir’s 100-word floor, and doesn’t name your genre or a release or show.')
    expect(r.value).toBe(`${words(skeen)} words · 1 of 3 facts`)
    expect(rowOf(r, 'city in your bio')).toBe('Chicago')
  })

  // Under 100 words fails even with every fact, pointing to the bio editor.
  it('fails under 100 words even with every fact', () => {
    const short = 'Skeen is a Chicago house DJ and producer. His EP OutWest came out in 2024. He has played Smartbar twice.'
    const r = run(short)
    expect(r.status).toBe('fail')
    expect(r.value).toBe(`${words(short)} words · 3 of 3 facts`)
    expect(r.action).toEqual(expect.objectContaining({ kind: 'edit', target: 'bio' }))
    expectPlainWords(r)
  })

  // A long bio with no genre fails, and suggests the genre Tapir has.
  it('fails a long bio with no genre, suggesting yours', () => {
    const r = run(bioWith('Skeen is a DJ and producer from Chicago. His EP OutWest came out in 2024.'))
    expect(r.status).toBe('fail')
    expect(r.value).toMatch(/2 of 3 facts/)
    expect(rowOf(r, 'genre in your bio')).toBe('not found')
    expect(r.good).toMatch(/House/)
  })

  // A long bio with no city fails, and suggests the city Tapir has.
  it('fails a long bio with no city, suggesting yours', () => {
    const r = run(bioWith('Skeen is a house DJ and producer. His EP OutWest came out in 2024.'))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'city in your bio')).toBe('not found')
    expect(r.good).toMatch(/Chicago/)
  })

  // A long bio with no release or show fails, and suggests one of the artist's own.
  it('fails a long bio with no release or show, suggesting one of yours', () => {
    const r = run(bioWith('Skeen is a Chicago house DJ and producer who plays long sets.'))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'highlight in your bio')).toBe('not found')
    expect(r.good).toMatch(/Smartbar|Navy Pier|You Were There|OutWest|Heatwaves/)
  })
})

describe('what counts as a highlight', () => {
  // A show's venue, or a show's city other than home, is a highlight; the home city is already the city fact.
  it('counts a venue or an away city, not the home city', () => {
    const k = { releases: [], tourDates: [{ date: '2026-08-15', venue: 'Navy Pier', city: 'Chicago', isPast: true }, { date: '2026-07-01', venue: 'Miramar', city: 'Milwaukee', isPast: true }] }
    expect(run(bioWith('Skeen is a Chicago house DJ who played Navy Pier last summer.'), k).status).toBe('pass')
    expect(run(bioWith('Skeen is a Chicago house DJ who played a packed room in Milwaukee.'), k).status).toBe('pass')
    expect(run(bioWith('Skeen is a Chicago house DJ who plays around town.'), k).status).toBe('fail')
  })

  // A release called "Home" or "XO" would match ordinary words: not counted, and with only such titles the highlight is "not checked".
  it('does not count a release title that is a menu word or under 3 letters', () => {
    const k = { releases: [{ title: 'Home', releasedOn: '2025-01-01' }, { title: 'XO', releasedOn: '2025-02-01' }, { title: 'OutWest', releasedOn: '2024-01-26' }], tourDates: [] }
    const r = run(bioWith('Skeen is a Chicago house DJ. XO, he signs every message. He is always happy to be home.'), k)
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'highlight in your bio')).toBe('not found')
    const only = run(bioWith('Skeen is a Chicago house DJ.'), { releases: [{ title: 'Home', releasedOn: '2025-01-01' }], tourDates: [] })
    expect(only.status).toBe('pass')
    expect(rowOf(only, 'highlight in your bio')).toMatch(/not checked/)
  })
})

describe('only the bio a page shows counts', () => {
  // Facts count only in the part of the bio the page shows: the full bio in Tapir names Chicago, the page leaves that sentence out.
  it('counts facts only in the shown part of the bio', () => {
    const full = bioWith('Skeen started out filming friends at parties and never really stopped. Today he is a Chicago house DJ and producer with a debut EP called OutWest.')
    const shown = full.split(/(?<=\.) /).filter((s) => !/Chicago/.test(s)).join(' ')
    const r = b(evidence({ home: homeHtml({ ld: [] }), about: aboutHtml(shown), known: known({}, { bio: full }) }))
    expect(r.status).toBe('fail')
    expect(rowOf(r, 'city in your bio')).toBe('not found')
  })

  // A bio only in the fact card, on no page, fails: people and AI tools read the page.
  it('fails a bio that is only in the fact card', () => {
    const r = b(evidence({ about: null }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('not on your pages')
  })

  // A short common sentence that happens to be on the page is not proof the bio is shown.
  it('does not count a short sentence that happens to appear on the page', () => {
    const r = b(evidence({ about: aboutHtml('Unrelated words. Hi. I play records sometimes.'), home: homeHtml({ ld: [] }), known: known({}, { bio: 'Hi. I play records.' }) }))
    expect(r.value).toBe('not on your pages')
  })

  // A bio not found says it looked only at the pages it read, and the limits say how many: never "your site has no bio". (verify-found B3)
  it('says a missing bio was looked for only on the pages read', () => {
    const r = b(onPage('Nothing about the bio here at all, just other words.'))
    expect(r.sentence).toMatch(/pages? we read/)
    expect(r.limits).toMatch(/pages/)
  })

  // One sentence pasted 45 times counts once: a padded bio can't reach 100 words by repeating itself. (verify-found B5)
  it('counts a sentence pasted many times once', () => {
    const s = 'I am a Chicago DJ and producer who plays house music all night.'
    const r = b(evidence({ home: homeHtml({ ld: [] }), about: `<html><body><p>${s}</p></body></html>`, known: known({}, { bio: Array(45).fill(s).join(' ') }) }))
    expect(r.status).toBe('fail')
    expect(r.value).toMatch(/^13 words/)
  })

  // A page with the bio that could not be read, and no other page showing it: "couldn't check", never a fail.
  it('is unknown when a page could not be read and no page shows the bio', () => {
    expect(b(evidence({ pages: [page('/', homeHtml()), page('/about', null, null, { error: 'timeout' })] })).status).toBe('unknown')
  })
})

describe('no bio in Digital Tapir', () => {
  // No bio anywhere: said about Tapir ("you haven't written a bio in Tapir"), not about the site. (verify-found B6)
  it('fails with no bio, saying it about Digital Tapir', () => {
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: undefined })])] }), known: known({}, { bio: null }) }))
    expect(r.status).toBe('fail')
    expect(r.sentence).toMatch(/haven[’']t written a bio in Digital Tapir/i)
    expect(rowOf(r, 'in Digital Tapir: bio')).toBe('none published')
    expect(rowOf(r, 'fact card')).toMatch(/no bio/)
  })

  // With no bio, the fact card falls back to the description: that is not a bio.
  it('does not take the fact card’s fallback description as a bio', () => {
    const summary = 'Meet Skeen, a Chicago DJ, producer and filmmaker, building a career in dance music from the ground up.'
    const r = b(evidence({ home: homeHtml({ ld: [graphBlock([artistNode({ description: summary })])], body: `<p>${summary}</p>` }), about: null, known: known({}, { bio: null }) }))
    expect(r.status).toBe('fail')
    expect(r.value).toBe('no bio')
  })
})

describe('scripts written without spaces', () => {
  // Chinese has no spaces between words: they are still counted, not read as one word.
  it('counts words in a script without spaces', () => {
    const zh = '斯基恩是一位来自芝加哥的浩室音乐制作人和唱片骑师。他在芝加哥的俱乐部演出了很多年，每一场都拍成视频日记。'
    const r = run(zh, { genre: '浩室', location: '芝加哥' })
    expect(r.value).toMatch(/^\d+ words/)
    expect(Number(r.value.split(' ')[0])).toBeGreaterThan(10)
  })

  // Half a Chinese bio shown on the page counts that half: sentences split on "。". (verify-found B4)
  it('counts the half of a Chinese bio a page shows', () => {
    const zh = '我是一名来自芝加哥的音乐制作人和唱片骑师，专注于浩室音乐和科技浩室。我拍摄自己从零开始建立舞曲事业的全部过程和每一场演出。'
    const e = evidence({ home: homeHtml({ ld: [] }), about: `<html><body><p>${zh.split('。')[0]}。</p></body></html>`, known: known({}, { bio: zh }) })
    expect(b(e).value).toMatch(/^[1-9]\d* words/)
  })
})
