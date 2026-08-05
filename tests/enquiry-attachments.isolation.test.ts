/**
 * `enquiry_attachments` and the private `enquiry-attachments` bucket.
 *
 * Two boundaries, and the second is the unusual one.
 *
 * The TABLE is read-only for managers of that artist. There is deliberately no insert,
 * update or delete policy for `authenticated` or `anon` — the Edge Function writes with
 * the service role and is the only writer. That means the interesting assertion is not
 * "B cannot write A's row", it is "NOBODY can write through a session, including the
 * artist's own manager". A missing policy denies by default, so this pins that the
 * omission is deliberate and stays that way.
 *
 * The BUCKET is private with no anon read at all. These are unsolicited files from
 * strangers, sent to one manager; a public URL would be the whole problem.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from './helpers/supabase'
import { expectRlsDenied } from './helpers/rls'

const BUCKET = 'enquiry-attachments'
/** Minimal bytes with an audio content-type — the bucket checks the declared type. */
const AUDIO = new Blob([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00])], { type: 'audio/mpeg' })

let artistA: string
let artistB: string
let asA: SupabaseClient
let asB: SupabaseClient
const svc = serviceClient()

let enquiryA: string
let pathA: string

async function seedEnquiry(artistId: string): Promise<string> {
  const { data, error } = await svc
    .from('enquiries')
    .insert({
      artist_id: artistId,
      purpose: 'demo',
      name: 'Attachment Fixture',
      email: 'fixture@example.com',
      message: 'attachment fixture',
      to_email: 'book@example.com',
      recipient_source: 'default',
      status: 'sent',
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('seed failed')
  return data.id as string
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)

  await svc.from('enquiries').delete().eq('message', 'attachment fixture')
  enquiryA = await seedEnquiry(artistA)
  pathA = `${artistA}/${enquiryA}/11111111-0000-4000-8000-000000000000-demo.mp3`

  const up = await svc.storage.from(BUCKET).upload(pathA, AUDIO, { contentType: 'audio/mpeg', upsert: true })
  if (up.error) throw up.error
  const ins = await svc.from('enquiry_attachments').insert({
    enquiry_id: enquiryA,
    artist_id: artistA,
    storage_path: pathA,
    filename: 'demo.mp3',
    mime_type: 'audio/mpeg',
    bytes: 5,
  })
  if (ins.error) throw ins.error
})

afterAll(async () => {
  await svc.storage.from(BUCKET).remove([pathA])
  await svc.from('enquiries').delete().eq('message', 'attachment fixture')
})

describe('enquiry_attachments — the row', () => {
  it("A can read their own artist's attachment", async () => {
    const { data } = await asA.from('enquiry_attachments').select('id, filename').eq('enquiry_id', enquiryA)
    expect((data ?? []).map((r) => r.filename)).toEqual(['demo.mp3'])
  })

  it("CRITICAL: B cannot read A's attachment", async () => {
    const { data } = await asB.from('enquiry_attachments').select('id').eq('enquiry_id', enquiryA)
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: an anonymous visitor reads nothing', async () => {
    const { data } = await anonClient().from('enquiry_attachments').select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('CRITICAL: even the artist’s OWN manager cannot insert a row', async () => {
    // Read-only by design. The Edge Function is the only writer, so a session-level insert
    // must fail even for the person who owns the data — otherwise a manager (or anything
    // running with their token) could fabricate an attachment pointing anywhere.
    const { error } = await asA.from('enquiry_attachments').insert({
      enquiry_id: enquiryA,
      artist_id: artistA,
      storage_path: `${artistA}/${enquiryA}/forged.mp3`,
      filename: 'forged.mp3',
      mime_type: 'audio/mpeg',
    })
    expectRlsDenied(error, "the owning manager inserting an attachment row")
  })

  it('CRITICAL: a manager cannot delete or repoint a row either', async () => {
    await asA.from('enquiry_attachments').update({ storage_path: 'elsewhere' }).eq('enquiry_id', enquiryA)
    await asA.from('enquiry_attachments').delete().eq('enquiry_id', enquiryA)
    const { data } = await svc.from('enquiry_attachments').select('storage_path').eq('enquiry_id', enquiryA)
    expect(data).toHaveLength(1)
    expect(data![0].storage_path).toBe(pathA)
  })

  it('deleting the enquiry cascades its attachment rows away', async () => {
    const throwaway = await seedEnquiry(artistA)
    await svc.from('enquiry_attachments').insert({
      enquiry_id: throwaway,
      artist_id: artistA,
      storage_path: `${artistA}/${throwaway}/x.mp3`,
      filename: 'x.mp3',
      mime_type: 'audio/mpeg',
    })
    await svc.from('enquiries').delete().eq('id', throwaway)
    const { data } = await svc.from('enquiry_attachments').select('id').eq('enquiry_id', throwaway)
    expect(data ?? []).toHaveLength(0)
  })
})

describe('enquiry-attachments bucket', () => {
  it("A's manager can download their own artist's file", async () => {
    const { data, error } = await asA.storage.from(BUCKET).download(pathA)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it("CRITICAL: B cannot download A's file", async () => {
    const { data, error } = await asB.storage.from(BUCKET).download(pathA)
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('CRITICAL: an anonymous visitor cannot download it', async () => {
    const { data } = await anonClient().storage.from(BUCKET).download(pathA)
    expect(data).toBeNull()
  })

  it('CRITICAL: the public URL does not serve a private object', async () => {
    const { data } = svc.storage.from(BUCKET).getPublicUrl(pathA)
    expect((await fetch(data.publicUrl)).ok).toBe(false)
  })

  it('CRITICAL: an anonymous visitor cannot upload — there is no anon write', async () => {
    // The whole upload model is server-minted signed tokens. A blanket anon insert policy
    // would make those pointless and hand every bot a writable bucket.
    const { error } = await anonClient()
      .storage.from(BUCKET)
      .upload(`${artistA}/${enquiryA}/intruder.mp3`, AUDIO, { contentType: 'audio/mpeg' })
    expect(error).not.toBeNull()
  })

  it('CRITICAL: the bucket refuses a non-audio file even from the service role', async () => {
    const { error } = await svc.storage
      .from(BUCKET)
      .upload(`${artistA}/${enquiryA}/evil.html`, new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), {
        contentType: 'text/html',
      })
    expect(error).not.toBeNull()
  })
})
