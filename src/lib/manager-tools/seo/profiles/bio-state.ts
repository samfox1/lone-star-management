/**
 * THE CHANGE NUDGE (OUTSIDE_PROFILES_PLAN.md, build step 1; Sam, 2026-10-01). Platforms never
 * say when a bio was edited, but Tapir knows when the artist's OWN facts change: on Publish.
 * That is the moment every outside bio (bios.ts) may go out of date. So each bio the artist has
 * is one of:
 *
 *   unconfirmed  never ticked "updated"
 *   stale        the facts changed on a Publish AFTER the last tick ("may be out of date since")
 *   recheck      the last tick is more than RECHECK_AFTER_DAYS old ("check it's still current")
 *   current      ticked, and nothing changed since
 *
 * These rows never count in the AI test's score (decided 2026-10-01).
 *
 * PURE: no DB, no React. The Profiles page reads the rows and passes them in (bios-load.ts).
 */
import type { ARTIST_SNAPSHOT } from '@/lib/content'
import { buildConnectionRows, type ConnectionDef, type LinkRowLike } from '@/lib/connections'
import type { IntegrationArtist } from '@/lib/integrations-registry'
import type { SeoTestId } from '@/lib/seo-tests/types'
import { shortDay } from '../../format'
import { OUTSIDE_BIOS, bioItem, type OutsideBio } from './bios'

/**
 * The facts an outside bio repeats, by their column in the published profile (ARTIST_SNAPSHOT:
 * a renamed column is a compile error here). Left out on purpose: `hero_image_url` (the site's
 * hero banner, not the artist's photo), the template, the press kit, the JSON-LD type and the
 * Spotify id, none of which a bio says. The Facts tab's region and country are site text.
 */
export const BIO_FACTS = ['name', 'bio', 'location', 'genre'] as const satisfies readonly (typeof ARTIST_SNAPSHOT)[number][]

/**
 * The profile photo is a fact too (PROFILE_TOOL_PLAN.md, Sam 2026-10-02): every outside profile
 * shows one. It is not an artist column but the `media` row with purpose 'profile_photo', so its
 * history is the media log, read on its own (photoChanges) and merged in (mergeChanges).
 */
export const PHOTO_FACT = 'photo'
export type BioFact = (typeof BIO_FACTS)[number] | typeof PHOTO_FACT
/** Every fact, in the order a row names them. */
export const ALL_BIO_FACTS: readonly BioFact[] = [...BIO_FACTS, PHOTO_FACT]

/** Each fact as the manager reads it: "bio and city changed". */
export const FACT_WORDS: Record<BioFact, string> = { name: 'name', bio: 'bio', location: 'city', genre: 'genre', photo: 'photo' }

/** After this long, a tick asks to be looked at again ("changes + 6 months", decided 2026-10-01). */
export const RECHECK_AFTER_DAYS = 183
export const RECHECK_AFTER_MS = RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000

/** One published profile, shaped like a `revisions` row of entity_type 'artist'. A fact the
 *  snapshot doesn't carry is ABSENT from `data`, never null (bios-load.ts keeps them apart). */
export type ProfileRevision = { published_at: string; data: Record<string, unknown> | null }

/** One Publish that changed a fact, and which. `first`: the artist's first Publish. */
export type FactsChange = { at: string; fields: BioFact[]; first: boolean }

export type BioState = 'unconfirmed' | 'stale' | 'recheck' | 'current'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** One fact as compared: trimmed text, and nothing (null, '', spaces) as null. */
function factValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.trim() || null
  return JSON.stringify(v)
}

/**
 * Every Publish whose facts differ from the Publish before it, newest first, with which facts.
 * The first Publish counts (it is when the facts first went out), naming the facts it set. A
 * republish with the same facts never counts: an editor restyle re-publishes the profile, and
 * must not nudge anyone.
 *
 * A fact is compared only when BOTH snapshots carry it. A column that joined the snapshot later
 * is MISSING from older rows: the first Publish that carries it says nothing about whether it
 * changed, so it must not mark every ticked bio out of date.
 *
 * `complete: false` says the rows are a capped window, not the whole history: the oldest row
 * read has an unknown Publish before it, so it is never treated as the first Publish (no guess).
 *
 * Rows arrive newest first; they are sorted anyway. A row with no snapshot or no date is skipped.
 */
export function factChanges(revisions: readonly ProfileRevision[], { complete = true }: { complete?: boolean } = {}): FactsChange[] {
  const rows = revisions
    .filter((r): r is { published_at: string; data: Record<string, unknown> } => isObj(r.data) && Number.isFinite(Date.parse(r.published_at)))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
  const changes: FactsChange[] = []
  rows.forEach((row, i) => {
    const before = rows[i + 1]
    if (before) {
      const fields = BIO_FACTS.filter((f) => Object.hasOwn(row.data, f) && Object.hasOwn(before.data, f) && factValue(row.data[f]) !== factValue(before.data[f]))
      if (fields.length) changes.push({ at: row.published_at, fields, first: false })
    } else if (complete) {
      changes.push({ at: row.published_at, fields: BIO_FACTS.filter((f) => factValue(row.data[f]) !== null), first: true })
    }
  })
  return changes
}

