/**
 * MIRROR TEST — "Released" is ONE rule with THREE implementations. This file is the
 * only thing that stops them drifting silently:
 *
 *   1. src/lib/music.ts            — releaseBucket / trackBucket (the source of truth)
 *   2. the SQL doors               — music_release_is_released / music_track_on_platform
 *   3. lone-star-agent's copilot   — releaseIsReleased / trackIsReleased
 *
 * Each of the three gets the SAME fixtures and must return the SAME answer. Two real
 * disagreements were live when this file was written:
 *
 *   - the SQL mirror did not count `deezer_url`, so a manager-entered Deezer link made a
 *     song Released in the app and Unreleased in Postgres. Harmless only by accident —
 *     20260710170000 removed music_track_on_platform's last door caller, so it was a
 *     loaded gun with no trigger. Closed by 20260805120000.
 *   - the copilot used `inherited ?? own` — the PRE-20260710160000 NARROWING inheritance
 *     that the widen-only migration explicitly reverted — and omitted `released`,
 *     `soundcloud_url` and `deezer_url`. It reported a platform-linked song inside an
 *     Unreleased album as Unreleased.
 *
 * Why three copies at all: the copilot is a separately deployed package
 * (lone-star-agent/, its own package.json + Vercel build root), so it cannot import
 * src/lib/music.ts without escaping its deploy root. Until the rule is extracted into a
 * shared workspace package, this test IS the link between them.
 *
 * The SQL functions are revoked from anon/authenticated, so they are called with the
 * service-role client — this file asserts pure classification, never RLS.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { releaseBucket, trackBucket, type ReleaseProvenance, type TrackProvenance } from '@/lib/music'
import {
  releaseIsReleased as copilotReleaseIsReleased,
  trackIsReleased as copilotTrackIsReleased,
  type ReleaseProvenanceRow,
  type TrackProvenanceRow,
} from '../lone-star-agent/agent/lib/lonestar'
import { serviceClient } from './helpers/supabase'

const svc = serviceClient()

type TrackRow = TrackProvenance & TrackProvenanceRow
type ReleaseRow = ReleaseProvenance & ReleaseProvenanceRow

/** Every provenance column the rule reads, all empty — fixtures set one at a time. */
const TRACK_BASE: TrackRow = {
  release_id: null,
  source: 'manual',
  audio_path: null,
  spotify_id: null,
  apple_id: null,
  deezer_id: null,
  provider_url: null,
  stream_url: null,
  apple_url: null,
  soundcloud_url: null,
  deezer_url: null,
  released: false,
}

const RELEASE_BASE: ReleaseRow = { source: 'manual', spotify_id: null, links: [], released: false }

type TrackFixture = { name: string; row: TrackRow }
type ReleaseFixture = { name: string; row: ReleaseRow }

const trk = (name: string, over: Partial<TrackRow> = {}): TrackFixture => ({
  name,
  row: { ...TRACK_BASE, ...over },
})
const rel = (name: string, over: Partial<ReleaseRow> = {}): ReleaseFixture => ({
  name,
  row: { ...RELEASE_BASE, ...over },
})

// One fixture per column the rule reads. A column missing from this list is a column
// whose disagreement this test cannot see — that is exactly how deezer_url slipped.
const TRACKS: TrackFixture[] = [
  trk('bare manual (nothing set)'),
  trk('a platform source', { source: 'spotify' }),
  trk('a null source (never a manual add)', { source: null }),
  trk('spotify_id', { spotify_id: 'sp1' }),
  trk('apple_id', { apple_id: 'ap1' }),
  trk('deezer_id', { deezer_id: 'dz1' }),
  trk('provider_url', { provider_url: 'https://x/y' }),
  trk('stream_url', { stream_url: 'https://x/y' }),
  trk('apple_url', { apple_url: 'https://music.apple.com/x' }),
  trk('soundcloud_url', { soundcloud_url: 'https://soundcloud.com/x/y' }),
  trk('deezer_url', { deezer_url: 'https://www.deezer.com/track/1' }),
  trk('the manual released flag', { released: true }),
  trk('released explicitly false', { released: false }),
]

