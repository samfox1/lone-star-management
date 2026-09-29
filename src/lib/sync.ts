/**
 * Sync external catalog data into a tenant's working rows, honoring the conflict
 * policy (PLAN #6): insert items we haven't seen, refresh rows we own
 * (source = this provider), and leave alone any row owned by someone else. All
 * writes go through the caller's RLS-scoped client, so a sync can only ever write
 * into its own artist.
 *
 * CAVEAT, corrected 2026-09-02: this header used to claim that `source` flips to
 * 'manual' the moment a human touches a row, which would make "never overwrite a
 * manager's hand edit" true for every column. Nothing implements that flip —
 * `updateContent` writes only `pickFields`, `source` is in no CRUD field list, and
 * no trigger does it. So a row imported from a provider stays that provider's
 * forever and every pull refreshes it, hand edits included. The guarantee that DOES
 * hold is narrower: a row whose source is already something else (a manually ADDED
 * row, or another provider's) is skipped. Before adding a column to any sync's
 * `values`, ask whether a manager can edit that column — if so, writing it here
 * silently reverts them (see `merch/sync.ts` on `in_stock`).
 *
 * The network clients (spotify/bandsintown) are kept separate: routes fetch the
 * items and hand them here, so this pure DB step is testable against a real
 * database without touching any external API.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SpotifyTrackInput, SpotifyReleaseInput } from '@/lib/spotify'
import { slugify } from '@/lib/slug'
import type { DeezerTrackInput } from '@/lib/deezer'
import type { AppleTrackInput } from '@/lib/apple'
import type { YouTubeVideoInput } from '@/lib/youtube'
import type { BandsintownTourDate } from '@/lib/bandsintown'
import type { TicketmasterTourDate } from '@/lib/ticketmaster'
import { PULLED_COLUMNS, planTourPull, slotNewRows, type ExistingTourRow, type IncomingShow } from '@/lib/tour-pull'
import type { ReleaseType } from '@/lib/releases'
import { groupReleases, matchTrackCandidate, normalizeTitle, type CatalogRelease, type CatalogReleaseRef } from '@/lib/sync-match'

// The merge DECISIONS live in sync-match (pure, mutation-tested); this module writes.
export { normalizeTitle, matchTrackCandidate } from '@/lib/sync-match'
export type { CatalogRelease } from '@/lib/sync-match'

export type SyncError = { externalId: string; op: 'insert' | 'update'; message: string }

/**
 * Something the manager has to KNOW about a pull, named by the song it happened to
 * (Sam, 2026-09-12: "if there are duplicates, notify me when the sync happens").
 *
 *  `merged-by-title`    two rows became one on the strength of the title alone, because
 *                       neither side could offer a duration. Almost always right, and
 *                       the one case where a wrong answer quietly loses a recording —
 *                       so it is never done quietly.
 *  `possible-duplicate` a song was added even though the artist already has one by that
 *                       name: several candidates, or the only one was already taken.
 */
export type SyncNote = { title: string; kind: 'merged-by-title' | 'possible-duplicate' }

export type SyncResult = {
  added: number
  updated: number
  skipped: number
  /** Incoming rows STAMPED onto an existing cross-platform match (union merge)
   *  instead of inserted as a duplicate. Only the track syncs produce these; every
   *  other sync returns 0. */
  merged: number
  /** Rows that errored at write time. 0 on a fully clean sync. */
  failed: number
  /** Per-item failures, in encounter order. Empty on a fully clean sync. */
  errors: SyncError[]
  /** Judgement calls worth a sentence, in encounter order. Empty on a clean sync —
   *  the dialog prints a line per note, so silence has to mean nothing happened. */
  notes: SyncNote[]
}

/**
 * ONE SENTENCE FOR EVERY PULL — what it did, and what it could not do.
 *
 * `syncExternal` has always returned `failed` and per-item `errors`, and almost every
 * action threw them away and returned a bare `{ ok: true }`. A pull where three rows
 * collided on a unique index therefore looked exactly like a clean one — which is why
 * two known bugs in MERCH_PLAN are invisible ("a handle swap fails one row";
 * "reconnecting to a different store leaves stale rows"). Only the Shopify action
 * reported it, in prose it had invented for itself.
 *
 * Here so every source says the same thing the same way, and so the sync dialog can show
 * a per-source line without each action having its own wording.
 *
 * A PARTIAL FAILURE IS NOT `ok`. Some rows landed and some did not, and a manager who
 * reads "pulled" will publish a catalogue that is missing products. The count that landed
 * rides along because it is the difference between "retry" and "look at your store", and
 * so does the first error message: a constraint name says which of those it is.
 */
export type SyncOutcome = { ok: boolean; message?: string; error?: string; notes: SyncNote[] }

