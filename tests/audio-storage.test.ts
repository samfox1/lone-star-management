/**
 * PHASE 3 — gated audio storage isolation (the non-negotiable gate). A manager
 * can only write their own audio folder, and the raw object in the PRIVATE
 * `audio` bucket is never reachable without signing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const body = new Uint8Array([0xff, 0xfb, 0x90, 0x00]) // tiny fake mp3 frame

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  await svc.storage.from('audio').upload(`${artistA}/audio/iso.mp3`, body, {
    contentType: 'audio/mpeg',
    upsert: true,
  })
})

afterAll(async () => {
  await svc.storage
    .from('audio')
    .remove([`${artistA}/audio/iso.mp3`, `${artistA}/audio/own.mp3`, `${artistB}/audio/evil.mp3`])
})

describe('gated audio storage isolation', () => {
  it('a manager can upload to their own audio folder', async () => {
    const { error } = await asA.storage.from('audio').upload(`${artistA}/audio/own.mp3`, body, {
      contentType: 'audio/mpeg',
      upsert: true,
    })
    expect(error).toBeNull()
  })

  it("CRITICAL: a manager cannot upload to another artist's audio folder", async () => {
    const { error } = await asA.storage.from('audio').upload(`${artistB}/audio/evil.mp3`, body, {
      contentType: 'audio/mpeg',
      upsert: true,
    })
    expect(error).not.toBeNull()
  })

  it('CRITICAL: the raw audio object is NOT publicly reachable', async () => {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/audio/${artistA}/audio/iso.mp3`)
    expect(res.ok).toBe(false) // private bucket → no public read
  })
})