const RELEASES: ReleaseFixture[] = [
  rel('manual, no links'),
  rel('a platform source', { source: 'spotify' }),
  rel('a null source', { source: null }),
  rel('spotify_id', { spotify_id: 'sp1' }),
  rel('non-empty DSP links', { links: [{ label: 'Spotify', url: 'https://open.spotify.com/album/x' }] }),
  rel('empty links array', { links: [] }),
  rel('the manual released flag', { released: true }),
]

async function sqlTrack(row: unknown): Promise<boolean> {
  const { data, error } = await svc.rpc('music_track_on_platform', { d: row })
  if (error) throw new Error(`music_track_on_platform: ${error.message}`)
  return data as boolean
}
async function sqlRelease(row: unknown): Promise<boolean> {
  const { data, error } = await svc.rpc('music_release_is_released', { d: row })
  if (error) throw new Error(`music_release_is_released: ${error.message}`)
  return data as boolean
}

// Every SQL answer is fetched once, in parallel, so the assertions below stay synchronous
// (each fixture would otherwise cost a transatlantic round-trip inside its own `it`).
const sqlTrackAnswer = new Map<string, boolean>()
const sqlReleaseAnswer = new Map<string, boolean>()

beforeAll(async () => {
  await Promise.all([
    ...TRACKS.map(async (f) => sqlTrackAnswer.set(f.name, await sqlTrack(f.row))),
    ...RELEASES.map(async (f) => sqlReleaseAnswer.set(f.name, await sqlRelease(f.row))),
  ])
})

describe('releaseBucket mirrors music_release_is_released (and the copilot)', () => {
  it.each(RELEASES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const ts = releaseBucket(f.row) === 'released'
    expect({ sql: sqlReleaseAnswer.get(f.name), copilot: copilotReleaseIsReleased(f.row) })
      .toEqual({ sql: ts, copilot: ts })
  })
})

describe('trackBucket (loose) mirrors music_track_on_platform (and the copilot)', () => {
  it.each(TRACKS.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const ts = trackBucket(f.row) === 'released'
    expect({ sql: sqlTrackAnswer.get(f.name), copilot: copilotTrackIsReleased(f.row, undefined) })
      .toEqual({ sql: ts, copilot: ts })
  })
})

/**
 * Release membership is WIDEN-ONLY in all three: `own OR release`. The SQL doors spell it
 * out at the call site (`music_track_on_platform(t) or coalesce(rel.released, false)` —
 * 20260710160000), so the mirror here is that same composition. `inherited ?? own`
 * NARROWS, and is the bug this block exists to catch.
 */
describe('widen-only membership mirrors across all three', () => {
  const linked = trk('platform-linked song', { spotify_id: 'sp1' })
  const bare = trk('bare manual song')
  const releasedAlbum = rel('released album', { spotify_id: 'al1' })
  const unreleasedAlbum = rel('unreleased album')

  const cases = [
    { name: 'bare song in a RELEASED album → released', t: bare, r: releasedAlbum },
    { name: 'linked song in an UNRELEASED album → released (never demoted)', t: linked, r: unreleasedAlbum },
    { name: 'bare song in an UNRELEASED album → unreleased', t: bare, r: unreleasedAlbum },
    { name: 'linked song in a RELEASED album → released', t: linked, r: releasedAlbum },
  ] as const

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const parented = { ...c.t.row, release_id: 'r1' }
    const releaseIsRel = releaseBucket(c.r.row) === 'released'
    const ts = trackBucket(parented, () => (releaseIsRel ? 'released' : 'unreleased')) === 'released'
    const sql = (await sqlTrack(parented)) || (await sqlRelease(c.r.row))
    expect({ sql, copilot: copilotTrackIsReleased(parented, releaseIsRel) }).toEqual({ sql: ts, copilot: ts })
  })
})
