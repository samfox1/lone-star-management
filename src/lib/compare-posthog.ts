/**
 * The PostHog cross-check's JUDGE (`npm run compare:posthog`, scripts/compare-posthog.ts).
 *
 * Pure: the rows both pipelines return in, a report and an exit code out. No I/O, no env.
 * The script fetches; everything that DECIDES lives here, so it can be unit-tested and
 * mutation-tested (tests/unit/analytics/compare-posthog.test.ts).
 *
 * What is and is not comparable, which is the whole point of the module:
 *   • VIEWS are independent. PostHog captures its own page views; we never mirror one.
 *     PostHog reads LOWER (ad blockers, softened but not removed by a same-origin proxy),
 *     so equality is not the test. The RATIO's stability is: r = Σph / Σours over the
 *     window, and a day whose own ratio is outside ±25% of r is an outlier. A day under 30
 *     on the larger side is "low n": neither a pass nor a failure.
 *   • CLICKS are mirrored from the same client call, so they are compared tightly per
 *     (day, type), and per entity id over the window. PostHog-only (PostHog kept it, we lack
 *     it) means our DOOR dropped it, gated at 1%. Ours-only is expected (ad blockers, clicks
 *     queued before PostHog's script loaded that die on navigation): reported, never gated.
 *   • VISITORS are not the same unit: ours are visitor-DAYS (a daily rotating hash), and
 *     PostHog with memory persistence mints an id per page load. Ours is printed for
 *     reference; no ratio is ever computed.
 *   • SOURCES and COUNTRIES are window totals. Countries never gate: PostHog behind a proxy
 *     may geolocate every event to the proxy edge, which gets a loud warning instead.
 *   • NO DATA on either side is exit 2. A table of zeros reads like agreement.
 *
 * Delete this module, its test and the script when the comparison passes (see
 * ANALYTICS_PAGE_PLAN.md, "PostHog cross-check"), and remove it from stryker `mutate`.
 */
import type { PlaceRow, SourceRow, TimelineDay } from './analytics'
import { countryTotals } from './analytics-places'
import { EVENT_TYPES } from './events'

/* ── Rules ──────────────────────────────────────────────────────────────────────── */

/** Every on-site event type except `view`, DERIVED from the registry (AGENTS.md rule 4). */
export const COMPARED_CLICK_TYPES = EVENT_TYPES.map((e) => e.type).filter((t) => t !== 'view')
const CLICK_SET: ReadonlySet<string> = new Set(COMPARED_CLICK_TYPES)

export const LIMITS = {
  /** A day's ratio may sit this far either side of the window ratio, as a share of it. */
  viewBand: 0.25,
  /** Below this on the LARGER side a day is too thin to judge. */
  lowN: 30,
  /** PostHog-only clicks, as a share of PostHog's clicks. */
  phOnlyMax: 0.01,
  /** A referrer host this big on one side must exist on the other. */
  sourceMin: 5,
  /** One country holding more than this share of PostHog's page views = proxy geolocation. */
  proxyShare: 0.9,
  /** Days that must clear the low-n gate before the views ratio means anything; the whole
   *  window when it is shorter. Without a floor, a window of nothing but low-n days passed. */
  minJudgedDays: 7,
  maxDays: 30,
} as const

/** Explicit on every query: HogQL's default is 100 rows, and OFFSET is refused for personal keys. */
export const QUERY_LIMIT = 10000

/* ── The window ─────────────────────────────────────────────────────────────────── */

export type Window = { since: string; until: string; days: string[] }

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** N complete UTC days ending YESTERDAY. Today is partial on both sides and never compared. */
export function comparisonWindow(days: number, nowMs: number): Window {
  if (!Number.isInteger(days) || days < 1 || days > LIMITS.maxDays) {
    throw new Error(`--days must be a whole number between 1 and ${LIMITS.maxDays}`)
  }
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS
  const list = Array.from({ length: days }, (_, i) => isoDay(today - (days - i) * DAY_MS))
  return { since: list[0], until: list[list.length - 1], days: list }
}

/* ── PostHog: the queries ───────────────────────────────────────────────────────── */

