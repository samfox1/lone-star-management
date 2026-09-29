/**
 * "Facts are true": five tests of the LIVE fact card (the JSON-LD a site hands search
 * engines), compared to what Tapir published where the comparison is the claim. Pure,
 * synchronous, never throws.
 *
 *   profiles  the artist's OWN node's `sameAs` lists exactly the identity profiles Tapir
 *             published (its links, plus the Spotify profile the bridge writes from the id)
 *   apple     every Apple Music link that is the artist's (their artist page, any album, song,
 *             playlist or video link) opens the store of the country they're based in: Tapir's
 *             published Facts first, the card's own statement only when Tapir has none
 *   shows     no past show stated as upcoming, no show with an unreadable date; upcoming shows
 *             match Tour. Days are UTC with one day's grace (a show tonight in Chicago is
 *             already "tomorrow" in UTC)
 *   releases  every published release is on the card, and every release the card lists is
 *             shown on a page, as words or a cover's description
 *   card      every block on every tested page parses, says schema.org, is not empty, and each
 *             node has the fields its type needs, of the right kind
 *
 * Evidence rows that state what TAPIR holds are labelled "in Tapir: …" (types.ts rule 3).
 * `na`: `apple` with no Apple Music link on the pages read (all read in full); `releases` for a
 * visual artist with no releases anywhere. A home page read only in part is "couldn't check"
 * wherever the missing part could change the answer (verify-content.md H1).
 */
import { JSON_LD_REQUIRED, isIdentityProfileUrl } from '@samfox1/site-bridge/seo'
import { appleLinkOf, appleStorefrontFix, countryCode, countryName, storeName } from './apple-storefront'
import {
  clip, collapse, dayOf, hasType, homeOf, isObj, ldNodes, linkKey, num, pageNodes, pagesOf, plural, prettyDay,
  shortUrl, textOf, typesOf, type LdNode, type Page, type PageState,
} from './html'
import { matchFold, ownArtistNode, sameAsUrls, titleShown } from './match'
import type { SeoEvidence, SeoKnown, SeoTest, SeoTestId, SeoTestResult } from './types'

type Id = Extract<SeoTestId, 'profiles' | 'apple' | 'shows' | 'releases' | 'card'>
type Result = Omit<SeoTestResult, 'id'>
type Row = { label: string; value: string }

const make = (id: Id, test: (e: SeoEvidence) => Result): SeoTest => (e) => {
  try {
    return { id, ...test(e) }
  } catch {
    return { id, status: 'unknown', value: 'couldn’t check', sentence: 'something went wrong reading your site, so we couldn’t check this.', evidence: [] }
  }
}

function unreadable(state: Extract<PageState, { ok: false }>, what: string): Result {
  return { status: 'unknown', value: 'couldn’t open', sentence: `${state.why}, so we couldn’t ${what}.`, evidence: [{ label: 'home page', value: state.why }], limits: 'We only judge what your site sent us; when a page doesn’t answer, we say so instead of guessing.' }
}

function tooBig(what: string, evidence: Row[] = []): Result {
  return {
    status: 'unknown', value: 'page too big',
    sentence: `your home page is too big for us to read in full, so we can’t say ${what}.`,
    evidence: [...evidence, { label: 'home page', value: 'only the first 1 MB was read' }],
    limits: 'We read the first 1 MB of each page; anything after that isn’t checked.',
  }
}

const noPublished = (what: string): Result => ({
  status: 'unknown', value: 'nothing published', sentence: `you haven’t published from Tapir yet, so there’s nothing to compare ${what} with.`, evidence: [],
  limits: 'This test compares your site with what you published in Tapir.',
})

const listOf = (xs: string[], max = 5) => xs.slice(0, max).join(' · ') + (xs.length > max ? ` · and ${xs.length - max} more` : '')
const UPDATE = 'Publish from Tapir, then test again. If it stays, your site needs an update from whoever built it.'
const HOME_CARD = 'We read the facts on your home page (top-level only).'

/** The home page's fact card: the artist's own node, every top-level node, or why not. */
function homeCard(e: SeoEvidence): { state: Extract<PageState, { ok: false }> } | { page: Page; artist: LdNode | null; others: string[]; nodes: LdNode[]; broken: boolean; none: boolean; cut: boolean } {
  const home = homeOf(e)
  if (!home.ok) return { state: home }
  const own = ownArtistNode(home.page, e.known.artistName, e.origin)
  return {
    page: home.page,
    artist: own.node,
    others: own.others,
    nodes: pageNodes(home.page),
    broken: home.page.ld.some((b) => b.error !== null),
    none: home.page.ld.length === 0,
    cut: home.truncated,
  }
}

/** Pages we could not read in full: no answer, or longer than we read. */
const blindPaths = (e: SeoEvidence) => pagesOf(e).filter((p) => (!p.ok && p.noAnswer) || (p.ok && p.truncated)).map((p) => (p.ok ? `${p.path} (too big to read in full)` : p.path))