/** One published revision of a profile-photo `media` row: its file, or null for the tombstone
 *  that took the row off the site. Shaped as bios-load.ts reads it (`data->>storage_path`). */
export type PhotoRevision = { entity_id: string; published_at: string; path: string | null }

/**
 * Every Publish that changed the profile photo, newest first, each naming 'photo'.
 *
 * Compared by FILE, never by row. Picking a photo vacates the slot and inserts a new row
 * (lib/profile-photo.ts), so picking the same image again is a new row with the same file,
 * published in one moment with the old row's tombstone: the photo did not change, and it must not
 * nudge anyone. A republish of the same row (its sort order or alt text moved) is no change either.
 * A first photo, a different one and a removed one all count.
 *
 * One Publish is one insert with one `published_at` (content.ts, publishTogether), so the rows
 * that share a time are applied together before the photo is compared.
 *
 * `complete: false`: the rows are a capped window, so the oldest moment has an unknown photo
 * before it and is never counted (the same rule factChanges keeps).
 */
export function photoChanges(revisions: readonly PhotoRevision[], { complete = true }: { complete?: boolean } = {}): FactsChange[] {
  const moments = new Map<number, { at: string; rows: PhotoRevision[] }>()
  for (const r of revisions) {
    const t = Date.parse(r.published_at)
    if (!r.entity_id || !Number.isFinite(t)) continue
    const m = moments.get(t)
    if (m) m.rows.push(r)
    else moments.set(t, { at: r.published_at, rows: [r] })
  }
  const live = new Map<string, string>()
  // What the site showed: every live row's file, as one value (two rows can exist from before
  // the slot held one, and a change to either is a change).
  const shown = () => [...new Set(live.values())].sort().join('\n') || null
  const changes: FactsChange[] = []
  let before: string | null = null
  let known = complete
  for (const [, m] of [...moments.entries()].sort((a, b) => a[0] - b[0])) {
    for (const r of m.rows) {
      const path = r.path?.trim()
      if (path) live.set(r.entity_id, path)
      else live.delete(r.entity_id)
    }
    const now = shown()
    if (known && now !== before) changes.push({ at: m.at, fields: [PHOTO_FACT], first: false })
    before = now
    known = true
  }
  return changes.reverse()
}

/**
 * The profile's fact changes and the photo's, as one list, newest first. A photo change in the
 * same Publish as a fact change (the same instant) is ONE change naming both, in ALL_BIO_FACTS
 * order, and stays the first Publish when it was one.
 */
export function mergeChanges(...lists: readonly (readonly FactsChange[])[]): FactsChange[] {
  const byTime = new Map<number, FactsChange>()
  for (const c of lists.flat()) {
    const t = Date.parse(c.at)
    const prev = byTime.get(t)
    byTime.set(
      t,
      prev ? { at: prev.at, fields: ALL_BIO_FACTS.filter((f) => prev.fields.includes(f) || c.fields.includes(f)), first: prev.first || c.first } : c,
    )
  }
  return [...byTime.entries()].sort((a, b) => b[0] - a[0]).map(([, c]) => c)
}

/**
 * One bio's state. A change after the tick wins over the 6 months: it has a date to say. A
 * tick exactly RECHECK_AFTER_DAYS old is still current; a moment more asks again.
 */
export function bioState({ confirmedAt, factsChangedAt: changedAt, now }: { confirmedAt: string | null; factsChangedAt: string | null; now: Date | number }): BioState {
  const confirmed = confirmedAt ? Date.parse(confirmedAt) : NaN
  if (!Number.isFinite(confirmed)) return 'unconfirmed'
  const changed = changedAt ? Date.parse(changedAt) : NaN
  if (changed > confirmed) return 'stale'
  if (+now - confirmed > RECHECK_AFTER_MS) return 'recheck'
  return 'current'
}