/** The alias each query names its columns with, and the order the reader expects. */
export const HOGQL_COLUMNS = {
  daily: ['day', 'ev', 'n', 'bots'],
  referrers: ['domain', 'n'],
  hosts: ['host', 'n'],
  countries: ['country', 'n'],
  entities: ['ev', 'entity_id', 'n'],
} as const
export type QueryName = keyof typeof HOGQL_COLUMNS

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ')

/**
 * The HogQL for one artist and window.
 *
 * TIMEZONES. A HogQL date literal parses in the PROJECT timezone, so every bound here is a
 * `toDateTime(…, 'UTC')` with the zone spelled out, and every day is bucketed with
 * `toDate(toTimeZone(timestamp, 'UTC'))` to match our readers' `(created_at at time zone
 * 'UTC')::date`. `posthogSide` then refuses any day outside the window, so a mistake here
 * fails loudly instead of shifting a day. Belt and braces: the PostHog project timezone
 * should ALSO be set to UTC, and checked once against a known event (click something on the
 * site, note the UTC time, find it in PostHog's activity view).
 *
 * `properties.site` is the artist slug, registered by the mirror as a super-property, so
 * `$pageview` carries it too. Never filter on `$host`: one site can have several.
 *
 * `$virt_is_bot` is PostHog's query-time bot classification. It works only in the DOT form
 * (`properties.$virt_is_bot`); the bracket form reads the raw JSON, where it never exists.
 * When the project cannot use it, `bots` is false and no query mentions it.
 */
export function hogqlQueries(slug: string, w: Window, bots: boolean): Record<QueryName, string> {
  if (!SLUG.test(slug)) throw new Error(`Not an artist slug: ${JSON.stringify(slug)}`)
  const at = (day: string) => `toDateTime('${day} 00:00:00', 'UTC')`
  const end = isoDay(Date.parse(`${w.until}T00:00:00Z`) + DAY_MS)
  const from = `properties.site = '${slug}' AND timestamp >= ${at(w.since)}`
  const bounded = `${from} AND timestamp < ${at(end)}`
  const isBot = 'ifNull(properties.$virt_is_bot, false)'
  const human = bots ? ` AND NOT ${isBot}` : ''
  // A view is LANDING on the site (Sam, 2026-09-17): a page load not reached from the site
  // itself. Our side applies that in the browser; PostHog captures every load, so it is
  // applied here, from the `$referring_domain` PostHog stamps on each page view (the
  // browser's referrer host, or `$direct`). `www.` is ignored on both sides of the test. In
  // HogQL the literal '^www\\.' is the regex ^www\. once the string escape is read.
  const bare = (prop: string) => `replaceRegexpOne(lower(ifNull(properties.${prop}, '')), '^www\\\\.', '')`
  const landed = `${bare('$referring_domain')} != ${bare('$host')}`
  const views = `event = '$pageview' AND ${landed}`
  return {
    daily:
      `SELECT toDate(toTimeZone(timestamp, 'UTC')) AS day, event AS ev, count() AS n, ${bots ? `countIf(${isBot})` : '0'} AS bots ` +
      `FROM events WHERE ${bounded} AND event IN (${list(['$pageview', ...COMPARED_CLICK_TYPES])}) AND (event != '$pageview' OR ${landed}) ` +
      `GROUP BY day, ev ORDER BY day, ev LIMIT ${QUERY_LIMIT}`,
    referrers:
      `SELECT properties.$referring_domain AS domain, count() AS n FROM events WHERE ${bounded} AND ${views}${human} ` +
      `GROUP BY domain ORDER BY n DESC LIMIT ${QUERY_LIMIT}`,
    hosts:
      // EVERY page view, same-site ones included: this is how the site's own hosts are found.
      `SELECT properties.$host AS host, count() AS n FROM events WHERE ${bounded} AND event = '$pageview' ` +
      `GROUP BY host ORDER BY n DESC LIMIT ${QUERY_LIMIT}`,
    countries:
      `SELECT properties.$geoip_country_code AS country, count() AS n FROM events WHERE ${bounded} AND ${views}${human} ` +
      `GROUP BY country ORDER BY n DESC LIMIT ${QUERY_LIMIT}`,
    // No upper bound: `analytics_by_entity` has none either. The script reads PostHog FIRST,
    // so any click PostHog holds had already reached our door (the door is a direct fetch,
    // PostHog batches), and today's partial counts cannot manufacture a PostHog-only click.
    entities:
      `SELECT event AS ev, properties.entity_id AS entity_id, count() AS n FROM events WHERE ${from} ` +
      `AND event IN (${list(COMPARED_CLICK_TYPES)}) AND properties.entity_id IS NOT NULL${human} ` +
      `GROUP BY ev, entity_id ORDER BY n DESC LIMIT ${QUERY_LIMIT}`,
  }
}