/* ── profiles ───────────────────────────────────────────────────────────────────────── */

const isProfile = (u: string) => {
  try {
    return isIdentityProfileUrl(u)
  } catch {
    return false
  }
}

const profiles = make('profiles', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your fact card')
  const pub = e.known.published
  if (!pub) return noPublished('your profiles')
  if (card.cut && !card.artist) return tooBig('which profiles your fact card lists')
  const expected = new Map<string, string>()
  // The bridge writes the Spotify profile into the card from the artist id alone (`sameAsFrom`),
  // after the links; it is a profile Tapir published, not one the site made up.
  const fromId = pub.spotifyArtistId ? [`https://open.spotify.com/artist/${pub.spotifyArtistId}`] : []
  for (const url of [...pub.links.map((l) => l.url), ...fromId]) {
    const key = linkKey(url)
    if (key && isProfile(url) && !expected.has(key)) expected.set(key, url)
  }
  const live = card.artist ? sameAsUrls(card.artist.sameAs) : []
  const seen = new Map<string, string>()
  const twice: string[] = []
  const notProfile: string[] = []
  for (const u of live) {
    if (!isProfile(u)) {
      notProfile.push(u)
      continue
    }
    const key = linkKey(u) ?? u
    if (seen.has(key)) twice.push(u)
    else seen.set(key, u)
  }
  const missing = [...expected].filter(([k]) => !seen.has(k)).map(([, u]) => u)
  const extra = [...seen].filter(([k]) => !expected.has(k)).map(([, u]) => u)
  const connections = { kind: 'edit', target: 'connections', label: 'Open Connections' } as const
  const limits = `We check the links match the profiles you published in Tapir. We don’t open each profile, so we can’t confirm an account is really yours. ${HOME_CARD}`
  const cardRow: Row[] = card.none ? [{ label: 'fact card', value: 'none on the home page' }] : card.artist ? [] : card.others.length ? [{ label: 'fact card', value: `describes ${card.others.map((o) => `“${clip(o, 40)}”`).join(', ')}, not you` }] : [{ label: 'fact card', value: 'no artist in it' }]
  const evidence = [
    { label: 'listed on your site', value: live.length ? listOf(live.map((u) => shortUrl(u, 50)), 8) : 'none' },
    ...(missing.length ? [{ label: 'in Tapir: not on your site', value: listOf(missing.map((u) => shortUrl(u, 50))) }] : []),
    ...(extra.length ? [{ label: 'not in Tapir', value: listOf(extra.map((u) => shortUrl(u, 50))) }] : []),
    ...(notProfile.length ? [{ label: 'not a profile page', value: listOf(notProfile.map((u) => shortUrl(u, 50))) }] : []),
    ...(twice.length ? [{ label: 'listed twice', value: listOf(twice.map((u) => shortUrl(u, 50))) }] : []),
    ...cardRow,
  ]
  const n = expected.size
  if (!n && !live.length) {
    const hasLinks = pub.links.some((l) => linkKey(l.url))
    return {
      status: 'fail', value: 'no profiles',
      sentence: hasLinks ? 'none of your links is a profile page, so search engines can’t link your accounts to you.' : 'you haven’t connected any profiles, so search engines can’t link your accounts to you.',
      todo: 'Connect your Spotify, Instagram and the rest in Connections, then publish.', action: connections, evidence, limits,
    }
  }
  const value = n ? `${n - missing.length} of ${n}` : `${live.length} listed`
  if (!card.artist && card.others.length && n) {
    return { status: 'fail', value, sentence: `your fact card describes ${clip(card.others[0], 40)}, not you, so your profiles aren’t listed for you.`, todo: UPDATE, action: connections, evidence, limits }
  }
  if (!missing.length && !extra.length && !notProfile.length && !twice.length) {
    return { status: 'pass', value, sentence: n === 1 ? 'Your fact card lists your one profile.' : `Your fact card lists all ${n} of your profiles.`, evidence, limits }
  }
  const [sentence, todo] = missing.length
    ? [`${missing.length} of your ${n} ${plural(n, 'profile')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} in your fact card yet.`, UPDATE]
    : extra.length
      ? [`your fact card lists ${extra.length} ${plural(extra.length, 'profile')} that ${extra.length === 1 ? 'isn’t' : 'aren’t'} in Connections.`, 'Add it in Connections if it’s yours; otherwise publish so your site drops it.']
      : notProfile.length
        ? [`${notProfile.length} ${plural(notProfile.length, 'link')} in your fact card ${notProfile.length === 1 ? 'isn’t a profile page' : 'aren’t profile pages'}.`, 'Use the link to your profile page (not a song or playlist) in Connections, then publish.']
        : [`your fact card lists ${twice.length} ${plural(twice.length, 'profile')} twice.`, UPDATE]
  return { status: 'fail', value, sentence, todo, action: connections, evidence, limits }
})

