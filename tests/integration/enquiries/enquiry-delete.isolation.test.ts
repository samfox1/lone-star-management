// Who may delete an enquiry: its own artist's manager, and nobody else.
/**
 * enquiries_delete (20260928140000) — a manager can delete an enquiry (Sam, 2026-09-28).
 *
 * NEEDS THE MIGRATION. Until 20260928140000 is pushed, the owner test and the anon test are
 * RED (no delete policy: the owner's delete matches zero rows; anon still holds the stock
 * DELETE grant, so its delete is filtered rather than refused). That is the red-first
 * evidence for both halves of the migration.
 *
 * Every denial here is proved on a PLANTED witness (AGENTS.md rule 2) and read back through
 * the service client, never from the delete's own return value: RLS turns a denied DELETE
 * into `error: null` over zero rows (rule 3), which reads exactly like success.
 *
 * TENANCY: two throwaway artists, A owned by manager A and B by manager B. Dropping them
 * cascades every enquiry and attachment row this file plants, so teardown is exact.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectRlsDenied } from '@tests/helpers/rls'

const svc = serviceClient()

let artistA: ThrowawayArtist
let artistB: ThrowawayArtist
let asA: SupabaseClient
let asB: SupabaseClient

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  artistA = await createThrowawayArtist(svc, 'enquiry delete A', asA)
  artistB = await createThrowawayArtist(svc, 'enquiry delete B', asB)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artistA)
  await deleteThrowawayArtist(svc, artistB)
})

/** Plant one enquiry as the service role (the only writer the table has) and prove it is there. */
async function plant(artistId: string, message: string): Promise<string> {
  const { data, error } = await svc
    .from('enquiries')
    .insert({
      artist_id: artistId,
      purpose: 'other',
      name: 'Spam Bot',
      email: 'bot@example.test',
      message,
      to_email: 'booking@example.test',
      recipient_source: 'default',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`plant enquiry: ${error?.message ?? 'no row'}`)
  const id = (data as { id: string }).id
  expect(await exists(id), 'the witness was not planted — every denial below would be vacuous').toBe(true)
  return id
}

async function exists(id: string): Promise<boolean> {
  const { data, error } = await svc.from('enquiries').select('id').eq('id', id)
  if (error) throw new Error(`read enquiry: ${error.message}`)
  return (data ?? []).length === 1
}

describe('enquiries_delete — the owner can, nobody else can', () => {
  it("CRITICAL: manager B cannot delete A's enquiry — it is still there afterwards", async () => {
    const id = await plant(artistA.id, 'cross-tenant delete witness')

    await asB.from('enquiries').delete().eq('id', id)

    expect(await exists(id)).toBe(true)
  })

  it('CRITICAL: anon cannot delete an enquiry — refused outright, and it is still there', async () => {
    const id = await plant(artistA.id, 'anon delete witness')

    const { error } = await anonClient().from('enquiries').delete().eq('id', id)

    // 42501, not a filtered no-op: the migration takes anon's DELETE grant away, so the
    // refusal no longer depends on no policy ever admitting anon.
    expectRlsDenied(error, 'anon deleting an enquiry')
    expect(await exists(id)).toBe(true)
  })

  it("the owner deletes their own enquiry, and its attachment rows go with it", async () => {
    const id = await plant(artistA.id, 'owner delete target')
    const { data: att, error: attErr } = await svc
      .from('enquiry_attachments')
      .insert({
        enquiry_id: id,
        artist_id: artistA.id,
        storage_path: `${artistA.id}/${id}/demo.mp3`,
        filename: 'demo.mp3',
        mime_type: 'audio/mpeg',
      })
      .select('id')
      .single()
    if (attErr || !att) throw new Error(`plant attachment: ${attErr?.message ?? 'no row'}`)

    const { data, error } = await asA.from('enquiries').delete().eq('id', id).select('id')

    expect(error).toBeNull()
    expect(data).toEqual([{ id }])
    expect(await exists(id)).toBe(false)
    const { data: left } = await svc.from('enquiry_attachments').select('id').eq('id', (att as { id: string }).id)
    expect(left ?? []).toEqual([])
  })

  it("the owner's delete reaches only the row it names", async () => {
    // A second enquiry on the same artist survives a delete aimed at the first.
    const keep = await plant(artistA.id, 'bystander on the same artist')
    const target = await plant(artistA.id, 'the one being deleted')

    await asA.from('enquiries').delete().eq('id', target)

    expect(await exists(target)).toBe(false)
    expect(await exists(keep)).toBe(true)
  })

  it('manager B CAN delete their own artist’s enquiry — the policy is per artist, not per manager', async () => {
    // The other side of the first test: B is refused on A's row because of WHOSE row it
    // is, not because B cannot delete at all.
    const id = await plant(artistB.id, "B's own enquiry")

    await asB.from('enquiries').delete().eq('id', id)

    expect(await exists(id)).toBe(false)
  })
})