export type HogQLRows = Record<string, unknown>[]

/** A HogQL response as records. Throws on an error body, unexpected columns, or a truncated result. */
export function parseHogQL(json: unknown, name: QueryName): HogQLRows {
  const body = (json ?? {}) as { results?: unknown; columns?: unknown; detail?: unknown }
  if (!Array.isArray(body.results)) {
    throw new Error(`PostHog ${name}: no results in the response${body.detail ? ` (${String(body.detail)})` : ''}`)
  }
  const want: readonly string[] = HOGQL_COLUMNS[name]
  if (!Array.isArray(body.columns) || body.columns.join(',') !== want.join(',')) {
    throw new Error(`PostHog ${name}: expected columns ${want.join(',')}, got ${String(body.columns)}`)
  }
  if (body.results.length >= QUERY_LIMIT) {
    throw new Error(`PostHog ${name}: ${body.results.length} rows hit the LIMIT, so the result is truncated`)
  }
  return (body.results as unknown[][]).map((row) => Object.fromEntries(want.map((c, i) => [c, row[i]])))
}

/* ── The two sides, normalized ──────────────────────────────────────────────────── */

const num = (v: unknown) => Number(v ?? 0)
const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n)
const anyPositive = (m: Map<string, number>) => [...m.values()].some((v) => v > 0)

/** Lower-case, no port, no leading `www.`, no trailing dot; PostHog's `$direct` is no host. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host || host === '$direct') return ''
  let h = host.toLowerCase().replace(/:\d+/, '')
  if (h.startsWith('www.')) h = h.slice(4)
  if (h.endsWith('.')) h = h.slice(0, -1)
  return h
}

type TypeDayRow = { day: string; type: string; count: number }
type EntityRow = { entity_type: string; entity_id: string; type: string; count: number }

/** What our public readers return, as fetched. */
export type OursRaw = {
  timeline: TimelineDay[]
  typeTimeline: TypeDayRow[]
  sources: SourceRow[]
  places: PlaceRow[]
  entities: EntityRow[]
}

type Side = {
  views: Map<string, number>
  /** `${day}|${type}` */
  clicks: Map<string, number>
  referrers: Map<string, number>
  countries: Map<string, number>
  /** `${type}|${entity_id}` */
  entities: Map<string, number>
}
export type OursSide = Side & { visitors: Map<string, number>; bots: Map<string, number>; typeView: Map<string, number>; days: Set<string> }
export type PhSide = Side & { bots: Map<string, number> | null; countriesTotal: number; droppedSameSite: string[] }

export function oursSide(raw: OursRaw): OursSide {
  const s: OursSide = {
    views: new Map(), clicks: new Map(), referrers: new Map(), countries: new Map(), entities: new Map(),
    visitors: new Map(), bots: new Map(), typeView: new Map(), days: new Set(),
  }
  for (const r of raw.timeline) {
    s.days.add(r.day)
    s.views.set(r.day, num(r.views))
    s.visitors.set(r.day, num(r.visitors))
    s.bots.set(r.day, num(r.bots))
  }
  for (const r of raw.typeTimeline) {
    s.days.add(r.day)
    if (r.type === 'view') s.typeView.set(r.day, num(r.count))
    else if (CLICK_SET.has(r.type)) s.clicks.set(`${r.day}|${r.type}`, num(r.count))
  }
  for (const r of raw.sources) {
    const host = normalizeHost(r.referrer_host)
    if (host) add(s.referrers, host, num(r.views))
  }
  for (const c of countryTotals(raw.places).countries) s.countries.set(c.code, c.views)
  for (const e of raw.entities) {
    if (CLICK_SET.has(e.type)) add(s.entities, `${e.type}|${e.entity_id.toLowerCase()}`, num(e.count))
  }
  return s
}

