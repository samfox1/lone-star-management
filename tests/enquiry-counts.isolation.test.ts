/**
 * `enquiry_counts_by_artist` — tenant isolation for the ROLLUP.
 *
 * A count view is a subtler leak than a row read: it exposes no message text, so it is
 * easy to assume it needs no guarding. It exposes VOLUME — how much interest a rival
 * artist is getting, and when it last arrived. That is commercially meaningful on a
 * roster platform, so the view has to be scoped as tightly as the table under it.
 *
 * The mechanism is `security_invoker = true`: RLS on `enquiries` applies to the CALLER,
 * not the view owner. Drop that one setting and the view silently becomes a
 * definer-rights read of every tenant's numbers, with no error anywhere. These tests are
 * what stands between that and production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'

let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

/** Seeded straight in with the service role: the Edge Function is the only real writer,
 *  and this is about who can READ the rollup. */
async function seedEnquiry(artistId: string, readAt: string | null, createdAt: string) {
  const { error } = await svc.from('enquiries').insert({
    artist_id: artistId,
    purpose: 'booking',
    name: 'Rollup Fixture',
    email: 'fixture@example.com',
    message: 'counts fixture',
    to_email: 'book@example.com',
    recipient_source: 'default',
    status: 'sent',
    read_at: readAt,
    created_at: createdAt,
  })
  if (error) throw error
}

const countsFor = async (client: SupabaseClient) =>
  (await client.from('enquiry_counts_by_artist').select('artist_id, total, unread, latest_at')).data ?? []

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)

  await svc.from('enquiries').delete().eq('message', 'counts fixture')
  // A: two enquiries, one unread. B: one, read.
  await seedEnquiry(artistA, null, '2026-08-01T10:00:00Z')
  await seedEnquiry(artistA, '2026-08-02T10:00:00Z', '2026-07-01T10:00:00Z')
  await seedEnquiry(artistB, '2026-08-02T10:00:00Z', '2026-08-03T10:00:00Z')
})

afterAll(async () => {
  await svc.from('enquiries').delete().eq('message', 'counts fixture')
})

describe('enquiry_counts_by_artist', () => {
  it("counts the caller's own artist correctly", async () => {
    const mine = (await countsFor(asA)).find((r) => r.artist_id === artistA)
    expect(mine).toBeTruthy()
    expect(Number(mine!.total)).toBe(2)
    expect(Number(mine!.unread)).toBe(1)
    expect(mine!.latest_at).toContain('2026-08-01')
  })

  it("CRITICAL: A cannot see B's row at all", async () => {
    // Not "sees zeros" — sees NOTHING. A zero row would still confirm the artist exists
    // and is quiet, which is itself information.
    expect((await countsFor(asA)).find((r) => r.artist_id === artistB)).toBeUndefined()
  })

  it("CRITICAL: B cannot see A's row", async () => {
    const forB = await countsFor(asB)
    expect(forB.find((r) => r.artist_id === artistA)).toBeUndefined()
    expect(forB.find((r) => r.artist_id === artistB)).toBeTruthy()
  })

  it('CRITICAL: an anonymous visitor sees nothing', async () => {
    expect(await countsFor(anonClient())).toEqual([])
  })

  it('CRITICAL: the totals themselves are scoped, not just the rows', async () => {
    // The leak that matters if the view were ever rewritten to join from `artists`:
    // A's row must never include enquiries belonging to B.
    const mine = (await countsFor(asA)).find((r) => r.artist_id === artistA)
    expect(Number(mine!.total)).toBe(2) // exactly A's own, not the 3 seeded overall
  })

  it('unread counts only the rows with no read_at', async () => {
    const mine = (await countsFor(asA)).find((r) => r.artist_id === artistA)
    expect(Number(mine!.unread)).toBe(1)
    expect(Number(mine!.total) - Number(mine!.unread)).toBe(1)
  })
})
