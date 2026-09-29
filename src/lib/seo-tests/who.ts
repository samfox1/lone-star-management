/**
 * "Says who you are": six tests read off the LIVE site (evidence.plain), each as strict as
 * its words in defs.ts and no stricter. Pure, synchronous, never throws (types.ts).
 *
 *   title   the home page's `<title>`: exists, names the artist, isn't only the name, ≤ 70
 *   desc    the meta description: exists, isn't the name-only fallback, 50–160 characters
 *   bio     how much of the bio SHOWS AS WORDS on a page, against Tapir's 2,500 goal
 *   genre   the fact card's artist node names a style
 *   place   the fact card's place has a city, a region and a country
 *   mb      MusicBrainz's answer (gathered by musicbrainz.ts)
 */
import { MAX_TITLE, defaultSeoTitle } from '@samfox1/site-bridge/seo'
import { musicBrainzCreateUrl } from '@/lib/manager-tools/connections/services/musicbrainz/seed'
import {
  artistNodeOf, clip, collapse, fold, hasType, homeOf, isBareName, isObj, metaOf, namesArtist, num, pagesOf,
  shortUrl, squash, strings, textOf, type LdNode, type PageState,
} from './html'
import type { SeoEvidence, SeoTest, SeoTestId, SeoTestResult } from './types'

type Id = Extract<SeoTestId, 'title' | 'desc' | 'bio' | 'genre' | 'place' | 'mb'>
type Result = Omit<SeoTestResult, 'id'>

const make = (id: Id, test: (e: SeoEvidence) => Result): SeoTest => (e) => {
  try {
    return { id, ...test(e) }
  } catch {
    // Total by contract: a bug here is a "couldn't check", never a crash of the whole run.
    return { id, status: 'unknown', value: 'couldn’t check', sentence: 'something went wrong reading your site, so we couldn’t check this.', evidence: [] }
  }
}

/** The home page could not be read: say why, and what we therefore could not do. */
function unreadable(state: Extract<PageState, { ok: false }>, what: string): Result {
  return { status: 'unknown', value: 'couldn’t open', sentence: `${state.why}, so we couldn’t ${what}.`, evidence: [{ label: 'home page', value: state.why }] }
}

/* ── title ──────────────────────────────────────────────────────────────────────────── */

const title = make('title', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your title')
  const name = e.known.artistName.trim()
  const t = home.page.title
  const listing = { kind: 'edit', target: 'listing', label: 'Change the title' } as const
  const limits = 'We read your home page’s title. Google can still show a different one if it thinks it fits a search better.'
  if (!t) {
    return {
      status: 'fail', value: 'no title', sentence: 'your home page has no title, so Google makes one up.',
      todo: 'Write a title on the SEO page, then publish.', action: listing, evidence: [{ label: 'title', value: 'none on the page' }], limits,
    }
  }
  const evidence = [{ label: 'title', value: clip(t, 120) }, { label: 'length', value: `${t.length} of ${MAX_TITLE}` }]
  if (home.page.titleCount > 1) evidence.push({ label: 'titles on the page', value: String(home.page.titleCount) })
  const source = titleSource(t, e)
  if (source) evidence.push({ label: 'source', value: source })
  const good = goodTitle(e)
  if (name && isBareName(t, name)) {
    return { status: 'fail', value: clip(t, 28), sentence: `your title is just “${clip(t, 60)}”. Add your city and sound so Google can tell you apart.`, good, todo: 'Write a title with your name, city and sound, then publish.', action: listing, evidence, limits }
  }
  if (name && !namesArtist(t, name)) {
    return { status: 'fail', value: 'your name is missing', sentence: `your title doesn’t say your name, “${name}”.`, good, todo: 'Put your name first in the title, then publish.', action: listing, evidence, limits }
  }
  if (!name) return { status: 'unknown', value: 'no artist name', sentence: 'we don’t know your artist name, so we couldn’t check the title names you.', evidence, limits }
  if (t.length > MAX_TITLE) {
    return { status: 'fail', lead: 'Almost', value: `${t.length} of ${MAX_TITLE}`, sentence: `your title is ${t.length} characters. Long titles get cut off in search results; keep it to ${MAX_TITLE}.`, todo: 'Shorten the title, then publish.', action: listing, evidence, limits }
  }
  return { status: 'pass', value: clip(t, 28), sentence: `Your site’s title is “${t}”.`, evidence, limits }
})

