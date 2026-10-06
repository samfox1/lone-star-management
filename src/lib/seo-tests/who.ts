/**
 * "Says who you are": six tests read off the LIVE site (evidence.plain), each as strict as
 * its words in defs.ts and no stricter. Pure, synchronous, never throws (types.ts).
 *
 *   title   the home page's `<title>`: exists, names the artist, isn't only the name or an error
 *           page's, says the city or sound Tapir has, ≤ 70 characters
 *   desc    the meta description: exists, names the artist (or their city or sound), isn't
 *           filler, 50–160 characters
 *   bio     the bio as WORDS on the pages read: at least 100 words (Tapir's own floor), naming
 *           the genre, the city and one release or show from what Tapir published
 *   genre   the artist's OWN fact card node names a style, the one Tapir has
 *   place   that node's place has a city, a region and a country, the ones Tapir has
 *   mb      MusicBrainz's answer (gathered by musicbrainz.ts), under this artist's name
 *   youtube the channel description (read by youtube.ts) names the site AND the city or genre
 *
 * Evidence rows that state what TAPIR holds are labelled "in Tapir: …" (types.ts rule 3).
 * `na` (does not apply), decided from what Tapir PUBLISHED: `genre` and `mb` for a visual artist.
 * A home page read only in part (over the read cap) is "couldn't check" wherever the missing
 * part could change the answer (verify-content.md H1).
 */
import { MAX_TITLE, defaultSeoTitle } from '@samfox1/site-bridge/seo'
import { musicBrainzCreateUrl } from '@/lib/manager-tools/connections/services/musicbrainz/seed'
import { listWords, shortLink } from '@/lib/manager-tools/format'
import { countryCode, countryName } from './apple-storefront'
import {
  clip, collapse, fold, hasType, homeOf, isBareName, isObj, metaOf, namesArtist, num, pagesOf, plural, strings, textOf, wordsOf,
  type LdNode, type PageState,
} from './html'
import { distinctiveTitle, matchFold, matchSquash, namesPhrase, ownArtistNode, sentencesOf, wordCount } from './match'
import type { SeoEvidence, SeoTest, SeoTestId, SeoTestResult } from './types'
import { siteMentionIn } from './youtube'

/** Published in Tapir as a visual artist (Profile "Type"). Unknown when nothing is
 *  published: then no test can say it does not apply. */
const visualArtist = (e: SeoEvidence) => e.known.published?.artistType === 'Person'

type Id = Extract<SeoTestId, 'title' | 'desc' | 'bio' | 'genre' | 'place' | 'mb' | 'youtube'>
type Result = Omit<SeoTestResult, 'id'>
type Readable = Extract<PageState, { ok: true }>

const make = (id: Id, test: (e: SeoEvidence) => Result): SeoTest => (e) => {
  try {
    return { id, ...test(e) }
  } catch {
    // Total by contract: a bug here is a "couldn't check", never a crash of the whole run.
    return { id, status: 'unknown', value: 'couldn’t check', sentence: 'something went wrong reading your site, so we couldn’t check this.', evidence: [] }
  }
}

const OPEN_LIMITS = 'We only judge what your site sent us; when a page doesn’t answer, we say so instead of guessing.'

/** The home page could not be read: say why, and what we therefore could not do. */
function unreadable(state: Extract<PageState, { ok: false }>, what: string): Result {
  return { status: 'unknown', value: 'couldn’t open', sentence: `${state.why}, so we couldn’t ${what}.`, evidence: [{ label: 'home page', value: state.why }], limits: OPEN_LIMITS }
}

/** The home page arrived, but longer than we read: whatever wasn't found may be past the cut. */
function tooBig(what: string, evidence: { label: string; value: string }[] = []): Result {
  return {
    status: 'unknown', value: 'page too big',
    sentence: `your home page is too big for us to read in full, and ${what} isn’t in the part we read.`,
    evidence: [...evidence, { label: 'home page', value: 'only the first 1 MB was read' }],
    limits: 'We read the first 1 MB of each page; anything after that isn’t checked.',
  }
}

const chars = (s: string) => Array.from(s).length
const listing = (label: string) => ({ kind: 'edit', target: 'listing', label }) as const

/** Tapir's city (the first part of "Chicago, IL") and each genre, as words to look for. */
function tapirWho(e: SeoEvidence): { city: string; genres: string[] } {
  const pub = e.known.published
  const city = collapse((pub?.location ?? '').split(',')[0] ?? '')
  const genres = (pub?.genre ?? '').split(',').map(collapse).filter(Boolean)
  return { city, genres }
}
/** Does `text` hold `phrase` as whole words (typography folded)? */
const hasWords = (text: string, phrase: string) => {
  const want = wordsOf(matchFold(phrase)).join(' ')
  return !!want && ` ${wordsOf(matchFold(text)).join(' ')} `.includes(` ${want} `)
}

/* ── title ──────────────────────────────────────────────────────────────────────────── */

/** Words that make a title an error page's, a builder's default or a placeholder. */
const JUNK_TITLE = /\b(?:page not found|not found|404|coming soon|under construction|just another wordpress site|untitled(?: document)?|index of|site not found|error)\b/i

