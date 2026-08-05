import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  releaseIsReleased,
  trackIsReleased,
  type ReleaseProvenance,
  type TrackProvenance,
} from "@lone-star/music-rules";

/**
 * The single seam between the agent and the Lone Star backend. Every tool reads
 * the roster through this module, so the transport lives in exactly one place.
 *
 * Today it talks to Supabase directly with the service-role key (read-only use
 * only — the agent never writes here yet). That is safe while Lone Star has a
 * single manager: there is no cross-tenant boundary to enforce, so bypassing RLS
 * to read the whole roster is acceptable. When roles arrive, swap this file for a
 * per-manager transport (the app's HTTP APIs, or an RLS-scoped client) without
 * touching any tool.
 */

let cached: SupabaseClient | null = null;

function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in lone-star-agent/.env.",
    );
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** The artist columns that back the integration-connected check. The catalog
 *  sources (Spotify/Deezer/Apple) all coexist — the union model merges every
 *  platform's pull into one track set, so there is no "active source" anymore. */
const INTEGRATIONS = [
  { key: "spotify", label: "Spotify", section: "music", idField: "spotify_artist_id" },
  { key: "deezer", label: "Deezer", section: "music", idField: "deezer_artist_id" },
  { key: "apple", label: "Apple Music", section: "music", idField: "apple_artist_id" },
  { key: "youtube", label: "YouTube", section: "videos", idField: "youtube_channel_id" },
  { key: "bandsintown", label: "Bandsintown", section: "tour", idField: "bandsintown_name" },
  { key: "ticketmaster", label: "Ticketmaster", section: "tour", idField: "ticketmaster_attraction_id" },
] as const;

const ARTIST_COLUMNS =
  "id, name, slug, template, spotify_artist_id, deezer_artist_id, apple_artist_id, youtube_channel_id, bandsintown_name, ticketmaster_attraction_id";

type ArtistRow = Record<string, string | null>;

export type ArtistSummary = { id: string; name: string; slug: string };

export type IntegrationStatus = {
  key: string;
  label: string;
  section: string;
  connected: boolean;
};

export type MusicCounts = {
  /** Tracks with platform presence (or inside a platform release) — public site material. */
  released: number;
  /** Uploads/demos with no platform presence — dashboard-only, never public. */
  unreleased: number;
};

export type ArtistSnapshot = {
  id: string;
  name: string;
  slug: string;
  template: string | null;
  integrations: IntegrationStatus[];
  connectedCount: number;
  counts: { releases: number; tracks: MusicCounts; media: number; links: number; merch: number };
};

/** Every artist on the roster, name-sorted. */
export async function listArtists(): Promise<ArtistSummary[]> {
  const { data, error } = await db()
    .from("artists")
    .select("id, name, slug")
    .order("name");
  if (error) throw new Error(`listArtists: ${error.message}`);
  return (data ?? []) as ArtistSummary[];
}

/** Resolve an artist by exact id, exact slug, or case-insensitive name. */
async function resolveArtist(idOrSlugOrName: string): Promise<ArtistRow | null> {
  const client = db();
  const term = idOrSlugOrName.trim();
  // uuid → id lookup; otherwise slug, then name.
  const byId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
  let q = client.from("artists").select(ARTIST_COLUMNS);
  if (byId) q = q.eq("id", term);
  else q = q.or(`slug.eq.${term},name.ilike.${term}`);
  const { data, error } = await q.limit(1);
  if (error) throw new Error(`resolveArtist: ${error.message}`);
  return (data?.[0] as ArtistRow) ?? null;
}

function integrationStatus(artist: ArtistRow): {
  integrations: IntegrationStatus[];
  connectedCount: number;
} {
  const integrations = INTEGRATIONS.map((i) => ({
    key: i.key,
    label: i.label,
    section: i.section,
    connected: !!artist[i.idField],
  }));
  return { integrations, connectedCount: integrations.filter((i) => i.connected).length };
}

const RELEASE_PROVENANCE_COLUMNS = "id, source, spotify_id, links, released";
const TRACK_PROVENANCE_COLUMNS =
  "release_id, source, spotify_id, apple_id, deezer_id, provider_url, stream_url, apple_url, soundcloud_url, deezer_url, released";

/**
 * Released vs Unreleased track counts for one artist. The RULE is imported from
 * `@lone-star/music-rules` — this function is only the query wiring around it. It used to
 * carry a hand-written copy of the rule, which drifted into reporting platform-linked
 * songs inside Unreleased albums as Unreleased and stayed wrong for four weeks.
 *
 * The two SELECT column lists are the coupling that remains: a new provenance column must
 * be added to them or the rule reads it as null and silently under-counts Released.
 */
async function musicCounts(artistId: string): Promise<MusicCounts> {
  const client = db();
  const [rels, trks] = await Promise.all([
    client.from("releases").select(RELEASE_PROVENANCE_COLUMNS).eq("artist_id", artistId),
    client.from("tracks").select(TRACK_PROVENANCE_COLUMNS).eq("artist_id", artistId),
  ]);
  if (rels.error) throw new Error(`musicCounts(releases): ${rels.error.message}`);
  if (trks.error) throw new Error(`musicCounts(tracks): ${trks.error.message}`);

  const releaseReleased = new Map<string, boolean>(
    (rels.data ?? []).map((r) => [
      (r as { id: string }).id,
      releaseIsReleased(r as unknown as ReleaseProvenance),
    ]),
  );
  let released = 0;
  let unreleased = 0;
  for (const t of trks.data ?? []) {
    const row = t as unknown as TrackProvenance;
    const inherited = row.release_id ? releaseReleased.get(row.release_id) : undefined;
    if (trackIsReleased(row, inherited)) released += 1;
    else unreleased += 1;
  }
  return { released, unreleased };
}

async function count(table: string, artistId: string): Promise<number> {
  const { count: c, error } = await db()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("artist_id", artistId);
  if (error) throw new Error(`count(${table}): ${error.message}`);
  return c ?? 0;
}

/** Full "what's here" view for one artist: integrations + content counts. */
export async function getArtistSnapshot(
  idOrSlugOrName: string,
): Promise<ArtistSnapshot | null> {
  const artist = await resolveArtist(idOrSlugOrName);
  if (!artist) return null;
  const id = artist.id as string;
  const { integrations, connectedCount } = integrationStatus(artist);
  const [releases, tracks, media, links, merch] = await Promise.all([
    count("releases", id),
    musicCounts(id),
    count("media", id),
    count("links", id),
    count("merch", id),
  ]);
  return {
    id,
    name: artist.name as string,
    slug: artist.slug as string,
    template: artist.template,
    integrations,
    connectedCount,
    counts: { releases, tracks, media, links, merch },
  };
}

/** Resolve an artist reference to its id + display name, or null if unknown. */
export async function resolveArtistId(
  idOrSlugOrName: string,
): Promise<{ id: string; name: string } | null> {
  const artist = await resolveArtist(idOrSlugOrName);
  if (!artist) return null;
  return { id: artist.id as string, name: artist.name as string };
}

export type AnalyticsRow = { type: string; count: number };

/**
 * Event counts for one artist since an ISO timestamp, via the app's
 * `analytics_summary` RPC (the same door the dashboard reads).
 */
export async function getAnalyticsSummary(
  artistId: string,
  sinceIso: string,
): Promise<AnalyticsRow[]> {
  const { data, error } = await db().rpc("analytics_summary", {
    p_artist_id: artistId,
    p_since: sinceIso,
  });
  if (error) throw new Error(`analytics_summary: ${error.message}`);
  return (data ?? []) as AnalyticsRow[];
}
