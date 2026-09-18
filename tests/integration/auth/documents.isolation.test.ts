// The private documents bucket: stage plots and riders stay unreadable across tenants.
/**
 * Tenant isolation for the PRIVATE `documents` bucket (stage plots + tech riders).
 *
 * This is the first bucket whose contents are meant to stay unreadable. `media` and
 * `videos` are public by design — their objects are served by URL and the policies only
 * govern the authenticated/list APIs. Here the object itself is the secret: a rider is a
 * document the manager chooses who receives, so "A cannot read B's" and "a fan cannot
 * read anyone's" both have to be true against the real database, not just intended.
 *
 * Uploads go in as the SERVICE role (RLS-exempt) so each case tests exactly one thing:
 * whether the reader's own policy lets them through.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'

const BUCKET = 'documents'
/** A minimal, genuinely-valid PDF — the bucket enforces application/pdf. */
const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])], {
  type: 'application/pdf',
})

let artistA: string
let artistB: string
let asA: SupabaseClient
const svc = serviceClient()

let aPath: string
let bPath: string
/**
 * The paths the two ATTACK cases write to — per-run, and cleaned up, for the same reason
 * the fixtures are.
 *
 * THE BUG THIS FIXES. Both attacks used to post to a fixed path (`…/intruder.pdf`,
 * `…/evil.html`) that nothing removed, and asserted only `expect(error).not.toBeNull()`.
 * Follow the first run after the door breaks: the object LANDS, the test fails once, and
 * it stays on the bucket. Every run after that gets `409 Duplicate` — an error, so the
 * assertion passes — and the suite is green forever with the door standing open and a
 * stored HTML file sitting in a bucket that refuses HTML. The file was already taking
 * this precaution for its fixtures twenty lines above.
 */
const RUN = crypto.randomUUID()
let intruderPath: string
let evilPath: string

/** A denial that is not merely "something went wrong": a 409 means the path was taken,
 *  which is the failure mode above wearing a passing test's clothes. */
function expectStorageDenied(error: unknown, what: string): void {
  expect(error, what).not.toBeNull()
  const code = (error as { statusCode?: string } | null)?.statusCode
  expect(String(code ?? ''), `${what}: refused as a duplicate, not as a denial`).not.toBe('409')
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)
  artistB = await artistIdBySlug(SEED.artistBSlug)
  asA = await signInAs(SEED.managerA)
  // A FRESH object path per run. Storage sits behind a CDN that caches by path and is
  // invalidated by object writes, NOT by policy changes — so a path that was ever served
  // to anon stays served to anon for the cache's lifetime, and a reused path would make
  // this file's anon assertion depend on what a previous run's policies allowed. (That
  // is not hypothetical: it is exactly how this test started failing after a policy
  // mutation check on 2026-08-04.)
  aPath = `${artistA}/documents/isolation-a-${RUN}.pdf`
  bPath = `${artistB}/documents/isolation-b-${RUN}.pdf`
  intruderPath = `${artistB}/documents/intruder-${RUN}.pdf`
  evilPath = `${artistA}/documents/evil-${RUN}.html`

  for (const path of [aPath, bPath]) {
    const { error } = await svc.storage.from(BUCKET).upload(path, PDF, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (error) throw error
  }
})

afterAll(async () => {
  // The attack paths too: if a door IS open, the object that landed is this file's to
  // clean up, and leaving it there is what turned the next run green.
  await svc.storage.from(BUCKET).remove([aPath, bPath, intruderPath, evilPath])
})

/** Object names directly under a folder, as the service role sees them. */
async function namesIn(folder: string): Promise<string[]> {
  const { data } = await svc.storage.from(BUCKET).list(folder)
  return (data ?? []).map((o) => o.name)
}

describe('documents bucket — tenant isolation', () => {
  it('a manager CAN read their own artist’s document', async () => {
    // The positive case is what makes the negatives below meaningful: without it, a
    // bucket that rejected EVERYONE would pass every other test in this file.
    const { data, error } = await asA.storage.from(BUCKET).download(aPath)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })

  it("CRITICAL: A cannot DOWNLOAD B's document", async () => {
    const { data, error } = await asA.storage.from(BUCKET).download(bPath)
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it("CRITICAL: A cannot LIST B's folder", async () => {
    const { data } = await asA.storage.from(BUCKET).list(`${artistB}/documents`)
    expect(data ?? []).toHaveLength(0)
  })

  it("CRITICAL: A cannot DELETE B's document", async () => {
    await asA.storage.from(BUCKET).remove([bPath])
    // Still there, as seen by the service role.
    const { data } = await svc.storage.from(BUCKET).list(`${artistB}/documents`)
    expect((data ?? []).map((o) => o.name)).toContain(bPath.split('/').pop())
  })

  it("CRITICAL: A cannot UPLOAD into B's folder", async () => {
    // The path is free before the attempt — without that, "it did not land" is a claim
    // about a path that was already taken (AGENTS.md rule 2, in its negative form).
    const name = intruderPath.split('/').pop()
    expect(await namesIn(`${artistB}/documents`)).not.toContain(name)
    const { error } = await asA.storage
      .from(BUCKET)
      .upload(intruderPath, PDF, { contentType: 'application/pdf' })
    expectStorageDenied(error, "A uploading into B's folder")
    // And the STATE, not just the answer: the object is the thing that matters.
    expect(await namesIn(`${artistB}/documents`)).not.toContain(name)
  })

  it('CRITICAL: an anonymous visitor cannot download ANY document', async () => {
    const { data, error } = await anonClient().storage.from(BUCKET).download(aPath)
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('CRITICAL: the public URL does not serve a private object', async () => {
    // The bucket is private, so the public object endpoint must refuse — this is the
    // difference between `documents` and `media`, and the whole reason for the split.
    const { data } = svc.storage.from(BUCKET).getPublicUrl(aPath)
    const res = await fetch(data.publicUrl)
    expect(res.ok).toBe(false)
  })

  it('CRITICAL: the bucket refuses a non-PDF even from the service role', async () => {
    // The bucket's allowed_mime_types is the unbypassable guard; DOCUMENT_UPLOAD_RULES is
    // only the client-side half. An HTML file here would be stored XSS on the Supabase
    // origin if the bucket were ever flipped public.
    const name = evilPath.split('/').pop()
    expect(await namesIn(`${artistA}/documents`)).not.toContain(name)
    const { error } = await svc.storage
      .from(BUCKET)
      .upload(evilPath, new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), {
        contentType: 'text/html',
      })
    expectStorageDenied(error, 'the service role storing text/html')
    expect(await namesIn(`${artistA}/documents`)).not.toContain(name)
  })
})