const title = make('title', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your title')
  const name = e.known.artistName.trim()
  const t = home.page.title
  const action = listing('Change the title')
  const who = tapirWho(e)
  const limits = `We read your home page’s title${who.city || who.genres.length ? ' and look for your name and the city or sound you gave Digital Tapir' : ' and look for your name; with no city or sound in Digital Tapir we can’t check more than that'}. Google can still show a different title.`
  if (!t) {
    if (home.truncated) return tooBig('a title')
    return { status: 'fail', value: 'no title', sentence: 'your home page has no title, so Google makes one up.', todo: 'Write a title on the Listing tab, then publish.', action, evidence: [{ label: 'title', value: 'none on the page' }], limits }
  }
  const evidence = [{ label: 'title', value: clip(t, 120) }, { label: 'length', value: `${chars(t)} of ${MAX_TITLE}` }]
  if (home.page.titleCount > 1) evidence.push({ label: 'titles on the page', value: String(home.page.titleCount) })
  evidence.push(...titleSource(t, e))
  const good = goodTitle(e)
  if (name && isBareName(t, name)) {
    return { status: 'fail', value: clip(t, 28), sentence: `your title is just “${clip(t, 60)}”. Add your city and sound so Google can tell you apart.`, good, todo: 'Write a title with your name, city and sound on the Listing tab, then publish.', action, evidence, limits }
  }
  if (JUNK_TITLE.test(t)) {
    return { status: 'fail', value: 'error page title', sentence: `your title is “${clip(t, 60)}”, which reads like an error or placeholder page.`, good, todo: 'Write a title with your name, city and sound on the Listing tab, then publish.', action, evidence, limits }
  }
  if (name && !namesArtist(t, name)) {
    return { status: 'fail', value: 'your name is missing', sentence: `your title doesn’t say your name, “${name}”.`, good, todo: 'Put your name first in the title on the Listing tab, then publish.', action, evidence, limits }
  }
  if (!name) return { status: 'unknown', value: 'no artist name', sentence: 'we don’t know your artist name, so we couldn’t check the title names you.', evidence, limits }
  if ((who.city || who.genres.length) && !(who.city && hasWords(t, who.city)) && !who.genres.some((g) => hasWords(t, g))) {
    return { status: 'fail', lead: 'Almost', value: 'no city or sound', sentence: 'your title has your name but not your city or your sound.', good, todo: 'Add your city or sound to the title on the Listing tab, then publish.', action, evidence, limits }
  }
  if (chars(t) > MAX_TITLE) {
    return { status: 'fail', lead: 'Almost', value: `${chars(t)} of ${MAX_TITLE}`, sentence: `your title is ${chars(t)} characters. Long titles get cut off in search results; keep it to ${MAX_TITLE}.`, todo: 'Shorten the title on the Listing tab, then publish.', action, evidence, limits }
  }
  return { status: 'pass', value: clip(t, 28), sentence: `Your site’s title is “${t}”.`, evidence, limits }
})

/**
 * What Tapir holds for the title, labelled as Tapir's. `seoTitle` is the title Tapir resolved
 * (known.ts: the one written on the Listing tab, else the one built from the facts), so it is
 * never empty for a named artist; "written" vs "built" is told by comparing it to the built one.
 */
function titleSource(live: string, e: SeoEvidence): { label: string; value: string }[] {
  const pub = e.known.published
  if (!pub) return []
  const built = defaultSeoTitle({ name: e.known.artistName, genre: pub.genre, location: pub.location, schema_type: pub.artistType })
  const tapir = collapse(pub.seoTitle ?? '') || built
  if (!tapir) return []
  const how = built && fold(tapir) === fold(built) ? 'built from your facts' : 'written on the Listing tab'
  return [
    { label: 'in Digital Tapir: title', value: `${clip(tapir, 100)} (${how})` },
    { label: 'same as your site', value: fold(tapir) === fold(live) ? 'yes' : 'no' },
  ]
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
const FILLER_TEXT = /\blorem ipsum\b|\bdolor sit amet\b/i

/** One word said over and over: fewer than 4 in 10 words are different. */
function repetitive(text: string): boolean {
  const words = wordsOf(text)
  return words.length >= 5 && new Set(words).size / words.length < 0.4
}

const desc = make('desc', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your description')
  const d = metaOf(home.page, 'description')
  const name = e.known.artistName.trim()
  const action = listing('Change the description')
  const who = tapirWho(e)
  const limits = 'Google often writes its own description from your page instead. We check it’s there, a good length and mentions you, your city or your sound; we don’t judge how well it reads. The 50 to 160 character range is a common guideline, not a Google rule.'
  if (!d) {
    if (home.truncated) return tooBig('a description')
    return { status: 'fail', value: 'no description', sentence: 'your site has no description for Google, so it picks words from your page.', todo: 'Write a one- or two-sentence description on the Listing tab, then publish.', action, evidence: [{ label: 'description', value: 'none on the page' }], limits }
  }
  const n = chars(d)
  const evidence = [{ label: 'description', value: clip(d, 200) }, { label: 'length', value: `${n} of ${DESC_MAX}` }]
  const count = home.page.meta.description?.length ?? 0
  if (count > 1) evidence.push({ label: 'descriptions on the page', value: String(count) })
  const write = 'Write a sentence about who you are and your sound on the Listing tab, then publish.'
  if (name && isBareName(d, name)) {
    return { status: 'fail', value: 'just your name', sentence: `your description just says “${clip(d, 60)}”.`, todo: write, action, evidence, limits }
  }
  if (FILLER_TEXT.test(d) || repetitive(d)) {
    return { status: 'fail', value: 'filler text', sentence: 'your description is filler text, not words about you.', todo: write, action, evidence, limits }
  }
  const aboutYou = (name && namesArtist(d, name)) || (who.city && hasWords(d, who.city)) || who.genres.some((g) => hasWords(d, g))
  if (!aboutYou) {
    return { status: 'fail', value: 'not about you', sentence: `your description doesn’t mention ${name ? `“${name}”` : 'you'}, your city or your sound.`, todo: write, action, evidence, limits }
  }
  if (n < DESC_MIN) {
    return { status: 'fail', lead: 'Almost', value: `${n} of ${DESC_MAX}`, sentence: `your description is only ${n} characters.`, todo: 'Add a sentence about who you are and your sound on the Listing tab, then publish.', action, evidence, limits }
  }
  if (n > DESC_MAX) {
    return { status: 'fail', lead: 'Almost', value: `${n} of ${DESC_MAX}`, sentence: `your description is ${n} characters, so Google may cut off the end.`, todo: `Shorten it to ${DESC_MAX} characters on the Listing tab, then publish.`, action, evidence, limits }
  }
  return { status: 'pass', value: `${n} of ${DESC_MAX}`, sentence: `Your description is ${n} characters and mentions you.`, evidence, limits }
})