export function syncOutcome(
  result: SyncResult,
  /** Singular noun for the thing pulled — "product", "song", "tour date". */
  noun: string,
): SyncOutcome {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`
  if (result.failed > 0) {
    const landed = result.added + result.updated + result.merged
    // Empty `errors` with a non-zero `failed` would be a bug in the sync, but swallowing
    // the count because the detail is missing is worse than reporting it bare.
    const reason = result.errors[0]?.message ?? 'unknown error'
    return { ok: false, error: `${plural(result.failed)} failed to save (${landed} saved): ${reason}`, notes: result.notes }
  }
  // NOTHING CHANGED is the normal outcome of a second pull, and it has to read that way.
  // `skipped` alone is that case: rows were looked at and deliberately left, which is
  // "up to date", not "7 left alone" — a count with no verb reads as a problem.
  // A pull that changed nothing can still have found a twin: the notes ride every path
  // out of here, or the one case worth reporting is the one that stays hidden.
  if (!result.added && !result.updated && !result.merged) {
    return { ok: true, message: 'Already up to date', notes: result.notes }
  }
  const parts: string[] = []
  if (result.added) parts.push(`${result.added} added`)
  if (result.updated) parts.push(`${result.updated} updated`)
  if (result.merged) parts.push(`${result.merged} merged`)
  if (result.skipped) parts.push(`${result.skipped} left alone`)
  return { ok: true, message: parts.join(', '), notes: result.notes }
}

/** Postgres RLS / authorization denial — a hard contract breach, never partial. */
const RLS_DENIED = '42501'
/** Postgres unique violation: the row is already there (a concurrent pull won the race). */
const UNIQUE_VIOLATION = '23505'

/** One incoming external item: its stable id + the columns to write. */
type ExternalItem = { externalId: string; values: Record<string, unknown> }

export type SyncSpec = {
  table: string
  /** Column holding the provider's stable id (e.g. spotify_id). Trusted constant. */
  externalIdCol: string
  /** The `source` value this provider owns (e.g. 'spotify'). */
  source: string
  artistId: string
  items: ExternalItem[]
  /** Columns set only on INSERT of a new row (not on refresh), e.g. `on_site:false`
   *  so imported items land off-site until the manager publishes them on. */
  insertDefaults?: Record<string, unknown>
}

export async function syncExternal(supabase: SupabaseClient, spec: SyncSpec): Promise<SyncResult> {
  const { table, externalIdCol, source, artistId, items, insertDefaults } = spec

  const { data: existing, error: listErr } = await supabase
    .from(table)
    .select(`id, source, ${externalIdCol}`)
    .eq('artist_id', artistId)
  if (listErr) throw new Error(listErr.message)

  // The dynamic select string defeats supabase-js's row-type inference, so read
  // the rows as plain records.
  const rows = (existing ?? []) as unknown as Record<string, unknown>[]
  const byExternalId = new Map<string, { id: string; source: string }>()
  for (const row of rows) {
    const ext = row[externalIdCol] as string | null
    if (ext) byExternalId.set(ext, { id: row.id as string, source: row.source as string })
  }

  // Upstream can repeat an externalId; collapse to one item, last-wins, so we
  // never insert the same row twice or fight ourselves on updates.
  const deduped = Array.from(new Map(items.map((i) => [i.externalId, i])).values())

  let added = 0
  let updated = 0
  let skipped = 0
  const errors: SyncError[] = []

  for (const item of deduped) {
    const match = byExternalId.get(item.externalId)

    // New row: insert one at a time so a single bad row (e.g. a value that
    // overflows the column) fails only itself, not the whole batch. A
    // permission denial is fatal (a security breach, not a flaky upstream row).
    if (!match) {
      const { error } = await supabase.from(table).insert({
        artist_id: artistId,
        ...insertDefaults,
        ...item.values,
        [externalIdCol]: item.externalId,
        source,
      })
      if (error) {
        if (error.code === RLS_DENIED) throw new Error(error.message)
        errors.push({ externalId: item.externalId, op: 'insert', message: error.message })
      } else added++
      continue
    }

    // Only refresh rows this provider owns; never clobber a manual edit (or a
    // row owned by a different provider).
    if (match.source !== source) {
      skipped++
      continue
    }

    const { error } = await supabase.from(table).update(item.values).eq('id', match.id)
    if (error) {
      if (error.code === RLS_DENIED) throw new Error(error.message)
      errors.push({ externalId: item.externalId, op: 'update', message: error.message })
    } else updated++
  }

  return { added, updated, skipped, merged: 0, failed: errors.length, errors, notes: [] }
}

// ── Multi-platform track merge ─────────────────────────────────────────────────
// Tracks are a UNION row: one song carries every platform's ids/links, and "which
// platforms is it on" is derived from which id columns are set. So a pull doesn't
// switch sources or duplicate — for each incoming song it either refreshes the row
// that already bears this platform's id, STAMPS this platform onto the same song
// imported from another platform (matched by title + duration), or inserts it new.
// Manual edits and other platforms' fields are never clobbered.

/** The per-platform id column an incoming track is keyed by. */
type TrackIdCol = 'spotify_id' | 'apple_id' | 'deezer_id'

/** One incoming track, normalized across platforms. */
type IncomingTrack = {
  externalId: string
  title: string
  cover_url: string | null
  album_name: string | null
  duration_ms: number | null
  /** Platform-owned columns, written on insert + same-platform refresh. */
  owned: Record<string, unknown>
  /** Fill-if-empty columns (the platform's link) when stamping onto another
   *  platform's row — never overwrites an existing value. */
  mergeFill: Record<string, unknown>
  /** Columns the platform SEEDS but the manager owns afterwards (a song's featured
   *  artists): written on insert, and on a refresh only where the row has nothing —
   *  a name the manager added or removed in the dashboard survives every pull. */
  fillIfEmpty?: Record<string, unknown>
}

/** The columns of an existing row the merge reads. */
type TrackRow = {
  id: string
  source: string
  title: string
  duration_ms: number | null
  spotify_id: string | null
  apple_id: string | null
  deezer_id: string | null
  cover_url: string | null
  album_name: string | null
  stream_url: string | null
  apple_url: string | null
  featured_artists: string[] | null
}

/**
 * Field ownership on a same-platform refresh.
 *
 * AUTHORITATIVE — the provider is the source of truth and writes them unconditionally:
 * `title` plus its own `owned` columns (its link, its provider-specific metadata). The
 * refresh only runs on rows whose `source` is this provider, so it owns them outright.
 *
 * ENRICHMENT — cross-platform facts (album_name, cover_url, duration_ms) that several
 * providers may know and none owns. Written ONLY when the incoming value is non-null:
 * a sync must never write null over a non-null enrichment value. Without this rule,
 * refreshMusicAction's Spotify → Apple → Deezer ordering meant whichever provider ran
 * last and lacked a field erased it on every single Sync click.
 *
 * Inserts are exempt — a brand-new row has nothing to lose, so nulls go in as-is and
 * a later provider fills them.
 */
function enrichmentPatch(item: IncomingTrack): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (item.cover_url != null) patch.cover_url = item.cover_url
  if (item.album_name != null) patch.album_name = item.album_name
  if (item.duration_ms != null) patch.duration_ms = item.duration_ms
  return patch
}

async function syncTracks(
  supabase: SupabaseClient,
  artistId: string,
  idCol: TrackIdCol,
  source: string,
  incoming: IncomingTrack[],
): Promise<SyncResult> {
  // Ordered, not just filtered: when several rows share a normalized title the merge
  // picks among them, so unordered Postgres row order would decide which song gets
  // stamped — a different answer run to run against identical data.
  const { data, error } = await supabase
    .from('tracks')
    .select('id, source, title, duration_ms, spotify_id, apple_id, deezer_id, cover_url, album_name, stream_url, apple_url, featured_artists')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as TrackRow[]

  const byId = new Map<string, TrackRow>()
  const byTitle = new Map<string, TrackRow[]>()
  for (const r of rows) {
    const idv = r[idCol]
    if (idv) byId.set(idv, r)
    const key = normalizeTitle(r.title)
    const bucket = byTitle.get(key)
    if (bucket) bucket.push(r)
    else byTitle.set(key, [r])
  }

  // Upstream can repeat an externalId; collapse last-wins.
  const deduped = Array.from(new Map(incoming.map((i) => [i.externalId, i])).values())
  const claimed = new Set<string>()

  let added = 0
  let updated = 0
  let skipped = 0
  let merged = 0
  const errors: SyncError[] = []
  const notes: SyncNote[] = []

  for (const item of deduped) {
    // 1) A row already carries THIS platform's id → refresh it, but only if this
    //    platform owns it (never clobber a manual edit / another provider).
    const exact = byId.get(item.externalId)
    if (exact) {
      if (exact.source !== source) {
        skipped++
        continue
      }
      const seed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(item.fillIfEmpty ?? {})) {
        const cur = (exact as Record<string, unknown>)[k]
        const empty = cur == null || (Array.isArray(cur) && cur.length === 0)
        if (empty && v != null) seed[k] = v
      }
      const { error: uErr } = await supabase
        .from('tracks')
        .update({ title: item.title, ...enrichmentPatch(item), ...item.owned, ...seed })
        .eq('id', exact.id)
      if (uErr) {
        if (uErr.code === RLS_DENIED) throw new Error(uErr.message)
        errors.push({ externalId: item.externalId, op: 'update', message: uErr.message })
      } else updated++
      continue
    }

    // 2) The same song imported from ANOTHER platform → stamp this platform onto it
    //    (its id + link + any fields it was missing), never touching title/source.
    const match = matchTrackCandidate(byTitle.get(normalizeTitle(item.title)), item, idCol, claimed)
    if (match.kind === 'match') {
      const cand = match.row
      claimed.add(cand.id)
      const fill: Record<string, unknown> = { [idCol]: item.externalId }
      if (cand.duration_ms == null && item.duration_ms != null) fill.duration_ms = item.duration_ms
      if (cand.cover_url == null && item.cover_url != null) fill.cover_url = item.cover_url
      if (cand.album_name == null && item.album_name != null) fill.album_name = item.album_name
      for (const [k, v] of Object.entries(item.mergeFill)) {
        if (v != null && (cand as Record<string, unknown>)[k] == null) fill[k] = v
      }
      const { error: mErr } = await supabase.from('tracks').update(fill).eq('id', cand.id)
      if (mErr) {
        if (mErr.code === RLS_DENIED) throw new Error(mErr.message)
        errors.push({ externalId: item.externalId, op: 'update', message: mErr.message })
      } else {
        merged++
        // Say it out loud when the title was the only evidence (see matchTrackCandidate).
        if (match.byTitleOnly) notes.push({ title: cand.title, kind: 'merged-by-title' })
        cand[idCol] = item.externalId // reflect locally so a later item can't re-merge it
      }
      continue
    }

    // 3) A song we haven't seen on any platform → insert new, OFF-SITE. A fresh import
    //    isn't public until the manager puts its release on the site (option A: a song's
    //    on-site state follows its home release, reconciled on publish). Existing tracks are
    //    never touched here (paths 1 & 2 don't write on_site), so nothing already live drops.
    const { error: iErr } = await supabase.from('tracks').insert({
      artist_id: artistId,
      [idCol]: item.externalId,
      source,
      title: item.title,
      cover_url: item.cover_url,
      album_name: item.album_name,
      duration_ms: item.duration_ms,
      on_site: false,
      ...item.owned,
      ...item.fillIfEmpty,
    })
    if (iErr) {
      if (iErr.code === RLS_DENIED) throw new Error(iErr.message)
      errors.push({ externalId: item.externalId, op: 'insert', message: iErr.message })
    } else {
      added++
      // A song by this name was already here and could not take the new one: the manager
      // is the only one who can say whether that is two recordings or one mess.
      if (match.sawCandidate) notes.push({ title: item.title, kind: 'possible-duplicate' })
    }
  }

  return { added, updated, skipped, merged, failed: errors.length, errors, notes }
}

export function syncSpotifyTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: SpotifyTrackInput[],
): Promise<SyncResult> {
  return syncTracks(
    supabase,
    artistId,
    'spotify_id',
    'spotify',
    tracks.map((t) => ({
      externalId: t.spotify_id,
      title: t.title,
      cover_url: t.cover_url,
      album_name: t.album_name,
      duration_ms: t.duration_ms,
      owned: { stream_url: t.stream_url },
      mergeFill: { stream_url: t.stream_url },
      // Seeded from Spotify, then the manager's (Sam, 2026-09-11: collaborators are
      // edited on the song) — a pull never overwrites a list the row already has.
      fillIfEmpty: { featured_artists: t.featured_artists },
    })),
  )
}

// ── Releases: one per album, whichever platform brings it ─────────────────────────
// Sam, 2026-09-28: "Songs pulled from Apple Music or Deezer never get grouped into albums,
// EPs or singles. Only Spotify does that." → "Yes, group them." All three platforms now
// create and join releases through ONE function, so a release Spotify made is the one
// Apple and Deezer file their songs under, and the other way round.

/** The catalog platforms that bring releases. */
type ReleasePlatform = 'spotify' | 'apple' | 'deezer'

/**
 * Per platform: the track column its song ids live in, the label of the DSP link a NEW
 * release is seeded with, and its release-id column on `releases`. Only Spotify has one
 * (`releases.spotify_id`); an Apple or Deezer release is known by its SONGS instead, which
 * the schema already records (`tracks.apple_id` / `deezer_id` + `tracks.release_id`).
 */
const RELEASE_PLATFORM: Record<ReleasePlatform, { trackIdCol: TrackIdCol; linkLabel: string; releaseIdCol: 'spotify_id' | null }> = {
  spotify: { trackIdCol: 'spotify_id', linkLabel: 'Spotify', releaseIdCol: 'spotify_id' },
  apple: { trackIdCol: 'apple_id', linkLabel: 'Apple Music', releaseIdCol: null },
  deezer: { trackIdCol: 'deezer_id', linkLabel: 'Deezer', releaseIdCol: null },
}

/** What a release sync did. `merged` = joined a release another platform (or the
 *  manager) made; `notes` name the judgement calls, in the song sync's own words. */
export type ReleaseSyncResult = { added: number; updated: number; merged: number; notes: SyncNote[] }

type ReleaseRow = {
  id: string
  slug: string
  title: string
  source: string
  spotify_id: string | null
  cover_url: string | null
  release_date: string | null
  release_type: ReleaseType
  release_type_locked: boolean | null
}

/**
 * Sync one platform's releases (albums/EPs/singles) into `releases` and file their songs
 * under them. Run AFTER that platform's song sync, so its songs exist (inserted, or
 * stamped onto another platform's copy) to be filed and to be read as evidence.
 *
 * FINDING THE RELEASE — the song sync's own tiers, strongest first:
 *   1. its id: `releases.spotify_id` (Spotify only — the one release-id column);
 *   2. its SONGS: the release this platform's songs already sit in. The song merge has
 *      just decided which songs are the same across platforms, so when Apple's copies were
 *      stamped onto Spotify's rows, those rows already name Spotify's release. The most
 *      common one wins (a manager may have moved a song or two). A release carrying a
 *      DIFFERENT Spotify album id is another Spotify album's, never this one's;
 *   3. its TITLE, through the song matcher's no-length tier (matchTrackCandidate): the
 *      normalized title must leave exactly ONE open release, and the pull names it.
 *      Only releases a platform IMPORTED are candidates — a hand-made release is joined
 *      only through its songs (tier 2), never on a name alone — and a release already on
 *      this platform (its id, or songs from it) is out of the running;
 *   4. none of those: a NEW release, off-site, owned by this platform, with a unique slug
 *      and one seed DSP link.
 *
 * WHAT A MATCH MAY WRITE — the song sync's union rule, applied to releases:
 *   - the platform that CREATED the release (source) refreshes what Spotify always
 *     refreshed: title, and cover/date when it has them (never null over a value), and
 *     the type unless the manager locked it;
 *   - any other platform only fills what is empty (cover, date) and, for Spotify, stamps
 *     its album id — never the title or type another platform (or the manager) set;
 *   - NOBODY touches on_site, slug, links, released, sort_order: manager-owned. Links are
 *     seeded on insert only; with no Apple/Deezer id column there is no telling "never
 *     added" from "the manager deleted it", so a pull never re-adds one.
 * Songs are filed only where still unassigned (a manual move wins), and take the release's
 * type only while at the column default 'single' (a manual re-tag wins).
 */
async function syncReleases(
  supabase: SupabaseClient,
  artistId: string,
  platform: ReleasePlatform,
  incoming: CatalogRelease[],
): Promise<ReleaseSyncResult> {
  const { trackIdCol, linkLabel, releaseIdCol } = RELEASE_PLATFORM[platform]

  // Pinned order for the same reason as the song sync: a tie must not be decided by
  // Postgres row order.
  const { data: relData, error: relErr } = await supabase
    .from('releases')
    .select('id, slug, title, source, spotify_id, cover_url, release_date, release_type, release_type_locked')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (relErr) throw new Error(relErr.message)
  const rows = (relData ?? []) as unknown as ReleaseRow[]

  // Every song of the artist: which release each of this platform's songs sits in, and
  // which releases already hold a song from this platform.
  const { data: songData, error: songErr } = await supabase
    .from('tracks')
    .select(`id, release_id, ${trackIdCol}`)
    .eq('artist_id', artistId)
  if (songErr) throw new Error(songErr.message)
  const songs = (songData ?? []) as unknown as Record<string, string | null>[]

  const byId = new Map<string, ReleaseRow>()
  const byExternal = new Map<string, ReleaseRow>()
  const byTitle = new Map<string, ReleaseRow[]>()
  const slugs = new Set<string>()
  for (const r of rows) {
    byId.set(r.id, r)
    if (releaseIdCol && r[releaseIdCol]) byExternal.set(r[releaseIdCol]!, r)
    slugs.add(r.slug)
    if (r.source === 'manual') continue // joined through its songs only (see tier 3)
    const key = normalizeTitle(r.title)
    const bucket = byTitle.get(key)
    if (bucket) bucket.push(r)
    else byTitle.set(key, [r])
  }
  const releaseOfSong = new Map<string, string | null>()
  const onPlatform = new Set<string>()
  for (const t of songs) {
    const ext = t[trackIdCol]
    if (!ext) continue
    releaseOfSong.set(ext, t.release_id)
    if (t.release_id) onPlatform.add(t.release_id)
  }

  /** Tier 2: the release most of this release's songs already sit in. */
  function bySongs(rel: CatalogRelease): ReleaseRow | undefined {
    const tally = new Map<string, number>()
    for (const tid of rel.trackIds) {
      const rid = releaseOfSong.get(tid)
      const row = rid ? byId.get(rid) : undefined
      if (!row) continue
      if (releaseIdCol && row[releaseIdCol] != null && row[releaseIdCol] !== rel.externalId) continue
      tally.set(row.id, (tally.get(row.id) ?? 0) + 1)
    }
    let best: ReleaseRow | undefined
    let bestCount = 0
    for (const [rid, n] of tally) {
      if (n > bestCount) {
        best = byId.get(rid)
        bestCount = n
      }
    }
    return best
  }

  // Upstream can repeat a release id; collapse last-wins.
  const deduped = Array.from(new Map(incoming.map((r) => [r.externalId, r])).values())
  const claimed = new Set<string>()
  let added = 0
  let updated = 0
  let merged = 0
  const notes: SyncNote[] = []

  for (const rel of deduped) {
    let target = releaseIdCol ? byExternal.get(rel.externalId) : undefined
    if (!target) target = bySongs(rel)
    let sawCandidate = false
    if (!target) {
      const cands = (byTitle.get(normalizeTitle(rel.title)) ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        duration_ms: null,
        on_platform: (releaseIdCol ? r[releaseIdCol] : null) ?? (onPlatform.has(r.id) ? r.id : null),
      }))
      const m = matchTrackCandidate(cands, { title: rel.title, duration_ms: null }, 'on_platform', claimed)
      if (m.kind === 'match') {
        target = byId.get(m.row.id)
        notes.push({ title: target!.title, kind: 'merged-by-title' })
      } else sawCandidate = m.sawCandidate
    }

    let releaseId: string
    let effectiveType: ReleaseType
    if (target) {
      releaseId = target.id
      claimed.add(target.id)
      onPlatform.add(target.id)
      const owner = target.source === platform
      const patch: Record<string, unknown> = {}
      if (owner) {
        patch.title = rel.title
        if (rel.cover_url != null) patch.cover_url = rel.cover_url
        if (rel.release_date != null) patch.release_date = rel.release_date
        if (!target.release_type_locked) patch.release_type = rel.release_type
      } else {
        if (target.cover_url == null && rel.cover_url != null) patch.cover_url = rel.cover_url
        if (target.release_date == null && rel.release_date != null) patch.release_date = rel.release_date
      }
      if (releaseIdCol && target[releaseIdCol] == null) patch[releaseIdCol] = rel.externalId
      if (Object.keys(patch).length > 0) {
        const { error: uErr } = await supabase.from('releases').update(patch).eq('id', target.id)
        if (uErr) throw new Error(uErr.message)
        Object.assign(target, patch)
        if (releaseIdCol && patch[releaseIdCol]) byExternal.set(rel.externalId, target)
      }
      if (owner) updated++
      else merged++
      effectiveType = target.release_type
    } else {
      // Unique slug within the artist.
      const base = slugify(rel.title) || rel.externalId.slice(0, 8)
      let slug = base
      for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`
      slugs.add(slug)
      const links = rel.url ? [{ label: linkLabel, url: rel.url }] : []
      const { data: ins, error: iErr } = await supabase
        .from('releases')
        .insert({
          artist_id: artistId,
          title: rel.title,
          cover_url: rel.cover_url,
          release_date: rel.release_date,
          release_type: rel.release_type,
          slug,
          links,
          on_site: false,
          source: platform,
          ...(releaseIdCol ? { [releaseIdCol]: rel.externalId } : {}),
        })
        .select('id')
        .single()
      if (iErr) throw new Error(iErr.message)
      releaseId = ins!.id as string
      const row: ReleaseRow = {
        id: releaseId,
        slug,
        title: rel.title,
        source: platform,
        spotify_id: releaseIdCol ? rel.externalId : null,
        cover_url: rel.cover_url,
        release_date: rel.release_date,
        release_type: rel.release_type,
        release_type_locked: false,
      }
      byId.set(releaseId, row)
      if (releaseIdCol) byExternal.set(rel.externalId, row)
      claimed.add(releaseId)
      onPlatform.add(releaseId)
      effectiveType = rel.release_type
      added++
      // A release by this name was already here and could not take this one.
      if (sawCandidate) notes.push({ title: rel.title, kind: 'possible-duplicate' })
    }

    if (rel.trackIds.length === 0) continue
    // File the songs — only unassigned ones, so a manual (or earlier) assignment wins.
    const { error: lErr } = await supabase
      .from('tracks')
      .update({ release_id: releaseId })
      .eq('artist_id', artistId)
      .is('release_id', null)
      .in(trackIdCol, rel.trackIds)
    if (lErr) throw new Error(lErr.message)
    for (const tid of rel.trackIds) if (releaseOfSong.get(tid) == null) releaseOfSong.set(tid, releaseId)
    // Stamp the release's type onto its songs (the Music page reads the SONG's tag), only
    // where a song is still at the column default — a manual re-tag is never clobbered.
    // The type is the release's own after this pull (a locked type, or the creating
    // platform's), so a release's songs agree with it.
    if (effectiveType === 'single') continue
    const { error: tErr } = await supabase
      .from('tracks')
      .update({ release_type: effectiveType })
      .eq('artist_id', artistId)
      .eq('release_id', releaseId)
      .eq('release_type', 'single')
      .in(trackIdCol, rel.trackIds)
    if (tErr) throw new Error(tErr.message)
  }

  return { added, updated, merged, notes }
}