/* ── apple ──────────────────────────────────────────────────────────────────────────── */

const isAppleMusic = (u: string) => {
  try {
    return /(^|\.)music\.apple\.com$/i.test(new URL(u).hostname)
  } catch {
    return false
  }
}

/** The artist's place on the card → its country code, when the site states one. */
function cardCountry(artist: LdNode | null): string | null {
  if (!artist) return null
  for (const k of ['foundingLocation', 'homeLocation', 'location']) {
    const raw = artist[k]
    const p = Array.isArray(raw) ? raw[0] : raw
    if (isObj(p) && isObj(p.address)) {
      const code = countryCode(textOf(p.address.addressCountry))
      if (code) return code
    }
  }
  return null
}

/**
 * Where the artist is based, for the store comparison. TAPIR'S PUBLISHED FACTS FIRST: the
 * question is "the store vs where you are", and the artist's own answer is the Country they
 * published on the Facts tab. The card's own country is used only when Tapir has none (a site
 * that states it by hand), and is labelled as the site's.
 */
function basedIn(pub: SeoKnown['published'], artist: LdNode | null): { code: string; from: 'tapir' | 'card' } | null {
  const tapir = pub ? (pub.countryCode ?? countryCode(pub.country)) : null
  if (tapir) return { code: tapir, from: 'tapir' }
  const card = cardCountry(artist)
  return card ? { code: card, from: 'card' } : null
}

const apple = make('apple', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your Apple Music links')
  const limits = 'We read the store written in each Apple Music link on the pages we read (5 at most): your artist page, and every album, song or playlist link, since we can’t tell whose album a link is. A web browser opens that store; Apple’s own app may switch to the fan’s store, which we can’t check.'
  const found = new Map<string, string>()
  const add = (u: string) => {
    const key = linkKey(u)
    if (key && isAppleMusic(u) && !found.has(key)) found.set(key, u)
  }
  if (card.artist) for (const u of sameAsUrls(card.artist.sameAs)) add(u)
  for (const p of pagesOf(e)) if (p.ok) for (const u of p.page.links) add(u)
  const links = [...found.values()]
  const blind = blindPaths(e)
  if (!links.length) {
    // "Doesn't apply" only when every page was read in full: an unread page may hold one.
    if (card.cut) return tooBig('whether it has an Apple Music link')
    if (blind.length) return { status: 'unknown', value: 'couldn’t check', sentence: `we found no Apple Music link, but we couldn’t read all of ${blind.join(', ')}.`, evidence: [{ label: 'not read in full', value: blind.join(', ') }], limits }
    return { status: 'na', value: 'no Apple Music link', sentence: 'your site has no Apple Music link.', evidence: [{ label: 'Apple Music links', value: 'none on the pages we read' }], limits }
  }
  // Your own Apple artist id(s): from Tapir's links and the card. An artist link with another id
  // is someone else's (a support act) and is listed, not judged.
  const ownIds = new Set<string>()
  for (const u of [...(e.known.published?.links ?? []).map((l) => l.url), ...(card.artist ? sameAsUrls(card.artist.sameAs) : [])]) {
    const info = appleLinkOf(u)
    if (info?.kind === 'artist') ownIds.add(info.id)
  }
  const others: string[] = []
  const judged: { u: string; store: string; known: boolean; kind: string }[] = []
  for (const u of links) {
    const info = appleLinkOf(u)
    if (!info) continue
    if (info.kind === 'artist' && ownIds.size && !ownIds.has(info.id)) others.push(u)
    else judged.push({ u, store: info.store, known: info.known, kind: info.kind })
  }
  const evidence: Row[] = [
    { label: 'Apple Music links', value: listOf(links.filter((u) => !others.includes(u)).map((u) => shortUrl(u, 60))) },
    ...(others.length ? [{ label: 'other artists’ Apple links, not checked', value: listOf(others.map((u) => shortUrl(u, 60))) }] : []),
  ]
  if (!judged.length) {
    return { status: 'pass', value: 'no country store', sentence: 'Your Apple Music links aren’t tied to one country’s store.', evidence, limits }
  }
  const place = basedIn(e.known.published, card.artist)
  const onCard = cardCountry(card.artist)
  const facts = { kind: 'edit', target: 'facts', label: 'Add your country' } as const
  if (!place) {
    const first = judged[0]
    const typed = e.known.published?.country
    return {
      status: 'unknown', value: 'country not said',
      sentence: first.known
        ? `your Apple Music link opens the ${storeName(first.store)} store, and we don’t know which country you’re based in.`
        : `your Apple Music link names a store Apple doesn’t have (“/${first.store}/”), and we don’t know which country you’re based in.`,
      action: facts,
      evidence: [
        ...evidence, { label: 'store', value: first.known ? `${first.store} = ${storeName(first.store)}` : `${first.store} (not an Apple store)` },
        { label: 'in Tapir: you’re based in', value: typed ? `${typed} (a country we don’t recognise)` : 'no country on the Facts tab' },
        { label: 'fact card: based in', value: 'no country' },
      ],
      limits,
    }
  }
  const country = place.code
  const wrong = judged.filter((x) => !x.known || x.store !== country.toLowerCase())
  const base = [
    ...evidence,
    place.from === 'tapir' ? { label: 'in Tapir: you’re based in', value: `${country} = ${countryName(country)}` } : { label: 'fact card: based in', value: `${country} = ${countryName(country)}` },
    ...(place.from === 'tapir' && onCard && onCard !== country ? [{ label: 'fact card: based in', value: `${onCard} = ${countryName(onCard)}` }] : []),
  ]
  if (!wrong.length) {
    const n = judged.length
    return { status: 'pass', value: `${country} store`, sentence: `Your Apple Music ${plural(n, 'link opens', 'links open')} the ${storeName(country)} store, where you’re based.`, evidence: base, limits }
  }
  const w = wrong[0]
  const inTapir = (e.known.published?.links ?? []).some((l) => linkKey(l.url) === linkKey(w.u))
  const fix = w.known && w.kind === 'artist' && country === 'US' && inTapir ? appleStorefrontFix(w.u) : null
  const what = w.kind === 'artist' ? 'link' : `${w.kind.replace('-', ' ')} link`
  const rows = [...base, { label: 'link', value: w.u }, { label: 'store', value: w.known ? `${w.store} = ${storeName(w.store)}` : `${w.store} (not an Apple store)` }, ...(wrong.length > 1 ? [{ label: 'other links with the wrong store', value: listOf(wrong.slice(1).map((x) => shortUrl(x.u, 60))) }] : []), ...(fix ? [{ label: 'in Tapir: after the fix', value: fix.fixed }] : [])]
  const sentence = w.known
    ? `your Apple Music ${what} opens the ${storeName(w.store)} store, but you’re based in ${countryName(country)}.`
    : `your Apple Music ${what} names a store Apple doesn’t have (“/${w.store}/”); you’re based in ${countryName(country)}.`
  const value = (w.known ? `${storeName(w.store)} store` : `no “${w.store}” store`).slice(0, 28)
  if (fix) return { status: 'fail', lead: 'Almost', value, sentence, todo: 'Switch it to the US store. One click.', action: { kind: 'fix', fix: 'apple-storefront', label: 'Fix the Apple Music link' }, evidence: rows, limits }
  return {
    status: 'fail', lead: 'Almost', value, sentence,
    todo: inTapir ? `In Connections, paste your Apple Music link from the ${storeName(country)} store, then publish.` : `This link isn’t from Tapir: ask whoever built your site to use the ${storeName(country)} store (“/${country.toLowerCase()}/”) in it.`,
    action: { kind: 'edit', target: 'connections', label: 'Open Connections' }, evidence: rows, limits,
  }
})

