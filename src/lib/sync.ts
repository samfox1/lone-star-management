/**
 * Sync external catalog data into a tenant's working rows, honoring the conflict
 * policy (PLAN #6): insert items we haven't seen, refresh rows we own
 * (source = this provider), and NEVER overwrite a manager's hand edit (source
 * flips to 'manual' the moment a human touches a row — and a row owned by a
 * different provider is left alone too). All writes go through the caller's
 * RLS-scoped client, so a sync can only ever write into its own artist.
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
import type { ShopifyMerch } from '@/lib/shopify'

export type SyncError = { externalId: string; op: 'insert' | 'update'; message: string }

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
}

/** Postgres RLS / authorization denial — a hard contract breach, never partial. */
const RLS_DENIED = '42501'

/** One incoming external item: its stable id + the columns to write. */
type ExternalItem = { externalId: string; values: Record<string, unknown> }

type SyncSpec = {
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

async function syncExternal(supabase: SupabaseClient, spec: SyncSpec): Promise<SyncResult> {
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

  return { added, updated, skipped, merged: 0, failed: errors.length, errors }
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
}

/** Songs within ±3s of each other (same normalized title) are treated as the same. */
const DURATION_TOLERANCE_MS = 3000

/**
 * Normalize a title for cross-platform matching: drop parenthetical/bracket
 * qualifiers ("(feat. X)", "[Explicit]") and punctuation, lowercase, collapse
 * whitespace. Scoped per-artist, so this can stay permissive without over-merging.
 */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Pick an existing row that is the SAME song as `item` but not yet on this platform:
 * same normalized title, and — when both durations are known — within tolerance
 * (closest wins). A title-only match (duration unknown on either side) is the
 * fallback. Rows already claimed this run, or already carrying this platform's id,
 * are skipped.
 */
function matchTrackCandidate(
  cands: TrackRow[] | undefined,
  item: IncomingTrack,
  idCol: TrackIdCol,
  claimed: Set<string>,
): TrackRow | undefined {
  if (!cands) return undefined
  let durMatch: TrackRow | undefined
  let durDelta = Infinity
  let titleOnly: TrackRow | undefined
  for (const r of cands) {
    if (claimed.has(r.id) || r[idCol] != null) continue
    if (r.duration_ms != null && item.duration_ms != null) {
      const d = Math.abs(r.duration_ms - item.duration_ms)
      if (d <= DURATION_TOLERANCE_MS && d < durDelta) {
        durMatch = r
        durDelta = d
      }
    } else if (!titleOnly) {
      titleOnly = r
    }
  }
  return durMatch ?? titleOnly
}

async function syncTracks(
  supabase: SupabaseClient,
  artistId: string,
  idCol: TrackIdCol,
  source: string,
  incoming: IncomingTrack[],
): Promise<SyncResult> {
  const { data, error } = await supabase
    .from('tracks')
    .select('id, source, title, duration_ms, spotify_id, apple_id, deezer_id, cover_url, album_name, stream_url, apple_url')
    .eq('artist_id', artistId)
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

  for (const item of deduped) {
    // 1) A row already carries THIS platform's id → refresh it, but only if this
    //    platform owns it (never clobber a manual edit / another provider).
    const exact = byId.get(item.externalId)
    if (exact) {
      if (exact.source !== source) {
        skipped++
        continue
      }
      const { error: uErr } = await supabase
        .from('tracks')
        .update({ title: item.title, cover_url: item.cover_url, album_name: item.album_name, duration_ms: item.duration_ms, ...item.owned })
        .eq('id', exact.id)
      if (uErr) {
        if (uErr.code === RLS_DENIED) throw new Error(uErr.message)
        errors.push({ externalId: item.externalId, op: 'update', message: uErr.message })
      } else updated++
      continue
    }

    // 2) The same song imported from ANOTHER platform → stamp this platform onto it
    //    (its id + link + any fields it was missing), never touching title/source.
    const cand = matchTrackCandidate(byTitle.get(normalizeTitle(item.title)), item, idCol, claimed)
    if (cand) {
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
        cand[idCol] = item.externalId // reflect locally so a later item can't re-merge it
      }
      continue
    }

    // 3) A song we haven't seen on any platform → insert new.
    const { error: iErr } = await supabase.from('tracks').insert({
      artist_id: artistId,
      [idCol]: item.externalId,
      source,
      title: item.title,
      cover_url: item.cover_url,
      album_name: item.album_name,
      duration_ms: item.duration_ms,
      ...item.owned,
    })
    if (iErr) {
      if (iErr.code === RLS_DENIED) throw new Error(iErr.message)
      errors.push({ externalId: item.externalId, op: 'insert', message: iErr.message })
    } else added++
  }

  return { added, updated, skipped, merged, failed: errors.length, errors }
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
      owned: { stream_url: t.stream_url, featured_artists: t.featured_artists },
      mergeFill: { stream_url: t.stream_url },
    })),
  )
}

/**
 * Sync the artist's Spotify releases (albums/EPs/singles) into `releases` and
 * link their tracks. Deduped by `spotify_id`:
 *  - existing spotify releases get their metadata refreshed (title/cover/date/
 *    type) but NEVER their `on_site` toggle, slug, or DSP links — those are
 *    manager-owned;
 *  - new releases are inserted OFF-SITE (`on_site=false`) with a unique slug and a
 *    seed Spotify link, for the manager to toggle on.
 * Tracks are linked to their release by member Spotify id, but only where the
 * track isn't already assigned — so a manual assignment (or a prior link) wins.
 * Run AFTER the tracks sync, so the tracks exist to be linked.
 */
