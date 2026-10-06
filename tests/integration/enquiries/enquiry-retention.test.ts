/**
 * In the real database, the nightly prune deletes exactly the enquiries the rule says (emailed:
 * 30 days, anything else: 90), their attachment rows with them, queues their audio for the
 * Storage API instead of orphaning it, and nobody but the service role can run it.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ NOT RUN until the migration is pushed. Flip RETENTION_PUSHED to true in the SAME change  │
 * │ as the push, then run this file (and `npm run audit:grants`).                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Code:     supabase/migrations/20261005120000_enquiry_retention.sql (enquiry_delete_at,
 *           prune_enquiries, enquiry_file_purges, enquiry_prune_schedule, the cron job)
 * Feature:  enquiries are kept for a while, not forever (Sam, 2026-10-05)
 * Tier:     STRICT (AGENTS.md "Test depth"): deletes, grants, storage. Every row read back
 *           through the service client (rule 3); every denial against a planted, DUE witness,
 *           so a call that got through would have deleted it (rule 2); every row on a
 *           throwaway artist, and the prune narrowed to that artist (rule 6).
 * Covers:   • on both sides of each window (with margins: the exact microsecond boundaries,
 *             time zones and every mutation were checked on a throwaway local Postgres,
 *             2026-10-05), only the old ones go; another artist's due rows are untouched
 *           • attachment rows go with the enquiry; the audio OBJECT stays in the bucket and its
 *             path is queued (SQL cannot delete files safely), and a second run is a no-op
 *           • anon and a manager cannot run the prune, read the rule, read the schedule, or
 *             read or write the queue (insert, repoint, remove: each one a file deleted or kept
 *             wrongly)
 *           • the nightly job exists, is active, and runs prune_enquiries() at 04:20 UTC
 * Not here: draining the queue. Its order (files first, rows by id only after) is
 *           drainPurgeQueue in supabase/functions/contact/validate.ts, held by
 *           tests/unit/enquiries/contact-validate.test.ts; the three calls around it in
 *           index.ts are Deno plumbing. The rule in TS:
 *           tests/unit/manager-tools/enquiries/enquiry-retention.test.ts.
 * Fixtures: the HOSTED project: the seeded manager A signed in, the service client, two
 *           throwaway artists, one tiny audio object, all removed by this file.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
import { SEED, anonClient, serviceClient, signInAs } from '@tests/helpers/supabase'

const RETENTION_PUSHED = true

const BUCKET = 'enquiry-attachments'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe.skipIf(!RETENTION_PUSHED)('enquiry retention', () => {
  const svc = serviceClient()
  const anon = anonClient()
  let asA: SupabaseClient
  let a: ThrowawayArtist
  let b: ThrowawayArtist
  /** Everything this file put in the queue or the bucket, so teardown removes exactly that. */
  const paths: string[] = []

  async function plant(artistId: string, status: string, ageDays: number, label: string): Promise<string> {
    const { data, error } = await svc
      .from('enquiries')
      .insert({
        artist_id: artistId,
        purpose: 'booking',
        name: 'Retention Witness',
        email: 'witness@example.test',
        message: label,
        to_email: 'to@example.test',
        recipient_source: 'default',
        status,
        created_at: new Date(Date.now() - ageDays * DAY).toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`plant ${label}: ${error?.message ?? 'no row'}`)
    const id = (data as { id: string }).id
    expect(await exists(id), `${label} was not planted — every assertion on it would be vacuous`).toBe(true)
    return id
  }

  async function exists(id: string): Promise<boolean> {
    const { data, error } = await svc.from('enquiries').select('id').eq('id', id)
    if (error) throw new Error(`read enquiry: ${error.message}`)
    return (data ?? []).length === 1
  }

  async function queued(path: string): Promise<boolean> {
    const { data, error } = await svc.from('enquiry_file_purges').select('id').eq('storage_path', path)
    if (error) throw new Error(`read queue: ${error.message}`)
    return (data ?? []).length === 1
  }

  async function objectThere(path: string): Promise<boolean> {
    const folder = path.split('/').slice(0, -1).join('/')
    const name = path.split('/').pop()
    const { data, error } = await svc.storage.from(BUCKET).list(folder, { limit: 100 })
    if (error) throw new Error(`list ${folder}: ${error.message}`)
    return (data ?? []).some((o) => o.name === name)
  }

  const prune = async (artistId: string) => {
    const { data, error } = await svc.rpc('prune_enquiries', { p_artist_id: artistId })
    expect(error).toBeNull()
    return data as number
  }

  beforeAll(async () => {
    asA = await signInAs(SEED.managerA)
    a = await createThrowawayArtist(svc, 'enquiry retention A', asA)
    b = await createThrowawayArtist(svc, 'enquiry retention B')
  })

  afterAll(async () => {
    if (paths.length) {
      await svc.storage.from(BUCKET).remove(paths)
      await svc.from('enquiry_file_purges').delete().in('storage_path', paths)
    }
    await deleteThrowawayArtist(svc, a)
    await deleteThrowawayArtist(svc, b)
  })

  it('CRITICAL: only enquiries past their window go — 30 days if emailed, 90 if not — and only this artist’s', async () => {
    const goes = {
      sent31: await plant(a.id, 'sent', 31, 'sent, 31 days'),
      unroutable91: await plant(a.id, 'unroutable', 91, 'unroutable, 91 days'),
      failed91: await plant(a.id, 'failed', 91, 'failed, 91 days'),
      queued91: await plant(a.id, 'queued', 91, 'queued, 91 days'),
    }
    const stays = {
      sent29: await plant(a.id, 'sent', 29, 'sent, 29 days'),
      failed31: await plant(a.id, 'failed', 31, 'failed, 31 days — not emailed, so 90'),
      unroutable89: await plant(a.id, 'unroutable', 89, 'unroutable, 89 days'),
      fresh: await plant(a.id, 'sent', 0, 'sent, just now'),
      otherArtist: await plant(b.id, 'sent', 31, 'B: due, but the run is narrowed to A'),
    }

    expect(await prune(a.id)).toBe(Object.keys(goes).length)

    for (const [k, id] of Object.entries(goes)) expect(await exists(id), `${k} should be gone`).toBe(false)
    for (const [k, id] of Object.entries(stays)) expect(await exists(id), `${k} should still be there`).toBe(true)
  })

  it('CRITICAL: the attachment rows go with it, and the FILE is queued, not orphaned', async () => {
    const due = await plant(a.id, 'sent', 40, 'due, with audio')
    const kept = await plant(a.id, 'failed', 40, 'kept, with audio')
    const duePath = `${a.id}/${due}/${randomUUID()}-demo.mp3`
    const keptPath = `${a.id}/${kept}/${randomUUID()}-keep.mp3`
    paths.push(duePath, keptPath)
    for (const [enquiry, path] of [[due, duePath], [kept, keptPath]] as const) {
      const up = await svc.storage
        .from(BUCKET)
        .upload(path, new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { contentType: 'audio/mpeg' })
      if (up.error) throw new Error(`upload ${path}: ${up.error.message}`)
      const att = await svc.from('enquiry_attachments').insert({
        enquiry_id: enquiry,
        artist_id: a.id,
        storage_path: path,
        filename: path.split('-').pop(),
        mime_type: 'audio/mpeg',
      })
      if (att.error) throw new Error(`attach ${path}: ${att.error.message}`)
      expect(await objectThere(path), `${path} was not uploaded`).toBe(true)
    }

    await prune(a.id)

    expect(await exists(due)).toBe(false)
    const { data: left } = await svc.from('enquiry_attachments').select('enquiry_id').in('enquiry_id', [due, kept])
    expect((left ?? []).map((r) => (r as { enquiry_id: string }).enquiry_id)).toEqual([kept])
    // SQL left the object alone (it cannot delete it safely) and named it for the Storage API.
    // A contact submission landing in this instant could drain it first; that is the only way
    // this can flake, and it would mean the drain works.
    expect(await objectThere(duePath)).toBe(true)
    expect(await queued(duePath)).toBe(true)
    expect(await queued(keptPath), 'a KEPT enquiry’s file is queued for deletion').toBe(false)
    expect(await objectThere(keptPath)).toBe(true)

    // A second run finds nothing due and queues nothing twice.
    expect(await prune(a.id)).toBe(0)
    expect(await queued(duePath)).toBe(true)
  })

  it('CRITICAL: anon and a manager cannot run the prune — the due witness survives both', async () => {
    const witness = await plant(a.id, 'sent', 45, 'due witness for the denials')

    expectExecuteDenied((await anon.rpc('prune_enquiries', { p_artist_id: a.id })).error, 'prune_enquiries')
    expectExecuteDenied((await asA.rpc('prune_enquiries', { p_artist_id: a.id })).error, 'prune_enquiries')

    expect(await exists(witness)).toBe(true)
  })

  it('the rule and the schedule readout are service-only too', async () => {
    const args = { p_status: 'sent', p_created_at: new Date().toISOString() }
    expectExecuteDenied((await anon.rpc('enquiry_delete_at', args)).error, 'enquiry_delete_at')
    expectExecuteDenied((await asA.rpc('enquiry_delete_at', args)).error, 'enquiry_delete_at')
    expectExecuteDenied((await anon.rpc('enquiry_prune_schedule')).error, 'enquiry_prune_schedule')
    expectExecuteDenied((await asA.rpc('enquiry_prune_schedule')).error, 'enquiry_prune_schedule')
  })

  it('nobody but the service role can read the queue — against a planted row', async () => {
    const path = `${a.id}/${randomUUID()}/${randomUUID()}-witness.mp3`
    paths.push(path)
    const { error } = await svc.from('enquiry_file_purges').insert({ storage_path: path })
    if (error) throw new Error(`plant queue row: ${error.message}`)
    expect(await queued(path)).toBe(true)

    expectRlsDenied((await anon.from('enquiry_file_purges').select('id')).error, 'anon reading the queue')
    expectRlsDenied((await asA.from('enquiry_file_purges').select('id')).error, 'a manager reading the queue')
  })

  it('CRITICAL: nobody but the service role can WRITE the queue — a path in it is a file that gets deleted', async () => {
    // The queue is a delete list: the contact function removes every path in it from the bucket.
    // Inserting would let a stranger pick which audio is deleted; updating would redirect a
    // queued delete onto a live file; deleting would strand a file forever. So: a planted
    // witness row, a fresh path the writes aim at, and every outcome read back through the
    // service client, never from the return value (RLS-filtered writes return no error).
    const witness = `${a.id}/${randomUUID()}/${randomUUID()}-queued.mp3`
    const target = `${a.id}/${randomUUID()}/${randomUUID()}-live.mp3`
    paths.push(witness, target)
    const { data: planted, error } = await svc
      .from('enquiry_file_purges')
      .insert({ storage_path: witness })
      .select('id')
      .single()
    if (error || !planted) throw new Error(`plant queue row: ${error?.message ?? 'no row'}`)
    const id = (planted as { id: number }).id
    expect(await queued(witness), 'the witness was not planted — the update/delete denials would be vacuous').toBe(true)
    expect(await queued(target)).toBe(false)

    for (const [who, client] of [['anon', anon], ['a manager', asA]] as const) {
      const queue = () => client.from('enquiry_file_purges')
      expectRlsDenied((await queue().insert({ storage_path: target })).error, `${who} queueing a file`)
      expectRlsDenied((await queue().update({ storage_path: target }).eq('id', id)).error, `${who} repointing a queued file`)
      expectRlsDenied((await queue().delete().eq('id', id)).error, `${who} removing a queued file`)
    }

    expect(await queued(target), 'a path reached the delete list from outside the service role').toBe(false)
    expect(await queued(witness), 'the planted row was deleted or repointed from outside the service role').toBe(true)
  })

  it('the nightly job exists, is active, and runs exactly the prune at 04:20 UTC', async () => {
    const { data, error } = await svc.rpc('enquiry_prune_schedule')
    expect(error).toBeNull()
    const jobs = (data ?? []) as { jobname: string; schedule: string; command: string; active: boolean; last_status: string | null; last_message: string }[]
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ jobname: 'enquiries-prune', schedule: '20 4 * * *', active: true })
    expect(jobs[0].command.trim()).toBe('select public.prune_enquiries()')
    if (jobs[0].last_status !== null) expect(jobs[0].last_status, jobs[0].last_message).toBe('succeeded')
  })
})