/* ── shows ──────────────────────────────────────────────────────────────────────────── */

const EVENT_TYPES = ['MusicEvent', 'Event', 'Festival', 'ComedyEvent', 'DanceEvent', 'TheaterEvent']
const OFF = /(EventCancelled|EventPostponed)$/

function eventCity(ev: LdNode): string | null {
  const loc = Array.isArray(ev.location) ? ev.location[0] : ev.location
  if (!isObj(loc)) return null
  const a = loc.address
  if (isObj(a)) return textOf(a.addressLocality)
  return null
}

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

const shows = make('shows', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your shows')
  const pub = e.known.published
  if (!pub) return noPublished('your shows')
  const today = dayOf(e.known.today)
  const limits = `We read the shows your home page gives search engines (top-level only), not which ones its design labels as coming up. Days are counted in UTC, and a show only counts as past a day after its date, so a late show isn’t called old while it’s still on.`
  if (!today) return { status: 'unknown', value: 'couldn’t check', sentence: 'we didn’t know today’s date, so we couldn’t check your shows.', evidence: [], limits }
  if (card.broken) return { status: 'unknown', value: 'couldn’t read', sentence: 'part of your fact card can’t be read, so we couldn’t see every show it lists.', evidence: [{ label: 'fact card', value: 'a block doesn’t parse (see “Search engines can read your fact card”)' }], limits }
  const yesterday = dayBefore(today)
  const upcoming: { day: string; city: string | null; name: string }[] = []
  const stale: string[] = []
  const undated: string[] = []
  for (const ev of card.nodes.filter((n) => hasType(n, ...EVENT_TYPES))) {
    if (OFF.test(String(ev.eventStatus ?? ''))) continue
    const name = textOf(ev.name) ?? 'a show'
    const start = dayOf(ev.startDate)
    if (!start) {
      undated.push(`${name} · ${typeof ev.startDate === 'string' ? `“${clip(ev.startDate, 30)}”` : 'no date'}`)
      continue
    }
    const end = dayOf(ev.endDate)
    if (start >= today) upcoming.push({ day: start, city: eventCity(ev), name })
    // Yesterday (UTC) may still be tonight where the show is: not called old yet. Started
    // before that but still running (a festival's end date): not old either. Neither is
    // "coming up", so Tour (which dates a show by its first day) isn't asked about them.
    else if (start === yesterday || (end !== null && end >= today)) continue
    else stale.push(`${prettyDay(start)} · ${name}`)
  }
  const expected = pub.tourDates.filter((t) => !t.isPast && (dayOf(t.date) ?? '') >= today && dayOf(t.date))
  const noCity = expected.filter((t) => !(t.city ?? '').trim())
  const wanted = expected.filter((t) => (t.city ?? '').trim())
  const unmatched = [...upcoming]
  const missing: string[] = []
  for (const t of wanted) {
    const day = dayOf(t.date)!
    const i = unmatched.findIndex((u) => u.day === day && (u.city === null || matchFold(u.city) === matchFold(t.city!)))
    if (i >= 0) unmatched.splice(i, 1)
    else missing.push(`${prettyDay(day)} · ${[t.venue, t.city].filter(Boolean).join(', ')}`)
  }
  const extra = unmatched.map((u) => `${prettyDay(u.day)} · ${u.name}`)
  const evidence = [
    { label: 'upcoming on your site', value: upcoming.length ? listOf(upcoming.map((u) => `${prettyDay(u.day)} · ${u.name}`)) : 'none' },
    ...(stale.length ? [{ label: 'past, listed as coming up', value: listOf(stale) }] : []),
    ...(undated.length ? [{ label: 'dates search engines can’t read', value: listOf(undated) }] : []),
    ...(missing.length ? [{ label: 'in Tapir: in Tour, not on your site', value: listOf(missing) }] : []),
    ...(extra.length ? [{ label: 'on your site, not in Tour', value: listOf(extra) }] : []),
    ...(noCity.length ? [{ label: 'in Tapir: left out (no city)', value: listOf(noCity.map((t) => `${prettyDay(dayOf(t.date)!)} · ${t.venue ?? 'no venue'}`)) }] : []),
    { label: 'today (UTC)', value: prettyDay(today) },
  ]
  const tour = { kind: 'edit', target: 'tour', label: 'Open Tour' } as const
  if (stale.length) return { status: 'fail', value: `${stale.length} old ${plural(stale.length, 'show')}`, sentence: `your site still lists ${stale.length} past ${plural(stale.length, 'show')} as coming up.`, todo: UPDATE, action: tour, evidence, limits }
  if (undated.length) return { status: 'fail', value: `${undated.length} unreadable ${plural(undated.length, 'date')}`, sentence: `${undated.length} ${plural(undated.length, 'show')} on your site ${undated.length === 1 ? 'has a date' : 'have dates'} search engines can’t read.`, todo: UPDATE, action: tour, evidence, limits }
  if (extra.length) return { status: 'fail', value: `${extra.length} not in Tour`, sentence: `your site lists ${extra.length} upcoming ${plural(extra.length, 'show')} that Tour doesn’t have.`, todo: 'Publish from Tapir so your site catches up with Tour.', action: tour, evidence, limits }
  // What we did NOT see may be past the cut: a missing show, or "all clear", can't be said.
  if (card.cut) return tooBig('every show it lists', evidence)
  if (missing.length) return { status: 'fail', value: `${missing.length} missing`, sentence: `${missing.length} upcoming ${plural(missing.length, 'show')} from Tour ${missing.length === 1 ? 'isn’t' : 'aren’t'} on your site yet.`, todo: UPDATE, action: tour, evidence, limits }
  const cityless = noCity.length ? ` Tour has ${noCity.length} ${plural(noCity.length, 'show')} with no city, which search engines don’t get.` : ''
  if (!upcoming.length) return { status: 'pass', value: 'none booked', sentence: `No old shows are listed as coming up.${cityless || ' Tour has none coming up either.'}`, evidence, limits }
  return { status: 'pass', value: `${upcoming.length} upcoming`, sentence: `Your ${upcoming.length} upcoming ${plural(upcoming.length, 'show')} ${upcoming.length === 1 ? 'matches' : 'match'} Tour, and no old shows are listed as coming up.${cityless}`, evidence, limits }
})