/* ── bio ────────────────────────────────────────────────────────────────────────────── */

/** Tapir's own floor for a bio, in words (Sam, 2026-09-29: "a small minimum of about 100
 *  words"): not a number from Google or any AI company, and said so in `limits`. */
export const BIO_MIN_WORDS = 100
/** A sentence shorter than this (squashed) is too common to prove the bio is on the page. */
const MIN_SENTENCE = 20

/** The part of the bio that shows as words on one page: the whole bio when it is there in one
 *  piece, else each DIFFERENT sentence that is (a sentence pasted twice counts once).
 *  Typography is folded on both sides: curly quotes, dashes, soft hyphens. */
function shownText(bio: string, pageText: string): string {
  const hay = matchSquash(pageText)
  if (!hay) return ''
  if (hay.includes(matchSquash(bio))) return bio
  const seen = new Set<string>()
  const shown: string[] = []
  for (const s of sentencesOf(bio)) {
    const sq = matchSquash(s)
    if (seen.has(sq)) continue
    seen.add(sq)
    if (chars(sq) >= MIN_SENTENCE && hay.includes(sq)) shown.push(s)
  }
  return shown.join(' ')
}

const bio = make('bio', (e) => {
  const pages = pagesOf(e)
  const home = homeOf(e)
  const readable = pages.filter((p): p is Readable => p.ok)
  if (!readable.length) return unreadable(home.ok ? { ok: false, path: '/', why: 'no page could be read', noAnswer: true } : home, 'look for your bio')
  const pub = e.known.published
  const card = home.ok ? ownArtistNode(home.page, e.known.artistName, e.origin).node : null
  const cardDesc = collapse(textOf(card?.description) ?? '')
  const metaDesc = home.ok ? metaOf(home.page, 'description') ?? '' : ''
  // The fact card's description is the bio, unless the bridge fell back to the description.
  const fromCard = cardDesc && fold(cardDesc) !== fold(metaDesc) ? cardDesc : ''
  const fromTapir = collapse(pub?.bio ?? '')
  const candidates = [...new Set([fromCard, fromTapir].filter(Boolean))]
  const action = { kind: 'edit', target: 'bio', label: 'Open the bio editor' } as const
  const n = readable.length
  const where = `the ${n === 1 ? 'page' : `${n} pages`} we read`
  const limits = `The ${BIO_MIN_WORDS}-word floor is Digital Tapir’s own, not a rule from Google or any AI company. We read your bio as words on your home page and the first pages your sitemap lists (5 at most), and look for your genre, city and releases or shows by their exact words from Digital Tapir; a nickname like “the Windy City” isn’t counted, and text hidden by the site’s design still is.`
  const cardRow = fromCard ? [{ label: 'fact card', value: `description · ${num(wordCount(fromCard))} words` }] : []
  const pagesRow = { label: 'pages read', value: readable.map((p) => p.path).join(' · ') }
  // Without anything published there are no facts to look for.
  if (!pub) return { status: 'unknown', value: 'nothing published', sentence: 'you haven’t published from Digital Tapir yet, so we have no genre, city or releases to look for in your bio.', evidence: [...cardRow, pagesRow], limits }
  if (!candidates.length) {
    return {
      status: 'fail', value: 'no bio', sentence: 'you haven’t written a bio in Digital Tapir.', todo: 'Write your bio: who you are, your genre, your city, your big shows and releases.', action,
      evidence: [{ label: 'in Digital Tapir: bio', value: 'none published' }, { label: 'fact card', value: cardDesc ? 'no bio in it (only your description)' : 'no bio in it' }, pagesRow], limits,
    }
  }
  let best = { text: '', words: 0, path: '' }
  for (const p of readable) {
    for (const c of candidates) {
      const text = shownText(c, p.page.text)
      const w = wordCount(text)
      if (w > best.words) best = { text, words: w, path: p.path }
    }
  }
  const whole = Math.max(...candidates.map(wordCount))
  const blind = pages.filter((p) => (!p.ok && p.noAnswer) || (p.ok && p.truncated)).map((p) => (p.ok ? `${p.path} (too big to read in full)` : p.path))
  if (blind.length && best.words < whole) {
    return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${blind.join(', ')}, and your full bio wasn’t on the pages we could read.`, evidence: [...cardRow, pagesRow, { label: 'not read', value: blind.join(', ') }], limits }
  }
  if (!best.words) {
    return {
      status: 'fail', value: 'not on your pages',
      sentence: fromCard ? `your bio isn’t shown as words on ${where}, only behind the scenes for search engines.` : `your bio isn’t shown as words on ${where}.`,
      todo: 'Show your bio on your home page or an About page, then publish.', action, evidence: [...cardRow, pagesRow], limits,
    }
  }

  // The three facts, from what Tapir published; a fact Tapir doesn't have is skipped, never
  // held against the bio.
  const { city, genres } = tapirWho(e)
  const home_ = matchFold(city)
  const highlights = [
    ...pub.releases.map((r) => ({ what: `“${collapse(r.title)}”`, text: collapse(r.title), kind: 'release' as const })),
    ...pub.tourDates.flatMap((t) => [
      ...(t.venue ? [{ what: collapse(t.venue), text: collapse(t.venue), kind: 'show' as const }] : []),
      // A show's city counts only when it isn't home: "Chicago" is already the city fact.
      ...(t.city && matchFold(t.city) !== home_ ? [{ what: collapse(t.city), text: collapse(t.city), kind: 'show' as const }] : []),
    ]),
  ].filter((h) => distinctiveTitle(h.text))
  const shown = best.text
  const genreHit = genres.find((g) => namesPhrase(shown, g)) ?? null
  const cityHit = city && namesPhrase(shown, city) ? city : null
  const highlightHit = highlights.find((h) => namesPhrase(shown, h.text)) ?? null
  const facts = [
    { key: 'genre', say: 'your genre', has: genres.length > 0, hit: genreHit, row: genreHit ?? 'not found' },
    { key: 'city', say: 'your city', has: !!city, hit: cityHit, row: cityHit ?? 'not found' },
    { key: 'highlight', say: 'a release or show', has: highlights.length > 0, hit: highlightHit?.what ?? null, row: highlightHit?.what ?? 'not found' },
  ]
  const checked = facts.filter((f) => f.has)
  const lacking = checked.filter((f) => !f.hit)
  const short = best.words < BIO_MIN_WORDS
  const evidence = [
    { label: 'bio on your site', value: `${num(best.words)} words` },
    { label: 'shown on', value: best.path },
    { label: 'genre in your bio', value: genres.length ? facts[0].row : 'not set in Digital Tapir, so not checked' },
    { label: 'city in your bio', value: city ? facts[1].row : 'not set in Digital Tapir, so not checked' },
    { label: 'highlight in your bio', value: highlights.length ? facts[2].row : 'no release or show in Digital Tapir we can look for, so not checked' },
    ...(genres.length ? [{ label: 'in Digital Tapir: genre', value: clip(genres.join(', '), 80) }] : []),
    ...(city ? [{ label: 'in Digital Tapir: city', value: city }] : []),
    { label: 'floor', value: `${BIO_MIN_WORDS} words (Digital Tapir’s own)` },
    ...cardRow,
    pagesRow,
  ]
  const value = checked.length ? `${num(best.words)} words · ${checked.length - lacking.length} of ${checked.length} ${plural(checked.length, 'fact')}` : `${num(best.words)} words`
  if (!short && !lacking.length) {
    const said = checked.map((f) => f.hit!)
    return { status: 'pass', value, sentence: said.length ? `Your bio has ${num(best.words)} words and names ${listWords(said, 'and')}.` : `Your bio has ${num(best.words)} words.`, evidence, limits }
  }
  // One line from their OWN data: what to mention.
  const example = [
    city || null,
    genres[0] ?? null,
    highlights[0] ? (highlights[0].kind === 'show' ? `a show like ${highlights[0].what}` : `a release like ${highlights[0].what}`) : null,
  ].filter((x): x is string => !!x)
  const good = example.length ? `e.g. mention ${listWords(example, 'and')}.` : undefined
  const missing = listWords(lacking.map((f) => f.say), 'or')
  const sentence = short && lacking.length
    ? `your bio has ${num(best.words)} words, under Digital Tapir’s ${BIO_MIN_WORDS}-word floor, and doesn’t name ${missing}.`
    : short
      ? `your bio has ${num(best.words)} words, under Digital Tapir’s ${BIO_MIN_WORDS}-word floor.`
      : `your bio doesn’t name ${missing}.`
  const add = listWords(lacking.map((f) => (f.key === 'highlight' ? 'a big show or release' : f.say)), 'and')
  const todo = lacking.length ? `Add ${add} to your bio${short ? `, and write at least ${BIO_MIN_WORDS} words` : ''}.` : `Write at least ${BIO_MIN_WORDS} words: who you are, your big shows, your releases.`
  return { status: 'fail', value, sentence, good, todo, action, evidence, limits }
})

/* ── genre / place: the artist's own card node ─────────────────────────────────────── */

/** The artist's OWN node on the home page's fact card, or why there is none to read. */
function cardArtist(e: SeoEvidence): { node: LdNode } | { none: string; row: string } | { home: Extract<PageState, { ok: false }> } | { cut: true } {
  const home = homeOf(e)
  if (!home.ok) return { home }
  const { node, others } = ownArtistNode(home.page, e.known.artistName, e.origin)
  if (node) return { node }
  if (home.truncated) return { cut: true }
  if (others.length) return { none: `your fact card describes “${clip(others[0], 40)}”, not you`, row: `describes ${others.map((o) => `“${clip(o, 40)}”`).join(', ')}, not you` }
  if (!home.page.ld.length) return { none: 'your home page has no fact card', row: 'none on the home page' }
  if (home.page.ld.every((b) => b.error !== null)) return { none: 'your fact card can’t be read', row: 'can’t be read' }
  return { none: 'your fact card doesn’t describe you', row: 'no artist in it' }
}

/** Values that fill a field without saying anything. */
const EMPTY_VALUE = /^(?:n\/?a|na|none|null|undefined|unknown|tbd|tba|other|-+|\.+|\?+)$/i
const meaningful = (v: string) => !!v && !EMPTY_VALUE.test(v.trim()) && !/^https?:\/\//i.test(v.trim())

const genre = make('genre', (e) => {
  const limits = 'We read the facts your home page gives search engines (top-level only); words about your sound elsewhere on the page aren’t counted.'
  // Decided from Tapir alone: a visual artist has no music style, whatever the site shows.
  if (visualArtist(e)) {
    return { status: 'na', value: 'visual artist', sentence: 'you’re listed in Digital Tapir as a visual artist, and a music style is for musicians.', evidence: [{ label: 'in Digital Tapir: artist type', value: 'Visual artist' }], limits }
  }
  const a = cardArtist(e)
  if ('home' in a) return unreadable(a.home, 'read your fact card')
  if ('cut' in a) return tooBig('the fact card about you')
  const facts = { kind: 'edit', target: 'facts', label: 'Change your genre' } as const
  const saved = (e.known.published?.genre ?? '').split(',').map(collapse).filter(Boolean)
  const todo = saved.length ? 'Your genre is saved in Digital Tapir but isn’t on your site yet. Publish, then test again.' : 'Add your genre on Profile, then publish.'
  const tapirRow = saved.length ? [{ label: 'in Digital Tapir: genre', value: clip(saved.join(', '), 120) }] : []
  if ('none' in a) {
    return { status: 'fail', value: 'not named', sentence: `your site doesn’t name your genre for search engines: ${a.none}.`, todo, action: facts, evidence: [{ label: 'fact card', value: a.row }, ...tapirRow], limits }
  }
  if (hasType(a.node, 'Person') && !hasType(a.node, 'MusicGroup')) {
    // Tapir says musician (or published nothing): the card is the one that is off.
    if (!e.known.published) {
      return {
        status: 'unknown', value: 'not for a person card',
        sentence: 'your site tells search engines you’re a person, which has no place for a genre, and you haven’t published from Digital Tapir to say otherwise.',
        evidence: [{ label: 'artist type', value: 'Person' }],
        limits: 'Search engines only read a genre from a musician’s card, and without what you published we can’t tell whether you are one.',
      }
    }
    return {
      status: 'fail', value: 'not named',
      sentence: 'your site tells search engines you’re a visual artist, but in Digital Tapir you’re a musician.',
      todo: 'Publish from Digital Tapir, then test again. If it stays, your site needs an update from whoever built it.',
      action: facts, evidence: [{ label: 'artist type', value: 'Person' }, { label: 'in Digital Tapir: artist type', value: 'Musician' }, ...tapirRow], limits,
    }
  }
  const all = strings(a.node.genre)
  const genres = all.filter(meaningful)
  const evidence = [{ label: 'genre', value: all.length ? all.join(', ') : 'not set' }, ...tapirRow]
  if (!genres.length) return { status: 'fail', value: 'not named', sentence: 'your site doesn’t name your genre for search engines.', todo, action: facts, evidence, limits }
  const said = listWords(genres)
  if (saved.length && !genres.some((g) => saved.some((s) => matchFold(s) === matchFold(g)))) {
    return { status: 'fail', lead: 'Almost', value: 'not your genre', sentence: `your site says your genre is ${clip(said, 60)}, but in Digital Tapir it’s ${clip(saved.join(', '), 60)}.`, todo: 'Publish from Digital Tapir, then test again. If it stays, your site needs an update from whoever built it.', action: facts, evidence, limits }
  }
  return { status: 'pass', value: clip(genres.join(', '), 28), sentence: `Your site says your genre is ${said}.`, evidence, limits }
})

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
  if ('cut' in a) return tooBig('the fact card about you')
  const facts = { kind: 'edit', target: 'facts', label: 'Add your state and country' } as const
  const limits = 'We read the place in the facts your home page gives search engines, not the words on your page or what articles say about you. A place with no states or regions can’t pass yet.'
  const pub = e.known.published
  const part = (v: string | null | undefined) => collapse(v ?? '') || 'not set'
  const tapirRow = pub ? [{ label: 'in Digital Tapir: place', value: `city ${part(pub.location)} · region ${part(pub.region)} · country ${part(pub.country)}` }] : []
  if ('none' in a) {
    return { status: 'fail', value: 'not said', sentence: `your site doesn’t say where you’re based: ${a.none}.`, todo: 'Add your city, state and country on Profile, then publish.', action: facts, evidence: [{ label: 'fact card', value: a.row }, ...tapirRow], limits }
  }
  const p = placeOf(a.node)
  const address = isObj(p) ? (isObj(p.address) ? p.address : null) : null
  // A place with no address is one line of text: a bare city ("Chicago") is just a city, but
  // "Chicago, IL" holds several facts in one line, which search engines don't read apart.
  const text = typeof p === 'string' ? collapse(p) || null : isObj(p) && !address ? textOf(p.name) : null
  const line = text && text.includes(',') ? text : null
  const city = address ? textOf(address.addressLocality) ?? (isObj(p) ? textOf(p.name) : null) : line ? null : text
  const region = address ? textOf(address.addressRegion) : null
  const country = address ? textOf(address.addressCountry) : null
  const evidence = [
    { label: 'place', value: p === null ? 'not set' : clip(typeof p === 'string' ? p : JSON.stringify(p), 160) },
    { label: 'city', value: city ?? (line ? `one line: ${line}` : 'missing') },
    { label: 'state or region', value: region ?? 'missing' },
    { label: 'country', value: country ?? 'missing' },
    ...tapirRow,
  ]
  const publish = 'It’s published in Digital Tapir but your site doesn’t state it yet. Publish, then test again; if it stays, your site needs an update from whoever built it.'
  // One line ("Chicago, IL"): the words may all be there, but not as the separate facts
  // search engines read. Said as such, never as "says Chicago, IL, but not the state".
  if (line && !address) {
    return { status: 'fail', lead: 'Almost', value: 'one line', sentence: `your site gives your place as one line (“${clip(line, 40)}”). Search engines want the city, state and country as separate facts.`, todo: pub?.region && pub?.country ? publish : 'Add your city, state and country on Profile, then publish.', action: facts, evidence, limits }
  }
  const bad = [region && !meaningful(region) && 'the state or region', country && !countryCode(country) && 'the country'].filter((x): x is string => !!x)
  if (bad.length) {
    return { status: 'fail', value: 'not a real place', sentence: `your site gives ${bad.join(' and ')} as “${clip([region, country].filter(Boolean).join(', '), 40)}”, which isn’t a real place.`, todo: 'Set your state and country on Profile, then publish.', action: facts, evidence, limits }
  }
  if (city && region && country) {
    // Compared with what Tapir published: a site that says Austin when Tapir says Chicago is
    // stale or wrong, not a pass. City and country only: a region may be spelled "IL" or
    // "Illinois" and both are right.
    const tapirCity = collapse((pub?.location ?? '').split(',')[0] ?? '')
    const tapirCountry = pub ? pub.countryCode ?? countryCode(pub.country) : null
    const cityOff = tapirCity && matchFold(tapirCity) !== matchFold(city)
    const countryOff = tapirCountry && countryCode(country) !== tapirCountry
    if (cityOff || countryOff) {
      const tapirSays = [tapirCity, pub?.region, tapirCountry ? countryName(tapirCountry) : pub?.country].filter(Boolean).join(', ')
      return { status: 'fail', lead: 'Almost', value: 'not your place', sentence: `your site says you’re based in ${clip(`${city}, ${region}, ${country}`, 50)}, but in Digital Tapir it’s ${clip(tapirSays, 50)}.`, todo: publish, action: facts, evidence, limits }
    }
    return { status: 'pass', value: clip(`${city}, ${region}, ${country}`, 28), sentence: `Your site says you’re based in ${city}, ${region}, ${country}.`, evidence, limits }
  }
  if (!city && !region && !country) {
    return { status: 'fail', value: 'not said', sentence: 'your site doesn’t say where you’re based.', todo: 'Add your city, state and country on Profile, then publish.', action: { ...facts, label: 'Add where you’re based' }, evidence, limits }
  }
  const missing = [!city && 'the city', !region && 'the state or region', !country && 'the country'].filter((x): x is string => !!x)
  const has = [city, region, country].filter(Boolean).join(', ')
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')}, or ${missing[missing.length - 1]}`
  // What Tapir published decides the to-do: a part it HAS that the card lacks is a site that
  // hasn't caught up (a bridge before 0.43.0 states no region or country), not a missing fact.
  const saved = { city: !!collapse(pub?.location ?? ''), region: !!pub?.region, country: !!pub?.country }
  const lacks = [!city && !saved.city && 'the city', !region && !saved.region && 'the state or region', !country && !saved.country && 'the country'].filter((x): x is string => !!x)
  return {
    status: 'fail', lead: 'Almost', value: city && !region && !country ? 'city only' : `missing ${missing.length}`,
    sentence: `your site says ${has}, but not ${list}.`,
    todo: lacks.length ? `Add ${lacks.join(' and ')} on Profile, then publish.` : publish, action: facts, evidence, limits,
  }
})

/* ── mb ─────────────────────────────────────────────────────────────────────────────── */

const mb = make('mb', (e) => {
  const limits = 'We asked which artist on MusicBrainz links to your site and your strongest profiles, and checked that artist has your name. A MusicBrainz page that links to none of them is missed.'
  // Decided from Tapir alone: MusicBrainz lists people who make music, and its editors remove
  // an entry for someone who doesn't, so "Create the page" would be wrong advice here.
  if (visualArtist(e)) {
    return { status: 'na', value: 'visual artist', sentence: 'MusicBrainz lists people who make music, and you’re listed in Digital Tapir as a visual artist.', evidence: [{ label: 'in Digital Tapir: artist type', value: 'Visual artist' }], limits }
  }
  const m = e.musicbrainz
  const asked = m.asked?.length ? [{ label: 'asked about', value: m.asked.map((u) => clip(shortLink(u), 50)).join(' · ') }] : []
  if (!m.looked) {
    return { status: 'unknown', value: 'couldn’t ask', sentence: `we couldn’t ask MusicBrainz this time${m.error ? ` (${m.error})` : ''}.`, evidence: [...asked, ...(m.error ? [{ label: 'why', value: m.error }] : [])], limits }
  }
  const fromConnections = m.fromConnections === true || /connections/i.test(m.matchedOn ?? '')
  const found = [
    ...(m.artistUrl ? [{ label: 'MusicBrainz page', value: m.artistUrl }] : []),
    ...(m.artistName ? [{ label: 'name there', value: m.artistName }] : []),
    ...(m.matchedOn ? [fromConnections ? { label: 'in Digital Tapir: found by', value: 'your MusicBrainz link in Connections' } : { label: 'found by', value: clip(shortLink(m.matchedOn), 60) }] : []),
    ...asked,
  ]
  const name = e.known.artistName.trim()
  if (!m.artistUrl && fromConnections) {
    return {
      status: 'fail', value: 'link goes nowhere', sentence: 'the MusicBrainz link in your Connections goes to a page MusicBrainz doesn’t have.',
      todo: 'Open Connections and paste the link to your MusicBrainz artist page.', action: { kind: 'edit', target: 'connections', label: 'Open Connections' }, evidence: found, limits,
    }
  }
  if (m.artistUrl) {
    // MusicBrainz linked one of your addresses to an artist of ANOTHER name: that page is not
    // "a page for you" (a mixed-up profile link, or someone else's page).
    if (m.artistName && name && matchFold(m.artistName) !== matchFold(name)) {
      return {
        status: 'fail', lead: 'Almost', value: 'another name there',
        sentence: `MusicBrainz links your ${fromConnections ? 'Connections link' : 'site or profiles'} to “${clip(m.artistName, 40)}”, not to an artist named “${clip(name, 40)}”.`,
        todo: 'Check that page on MusicBrainz. If it’s you under another name, add your name as an alias there; if not, the link is mixed up.',
        action: { kind: 'outside', href: m.artistUrl.startsWith('https://') ? m.artistUrl : 'https://musicbrainz.org/', label: 'Open the MusicBrainz page' }, evidence: found, limits,
      }
    }
    return { status: 'pass', value: 'page found', sentence: 'MusicBrainz has a page for you.', evidence: found, limits }
  }
  const pub = e.known.published
  const href = musicBrainzCreateUrl({ name, area: pub?.location ?? null, homepage: e.known.siteUrl, links: pub?.links ?? [] })
  return {
    status: 'fail', value: 'no page yet', sentence: 'MusicBrainz has no page linked to your site or profiles.',
    todo: 'This happens on MusicBrainz, outside Digital Tapir. We fill in what we know; you sign in and save. About 10 minutes.',
    action: { kind: 'outside', href, label: 'Create the page' },
    evidence: [{ label: 'musicbrainz.org', value: 'no artist links to these addresses' }, ...asked],
    limits,
  }
})

/* ── youtube ────────────────────────────────────────────────────────────────────────── */

/** Where the artist edits it (bios.ts OUTSIDE_BIOS 'youtube': Customization > Profile). */
const YOUTUBE_STUDIO = 'https://studio.youtube.com/'
/** At most this many lines of the description are quoted, each this long. */
const QUOTE_LINES = 3
const QUOTE_LINE = 160

/** The part of a description worth quoting: the lines that say any of `hits`, else its start. */
function quoteOf(description: string, hits: readonly string[]): string {
  const lines = description.split(/\r?\n/).map(collapse).filter(Boolean)
  if (!lines.length) return 'empty'
  const saying = hits.length ? lines.filter((l) => hits.some((h) => l.includes(h) || namesPhrase(l, h))) : []
  if (saying.length) return saying.slice(0, QUOTE_LINES).map((l) => clip(l, QUOTE_LINE)).join('\n')
  return clip(lines.join(' '), 200)
}

const youtube = make('youtube', (e) => {
  const limits = 'We read your channel’s description with YouTube’s own data service and look for your site’s address and the city or genre you gave Digital Tapir, by their exact words. YouTube doesn’t share the links shown under your channel name, so a site link only there isn’t seen.'
  const y = e.youtube
  if (!y) return { status: 'unknown', value: 'couldn’t ask', sentence: 'we didn’t get to ask YouTube this time.', evidence: [], limits }
  const pub = e.known.published
  if (!pub) return { status: 'unknown', value: 'nothing published', sentence: 'you haven’t published from Digital Tapir yet, so we don’t know your YouTube channel, city or genre.', evidence: [], limits }
  if (!y.link) {
    return { status: 'na', value: 'no YouTube link', sentence: 'you haven’t linked a YouTube channel in Connections.', evidence: [{ label: 'in Digital Tapir: YouTube', value: 'no channel linked' }], limits }
  }
  const linkRow = { label: 'in Digital Tapir: your YouTube link', value: clip(shortLink(y.link), 80) }
  if (!y.looked) {
    return { status: 'unknown', value: 'couldn’t ask', sentence: `we couldn’t ask YouTube this time${y.error ? ` (${y.error})` : ''}.`, evidence: [linkRow, ...(y.error ? [{ label: 'why', value: y.error }] : [])], limits }
  }
  if (!y.channel) {
    return {
      status: 'fail', value: 'no channel there', sentence: 'there’s no YouTube channel at the link in your Connections.',
      todo: 'Open your channel on YouTube, copy its address (youtube.com/@yourname) and paste it in Connections.',
      action: { kind: 'edit', target: 'connections', label: 'Open Connections' },
      evidence: [linkRow, { label: 'youtube.com', value: 'no channel at this link' }], limits,
    }
  }
  const site = e.known.siteUrl
  if (!site) return { status: 'unknown', value: 'no site', sentence: 'no site is connected, so there was no address to look for.', evidence: [linkRow], limits }
  const { city, genres } = tapirWho(e)
  const d = y.channel.description
  const siteHit = siteMentionIn(d, site)
  const cityHit = city && namesPhrase(d, city) ? city : null
  // The most specific genre said ("Tech House" over the "House" inside it).
  const genreHit = genres.filter((g) => namesPhrase(d, g)).sort((a, b) => b.length - a.length)[0] ?? null
  // A fact Tapir doesn't have is never held against the channel: with no city and no genre in
  // Tapir, the site alone is asked for.
  const wantWho = !!city || genres.length > 0
  const whoHit = cityHit ?? genreHit
  const channelName = [y.channel.title, y.channel.handle].filter(Boolean).join(' · ')
  const evidence = [
    ...(channelName ? [{ label: 'channel', value: clip(channelName, 120) }] : []),
    { label: 'description', value: quoteOf(d, [siteHit, cityHit, genreHit].filter((h): h is string => !!h)) },
    { label: 'your site', value: siteHit ?? 'not found' },
    ...(city ? [{ label: 'city', value: cityHit ?? 'not found' }] : []),
    ...(genres.length ? [{ label: 'genre', value: genreHit ?? 'not found' }] : []),
    { label: 'in Digital Tapir: site', value: clip(shortLink(site), 80) },
    ...(city ? [{ label: 'in Digital Tapir: city', value: city }] : []),
    ...(genres.length ? [{ label: 'in Digital Tapir: genre', value: genres.join(', ') }] : []),
    linkRow,
  ]
  if (siteHit && (whoHit || !wantWho)) {
    return { status: 'pass', value: 'says who you are', sentence: `Your YouTube description links your site${whoHit ? ` and says ${whoHit}` : ''}.`, evidence, limits }
  }
  const missing = [
    ...(siteHit ? [] : ['doesn’t link your site']),
    ...(wantWho && !whoHit ? [`doesn’t say ${listWords([city, ...genres].filter(Boolean), 'or')}`] : []),
  ]
  const host = shortLink(site).replace(/^www\./, '')
  const example = [city, genres[0], host].filter(Boolean).join(' · ')
  return {
    status: 'fail',
    ...(missing.length === 1 && d.trim() ? { lead: 'Almost' as const } : {}),
    value: siteHit ? 'no city or genre' : wantWho && !whoHit ? 'no site, city or genre' : 'no site link',
    sentence: `your YouTube channel’s description ${missing.join(' and ')}.`,
    good: `A line like “${example}” is enough.`,
    todo: 'In YouTube Studio, open Customization, then Profile, and add it to your description.',
    action: { kind: 'outside', href: YOUTUBE_STUDIO, label: 'Open YouTube Studio' },
    evidence,
    limits,
  }
})

export const WHO_TESTS: Record<Id, SeoTest> = { title, desc, bio, genre, place, mb, youtube }