/**
 * Sync the artist's Spotify releases (albums/EPs/singles) into `releases` and file their
 * songs — through the one release sync all three platforms share (see syncReleases). A
 * release Apple or Deezer already made is found through its songs (or its title) and
 * gets Spotify's album id stamped on it, instead of a second copy.
 * Run AFTER the tracks sync, so the tracks exist to be linked.
 */
export function syncSpotifyReleases(
  supabase: SupabaseClient,
  artistId: string,
  releases: SpotifyReleaseInput[],
): Promise<ReleaseSyncResult> {
  return syncReleases(
    supabase,
    artistId,
    'spotify',
    releases.map((r) => ({
      externalId: r.spotify_id,
      title: r.title,
      release_type: r.release_type,
      cover_url: r.cover_url,
      release_date: r.release_date,
      url: r.spotify_url,
      trackIds: r.track_spotify_ids,
    })),
  )
}

/**
 * The song sync, then the releases those songs came from. The Apple and Deezer pulls
 * hand over one flat song list (each song carrying its release), so their sync step is
 * where the list folds back into releases — the actions that call these need no change.
 * Songs with no release (a compilation, an appearance, a fixture without one) stay loose;
 * a list with none at all never touches `releases`. The release sync's notes join the
 * song sync's, so the Sync dialog names a release joined on its title alone.
 */