const sameSite = (ref: string, hosts: string[]) => hosts.some((h) => ref === h || ref.endsWith(`.${h}`) || h.endsWith(`.${ref}`))

export function posthogSide(rows: Record<QueryName, HogQLRows>, w: Window, botsAvailable: boolean): PhSide {
  const s: Omit<PhSide, 'droppedSameSite'> = {
    views: new Map(), clicks: new Map(), referrers: new Map(), countries: new Map(), entities: new Map(),
    bots: botsAvailable ? new Map() : null, countriesTotal: 0,
  }
  for (const r of rows.daily) {
    const day = String(r.day)
    if (!w.days.includes(day)) {
      throw new Error(`PostHog returned day ${day}, outside the window ${w.since}..${w.until}: a timezone shift, not data`)
    }
    const ev = String(r.ev)
    const bots = s.bots ? num(r.bots) : 0
    if (s.bots) add(s.bots, day, bots)
    if (ev === '$pageview') add(s.views, day, num(r.n) - bots)
    else if (CLICK_SET.has(ev)) add(s.clicks, `${day}|${ev}`, num(r.n) - bots)
  }
  // The site's own hosts come from the data, never a hand-typed list: PostHog records the
  // site itself as the referrer on internal navigation, where our door records no referrer.
  const hosts = rows.hosts.map((r) => normalizeHost(r.host as string))
  const dropped = new Set<string>()
  for (const r of rows.referrers) {
    const host = normalizeHost(r.domain as string)
    if (!host) continue
    if (sameSite(host, hosts)) dropped.add(host)
    else add(s.referrers, host, num(r.n))
  }
  for (const r of rows.countries) {
    s.countriesTotal += num(r.n)
    if (r.country) add(s.countries, String(r.country), num(r.n))
  }
  for (const r of rows.entities) {
    const ev = String(r.ev)
    if (CLICK_SET.has(ev) && r.entity_id) add(s.entities, `${ev}|${String(r.entity_id).toLowerCase()}`, num(r.n))
  }
  return { ...s, droppedSameSite: [...dropped].sort() }
}

/* ── Countries ──────────────────────────────────────────────────────────────────── */

type Ranked = { code: string; views: number }
const top = (m: Map<string, number>, n: number): Ranked[] =>
  [...m].map(([code, views]) => ({ code, views })).sort((a, b) => b.views - a.views || a.code.localeCompare(b.code)).slice(0, n)

/** Average ranks (1 = largest) of `values`, ties sharing their mean rank. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0])
  const out = values.map(() => 0)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j < order.length && order[j][0] === order[i][0]) j++
    for (let k = i; k < j; k++) out[order[k][1]] = (i + j + 1) / 2
    i = j
  }
  return out
}

/** Spearman rank correlation over the UNION of both sides' top 10; null when it cannot be ranked. */
export function rankCorrelation(ours: Map<string, number>, ph: Map<string, number>): number | null {
  const codes = [...new Set([...top(ours, 10), ...top(ph, 10)].map((c) => c.code))]
  const a = ranks(codes.map((c) => ours.get(c) ?? 0))
  const b = ranks(codes.map((c) => ph.get(c) ?? 0))
  const mean = (codes.length + 1) / 2
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < codes.length; i++) {
    // Centering one factor is enough: Σ(b - mean) is zero, so Σ a·(b - mean) is the covariance.
    cov += a[i] * (b[i] - mean)
    va += (a[i] - mean) ** 2
    vb += (b[i] - mean) ** 2
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null
}

/* ── The comparison ─────────────────────────────────────────────────────────────── */

export type DayStatus = 'ok' | 'outlier' | 'low-n'
export type Criterion = { name: 'consistency' | 'judged' | 'views' | 'clicks' | 'entities' | 'sources'; pass: boolean; detail: string }
type Split = { phTotal: number; oursTotal: number; phOnly: number; oursOnly: number; phOnlyRate: number; oursOnlyRate: number }

