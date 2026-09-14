// TALKS TO THE HOSTED PROJECT. The booking-email door: one column, own artist only.
/**
 * set_booking_email (20260913220000). `artist_mail_settings` stays admin-write-only —
 * it holds the sending domain — so the booking email gets a SECURITY DEFINER door that
 * writes that one column for the artist's own managers. What has to hold, with the
 * witness planted and the ROW STATE asserted (AGENTS.md rules 2 and 3):
 *
 *   - manager A sets A's booking email, and the row says so;
 *   - manager B, calling for A, is refused — and A's row is untouched;
 *   - anon cannot execute the function at all (42501 naming it);
 *   - a non-address is refused and not stored; a blank clears.
 *
 * Teardown restores exactly the value found at the start (rule 6): the seed artist's
 * mail settings are shared with other suites and with humans.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'
import { expectExecuteDenied } from '@tests/helpers/rls'

const svc = serviceClient()
let artistA: string
let asA: SupabaseClient
let asB: SupabaseClient
let before: string | null | undefined // undefined = no row existed

async function rowState(): Promise<string | null | undefined> {
  const { data } = await svc.from('artist_mail_settings').select('booking_email').eq('artist_id', artistA).maybeSingle()
  return data ? ((data.booking_email as string | null) ?? null) : undefined
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  before = await rowState()
})

afterAll(async () => {
  if (before === undefined) await svc.from('artist_mail_settings').delete().eq('artist_id', artistA)
  else await svc.from('artist_mail_settings').upsert({ artist_id: artistA, booking_email: before })
})

describe('set_booking_email', () => {
  it('CRITICAL: the artist’s own manager sets it, and the row says so', async () => {
    const { data, error } = await asA.rpc('set_booking_email', { p_artist_id: artistA, p_email: '  door-test@example.com ' })
    expect(error).toBeNull()
    expect(data).toBe('door-test@example.com')
    expect(await rowState()).toBe('door-test@example.com')
  })

  it('CRITICAL: another manager is refused, and the row is untouched', async () => {
    await asA.rpc('set_booking_email', { p_artist_id: artistA, p_email: 'mine@example.com' })
    const { error } = await asB.rpc('set_booking_email', { p_artist_id: artistA, p_email: 'theirs@example.com' })
    expect(error?.message ?? '').toContain('not authorized')
    expect(await rowState()).toBe('mine@example.com') // the witness: B's write left no mark
  })

  it('CRITICAL: anon cannot execute the door at all', async () => {
    const { error } = await anonClient().rpc('set_booking_email', { p_artist_id: artistA, p_email: 'anon@example.com' })
    expectExecuteDenied(error, 'set_booking_email')
    expect(await rowState()).toBe('mine@example.com')
  })

  it('a non-address is refused and not stored; a blank clears', async () => {
    const bad = await asA.rpc('set_booking_email', { p_artist_id: artistA, p_email: 'not an email' })
    expect(bad.error?.message ?? '').toContain('not an email address')
    expect(await rowState()).toBe('mine@example.com')
    const cleared = await asA.rpc('set_booking_email', { p_artist_id: artistA, p_email: '   ' })
    expect(cleared.error).toBeNull()
    expect(cleared.data).toBeNull()
    expect(await rowState()).toBeNull()
  })
})