/** Where the live title came from, as far as the evidence shows. */
function titleSource(live: string, e: SeoEvidence): string | null {
  const pub = e.known.published
  if (!pub) return null
  const written = collapse(pub.seoTitle ?? '')
  if (written) return fold(written) === fold(live) ? 'written on the SEO page' : `not the title you published (“${clip(written, 60)}”)`
  const facts = { name: e.known.artistName, genre: pub.genre, location: pub.location }
  const built = (['MusicGroup', 'Person', null] as const).map((schema_type) => defaultSeoTitle({ ...facts, schema_type }))
  return built.some((b) => b && fold(b) === fold(live)) ? 'built from your facts (no title written)' : 'not written in Tapir'
}

/** "Skeen · Chicago house", from the facts Tapir has, or nothing (never invented). */
function goodTitle(e: SeoEvidence): string | undefined {
  const pub = e.known.published
  const built = pub ? defaultSeoTitle({ name: e.known.artistName, genre: pub.genre, location: pub.location }) : ''
  return built && fold(built) !== fold(e.known.artistName) ? `Like “${built}”.` : undefined
}

/* ── desc ───────────────────────────────────────────────────────────────────────────── */

/** Google cuts snippets by width, about 160 characters on a computer; under 50 says little.
 *  Both are the common guideline, not a published Google rule (said in `limits`). */
const DESC_MIN = 50
const DESC_MAX = 160

const desc = make('desc', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your summary')
  const d = metaOf(home.page, 'description')
  const name = e.known.artistName.trim()
  const listing = { kind: 'edit', target: 'listing', label: 'Change the summary' } as const
  const limits = 'Google often writes its own summary from your page instead. The 50 to 160 character range is a common guideline, not a Google rule.'
  if (!d) {
    return { status: 'fail', value: 'no summary', sentence: 'your site has no summary for Google, so it picks words from your page.', todo: 'Write a one- or two-sentence summary on the SEO page, then publish.', action: listing, evidence: [{ label: 'summary', value: 'none on the page' }], limits }
  }
  const evidence = [{ label: 'summary', value: clip(d, 200) }, { label: 'length', value: `${d.length} of ${DESC_MAX}` }]
  const count = home.page.meta.description?.length ?? 0
  if (count > 1) evidence.push({ label: 'summaries on the page', value: String(count) })
  if (name && isBareName(d, name)) {
    return { status: 'fail', value: 'just your name', sentence: `your summary just says “${clip(d, 60)}”.`, todo: 'Write a sentence about who you are and your sound, then publish.', action: listing, evidence, limits }
  }
  if (d.length < DESC_MIN) {
    return { status: 'fail', lead: 'Almost', value: `${d.length} of ${DESC_MAX}`, sentence: `your summary is only ${d.length} characters.`, todo: 'Add a sentence about who you are and your sound, then publish.', action: listing, evidence, limits }
  }
  if (d.length > DESC_MAX) {
    return { status: 'fail', lead: 'Almost', value: `${d.length} of ${DESC_MAX}`, sentence: `your summary is ${d.length} characters, so Google will cut off the end.`, todo: `Shorten it to ${DESC_MAX} characters, then publish.`, action: listing, evidence, limits }
  }
  return { status: 'pass', value: `${d.length} of ${DESC_MAX}`, sentence: `Your summary is ${d.length} characters, a good length.`, evidence, limits }
})

/* ── bio ────────────────────────────────────────────────────────────────────────────── */

/** SEO_GEO_PLAN.md 3.2: Tapir's own target (first set for a page's visible text), not a
 *  number from Google or any AI company. Said plainly in `limits`, and no `good` line. */
