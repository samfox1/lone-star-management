/**
 * PHASE 3 — gated audio storage isolation (the non-negotiable gate). A manager
 * can only write their own audio folder, and the raw object in the PRIVATE
 * `audio` bucket is never reachable without signing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const body = new Uint8Array([0xff, 0xfb, 0x90, 0x00]) // tiny fake mp3 frame

/** Paths this file creates, and the only ones it removes. */
const objectA = () => `${artistA}/audio/iso.mp3`
const ownA = () => `${artistA}/audio/own.mp3`
const evilB = () => `${artistB}/audio/evil.mp3`
const objectB = () => `${artistB}/audio/iso-b.mp3`

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  await svc.storage.from('audio').upload(objectA(), body, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
  // A real object inside B's folder, planted with the SERVICE client.
  //
  // Without it this file only ever created an object in A's OWN folder, so the
  // `audio manager read` policy was never exercised across tenants at all: widening it
  // to every authenticated user would have left every assertion here green. A read
  // denial needs something to be denied.
  await svc.storage.from('audio').upload(objectB(), body, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
})

afterAll(async () => {
  await svc.storage.from('audio').remove([objectA(), ownA(), evilB(), objectB()])
})

describe('gated audio storage isolation', () => {
  it('a manager can upload to their own audio folder', async () => {
    const { error } = await asA.storage.from('audio').upload(ownA(), body, {
      contentType: 'audio/mpeg',
      upsert: true,
    })
    expect(error).toBeNull()
  })

  it("CRITICAL: a manager cannot upload to another artist's audio folder", async () => {
    const { error } = await asA.storage.from('audio').upload(evilB(), body, {
      contentType: 'audio/mpeg',
      upsert: true,
    })
    expect(error).not.toBeNull()
    // And nothing landed there.
    const { data } = await svc.storage.from('audio').list(`${artistB}/audio`)
    expect((data ?? []).map((o) => o.name)).not.toContain('evil.mp3')
  })

  it("CRITICAL: a manager cannot DOWNLOAD another artist's audio object", async () => {
    // The fixture proves the object exists, so the empty/failed read below is the policy
    // working and not a missing file. `audio` is private, so RLS filters the row out of
    // storage.objects and the API answers 404 rather than 403 — either way, no bytes.
    const present = await svc.storage.from('audio').download(objectB())
    expect(present.data, 'B fixture object missing — the denial below would be vacuous').not.toBeNull()

    const { data, error } = await asA.storage.from('audio').download(objectB())
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it("CRITICAL: a manager cannot even ENUMERATE another artist's audio folder", async () => {
    const { data } = await asA.storage.from('audio').list(`${artistB}/audio`)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: the raw audio object is NOT publicly reachable', async () => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/audio/${objectA()}`)
    expect(res.ok).toBe(false) // private bucket → no public read
  })

  it('CRITICAL: anon cannot download the object; the owning manager can', async () => {
    const anon = await anonClient().storage.from('audio').download(objectA())
    expect(anon.data).toBeNull() // the manager-read policy does NOT grant anon
    const owner = await asA.storage.from('audio').download(objectA())
    expect(owner.error).toBeNull()
  })
})