export type Report = {
  window: Window
  noData: string | null
  consistency: { ok: boolean; mismatches: { day: string; views: number; typeView: number }[] }
  views: { ratio: number | null; days: { day: string; ours: number; ph: number; dayRatio: number | null; status: DayStatus }[] }
  clicks: Split & { days: { day: string; type: string; ours: number; ph: number }[]; entity: Split }
  visitors: { ours: { day: string; visitors: number }[]; comparable: false; reason: string }
  bots: { ours: { day: string; bots: number }[]; ph: { day: string; bots: number }[] | null }
  sources: { rows: { host: string; ours: number; ph: number; flag: 'missing-ph' | 'missing-ours' | null }[]; droppedSameSite: string[]; flagged: number }
  countries: { ours: Ranked[]; ph: Ranked[]; rankCorrelation: number | null; top5Overlap: number; warning: string | null }
  criteria: Criterion[]
  verdict: string
}

/** Per key: what one side has beyond the other. Never netted across keys. */
function split(keys: Iterable<string>, ours: Map<string, number>, ph: Map<string, number>): Split {
  const s = { phTotal: 0, oursTotal: 0, phOnly: 0, oursOnly: 0 }
  for (const k of new Set(keys)) {
    const o = ours.get(k) ?? 0
    const p = ph.get(k) ?? 0
    s.oursTotal += o
    s.phTotal += p
    s.phOnly += Math.max(0, p - o)
    s.oursOnly += Math.max(0, o - p)
  }
  return { ...s, phOnlyRate: s.phTotal ? s.phOnly / s.phTotal : 0, oursOnlyRate: s.oursTotal ? s.oursOnly / s.oursTotal : 0 }
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`

/** A PostHog-only rate over zero PostHog clicks is 0/0, not 0%. If we recorded clicks and
 *  PostHog recorded none, the mirror is not reaching PostHog, and that must not pass. */
const arrived = (s: Split) => !(s.oursTotal > 0 && s.phTotal === 0)
const clickDetail = (label: string, s: Split) =>
  arrived(s)
    ? `${label} ${pct(s.phOnlyRate)} (gate ≤ ${pct(LIMITS.phOnlyMax)})`
    : `${label}: we recorded ${s.oursTotal}, PostHog recorded none, so the mirror is not reaching PostHog`

export function compare(o: OursSide, p: PhSide, w: Window): Report {
  for (const day of o.days) {
    if (!w.days.includes(day)) throw new Error(`Our readers returned day ${day}, outside the window ${w.since}..${w.until}`)
  }

  const missing: string[] = []
  if (!anyPositive(o.views) && !anyPositive(o.clicks)) missing.push('ours (the Lone Star readers)')
  if (!anyPositive(p.views) && !anyPositive(p.clicks)) missing.push('PostHog')
  const noData = missing.length
    ? `No data from ${missing.join(' or ')} for ${w.since}..${w.until}. An empty side is not agreement, so nothing is compared.`
    : null

  const mismatches = w.days
    .map((day) => ({ day, views: o.views.get(day) ?? 0, typeView: o.typeView.get(day) ?? 0 }))
    .filter((m) => m.views !== m.typeView)

  const sumO = w.days.reduce((n, d) => n + (o.views.get(d) ?? 0), 0)
  const sumP = w.days.reduce((n, d) => n + (p.views.get(d) ?? 0), 0)
  const ratio = sumO ? sumP / sumO : null
  const days = w.days.map((day) => {
    const ours = o.views.get(day) ?? 0
    const ph = p.views.get(day) ?? 0
    const dayRatio = ours ? ph / ours : null
    let status: DayStatus = 'ok'
    if (Math.max(ours, ph) < LIMITS.lowN) status = 'low-n'
    else if (!ratio || dayRatio === null || Math.abs(dayRatio - ratio) > LIMITS.viewBand * ratio) status = 'outlier'
    return { day, ours, ph, dayRatio, status }
  })
  const outliers = days.filter((d) => d.status === 'outlier').length
  const judgedDays = days.filter((d) => d.status !== 'low-n').length
  const judgedFloor = Math.min(LIMITS.minJudgedDays, w.days.length)

  const clickKeys = w.days.flatMap((day) => COMPARED_CLICK_TYPES.map((type) => `${day}|${type}`))
  const clickDays = clickKeys.map((k) => {
    const [day, type] = k.split('|')
    return { day, type, ours: o.clicks.get(k) ?? 0, ph: p.clicks.get(k) ?? 0 }
  })
  const clicks = split(clickKeys, o.clicks, p.clicks)
  const entity = split([...o.entities.keys(), ...p.entities.keys()], o.entities, p.entities)

  const hosts = new Set([...o.referrers.keys(), ...p.referrers.keys()])
  const sourceRows = [...hosts]
    .map((host) => {
      const ours = o.referrers.get(host) ?? 0
      const ph = p.referrers.get(host) ?? 0
      const flag = ours >= LIMITS.sourceMin && !ph ? 'missing-ph' : ph >= LIMITS.sourceMin && !ours ? 'missing-ours' : null
      return { host, ours, ph, flag } as Report['sources']['rows'][number]
    })
    .sort((a, b) => b.ours + b.ph - (a.ours + a.ph) || a.host.localeCompare(b.host))
  const flagged = sourceRows.filter((r) => r.flag).length

  const oursTop = top(o.countries, 10)
  const phTop = top(p.countries, 10)
  const top5 = new Set(oursTop.slice(0, 5).map((c) => c.code))
  const lead = phTop[0]
  const share = lead ? lead.views / p.countriesTotal : 0
  const warning =
    p.countriesTotal >= LIMITS.lowN && share > LIMITS.proxyShare
      ? `WARNING: ${lead.code} holds ${Math.round(share * 100)}% of PostHog page views. That is what every event geolocated to a proxy edge looks like; PostHog's countries mean nothing until the proxy forwards the client IP.`
      : null

  const phBots = p.bots
  const criteria: Criterion[] = [
    { name: 'consistency', pass: !mismatches.length, detail: `byType.view = timeline.views on every day (${mismatches.length} mismatched)` },
    { name: 'judged', pass: judgedDays >= judgedFloor, detail: `${judgedDays} day(s) with ${LIMITS.lowN}+ views (need ${judgedFloor}); fewer and the views ratio proves nothing` },
    { name: 'views', pass: !outliers, detail: `${outliers} day(s) outside ±${LIMITS.viewBand * 100}% of r` },
    { name: 'clicks', pass: arrived(clicks) && clicks.phOnlyRate <= LIMITS.phOnlyMax, detail: clickDetail('PostHog-only', clicks) },
    { name: 'entities', pass: arrived(entity) && entity.phOnlyRate <= LIMITS.phOnlyMax, detail: clickDetail('PostHog-only by entity', entity) },
    { name: 'sources', pass: !flagged, detail: `${flagged} host(s) with ${LIMITS.sourceMin}+ on one side missing on the other` },
  ]
  const failed = criteria.filter((c) => !c.pass).map((c) => c.name)
  const verdict = noData
    ? `NO DATA: ${noData}`
    : failed.length
      ? `FAIL: ${failed.join(', ')}`
      : `PASS: all ${criteria.length} criteria met`

  return {
    window: w,
    noData,
    consistency: { ok: !mismatches.length, mismatches },
    views: { ratio, days },
    clicks: { ...clicks, days: clickDays, entity },
    visitors: {
      ours: w.days.map((day) => ({ day, visitors: o.visitors.get(day) ?? 0 })),
      comparable: false,
      reason: 'ours are visitor-days (a daily rotating hash); PostHog in memory persistence mints an id per page load',
    },
    bots: {
      ours: w.days.map((day) => ({ day, bots: o.bots.get(day) ?? 0 })),
      ph: phBots ? w.days.map((day) => ({ day, bots: phBots.get(day) ?? 0 })) : null,
    },
    sources: { rows: sourceRows, droppedSameSite: p.droppedSameSite, flagged },
    countries: {
      ours: oursTop,
      ph: phTop,
      rankCorrelation: rankCorrelation(o.countries, p.countries),
      top5Overlap: phTop.slice(0, 5).filter((c) => top5.has(c.code)).length,
      warning,
    },
    criteria,
    verdict,
  }
}