async function thenReleases(
  supabase: SupabaseClient,
  artistId: string,
  platform: 'apple' | 'deezer',
  songResult: SyncResult,
  songs: { trackId: string; release?: CatalogReleaseRef | null }[],
): Promise<SyncResult> {
  const releases = groupReleases(songs)
  if (releases.length === 0) return songResult
  const rel = await syncReleases(supabase, artistId, platform, releases)
  return { ...songResult, notes: [...songResult.notes, ...rel.notes] }
}

/** Apple Music is a metadata + link-out source (no hosted audio). Its link lives in
 *  `apple_url` (not the shared legacy `provider_url`) so a merged row keeps each
 *  platform's link independently. */
export async function syncAppleTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: AppleTrackInput[],
): Promise<SyncResult> {
  const songs = await syncTracks(
    supabase,
    artistId,
    'apple_id',
    'apple',
    tracks.map((t) => ({
      externalId: t.apple_id,
      title: t.title,
      cover_url: t.cover_url,
      album_name: t.album_name,
      duration_ms: t.duration_ms,
      owned: { apple_url: t.provider_url },
      mergeFill: { apple_url: t.provider_url },
    })),
  )
  return thenReleases(supabase, artistId, 'apple', songs, tracks.map((t) => ({ trackId: t.apple_id, release: t.release })))
}