export async function syncSpotifyReleases(
  supabase: SupabaseClient,
  artistId: string,
  releases: SpotifyReleaseInput[],
): Promise<{ added: number; updated: number }> {
  const { data: existing, error } = await supabase
    .from('releases')
    .select('id, slug, spotify_id, release_type_locked')
    .eq('artist_id', artistId)
  if (error) throw new Error(error.message)
  const rows = (existing ?? []) as {
    id: string
    slug: string
    spotify_id: string | null
    release_type_locked: boolean | null
  }[]
  const idBySpotify = new Map<string, string>()
  const lockedById = new Map<string, boolean>()
  const slugs = new Set<string>()
  for (const r of rows) {
    if (r.spotify_id) idBySpotify.set(r.spotify_id, r.id)
    lockedById.set(r.id, !!r.release_type_locked)
    slugs.add(r.slug)
  }

  let added = 0
  let updated = 0

  for (const rel of releases) {
    const existingId = idBySpotify.get(rel.spotify_id)
    // A locked release keeps its manager-set type (Sync still refreshes title/cover/date).
    const meta: Record<string, unknown> = {
      title: rel.title,
      cover_url: rel.cover_url,
      release_date: rel.release_date,
    }
    if (!(existingId && lockedById.get(existingId))) meta.release_type = rel.release_type
    if (existingId) {
      const { error: uErr } = await supabase.from('releases').update(meta).eq('id', existingId)
      if (uErr) throw new Error(uErr.message)
      updated++
      continue
    }
    // Unique slug within the artist.
    const base = slugify(rel.title) || rel.spotify_id.slice(0, 8)
    let slug = base
    for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`
    slugs.add(slug)
    const links = rel.spotify_url ? [{ label: 'Spotify', url: rel.spotify_url }] : []
    const { data: ins, error: iErr } = await supabase
      .from('releases')
      .insert({ artist_id: artistId, ...meta, slug, links, on_site: false, source: 'spotify', spotify_id: rel.spotify_id })
      .select('id')
      .single()
    if (iErr) throw new Error(iErr.message)
    idBySpotify.set(rel.spotify_id, ins!.id as string)
    added++
  }

  // Link each release's tracks by Spotify id — only unassigned ones, so a manual
  // (or earlier) assignment is never clobbered — and stamp the release's TYPE onto them,
  // so a Spotify album's songs read as 'album' (etc.) rather than the default 'single'.
  // Type is a per-song tag now (20260726120000); only stamp songs still at the default,
  // so a manual re-tag (e.g. flagging one track a remix) is never clobbered.
  for (const rel of releases) {
    const releaseId = idBySpotify.get(rel.spotify_id)
    if (!releaseId || rel.track_spotify_ids.length === 0) continue
    const { error: lErr } = await supabase
      .from('tracks')
      .update({ release_id: releaseId })
      .eq('artist_id', artistId)
      .is('release_id', null)
      .in('spotify_id', rel.track_spotify_ids)
    if (lErr) throw new Error(lErr.message)
    const { error: tErr } = await supabase
      .from('tracks')
      .update({ release_type: rel.release_type })
      .eq('artist_id', artistId)
      .eq('release_type', 'single')
      .in('spotify_id', rel.track_spotify_ids)
    if (tErr) throw new Error(tErr.message)
  }

  return { added, updated }
}

/** Apple Music is a metadata + link-out source (no hosted audio). Its link lives in
 *  `apple_url` (not the shared legacy `provider_url`) so a merged row keeps each
 *  platform's link independently. */
export function syncAppleTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: AppleTrackInput[],
): Promise<SyncResult> {
  return syncTracks(
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
}

/** Deezer is a metadata + link-out source: no stream_url, a deezer.com link in
 *  `provider_url`. On a merge the link is omitted (it rebuilds from `deezer_id`). */
export function syncDeezerTracks(
  supabase: SupabaseClient,
  artistId: string,
  tracks: DeezerTrackInput[],
): Promise<SyncResult> {
  return syncTracks(
    supabase,
    artistId,
    'deezer_id',
    'deezer',
    tracks.map((t) => ({
      externalId: t.deezer_id,
      title: t.title,
      cover_url: t.cover_url,
      album_name: null,
      duration_ms: t.duration_ms,
      owned: { provider_url: t.provider_url },
      mergeFill: {},
    })),
  )
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
 * Shopify sends price as a raw string ('25.00'); merch.price is numeric(10,2).
 * Coerce like the manual path (Number + isFinite); drop a non-numeric price to
 * null rather than letting it abort the row. A numerically valid but too-large
 * value still errors at the DB and is reported in SyncResult.errors.
 */
function coercePrice(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function syncShopifyMerch(
  supabase: SupabaseClient,
  artistId: string,
  products: ShopifyMerch[],
): Promise<SyncResult> {
  return syncExternal(supabase, {
    table: 'merch',
    externalIdCol: 'shopify_product_id',
    source: 'shopify',
    artistId,
    items: products.map((p) => ({
      externalId: p.shopify_product_id,
      values: { title: p.title, image_url: p.image_url, price: coercePrice(p.price), url: p.url },
    })),
    insertDefaults: { on_site: false },
  })
}
