/**
 * "Facts are true": five tests of the LIVE fact card (the JSON-LD a site hands search
 * engines), compared to what Tapir published where the comparison is the claim. Pure,
 * synchronous, never throws.
 *
 *   profiles  the artist's `sameAs` lists exactly the identity profiles Tapir published
 *   apple     an Apple Music link's store matches the country the site says they're based in
 *   shows     no past show stated as upcoming; upcoming shows match Tour
 *   releases  every published release is on the card (the newest first of all)
 *   card      every block on every tested page parses, is not empty, and has what each type needs
 */
import { JSON_LD_REQUIRED, isIdentityProfileUrl } from '@samfox1/site-bridge/seo'
import { appleStorefrontFix, appleStorefrontOf, countryCode, countryName } from './apple-storefront'
import {
  artistNodeOf, dayOf, fold, hasType, homeOf, isObj, ldNodes, linkKey, num, pageNodes, pagesOf, plural, prettyDay,
  shortUrl, strings, textOf, typesOf, type LdNode, type Page, type PageState,
} from './html'
import type { SeoEvidence, SeoTest, SeoTestId, SeoTestResult } from './types'

type Id = Extract<SeoTestId, 'profiles' | 'apple' | 'shows' | 'releases' | 'card'>
type Result = Omit<SeoTestResult, 'id'>

const make = (id: Id, test: (e: SeoEvidence) => Result): SeoTest => (e) => {
  try {
    return { id, ...test(e) }
  } catch {
    return { id, status: 'unknown', value: 'couldn’t check', sentence: 'something went wrong reading your site, so we couldn’t check this.', evidence: [] }
  }
}

function unreadable(state: Extract<PageState, { ok: false }>, what: string): Result {
  return { status: 'unknown', value: 'couldn’t open', sentence: `${state.why}, so we couldn’t ${what}.`, evidence: [{ label: 'home page', value: state.why }] }
}

const noPublished = (what: string): Result => ({
  status: 'unknown', value: 'couldn’t compare', sentence: `we couldn’t read what you published in Tapir, so we couldn’t compare ${what}.`, evidence: [],
})

const listOf = (xs: string[], max = 5) => xs.slice(0, max).join(' · ') + (xs.length > max ? ` · and ${xs.length - max} more` : '')
const UPDATE = 'Publish from Tapir, then test again. If it stays, your site needs an update from whoever built it.'