/** "bio", "city and genre", "name, bio and genre". */
export function changedWords(fields: readonly BioFact[]): string {
  const words = fields.map((f) => FACT_WORDS[f])
  if (words.length < 2) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** An outside bio the artist has: its platform is connected (Connections). */
export type ConnectedBio = { key: OutsideBio; label: string; edit: string; def: ConnectionDef; url: string | null }

/**
 * The outside bios the artist has, in OUTSIDE_BIOS order: each one whose platform is connected,
 * exactly as the Connections tool decides it (`buildConnectionRows`: a profile link, or the
 * platform's source id on the artist). So Apple Music and Bandsintown show only when linked,
 * and a booking address or a button bound to a site element is never a profile.
 */
export function connectedBios(links: readonly LinkRowLike[], artist: IntegrationArtist): ConnectedBio[] {
  const rows = buildConnectionRows({ links, artist, shopifyConnected: false, counts: {} })
  return OUTSIDE_BIOS.flatMap((b) => {
    const row = rows.find((r) => r.label === b.label)
    return row ? [{ key: b.key, label: b.label, edit: b.edit, def: row.def, url: row.url ?? null }] : []
  })
}

/* ── what the AI test read ───────────────────────────────────────────────────────────── */

/**
 * What the AI test READ on a platform, for a bio Tapir can check itself (OUTSIDE_PROFILES_PLAN.md,
 * build step 2: YouTube's channel description). Only a pass or a fail is a read; "couldn't check"
 * and "doesn't apply" say nothing about the bio, so the row keeps its manual state.
 */
export type BioRead = { status: 'pass' | 'fail'; value: string; sentence: string; lead?: 'Almost' }

/** The AI test that reads each bio Tapir can read. */
export const BIO_TESTS = { youtube: 'youtube' } as const satisfies Partial<Record<OutsideBio, SeoTestId>>

/** The reads, from the newest stored run's `results` (read defensively: a stored row is data). */
export function bioReads(results: unknown): Partial<Record<OutsideBio, BioRead>> {
  const out: Partial<Record<OutsideBio, BioRead>> = {}
  if (!Array.isArray(results)) return out
  for (const [bio, test] of Object.entries(BIO_TESTS) as [OutsideBio, SeoTestId][]) {
    const r = results.find((x): x is Record<string, unknown> => isObj(x) && x.id === test)
    if (!r || (r.status !== 'pass' && r.status !== 'fail') || typeof r.value !== 'string' || typeof r.sentence !== 'string') continue
    out[bio] = { status: r.status, value: r.value, sentence: r.sentence, ...(r.lead === 'Almost' ? { lead: 'Almost' as const } : {}) }
  }
  return out
}

/** What the rows are built from. Null where a read failed: those rows say "couldn't check". */
export type BiosInput = {
  /** Null: the links couldn't be read, so which bios is unknown. */
  bios: ConnectedBio[] | null
  /** When each item was ticked, by profile_marks item. Null: couldn't read. */
  marks: Partial<Record<string, string>> | null
  /** False: the published profiles couldn't be read. */
  factsKnown: boolean
  /** Every fact change, newest first (factChanges). */
  changes: FactsChange[]
  /** What the newest AI test run read, per bio it can read (bioReads). Absent: none. */
  reads?: Partial<Record<OutsideBio, BioRead>>
}

export type BioRow = ConnectedBio & {
  confirmedAt: string | null
  state: BioState | null
  /** Stale only: the OLDEST change after this bio's tick ("may be out of date since"). */
  since: string | null
  /** Stale only: every fact changed after this bio's tick, in ALL_BIO_FACTS order. */
  changed: BioFact[]
  /** What the AI test read there, for a bio Tapir can check (bioReads); null: none. */
  read: BioRead | null
}

/**
 * The rows, each with its state at `now`. Null when the links couldn't be read (which bios is
 * unknown). A row's state is null when its tick or the published facts couldn't be read: it
 * says "couldn't check", never a guess.
 *
 * Each row reads only the changes AFTER its own tick: out of date since the oldest of them,
 * naming every fact any of them changed. A never-ticked row is "not confirmed", with neither.
 */
export function bioRows(input: BiosInput, now: Date | number): BioRow[] | null {
  if (!input.bios) return null
  const { marks, factsKnown, changes } = input
  return input.bios.map((b) => {
    const confirmedAt = marks?.[bioItem(b.key)] ?? null
    const state = marks && factsKnown ? bioState({ confirmedAt, factsChangedAt: changes[0]?.at ?? null, now }) : null
    const read = input.reads?.[b.key] ?? null
    if (state !== 'stale') return { ...b, confirmedAt, state, since: null, changed: [], read }
    const after = changes.filter((c) => Date.parse(c.at) > Date.parse(confirmedAt!))
    return {
      ...b,
      confirmedAt,
      state,
      since: after[after.length - 1].at,
      changed: ALL_BIO_FACTS.filter((f) => after.some((c) => c.fields.includes(f))),
      read,
    }
  })
}

/**
 * "Sep 29" in the time zone this runs in (the viewer's, in the browser), with the year when it
 * is not the year of `now`. Call it only after mount: a server in UTC would print another day,
 * and React 19 does not repaint a mismatched text node. Empty for a bad date.
 */
export function dayLabel(iso: string, now: Date | number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return shortDay(d, { locale: 'en-US', now })
}

/** How many bios to look at: every row that is not current. A row that couldn't be checked is
 *  not counted (the AI test then says nothing rather than something false). */
export function biosToCheck(rows: readonly BioRow[] | null): number {
  return (rows ?? []).filter((r) => r.state !== null && r.state !== 'current').length
}