/* ── releases ───────────────────────────────────────────────────────────────────────── */

const releases = make('releases', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your releases')
  const pub = e.known.published
  if (!pub) return noPublished('your releases')
  const limits = 'We match releases by title in the facts your home page gives search engines, and look for each one in the words and cover descriptions of the pages we read (5 at most) with scripts off. A title that is one common menu word (like “Home”) found only in running text can’t be told from the menu, and any other one-word title counts wherever it appears. We don’t check songs, dates or links.'
  if (card.broken) return { status: 'unknown', value: 'couldn’t read', sentence: 'part of your fact card can’t be read, so we couldn’t see every release it lists.', evidence: [{ label: 'fact card', value: 'a block doesn’t parse (see “Search engines can read your fact card”)' }], limits }
  const albums = card.nodes.filter((n) => hasType(n, 'MusicAlbum', 'MusicRelease'))
  const live = albums.map((a) => ({ name: collapse(textOf(a.name) ?? ''), day: dayOf(a.datePublished) })).filter((a) => a.name)
  const pool = new Map<string, number>()
  for (const a of live) pool.set(matchFold(a.name), (pool.get(matchFold(a.name)) ?? 0) + 1)
  const titles = pub.releases.map((r) => ({ ...r, title: collapse(r.title) }))
  const missing: string[] = []
  for (const r of titles) {
    const k = matchFold(r.title)
    const left = pool.get(k) ?? 0
    if (left > 0) pool.set(k, left - 1)
    else missing.push(r.title)
  }
  const extra: string[] = []
  for (const a of live) {
    const k = matchFold(a.name)
    if ((pool.get(k) ?? 0) > 0) {
      extra.push(a.name)
      pool.set(k, pool.get(k)! - 1)
    }
  }
  const n = titles.length
  const today = dayOf(e.known.today)
  // "Newest" only among releases with a date that has come: never an undated one, never one
  // dated in the future.
  const newest = titles.filter((r) => dayOf(r.releasedOn) && (!today || dayOf(r.releasedOn)! <= today)).sort((x, y) => dayOf(y.releasedOn)!.localeCompare(dayOf(x.releasedOn)!))[0]
  const newestLive = [...live].filter((a) => a.day).sort((x, y) => y.day!.localeCompare(x.day!))[0]
  // Every release the card lists must be one a page SHOWS (Google: markup describes what the
  // page shows). skeen, 2026-09-29: the card listed "Home Again", "Summer Sun" and "#lola!"
  // (released and ticked on the site, but none of their songs are), the page's grid did not.
  const pages = pagesOf(e)
  const readable = pages.filter((p): p is Extract<PageState, { ok: true }> => p.ok).map((p) => p.page)
  const seenName = new Set<string>()
  const unshown: string[] = []
  const unsure: string[] = []
  for (const a of live) {
    const k = matchFold(a.name)
    if (seenName.has(k)) continue
    seenName.add(k)
    const shown = titleShown(a.name, readable)
    if (shown === 'no') unshown.push(a.name)
    else if (shown === 'unsure') unsure.push(a.name)
  }
  const blind = blindPaths(e)
  const evidence = [
    { label: 'on your site', value: `${live.length} ${plural(live.length, 'release')}` },
    ...(newestLive ? [{ label: 'newest on your site', value: `${newestLive.name} · ${prettyDay(newestLive.day!)}` }] : []),
    { label: 'in Tapir', value: `${n} published ${plural(n, 'release')}` },
    ...(missing.length ? [{ label: 'in Tapir: not on your site', value: listOf(missing) }] : []),
    ...(extra.length ? [{ label: 'not in Music', value: listOf(extra) }] : []),
    ...(unshown.length ? [{ label: 'on your fact card, not on your pages', value: listOf(unshown) }] : []),
    ...(unsure.length ? [{ label: 'can’t tell if your pages show', value: listOf(unsure) }] : []),
    ...(blind.length ? [{ label: 'not read in full', value: blind.join(', ') }] : []),
  ]
  const music = { kind: 'edit', target: 'music', label: 'Open Music' } as const
  if (!n && !live.length) {
    if (card.cut) return tooBig('which releases it lists', evidence)
    if (pub.artistType === 'Person') {
      return { status: 'na', value: 'no releases', sentence: 'you’re listed in Tapir as a visual artist with no releases.', evidence, limits }
    }
    return { status: 'fail', value: 'no releases', sentence: 'Tapir has no published releases for you, so search engines have none to list.', todo: 'Add your releases in Music, then publish.', action: music, evidence, limits }
  }
  const value = `${n - missing.length} of ${n}`
  if (extra.length) return { status: 'fail', value, sentence: `your site lists ${extra.length} ${plural(extra.length, 'release')} that ${extra.length === 1 ? 'isn’t' : 'aren’t'} in Music.`, todo: 'Publish from Tapir so your site drops it.', action: music, evidence, limits }
  if (missing.length && card.cut) return tooBig('every release it lists', evidence)
  if (newest && missing.includes(newest.title)) {
    return { status: 'fail', value, sentence: `your newest release, “${clip(newest.title, 60)}”, isn’t listed for search engines yet.`, todo: UPDATE, action: music, evidence, limits }
  }
  if (missing.length) return { status: 'fail', value, sentence: `${missing.length} of your ${n} ${plural(n, 'release')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} listed for search engines.`, todo: UPDATE, action: music, evidence, limits }
  const named = (xs: string[]) => xs.slice(0, 3).map((t) => `“${clip(t, 40)}”`).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '')
  if (unshown.length) {
    if (blind.length) {
      return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${blind.join(', ')}, and your fact card lists ${named(unshown)}, which the pages we read don’t show.`, evidence, limits }
    }
    return {
      status: 'fail', value: `${unshown.length} not shown`,
      sentence: `your fact card lists ${unshown.length} ${plural(unshown.length, 'release')} the pages we read don’t show: ${named(unshown)}.`,
      todo: 'Put their songs on your site in Music and publish, or ask whoever built your site to list only the releases your pages show.',
      action: music, evidence, limits,
    }
  }
  if (card.cut) return tooBig('every release it lists', evidence)
  if (unsure.length) {
    const wordless = unsure.filter((t) => !/[\p{L}\p{N}]/u.test(t))
    const why = wordless.length === unsure.length ? 'the title has no words we can look for' : 'the word is also in your site’s menu'
    return { status: 'unknown', value: 'couldn’t tell', sentence: `we can’t tell whether your pages show ${named(unsure)}: ${why}.`, evidence, limits }
  }
  return {
    status: 'pass', value: `${num(n)} ${plural(n, 'release')}`,
    sentence: n === 1 ? `Your release “${clip(titles[0].title, 60)}” is listed.` : newest ? `All ${n} of your releases are listed, including your newest, “${clip(newest.title, 60)}”.` : `All ${n} of your releases are listed.`,
    evidence, limits,
  }
})

/* ── card ───────────────────────────────────────────────────────────────────────────── */

const SCHEMA_ORG = /^https?:\/\/schema\.org\/?$/i
function usesSchemaOrg(ctx: unknown): boolean {
  if (typeof ctx === 'string') return SCHEMA_ORG.test(ctx.trim())
  if (Array.isArray(ctx)) return ctx.some(usesSchemaOrg)
  if (isObj(ctx)) return Object.values(ctx).some((v) => typeof v === 'string' && SCHEMA_ORG.test(v.trim()))
  return false
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)

/** Fields Google marks REQUIRED for the Event family, which the bridge's list names only as
 *  MusicEvent (a hand-written card may say plain "Event"). */
const EVENT_REQUIRED = ['name', 'startDate', 'location']
const REQUIRED: Record<string, readonly string[]> = {
  ...JSON_LD_REQUIRED,
  Event: EVENT_REQUIRED, Festival: EVENT_REQUIRED, DanceEvent: EVENT_REQUIRED, ComedyEvent: EVENT_REQUIRED, TheaterEvent: EVENT_REQUIRED,
}
/** Types an artist's site uses that we recognise; any other is named in the details (a typo
 *  like "MusicAlbun" is read by nobody), not failed: schema.org has hundreds more. */
const KNOWN_TYPES = new Set([
  ...Object.keys(REQUIRED), 'MusicRelease', 'MusicPlaylist', 'Organization', 'Place', 'PostalAddress', 'Offer', 'AggregateOffer', 'FAQPage', 'Question', 'Answer',
  'BreadcrumbList', 'ListItem', 'ItemList', 'WebPage', 'ProfilePage', 'AboutPage', 'ContactPage', 'CollectionPage', 'Product', 'Brand', 'Thing', 'CreativeWork',
  'AudioObject', 'MediaObject', 'Review', 'AggregateRating', 'Rating', 'SearchAction', 'EntryPoint', 'ContactPoint', 'Country', 'City', 'State', 'DefinedTerm',
  'LocalBusiness', 'MusicVenue', 'EventVenue', 'Article', 'NewsArticle', 'BlogPosting', 'Service', 'ListenAction', 'WatchAction', 'ReadAction', 'SiteNavigationElement',
  'ImageGallery', 'MusicComposition', 'PerformingGroup', 'Blog', 'VirtualLocation', 'PropertyValue', 'QuantitativeValue', 'Duration', 'Language', 'OrganizationRole',
])
const DATE_FIELDS = ['startDate', 'endDate', 'datePublished', 'uploadDate', 'dateCreated']
const isWebUrl = (v: unknown) => {
  if (typeof v !== 'string') return false
  try {
    return /^https?:$/.test(new URL(v).protocol)
  } catch {
    return false
  }
}

/** What one node is missing or has of the wrong kind (Google's required fields per type). */
function nodeProblems(node: LdNode, where: string, out: string[], unknownTypes: Set<string>) {
  const types = typesOf(node)
  if (!types.length && Object.keys(node).some((k) => !k.startsWith('@'))) out.push(`${where} has no type`)
  for (const t of types) {
    if (!KNOWN_TYPES.has(t)) unknownTypes.add(t)
    for (const f of REQUIRED[t] ?? []) if (blank(node[f])) out.push(`${where} is missing ${f}`)
  }
  if (node.name !== undefined && !blank(node.name) && typeof node.name !== 'string') out.push(`${where}'s name isn’t text`)
  if (node.url !== undefined && !blank(node.url) && !(isObj(node.url) && typeof node.url['@id'] === 'string') && !isWebUrl(node.url)) out.push(`${where}'s url isn’t a web address`)
  for (const f of DATE_FIELDS) if (node[f] !== undefined && !blank(node[f]) && !dayOf(node[f])) out.push(`${where}'s ${f} isn’t a date search engines read (${clip(String(node[f]), 30)})`)
  if (types.some((t) => EVENT_TYPES.includes(t)) && node.location !== undefined) {
    const loc = Array.isArray(node.location) ? node.location[0] : node.location
    if (!isObj(loc) || blank(loc.address)) out.push(`${where}'s place has no address`)
  }
  if (types.includes('MusicAlbum') && Array.isArray(node.track)) {
    node.track.forEach((t, i) => {
      if (isObj(t)) nodeProblems(t, `${where} track ${i + 1}`, out, unknownTypes)
    })
  }
}

function typeSummary(nodes: LdNode[]): string {
  const counts = new Map<string, number>()
  for (const n of nodes) for (const t of typesOf(n).slice(0, 1)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([t, c]) => (c > 1 ? `${c} ${t}` : t)).join(' · ') || 'nothing'
}

const card = make('card', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your fact card')
  const problems: string[] = []
  const cut: string[] = []
  const unknownTypes = new Set<string>()
  const evidence: Row[] = []
  let broken = false
  let empty = false
  const pages = pagesOf(e)
  for (const p of pages) {
    if (!p.ok) continue
    const blocks = p.page.ld
    const isHome = p.path === home.path
    if (!blocks.length) {
      // A page read only in part may carry its card past the cut.
      if (isHome && p.truncated) cut.push(p.path)
      else if (isHome) {
        problems.push(`${p.path}: no fact card`)
        empty = true
      }
      continue
    }
    const nodes: LdNode[] = []
    blocks.forEach((b, i) => {
      const where = `${p.path}: block ${i + 1}`
      if (!b.raw.trim()) {
        problems.push(`${where} is empty`)
        empty = true
        return
      }
      if (b.error !== null) {
        if (p.truncated && i === blocks.length - 1) cut.push(p.path)
        else {
          problems.push(`${where} can’t be read (${b.error})`)
          broken = true
        }
        return
      }
      const found = ldNodes(b.parsed)
      if (!found.some((n) => Object.keys(n).some((k) => !k.startsWith('@')))) {
        problems.push(`${where} is empty`)
        empty = true
        return
      }
      const tops = Array.isArray(b.parsed) ? b.parsed : [b.parsed]
      if (tops.some((t) => isObj(t) && !usesSchemaOrg(t['@context']))) problems.push(`${where} doesn’t say it uses schema.org`)
      found.forEach((n, j) => nodeProblems(n, `${where} ${typesOf(n)[0] ?? 'node'} #${j + 1}`, problems, unknownTypes))
      nodes.push(...found)
    })
    if (isHome && nodes.length && !nodes.some((n) => hasType(n, 'MusicGroup', 'Person'))) {
      if (p.truncated) cut.push(p.path)
      else problems.push(`${p.path}: no artist (MusicGroup or Person)`)
    }
    evidence.push({ label: p.path, value: `${typeSummary(nodes)}${blocks.length > 1 ? ` (${blocks.length} blocks)` : ''}` })
  }
  const limits = 'We check that each block on the pages we read (5 at most) reads, and has the details Google marks as required for its kind, of the right kind. We don’t check that every fact in it is true; the other tests do some of that.'
  if (problems.length) evidence.push({ label: 'problems', value: listOf(problems, 8) })
  if (unknownTypes.size) evidence.push({ label: 'types we don’t know', value: listOf([...unknownTypes], 8) })
  if (cut.length) evidence.push({ label: 'too big to read in full', value: [...new Set(cut)].join(', ') })
  const blind = pages.filter((p) => !p.ok && p.noAnswer).map((p) => p.path)
  if (blind.length) evidence.push({ label: 'not read', value: blind.join(', ') })
  if (problems.length) {
    const sentence = broken
      ? 'part of your fact card is broken, so search engines can’t read it.'
      : empty
        ? 'your home page has no fact card for search engines, or it is empty.'
        : `${problems.length} ${plural(problems.length, 'detail')} search engines need ${problems.length === 1 ? 'is' : 'are'} missing or wrong in your fact card.`
    return { status: 'fail', value: `${problems.length} ${plural(problems.length, 'problem')}`, sentence, todo: UPDATE, evidence, limits }
  }
  if (cut.includes(home.path)) return tooBig('the whole fact card reads', evidence)
  if (cut.length || blind.length) {
    return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${[...new Set([...cut, ...blind])].join(', ')}, so we can’t say the whole fact card reads.`, evidence, limits }
  }
  return { status: 'pass', value: 'no errors', sentence: 'Search engines can read your fact card with no errors.', evidence, limits }
})

export const FACTS_TESTS: Record<Id, SeoTest> = { profiles, apple, shows, releases, card }