/** 2 when a side had no data, 1 when a criterion failed, 0 when every one was met. */
export function exitCode(r: Report): 0 | 1 | 2 {
  if (r.noData) return 2
  return r.criteria.every((c) => c.pass) ? 0 : 1
}

/* ── Text ───────────────────────────────────────────────────────────────────────── */

const fixed = (x: number | null) => (x === null ? '-' : x.toFixed(2))

export function formatReport(r: Report): string {
  const w = r.window
  if (r.noData) return `${r.noData}\n\nVERDICT: ${r.verdict}\n`

  const out: string[] = []
  out.push(`PostHog cross-check  ${w.since}..${w.until} (${w.days.length} days, UTC, today excluded)`)
  out.push(`views ratio r = PostHog / ours = ${fixed(r.views.ratio)}; a judged day must sit within ±${LIMITS.viewBand * 100}% of r`)
  out.push('')
  const head = ['day'.padEnd(10), 'views'.padStart(6), 'ph'.padStart(6), 'ratio'.padStart(6)]
  for (const t of COMPARED_CLICK_TYPES) head.push(t.padStart(12))
  head.push('bots o/p'.padStart(10), 'visitors(ours)'.padStart(15), ' note')
  out.push(head.join(' '))
  // Every per-day array in the report is in window order, so index i is the same day in each.
  const types = COMPARED_CLICK_TYPES.length
  r.views.days.forEach((d, i) => {
    const cells = [d.day, String(d.ours).padStart(6), String(d.ph).padStart(6), fixed(d.dayRatio).padStart(6)]
    for (let j = 0; j < types; j++) {
      const c = r.clicks.days[i * types + j]
      cells.push(`${c.ours}/${c.ph}`.padStart(12))
    }
    const pb = r.bots.ph ? r.bots.ph[i].bots : '-'
    cells.push(`${r.bots.ours[i].bots}/${pb}`.padStart(10), String(r.visitors.ours[i].visitors).padStart(15))
    cells.push(d.status === 'outlier' ? ' OUTLIER' : d.status === 'low-n' ? ' low n' : '')
    out.push(cells.join(' '))
  })
  out.push('')
  out.push(`visitors: ours shown for reference only, not comparable (${r.visitors.reason})`)
  out.push(
    r.bots.ph
      ? 'bots: ours = is_bot views; PostHog = events with $virt_is_bot (its SDK also drops known bots before sending)'
      : 'bots: ours = is_bot views; PostHog $virt_is_bot unavailable on this project, so its column is omitted',
  )
  const c = r.clicks
  out.push(`CLICKS    PostHog-only ${c.phOnly} of ${c.phTotal} (${pct(c.phOnlyRate)}, gate ≤ ${pct(LIMITS.phOnlyMax)}) · ours-only ${c.oursOnly} of ${c.oursTotal} (${pct(c.oursOnlyRate)}, not gated)`)
  const e = c.entity
  out.push(`ENTITIES  PostHog-only ${e.phOnly} of ${e.phTotal} (${pct(e.phOnlyRate)}) · ours-only ${e.oursOnly} of ${e.oursTotal} (${pct(e.oursOnlyRate)})`)
  out.push(`CONSISTENCY  byType.view vs timeline.views: ${r.consistency.ok ? 'agree' : r.consistency.mismatches.map((m) => `${m.day} ${m.views}≠${m.typeView}`).join(', ')}`)

  out.push('')
  out.push('SOURCES   host  ours  ph')
  for (const s of r.sources.rows) out.push(`  ${s.host.padEnd(28)} ${String(s.ours).padStart(6)} ${String(s.ph).padStart(6)}${s.flag ? `  ${s.flag}` : ''}`)
  if (r.sources.droppedSameSite.length) out.push(`  (PostHog same-site referrers dropped: ${r.sources.droppedSameSite.join(', ')})`)

  out.push('')
  const k = r.countries
  const line = (xs: Ranked[]) => xs.map((x) => `${x.code} ${x.views}`).join(', ') || '-'
  out.push('COUNTRIES')
  out.push(`  ours     ${line(k.ours)}`)
  out.push(`  PostHog  ${line(k.ph)}`)
  out.push(`  top-10 rank correlation ${fixed(k.rankCorrelation)} · top-5 overlap ${k.top5Overlap}/5 (reported, not gated)`)
  if (k.warning) out.push(`  ${k.warning}`)

  out.push('')
  for (const cr of r.criteria) out.push(`  ${cr.pass ? 'ok  ' : 'FAIL'}  ${cr.name}: ${cr.detail}`)
  out.push(`VERDICT: ${r.verdict}`)
  return `${out.join('\n')}\n`
}
