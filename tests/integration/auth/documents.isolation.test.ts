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
  const run = crypto.randomUUID()
  aPath = `${artistA}/documents/isolation-a-${run}.pdf`
  bPath = `${artistB}/documents/isolation-b-${run}.pdf`

  for (const path of [aPath, bPath]) {
    const { error } = await svc.storage.from(BUCKET).upload(path, PDF, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (error) throw error
  }
})

afterAll(async () => {
  await svc.storage.from(BUCKET).remove([aPath, bPath])
})

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
    const { error } = await asA.storage
      .from(BUCKET)
      .upload(`${artistB}/documents/intruder.pdf`, PDF, { contentType: 'application/pdf' })
    expect(error).not.toBeNull()
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
    const { error } = await svc.storage
      .from(BUCKET)
      .upload(`${artistA}/documents/evil.html`, new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), {
        contentType: 'text/html',
      })
    expect(error).not.toBeNull()
  })
})