/** Deezer is a metadata + link-out source: no stream_url, a deezer.com link in
 *  `provider_url`. On a merge the link is omitted (it rebuilds from `deezer_id`). */
export async function syncDeezerTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: DeezerTrackInput[],
): Promise<SyncResult> {
  const songs = await syncTracks(
    supabase,
    artistId,
    'deezer_id',
    'deezer',
    tracks.map((t) => ({
      externalId: t.deezer_id,
      title: t.title,
      cover_url: t.cover_url,
      album_name: t.album_name,
      duration_ms: t.duration_ms,
      owned: { provider_url: t.provider_url },
      mergeFill: {},
    })),
  )
  return thenReleases(supabase, artistId, 'deezer', songs, tracks.map((t) => ({ trackId: t.deezer_id, release: t.release })))
}

export function syncBandsintownTourDates(
  supabase: SupabaseClient,
  artistId: string,
  events: BandsintownTourDate[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tour_dates',
    externalIdCol: 'bandsintown_id',
    source: 'bandsintown',
    artistId,
    items: events.map((e) => ({
      externalId: e.bandsintown_id,
      values: { date: e.date, venue: e.venue, city: e.city, country: e.country, ticket_url: e.ticket_url, latitude: e.latitude, longitude: e.longitude },
    })),
    insertDefaults: { on_site: false },
  })
}