export const BIO_GOAL = 2500
/** A sentence shorter than this (squashed) is too common to prove the bio is on the page. */
const MIN_SENTENCE = 20

/** How many of the bio's characters show as words on one page: the whole bio when it is
 *  there in one piece, else the sentences that are. */
function shownChars(bio: string, pageText: string): number {
  const hay = squash(pageText)
  if (!hay) return 0
  if (hay.includes(squash(bio))) return bio.length
  const sentences = bio.split(/(?<=[.!?…])\s+/)
  let shown = 0
  let count = 0
  for (const s of sentences) {
    const sq = squash(s)
    if (sq.length >= MIN_SENTENCE && hay.includes(sq)) {
      shown += s.length
      count++
    }
  }
  return shown + Math.max(0, count - 1)
}

const bio = make('bio', (e) => {
  const pages = pagesOf(e)
  const home = homeOf(e)
  const readable = pages.filter((p): p is Extract<PageState, { ok: true }> => p.ok)
  if (!readable.length) return unreadable(home.ok ? { ok: false, path: '/', why: 'no page could be read', noAnswer: true } : home, 'look for your bio')
  const pub = e.known.published
  const card = home.ok ? artistNodeOf(home.page, e.known.artistName) : null
  const cardDesc = collapse(textOf(card?.description) ?? '')
  const metaDesc = home.ok ? metaOf(home.page, 'description') ?? '' : ''
  // The fact card's description is the bio, unless the bridge fell back to the summary.
  const fromCard = cardDesc && fold(cardDesc) !== fold(metaDesc) ? cardDesc : ''
  const fromTapir = collapse(pub?.bio ?? '')
  const candidates = [...new Set([fromCard, fromTapir].filter(Boolean))]
  const action = { kind: 'edit', target: 'bio', label: 'Open the bio editor' } as const
  const limits = `The ${num(BIO_GOAL)} goal is Tapir’s own target, not a rule from Google or any AI company. We find your bio by matching the one you published; words typed straight into the site’s code aren’t counted, and text hidden by the site’s design still is.`
  const cardRow = fromCard ? [{ label: 'fact card', value: `description · ${num(fromCard.length)} characters` }] : []
  if (!candidates.length) {
    if (!pub) return { status: 'unknown', value: 'couldn’t check', sentence: 'we couldn’t find a bio to look for on your site.', evidence: cardRow, limits }
    return { status: 'fail', value: `0 of ${num(BIO_GOAL)}`, sentence: 'you haven’t written a bio yet.', todo: 'Write your bio: who you are, your sound, your big shows and releases.', action, evidence: [{ label: 'bio', value: 'none found on the site' }], limits }
  }
  let best = { chars: 0, path: '' }
  for (const p of readable) {
    for (const c of candidates) {
      const chars = shownChars(c, p.page.text)
      if (chars > best.chars) best = { chars, path: p.path }
    }
  }
  const whole = Math.max(...candidates.map((c) => c.length))
  const blind = pages.filter((p) => (!p.ok && p.noAnswer) || (p.ok && p.truncated)).map((p) => p.path)
  const evidence = [
    { label: 'bio on your site', value: `${num(best.chars)} characters as words on a page` },
    ...(best.path ? [{ label: 'shown on', value: best.path }] : []),
    { label: 'goal', value: `${num(BIO_GOAL)} characters (Tapir’s own goal)` },
    ...cardRow,
  ]
  if (blind.length && best.chars < whole) {
    return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${blind.join(', ')}, and your full bio wasn’t on the pages we could read.`, evidence: [...evidence, { label: 'not read', value: blind.join(', ') }], limits }
  }
  if (best.chars === 0) {
    return {
      status: 'fail', value: `0 of ${num(BIO_GOAL)}`,
      sentence: fromCard ? 'your bio isn’t shown as words on any page, only behind the scenes for search engines.' : 'your bio isn’t shown as words on any page of your site.',
      todo: 'Show your bio on your home page or an About page, then publish.', action, evidence, limits,
    }
  }
  if (best.chars < BIO_GOAL) {
    return { status: 'fail', value: `${num(best.chars)} of ${num(BIO_GOAL)}`, sentence: `your bio shows ${num(best.chars)} characters on your site. Tapir’s goal is ${num(BIO_GOAL)}.`, todo: 'Add your big moments: shows you played, releases, press.', action, evidence, limits }
  }
  return { status: 'pass', value: `${num(best.chars)} of ${num(BIO_GOAL)}`, sentence: `Your bio shows ${num(best.chars)} characters on your site.`, evidence, limits }
})

/* ── genre ──────────────────────────────────────────────────────────────────────────── */

/** The fact card's artist node, or why there is none to read. */
function cardArtist(e: SeoEvidence): { node: LdNode } | { none: string } | { home: Extract<PageState, { ok: false }> } {
  const home = homeOf(e)
  if (!home.ok) return { home }
  const node = artistNodeOf(home.page, e.known.artistName)
  if (node) return { node }
  if (!home.page.ld.length) return { none: 'no fact card on your home page' }
  if (home.page.ld.every((b) => b.error !== null)) return { none: 'your fact card can’t be read' }
  return { none: 'no artist in your fact card' }
}

const genre = make('genre', (e) => {
  const a = cardArtist(e)
  if ('home' in a) return unreadable(a.home, 'read your fact card')
  const facts = { kind: 'edit', target: 'facts', label: 'Change your sound' } as const
  const limits = 'We read the facts your site gives search engines; words about your sound elsewhere on the page aren’t counted.'
  const inTapir = !!collapse(e.known.published?.genre ?? '')
  const todo = inTapir ? 'Your sound is saved in Tapir but isn’t on your site yet. Publish, then test again.' : 'Add your sound on the Facts tab, then publish.'
  if ('none' in a) {
    return { status: 'fail', value: 'not named', sentence: `your site doesn’t name your sound for search engines (${a.none}).`, todo, action: facts, evidence: [{ label: 'fact card', value: a.none }], limits }
  }
  if (hasType(a.node, 'Person') && !hasType(a.node, 'MusicGroup')) {
    return {
      status: 'unknown', value: 'not for a person card',
      sentence: 'your fact card describes you as a person, and that kind of card has no place for a music style.',
      evidence: [{ label: 'artist type', value: 'Person' }],
      limits: 'Search engines only read a music style from a musician’s card, so this test can’t check a visual artist’s.',
    }
  }
  const genres = strings(a.node.genre)
  const evidence = [{ label: 'genre', value: genres.length ? genres.join(', ') : 'not set' }]
  if (!genres.length) return { status: 'fail', value: 'not named', sentence: 'your site doesn’t name your sound for search engines.', todo, action: facts, evidence, limits }
  const said = genres.length === 1 ? genres[0] : `${genres.slice(0, -1).join(', ')} and ${genres[genres.length - 1]}`
  return { status: 'pass', value: clip(genres.join(', '), 28), sentence: `Your site says your sound is ${said}.`, evidence, limits }
})

/* ── place ──────────────────────────────────────────────────────────────────────────── */

/** The artist's place: foundingLocation (MusicGroup), homeLocation (Person), or location. */
function placeOf(node: LdNode): unknown {
  for (const k of ['foundingLocation', 'homeLocation', 'location']) {
    const v = node[k]
    if (v !== undefined && v !== null) return Array.isArray(v) ? v[0] : v
  }
  return null
}

const place = make('place', (e) => {
  const a = cardArtist(e)
  if ('home' in a) return unreadable(a.home, 'read your fact card')
  const facts = { kind: 'edit', target: 'facts', label: 'Add your state and country' } as const
  const limits = 'We read the place in the facts your site gives search engines, not the words on your page or what articles say about you. A place with no states or regions can’t pass yet.'
  if ('none' in a) {
    return { status: 'fail', value: 'not said', sentence: `your site doesn’t say where you’re based (${a.none}).`, todo: 'Add your city, state and country on the Facts tab, then publish.', action: facts, evidence: [{ label: 'fact card', value: a.none }], limits }
  }
  const p = placeOf(a.node)
  const address = isObj(p) ? (isObj(p.address) ? p.address : null) : null
  const city = (address && textOf(address.addressLocality)) || (typeof p === 'string' ? collapse(p) || null : isObj(p) ? textOf(p.name) : null)
  const region = address ? textOf(address.addressRegion) : null
  const country = address ? textOf(address.addressCountry) : null
  const evidence = [
    { label: 'place', value: p === null ? 'not set' : clip(typeof p === 'string' ? p : JSON.stringify(p), 160) },
    { label: 'city', value: city ?? 'missing' },
    { label: 'state or region', value: region ?? 'missing' },
    { label: 'country', value: country ?? 'missing' },
  ]
  if (city && region && country) {
    return { status: 'pass', value: clip(`${city}, ${region}, ${country}`, 28), sentence: `Your site says you’re based in ${city}, ${region}, ${country}.`, evidence, limits }
  }
  if (!city && !region && !country) {
    return { status: 'fail', value: 'not said', sentence: 'your site doesn’t say where you’re based.', todo: 'Add your city, state and country on the Facts tab, then publish.', action: { ...facts, label: 'Add where you’re based' }, evidence, limits }
  }
  const missing = [!city && 'the city', !region && 'the state or region', !country && 'the country'].filter((x): x is string => !!x)
  const has = [city, region, country].filter(Boolean).join(', ')
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')}, or ${missing[missing.length - 1]}`
  return {
    status: 'fail', lead: 'Almost', value: city && !region && !country ? 'city only' : `missing ${missing.length}`,
    sentence: `your site says ${has}, but not ${list}.`,
    todo: `Add ${missing.join(' and ')} on the Facts tab, then publish.`, action: facts, evidence, limits,
  }
})

/* ── mb ─────────────────────────────────────────────────────────────────────────────── */

const mb = make('mb', (e) => {
  const m = e.musicbrainz
  const asked = m.asked?.length ? [{ label: 'asked about', value: m.asked.map((u) => shortUrl(u, 50)).join(' · ') }] : []
  const baseLimits = 'We asked which artist on MusicBrainz links to your site and your strongest profiles. A MusicBrainz page that links to none of them is missed.'
  if (!m.looked) {
    return { status: 'unknown', value: 'couldn’t ask', sentence: `we couldn’t ask MusicBrainz this time${m.error ? ` (${m.error})` : ''}.`, evidence: [...asked, ...(m.error ? [{ label: 'why', value: m.error }] : [])], limits: baseLimits }
  }
  if (m.artistUrl) {
    const fromConnections = /connections/i.test(m.matchedOn ?? '')
    return {
      status: 'pass', value: 'page found', sentence: 'MusicBrainz has a page for you.',
      evidence: [
        { label: 'MusicBrainz page', value: m.artistUrl },
        ...(m.artistName ? [{ label: 'name there', value: m.artistName }] : []),
        ...(m.matchedOn ? [{ label: 'found by', value: fromConnections ? m.matchedOn : shortUrl(m.matchedOn, 60) }] : []),
        ...asked,
      ],
      limits: fromConnections ? 'We took the MusicBrainz link from your Connections as given; we didn’t open it to check it’s you.' : baseLimits,
    }
  }
  const pub = e.known.published
  const href = musicBrainzCreateUrl({ name: e.known.artistName, area: pub?.location ?? null, homepage: e.known.siteUrl, links: pub?.links ?? [] })
  return {
    status: 'fail', value: 'no page yet', sentence: 'MusicBrainz has no page linked to your site or profiles.',
    todo: 'This happens on MusicBrainz, outside Tapir. We fill in what we know; you sign in and save. About 10 minutes.',
    action: { kind: 'outside', href, label: 'Create the page' },
    evidence: [{ label: 'musicbrainz.org', value: 'no artist links to these addresses' }, ...asked],
    limits: baseLimits,
  }
})

export const WHO_TESTS: Record<Id, SeoTest> = { title, desc, bio, genre, place, mb }