/** The home page's fact card: its artist node and every top-level node, or why not. */
function homeCard(e: SeoEvidence): { state: Extract<PageState, { ok: false }> } | { page: Page; artist: LdNode | null; nodes: LdNode[]; broken: boolean; none: boolean } {
  const home = homeOf(e)
  if (!home.ok) return { state: home }
  return {
    page: home.page,
    artist: artistNodeOf(home.page, e.known.artistName),
    nodes: pageNodes(home.page),
    broken: home.page.ld.some((b) => b.error !== null),
    none: home.page.ld.length === 0,
  }
}

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
  const expected = new Map<string, string>()
  for (const l of pub.links) {
    const key = linkKey(l.url)
    if (key && isProfile(l.url) && !expected.has(key)) expected.set(key, l.url)
  }
  const live = card.artist ? strings(card.artist.sameAs) : []
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
  const limits = 'We check the links match the profiles you published in Tapir. We don’t open each profile, so we can’t confirm an account is really yours.'
  const evidence = [
    { label: 'listed on your site', value: live.length ? listOf(live.map((u) => shortUrl(u, 50)), 8) : 'none' },
    ...(missing.length ? [{ label: 'not on your site', value: listOf(missing.map((u) => shortUrl(u, 50))) }] : []),
    ...(extra.length ? [{ label: 'not in Tapir', value: listOf(extra.map((u) => shortUrl(u, 50))) }] : []),
    ...(notProfile.length ? [{ label: 'not a profile page', value: listOf(notProfile.map((u) => shortUrl(u, 50))) }] : []),
    ...(twice.length ? [{ label: 'listed twice', value: listOf(twice.map((u) => shortUrl(u, 50))) }] : []),
    ...(card.none ? [{ label: 'fact card', value: 'none on the home page' }] : card.artist ? [] : [{ label: 'fact card', value: 'no artist in it' }]),
  ]
  const n = expected.size
  if (!n && !live.length) {
    return { status: 'fail', value: 'no profiles', sentence: 'you haven’t connected any profiles, so search engines can’t link your accounts to you.', todo: 'Connect your Spotify, Instagram and the rest in Connections, then publish.', action: connections, evidence, limits }
  }
  const value = n ? `${n - missing.length} of ${n}` : `${live.length} listed`
  if (!missing.length && !extra.length && !notProfile.length && !twice.length) {
    return { status: 'pass', value, sentence: n === 1 ? 'Your fact card lists your one profile.' : `Your fact card lists all ${n} of your profiles.`, evidence, limits }
  }
  const [sentence, todo] = missing.length
    ? [`${missing.length} of your ${n} ${plural(n, 'profile')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} in your fact card yet.`, UPDATE]
    : extra.length
      ? [`your fact card lists ${extra.length} ${plural(extra.length, 'profile')} Tapir doesn’t have.`, 'Add it in Connections if it’s yours; otherwise publish so your site drops it.']
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
function artistCountry(artist: LdNode | null): string | null {
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

const apple = make('apple', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your Apple Music link')
  const limits = 'We read the store written in each Apple Music link. A web browser opens that store; Apple’s own app may switch to the fan’s store, which we can’t check.'
  const found = new Map<string, string>()
  const add = (u: string) => {
    const key = linkKey(u)
    if (key && isAppleMusic(u) && !found.has(key)) found.set(key, u)
  }
  if (card.artist) for (const u of strings(card.artist.sameAs)) add(u)
  for (const p of pagesOf(e)) if (p.ok) for (const u of p.page.links) add(u)
  const links = [...found.values()]
  if (!links.length) return { status: 'pass', value: 'no Apple Music link', sentence: 'Your site has no Apple Music link, so there’s no store to get wrong.', evidence: [{ label: 'Apple Music links', value: 'none on your site' }], limits }
  const pinned = links.map((u) => ({ u, store: appleStorefrontOf(u) })).filter((x): x is { u: string; store: string } => !!x.store)
  const evidence = [{ label: 'Apple Music links', value: listOf(links.map((u) => shortUrl(u, 60))) }]
  if (!pinned.length) return { status: 'pass', value: 'fan’s own store', sentence: 'Your Apple Music link lets Apple open each fan’s own store.', evidence, limits }
  const country = artistCountry(card.artist)
  const facts = { kind: 'edit', target: 'facts', label: 'Add your country' } as const
  if (!country) {
    const first = pinned[0]
    return {
      status: 'unknown', value: 'country not said',
      sentence: `your Apple Music link opens the ${countryName(first.store)} store, and your site doesn’t say which country you’re based in, so we can’t tell if that’s right.`,
      action: facts, evidence: [...evidence, { label: 'store', value: `${first.store} = ${countryName(first.store)}` }, { label: 'you’re based in', value: 'not on your site' }], limits,
    }
  }
  const wrong = pinned.filter((x) => x.store !== country.toLowerCase())
  const base = [...evidence, { label: 'you’re based in', value: `${country} = ${countryName(country)}` }]
  if (!wrong.length) {
    return { status: 'pass', value: `${country} store`, sentence: `Your Apple Music link opens the ${countryName(country)} store, where you’re based.`, evidence: base, limits }
  }
  const w = wrong[0]
  const inTapir = (e.known.published?.links ?? []).some((l) => linkKey(l.url) === linkKey(w.u))
  const fix = country === 'US' && inTapir ? appleStorefrontFix(w.u) : null
  const rows = [...base, { label: 'link', value: w.u }, { label: 'store', value: `${w.store} = ${countryName(w.store)}` }, ...(fix ? [{ label: 'after the fix', value: fix.fixed }] : [])]
  const sentence = `your Apple Music link opens the ${countryName(w.store)} store, but you’re based in ${countryName(country)}.`
  if (fix) return { status: 'fail', lead: 'Almost', value: `${countryName(w.store).replace(/^the /, '')} store`.slice(0, 28), sentence, todo: 'Switch it to the US store. One click.', action: { kind: 'fix', fix: 'apple-storefront', label: 'Fix the Apple Music link' }, evidence: rows, limits }
  return {
    status: 'fail', lead: 'Almost', value: `${countryName(w.store).replace(/^the /, '')} store`.slice(0, 28), sentence,
    todo: inTapir ? `In Connections, change “/${w.store}/” in the link to “/${country.toLowerCase()}/”, then publish.` : `This link isn’t from Tapir: change “/${w.store}/” to “/${country.toLowerCase()}/” where your site is built.`,
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

const shows = make('shows', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your shows')
  const pub = e.known.published
  if (!pub) return noPublished('your shows to Tour')
  const today = dayOf(e.known.today)
  if (!today) return { status: 'unknown', value: 'couldn’t check', sentence: 'we didn’t know today’s date, so we couldn’t check your shows.', evidence: [] }
  if (card.broken) return { status: 'unknown', value: 'couldn’t read', sentence: 'part of your fact card can’t be read, so we couldn’t see every show it lists.', evidence: [{ label: 'fact card', value: 'a block doesn’t parse (see “Search engines can read your fact card”)' }] }
  const limits = 'We read the shows your site gives search engines. We can’t tell which shows your page’s own design labels as coming up, and we compare days, not times.'
  const upcoming: { day: string; city: string | null; name: string }[] = []
  const stale: string[] = []
  for (const ev of card.nodes.filter((n) => hasType(n, ...EVENT_TYPES))) {
    if (OFF.test(String(ev.eventStatus ?? ''))) continue
    const start = dayOf(ev.startDate)
    if (!start) continue
    const end = dayOf(ev.endDate)
    const name = textOf(ev.name) ?? 'a show'
    if (start >= today) upcoming.push({ day: start, city: eventCity(ev), name })
    // Started before today but still running (a festival's end date): not old, and not
    // "coming up" either, so Tour (which dates a show by its first day) isn't asked about it.
    else if (end !== null && end >= today) continue
    else stale.push(`${prettyDay(start)} · ${name}`)
  }
  const expected = pub.tourDates.filter((t) => !t.isPast && (dayOf(t.date) ?? '') >= today && dayOf(t.date))
  const noCity = expected.filter((t) => !(t.city ?? '').trim())
  const wanted = expected.filter((t) => (t.city ?? '').trim())
  const unmatched = [...upcoming]
  const missing: string[] = []
  for (const t of wanted) {
    const day = dayOf(t.date)!
    const i = unmatched.findIndex((u) => u.day === day && (u.city === null || fold(u.city) === fold(t.city!)))
    if (i >= 0) unmatched.splice(i, 1)
    else missing.push(`${prettyDay(day)} · ${[t.venue, t.city].filter(Boolean).join(', ')}`)
  }
  const extra = unmatched.map((u) => `${prettyDay(u.day)} · ${u.name}`)
  const evidence = [
    { label: 'upcoming on your site', value: upcoming.length ? listOf(upcoming.map((u) => `${prettyDay(u.day)} · ${u.name}`)) : 'none' },
    ...(stale.length ? [{ label: 'past, listed as coming up', value: listOf(stale) }] : []),
    ...(missing.length ? [{ label: 'in Tour, not on your site', value: listOf(missing) }] : []),
    ...(extra.length ? [{ label: 'on your site, not in Tour', value: listOf(extra) }] : []),
    ...(noCity.length ? [{ label: 'left out (no city)', value: listOf(noCity.map((t) => `${prettyDay(dayOf(t.date)!)} · ${t.venue ?? 'no venue'}`)) }] : []),
    { label: 'today', value: prettyDay(today) },
  ]
  const tour = { kind: 'edit', target: 'tour', label: 'Open Tour' } as const
  if (stale.length) return { status: 'fail', value: `${stale.length} old ${plural(stale.length, 'show')}`, sentence: `your site still lists ${stale.length} past ${plural(stale.length, 'show')} as coming up.`, todo: UPDATE, action: tour, evidence, limits }
  if (missing.length) return { status: 'fail', value: `${missing.length} missing`, sentence: `${missing.length} upcoming ${plural(missing.length, 'show')} from Tour ${missing.length === 1 ? 'isn’t' : 'aren’t'} on your site yet.`, todo: UPDATE, action: tour, evidence, limits }
  if (extra.length) return { status: 'fail', value: `${extra.length} not in Tour`, sentence: `your site lists ${extra.length} upcoming ${plural(extra.length, 'show')} that Tour doesn’t have.`, todo: 'Publish from Tapir so your site catches up with Tour.', action: tour, evidence, limits }
  if (!upcoming.length) return { status: 'pass', value: 'none booked', sentence: 'No shows are listed as coming up, which matches Tour.', evidence, limits }
  return { status: 'pass', value: `${upcoming.length} upcoming`, sentence: `Your ${upcoming.length} upcoming ${plural(upcoming.length, 'show')} ${upcoming.length === 1 ? 'matches' : 'match'} Tour, and no old shows are listed as coming up.`, evidence, limits }
})

/* ── releases ───────────────────────────────────────────────────────────────────────── */

const releases = make('releases', (e) => {
  const card = homeCard(e)
  if ('state' in card) return unreadable(card.state, 'read your releases')
  const pub = e.known.published
  if (!pub) return noPublished('your releases to Music')
  if (card.broken) return { status: 'unknown', value: 'couldn’t read', sentence: 'part of your fact card can’t be read, so we couldn’t see every release it lists.', evidence: [{ label: 'fact card', value: 'a block doesn’t parse (see “Search engines can read your fact card”)' }] }
  const limits = 'We match releases by title in the facts your site gives search engines; we don’t check their songs, dates or links.'
  const albums = card.nodes.filter((n) => hasType(n, 'MusicAlbum', 'MusicRelease'))
  const live = albums.map((a) => ({ name: textOf(a.name) ?? '', day: dayOf(a.datePublished) })).filter((a) => a.name)
  const pool = new Map<string, number>()
  for (const a of live) pool.set(fold(a.name), (pool.get(fold(a.name)) ?? 0) + 1)
  const missing: string[] = []
  for (const r of pub.releases) {
    const k = fold(r.title)
    const left = pool.get(k) ?? 0
    if (left > 0) pool.set(k, left - 1)
    else missing.push(r.title)
  }
  const extra: string[] = []
  for (const a of live) {
    const k = fold(a.name)
    if ((pool.get(k) ?? 0) > 0) {
      extra.push(a.name)
      pool.set(k, pool.get(k)! - 1)
    }
  }
  const n = pub.releases.length
  const newest = [...pub.releases].sort((x, y) => (dayOf(y.releasedOn) ?? '').localeCompare(dayOf(x.releasedOn) ?? ''))[0]
  const newestLive = [...live].filter((a) => a.day).sort((x, y) => y.day!.localeCompare(x.day!))[0]
  const evidence = [
    { label: 'on your site', value: `${live.length} ${plural(live.length, 'release')}` },
    ...(newestLive ? [{ label: 'newest on your site', value: `${newestLive.name} · ${prettyDay(newestLive.day!)}` }] : []),
    ...(missing.length ? [{ label: 'missing', value: listOf(missing) }] : []),
    ...(extra.length ? [{ label: 'not in Music', value: listOf(extra) }] : []),
  ]
  const music = { kind: 'edit', target: 'music', label: 'Open Music' } as const
  if (!n && !live.length) {
    return { status: 'fail', value: 'no releases', sentence: 'Tapir has no published releases for you yet, so search engines have none to list.', todo: 'Add your releases in Music, then publish.', action: music, evidence, limits }
  }
  const value = `${n - missing.length} of ${n}`
  if (newest && missing.includes(newest.title)) {
    return { status: 'fail', value, sentence: `your newest release, “${newest.title}”, isn’t listed for search engines yet.`, todo: UPDATE, action: music, evidence, limits }
  }
  if (missing.length) return { status: 'fail', value, sentence: `${missing.length} of your ${n} ${plural(n, 'release')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} listed for search engines.`, todo: UPDATE, action: music, evidence, limits }
  if (extra.length) return { status: 'fail', value, sentence: `your site lists ${extra.length} ${plural(extra.length, 'release')} that ${extra.length === 1 ? 'isn’t' : 'aren’t'} in Music.`, todo: 'Publish from Tapir so your site drops it.', action: music, evidence, limits }
  return {
    status: 'pass', value: `${num(n)} ${plural(n, 'release')}`,
    sentence: n === 1 ? `Your release “${newest!.title}” is listed.` : `All ${n} of your releases are listed, including your newest, “${newest!.title}”.`,
    evidence, limits,
  }
})

/* ── card ───────────────────────────────────────────────────────────────────────────── */

function usesSchemaOrg(ctx: unknown): boolean {
  if (typeof ctx === 'string') return /schema\.org/i.test(ctx)
  if (Array.isArray(ctx)) return ctx.some(usesSchemaOrg)
  if (isObj(ctx)) return Object.values(ctx).some((v) => typeof v === 'string' && /schema\.org/i.test(v))
  return false
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)

/** What one node is missing, by Google's required fields (the bridge's JSON_LD_REQUIRED). */
function nodeProblems(node: LdNode, where: string, out: string[]) {
  const types = typesOf(node)
  if (!types.length && Object.keys(node).some((k) => !k.startsWith('@'))) out.push(`${where} has no type`)
  for (const t of types) for (const f of JSON_LD_REQUIRED[t] ?? []) if (blank(node[f])) out.push(`${where} is missing ${f}`)
  if (types.includes('MusicEvent') && node.location !== undefined) {
    const loc = Array.isArray(node.location) ? node.location[0] : node.location
    if (!isObj(loc) || blank(loc.address)) out.push(`${where}'s place has no address`)
  }
  if (types.includes('MusicAlbum') && Array.isArray(node.track)) {
    node.track.forEach((t, i) => {
      if (isObj(t)) nodeProblems(t, `${where} track ${i + 1}`, out)
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
  const evidence: { label: string; value: string }[] = []
  let broken = false
  let empty = false
  const pages = pagesOf(e)
  for (const p of pages) {
    if (!p.ok) continue
    const blocks = p.page.ld
    const isHome = p.path === home.path
    if (!blocks.length) {
      if (isHome) {
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
      found.forEach((n, j) => nodeProblems(n, `${where} ${typesOf(n)[0] ?? 'node'} #${j + 1}`, problems))
      nodes.push(...found)
    })
    if (isHome && nodes.length && !nodes.some((n) => hasType(n, 'MusicGroup', 'Person'))) problems.push(`${p.path}: no artist (MusicGroup or Person)`)
    evidence.push({ label: p.path, value: `${typeSummary(nodes)}${blocks.length > 1 ? ` (${blocks.length} blocks)` : ''}` })
  }
  const limits = 'We check that each block reads and has the details Google marks as required for its kind. We don’t check that every fact in it is true; the other tests do some of that.'
  if (problems.length) evidence.push({ label: 'problems', value: listOf(problems, 8) })
  if (cut.length) evidence.push({ label: 'cut off where we stopped reading', value: cut.join(', ') })
  const blind = pages.filter((p) => !p.ok && p.noAnswer).map((p) => p.path)
  if (blind.length) evidence.push({ label: 'not read', value: blind.join(', ') })
  if (problems.length) {
    const sentence = broken
      ? 'part of your fact card is broken, so search engines can’t read it.'
      : empty
        ? 'your home page has no fact card for search engines, or it is empty.'
        : `your fact card is missing ${problems.length} ${plural(problems.length, 'detail')} search engines need.`
    return { status: 'fail', value: `${problems.length} ${plural(problems.length, 'problem')}`, sentence, todo: UPDATE, evidence, limits }
  }
  if (cut.length || blind.length) {
    return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${[...cut, ...blind].join(', ')}, so we can’t say the whole fact card reads.`, evidence, limits }
  }
  return { status: 'pass', value: 'no errors', sentence: 'Search engines can read your fact card with no errors.', evidence, limits }
})

export const FACTS_TESTS: Record<Id, SeoTest> = { profiles, apple, shows, releases, card }