/** YouTube uploads → videos (embed-only). source='youtube', keyed by youtube_id. */
export function syncYouTubeVideos(
  supabase: SupabaseClient,
  artistId: string,
  videos: YouTubeVideoInput[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'videos',
    externalIdCol: 'youtube_id',
    source: 'youtube',
    artistId,
    // Skip Shorts — they aren't used on artist sites right now. The is_short column and
    // the Videos-page Shorts tab stay, so this is easy to reintroduce later.
    items: videos
      .filter((v) => !v.is_short)
      .map((v) => ({
        externalId: v.youtube_id,
        values: {
          title: v.title,
          provider: v.provider,
          embed_url: v.embed_url,
          is_short: v.is_short,
          published_at: v.published_at ?? null,
          ...(v.views != null ? { youtube_views: v.views, youtube_views_at: new Date().toISOString() } : {}),
        },
      })),
    insertDefaults: { on_site: false },
  })
}

export function syncTicketmasterTourDates(
  supabase: SupabaseClient,
  artistId: string,
  events: TicketmasterTourDate[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'tour_dates',
    externalIdCol: 'ticketmaster_id',
    source: 'ticketmaster',
    artistId,
    items: events.map((e) => ({
      externalId: e.ticketmaster_id,
      values: { date: e.date, venue: e.venue, city: e.city, country: e.country, ticket_url: e.ticket_url, latitude: e.latitude, longitude: e.longitude },
    })),
    insertDefaults: { on_site: false },
  })
}

