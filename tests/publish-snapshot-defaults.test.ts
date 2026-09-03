/**
 * M5 + M6 (REVIEW_2026-09-03) — a column that joins a snapshot WITH a default must not
 * make every existing artist dirty.
 *
 * `media.kind` (20260826130000) and `artists.schema_type` (20260826160000) both landed
 * as "not null-ish, defaulted, backfilled" AND joined their snapshot in the same change.
 * Every revision published before that carries no such key, so `sameSnapshot` compared
 * the backfilled default against a missing key and counted the row edited: a manager who
 * published yesterday and touched nothing saw a dirty badge on every photo, and a
 * profile that could never be made clean. (77 of the 91 media revisions on the live
 * project are in exactly that shape, measured 2026-09-03.)
 *
 * The rule under test: a key ABSENT from the older snapshot means "the column's default",
 * not "a different value". The test is deliberately paired — the second half proves the
 * rule is not the cheaper, wrong one ("ignore the key when it is missing"), which would
 * hide a real edit forever.
 *
 * The fixture is a THROWAWAY artist created here, so the counts are exact rather than a
 * race against whatever else is publishing to a seeded artist on the shared live
 * project. Teardown deletes that one artist; media rows and revisions cascade with it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ARTIST_SNAPSHOT, SNAPSHOT_DEFAULTS, diffUnpublished, publicSnapshot, type ContentRow } from '@/lib/content'
import { serviceClient } from './helpers/supabase'

const svc = serviceClient()
const SLUG = `zz-m5-defaults-${randomUUID().slice(0, 8)}`

let artistId = ''
let mediaId = ''

/** Everything the snapshot holds EXCEPT the defaulted keys — the shape a revision
 *  published before those columns existed has. Derived from the registry, never
 *  hand-listed, so a defaulted column added later is covered the day it is registered. */
function legacySnapshot(snapshot: Record<string, unknown>, defaults: Record<string, unknown>) {
  const out = { ...snapshot }
  for (const key of Object.keys(defaults)) delete out[key]
  return out
}

/** The planted witness (AGENTS.md rule 2): the live row must actually sit AT the default
 *  for every key we strip, or "clean" would be true for a reason that has nothing to do
 *  with the rule — and an empty registry would make the whole file vacuous. */
function assertLiveIsAtDefaults(live: Record<string, unknown>, defaults: Record<string, unknown>) {
  expect(Object.keys(defaults).length).toBeGreaterThan(0)
  for (const [key, value] of Object.entries(defaults)) {
    expect(live[key], `live row should carry the column default for ${key}`).toBe(value)
  }
}

beforeAll(async () => {
  const { data: artist, error } = await svc
    .from('artists')
    .insert({ slug: SLUG, name: 'M5 snapshot-defaults fixture' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  artistId = artist.id as string

  const { data: media, error: mediaErr } = await svc
    .from('media')
    .insert({
      artist_id: artistId,
      purpose: 'gallery_image',
      storage_path: `${artistId}/gallery/m5-defaults.jpg`,
      on_site: true,
    })
    .select('*')
    .single()
  if (mediaErr) throw new Error(mediaErr.message)
  mediaId = media.id as string

  const { data: artistRow, error: artistErr } = await svc
    .from('artists')
    .select(ARTIST_SNAPSHOT.join(', '))
    .eq('id', artistId)
    .single()
  if (artistErr) throw new Error(artistErr.message)

  const mediaSnapshot = publicSnapshot('media', media as ContentRow)
  const profileSnapshot = Object.fromEntries(
    ARTIST_SNAPSHOT.map((k) => [k, (artistRow as unknown as Record<string, unknown>)[k]]),
  )
  assertLiveIsAtDefaults(mediaSnapshot, SNAPSHOT_DEFAULTS.media ?? {})
  assertLiveIsAtDefaults(profileSnapshot, SNAPSHOT_DEFAULTS.artist ?? {})

  // Publish the LEGACY shape: byte-identical to what publishing this row would write
  // today, minus the keys that did not exist yet. Nothing else differs, so a dirty count
  // can only come from the missing keys.
  const { error: revErr } = await svc.from('revisions').insert([
    {
      artist_id: artistId,
      entity_type: 'media',
      entity_id: mediaId,
      data: legacySnapshot(mediaSnapshot, SNAPSHOT_DEFAULTS.media ?? {}),
    },
    {
      artist_id: artistId,
      entity_type: 'artist',
      entity_id: artistId,
      data: legacySnapshot(profileSnapshot, SNAPSHOT_DEFAULTS.artist ?? {}),
    },
  ])
  if (revErr) throw new Error(revErr.message)
})

afterAll(async () => {
  if (artistId) await svc.from('artists').delete().eq('id', artistId)
})

describe('diffUnpublished vs snapshot defaults', () => {
  it('CRITICAL: a revision published before a defaulted column existed is NOT dirty', async () => {
    const diff = await diffUnpublished(svc, artistId)
    expect(diff.media.edited).toBe(0)
    expect(diff.media.dirty).toBe(false)
    expect(diff.profile.edited).toBe(0)
    expect(diff.profile.dirty).toBe(false)
  })

  it('CRITICAL: a value that DIFFERS from that default is still dirty (missing ≠ ignored)', async () => {
    // The same legacy revisions, still missing the keys — only the live rows move. If the
    // rule were "skip a key the old snapshot lacks" instead of "read it as the default",
    // this edit would be invisible until someone republished blind.
    const { error: mErr } = await svc.from('media').update({ kind: 'artwork' }).eq('id', mediaId)
    if (mErr) throw new Error(mErr.message)
    const { error: aErr } = await svc.from('artists').update({ schema_type: 'Person' }).eq('id', artistId)
    if (aErr) throw new Error(aErr.message)

    const diff = await diffUnpublished(svc, artistId)
    expect(diff.media.edited).toBe(1)
    expect(diff.media.dirty).toBe(true)
    expect(diff.profile.edited).toBe(1)
    expect(diff.profile.dirty).toBe(true)
  })
})