/**
 * EVENTBRITE SHOWS → tour dates (Sam, 2026-09-28). Not `syncExternal`: that refreshes every
 * column of a row it owns on every pull, so a manager's fix would be undone by the next Pull
 * now. This carries out `planTourPull` (lib/tour-pull.ts) instead:
 *
 *   - a new event is inserted OFF the site (`on_site: false`: the library is where things
 *     arrive; the tour page's tick puts it in the draft and Publish commits it), owned by
 *     `source: 'eventbrite'`, keyed by `eventbrite_id`, remembering what was pulled;
 *   - an event already here changes only in the columns the manager never touched, and the
 *     update is filtered to rows Eventbrite owns;
 *   - new rows are slotted by date among a dragged list (the tour page's own Add rule).
 *
 * It writes `tour_dates` (and renumbers it through `reorder_rows`) and nothing else: no
 * revision, so nothing reaches fans until the manager publishes. Through the caller's
 * RLS-scoped client, so it can only ever write into its own artist.
 */
export async function syncEventbriteTourDates(supabase: SupabaseClient, artistId: string, shows: readonly IncomingShow[]): Promise<SyncResult> {
  const { data, error } = await supabase
    .from('tour_dates')
    .select(`id, source, eventbrite_id, pulled, sort_order, ${PULLED_COLUMNS.join(', ')}`)
    .eq('artist_id', artistId)
  if (error) throw new Error(error.message)
  const existing = (data ?? []) as unknown as (ExistingTourRow & { sort_order: number | null })[]
  const plan = planTourPull(existing, shows)

  let added = 0
  let updated = 0
  let skipped = plan.skipped
  const errors: SyncError[] = []
  const inserted: { id: string; date: string | null }[] = []

  for (const show of plan.inserts) {
    const { data: row, error: iErr } = await supabase
      .from('tour_dates')
      .insert({ artist_id: artistId, ...show.values, eventbrite_id: show.externalId, source: 'eventbrite', on_site: false, pulled: show.values })
      .select('id, date')
      .single()
    if (iErr) {
      if (iErr.code === RLS_DENIED) throw new Error(iErr.message)
      // Another pull inserted this event a moment ago (the unique index): it is here.
      if (iErr.code === UNIQUE_VIOLATION) skipped++
      else errors.push({ externalId: show.externalId, op: 'insert', message: iErr.message })
      continue
    }
    added++
    inserted.push({ id: row!.id as string, date: (row!.date as string | null) ?? null })
  }

  for (const u of plan.updates) {
    const { error: uErr } = await supabase.from('tour_dates').update({ ...u.patch, pulled: u.pulled }).eq('id', u.id).eq('source', 'eventbrite')
    if (uErr) {
      if (uErr.code === RLS_DENIED) throw new Error(uErr.message)
      errors.push({ externalId: u.externalId, op: 'update', message: uErr.message })
    } else if (Object.keys(u.patch).length) updated++
  }

  const order = slotNewRows(
    existing.map((r) => ({ id: r.id, date: (r.date as string | null) ?? null, sort_order: r.sort_order ?? null })),
    inserted,
  )
  if (order) {
    const { error: rErr } = await supabase.rpc('reorder_rows', { p_table: 'tour_dates', p_artist: artistId, p_ids: order })
    if (rErr) errors.push({ externalId: 'order', op: 'update', message: `The new shows could not be put in date order: ${rErr.message}` })
  }

  return { added, updated, skipped, merged: 0, failed: errors.length, errors, notes: [] }
}
