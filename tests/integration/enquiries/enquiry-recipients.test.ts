// Enquiry kinds and their recipient lists: seeding, per-kind routing, tenancy.
/**
 * enquiry_kinds + enquiry_recipients + resolve_enquiry_recipients (2026-09-21).
 *
 * WHAT IS ACTUALLY BEING PINNED. Two rules, and both fail SILENTLY when broken, which is why
 * they get a file:
 *
 *   1. A kind goes ONLY to its own list (Sam, 2026-10-02: "I dont want the main address to
 *      recieve everything, I should have to add each one individually"; 20261002210000). The
 *      artist's booking_email, the site's booking link and its site text route NOTHING: they
 *      were a fallback chain in front of every list until that migration.
 *   2. Lists do not leak ACROSS kinds. A demo landing on the booking list is not an error
 *      anyone sees; it is just the wrong people reading someone's demo.
 *
 * TENANCY. Every artist here is a throwaway created and dropped by this file
 * (@tests/helpers/artist), so "delete everything for this artist" is "delete exactly what I
 * created" and the absolute counts below are true about a genuinely empty table. The seed
 * artists are shared fixtures and are never touched — AGENTS.md rule 6.
 *
 * THE HOUSE ROW IS NEVER WRITTEN. `mail_settings` is live config. This file used to
 * overwrite it for its whole run and restore it afterwards, which misrouted real enquiries
 * while it ran and leaked a fake row when a run crashed or two runs nested (2026-09-28). It
 * no longer needs it at all: since 20260928141000 there is NO global inbox (rung 4 is gone,
 * Sam: "my email shouldn't be involved here"), so what an artist resolves depends only on
 * rows under that artist.
 *
 * The end-to-end half — what `submit_enquiry` returns and freezes on the enquiry row —
 * lives in enquiry-door.test.ts, which already owns that singleton and the throwaway artist
 * the rate-limit windows depend on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEED, anonClient, artistIdBySlug, serviceClient, signInAs } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'
import { expectExecuteDenied, expectRlsDenied } from '@tests/helpers/rls'
import { confirmForRouting } from '@tests/helpers/email-confirmations'
import type { SupabaseClient } from '@supabase/supabase-js'

const svc = serviceClient()

/** Owned by managerA. */
let artistA: ThrowawayArtist
/** Owned by managerB — the other side of every isolation assertion. */
let artistB: ThrowawayArtist
let asA: SupabaseClient
let asB: SupabaseClient

const OPS_TO = 'booking-email@example.com'
const LINK_TO = 'booking-link@example.com'
const CONTENT_TO = 'site-text@example.com'
const MANAGER_TO = 'the-manager@example.com'
const ARTIST_TO = 'the-artist@example.com'


type Resolved = { to_email: string; recipient_source: string; is_primary: boolean; ordinal: number }

async function resolve(artistId: string, purpose: string): Promise<Resolved[]> {
  const { data, error } = await svc.rpc('resolve_enquiry_recipients', {
    p_artist_id: artistId,
    p_purpose: purpose,
  })
  if (error) throw new Error(`resolve_enquiry_recipients: ${error.message}`)
  return (data ?? []) as Resolved[]
}

async function kindId(artistId: string, slug: string): Promise<string> {
  const { data, error } = await svc
    .from('enquiry_kinds')
    .select('id')
    .eq('artist_id', artistId)
    .eq('slug', slug)
    .single()
  if (error) throw new Error(`kindId(${slug}): ${error.message}`)
  return (data as { id: string }).id
}

/**
 * The three things that USED to route every kind (resolve_booking_recipient's rungs) and must
 * route nothing now: the artist's booking_email (its OWN mail row, never the house one), the
 * site's booking link, and its site text. Planted together so "reaches nobody" is a claim about
 * an artist that HAS all three.
 */
async function giveOldRungs(artistId: string): Promise<void> {
  const mail = await svc.from('artist_mail_settings').upsert({ artist_id: artistId, booking_email: OPS_TO })
  if (mail.error) throw new Error(`booking_email: ${mail.error.message}`)
  await giveBookingLink(artistId, LINK_TO)
  const text = await svc.from('site_content').upsert({ artist_id: artistId, key: 'booking_email', value: CONTENT_TO }, { onConflict: 'artist_id,key' })
  if (text.error) throw new Error(`site_content booking_email: ${text.error.message}`)
}

/** links.role = 'booking': the site's public booking contact. */
async function giveBookingLink(artistId: string, email: string): Promise<void> {
  const { error } = await svc
    .from('links')
    .insert({ artist_id: artistId, role: 'booking', label: 'Booking', url: `mailto:${email}` })
  if (error) throw new Error(`giveBookingLink: ${error.message}`)
}

async function addRecipient(
  artistId: string,
  slug: string,
  email: string,
  label?: string,
  /** Explicit where ORDER is asserted: two inserts in one test can share a clock tick, and
   *  the resolver tie-breaks on a random id, so a real timestamp gap is the only honest one. */
  createdAt?: string,
): Promise<string> {
  const { data, error } = await svc
    .from('enquiry_recipients')
    .insert({
      artist_id: artistId,
      kind_id: await kindId(artistId, slug),
      email,
      label: label ?? null,
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    .select('id')
    .single()
  if (error) throw new Error(`addRecipient(${slug}, ${email}): ${error.message}`)
  // Confirmed too: since 20261006120000 only a confirmed address routes, and this file is about
  // LISTS. Unconfirmed routing has its own file (email-confirmations.test.ts).
  await confirmForRouting(svc, artistId, [email])
  return (data as { id: string }).id
}

beforeAll(async () => {
  asA = await signInAs(SEED.managerA)
  asB = await signInAs(SEED.managerB)
  artistA = await createThrowawayArtist(svc, 'enquiry-recipients A', asA)
  artistB = await createThrowawayArtist(svc, 'enquiry-recipients B', asB)
})

afterAll(async () => {
  await deleteThrowawayArtist(svc, artistA)
  await deleteThrowawayArtist(svc, artistB)
})

describe('enquiry_kinds — every artist starts with the three the sites send', () => {
  it('seeds booking, demo and other when an artist is created', async () => {
    // A TRIGGER, not app code: every live site posts one of these three slugs today, and
    // "the app remembers to seed it" holds only until the second place that creates an
    // artist forgets. This artist was made by the plain helper, which knows nothing of it.
    const a = await createThrowawayArtist(svc, 'seeded kinds')
    try {
      const { data } = await svc
        .from('enquiry_kinds')
        .select('slug, label, sort_order')
        .eq('artist_id', a.id)
        .order('sort_order')

      // 'other' is labelled CONTACT. The slug is what the sites post and what
      // coercePurpose falls back to, so it cannot change; the label is the only part a
      // human reads, and the inbox and the email subject have both always said "Contact".
      expect(data).toEqual([
        { slug: 'booking', label: 'Booking', sort_order: 0 },
        { slug: 'demo', label: 'Demo', sort_order: 1 },
        { slug: 'other', label: 'Contact', sort_order: 2 },
      ])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('accepts an artist-invented kind', async () => {
    const a = await createThrowawayArtist(svc, 'custom kind')
    try {
      const { error } = await svc
        .from('enquiry_kinds')
        .insert({ artist_id: a.id, slug: 'sync-licensing', label: 'Sync licensing', sort_order: 3 })

      expect(error).toBeNull()
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses a slug the site could not safely send', async () => {
    // Same shape enquiries_purpose_check enforces. `purpose` crosses a public HTTP boundary
    // in both directions and is compared by equality at the routing step.
    const a = await createThrowawayArtist(svc, 'slug shape')
    try {
      for (const slug of ['Has Caps', 'has space', '-leading', 'under_score', 'x'.repeat(41)]) {
        const { error } = await svc
          .from('enquiry_kinds')
          .insert({ artist_id: a.id, slug, label: 'X' })
        expect(error?.code, `slug ${JSON.stringify(slug)} should be refused`).toBe('23514')
      }
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses a label carrying CR/LF', async () => {
    // The label reaches a mail header via buildSubject. Refused at the STORAGE layer so the
    // invariant outlives whoever writes the next sender.
    const a = await createThrowawayArtist(svc, 'label injection')
    try {
      const { error } = await svc
        .from('enquiry_kinds')
        .insert({ artist_id: a.id, slug: 'press', label: 'Press\r\nBcc: attacker@evil.com' })

      expect(error?.code).toBe('23514')
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('lets the label be renamed', async () => {
    // The label is the only part a human reads. "Other" → "Contact" → "General" is the
    // expected use, and it changes nothing about routing.
    const a = await createThrowawayArtist(svc, 'rename label')
    try {
      const { error } = await svc
        .from('enquiry_kinds')
        .update({ label: 'General enquiries' })
        .eq('artist_id', a.id)
        .eq('slug', 'other')

      expect(error).toBeNull()
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses to change a slug', async () => {
    // The slug is the word the SITE posts. Renaming it moves nothing — the site keeps
    // sending the old word, it matches no kind, and that kind's list is silently skipped
    // on every future enquiry. No error anywhere; the wrong people just stop being copied.
    const a = await createThrowawayArtist(svc, 'immutable slug')
    try {
      const { error } = await svc
        .from('enquiry_kinds')
        .update({ slug: 'bookings' })
        .eq('artist_id', a.id)
        .eq('slug', 'booking')

      expect(error?.code).toBe('23514')
      // A denied UPDATE can return error: null with zero rows matched, so the row STATE is
      // the evidence, not the return value (AGENTS.md rule 3).
      const { data } = await svc
        .from('enquiry_kinds')
        .select('slug')
        .eq('artist_id', a.id)
        .eq('slug', 'booking')
      expect(data).toHaveLength(1)
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses to delete the fallback kind', async () => {
    // 'other' is named literally by coercePurpose and submit_enquiry, so it receives every
    // malformed and unrecognised purpose. Deleting it cascades its recipients away.
    const a = await createThrowawayArtist(svc, 'undeletable fallback')
    try {
      const { error } = await svc
        .from('enquiry_kinds')
        .delete()
        .eq('artist_id', a.id)
        .eq('slug', 'other')

      expect(error?.code).toBe('23514')
      const { data } = await svc
        .from('enquiry_kinds')
        .select('id')
        .eq('artist_id', a.id)
        .eq('slug', 'other')
      expect(data).toHaveLength(1)
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('allows deleting a kind the artist invented', async () => {
    // They made it, its slug is hardcoded nowhere, and its recipients cascade as they should.
    const a = await createThrowawayArtist(svc, 'delete custom kind')
    try {
      await svc.from('enquiry_kinds').insert({ artist_id: a.id, slug: 'press', label: 'Press' })

      const { error } = await svc
        .from('enquiry_kinds')
        .delete()
        .eq('artist_id', a.id)
        .eq('slug', 'press')

      expect(error).toBeNull()
      const { data } = await svc.from('enquiry_kinds').select('id').eq('artist_id', a.id).eq('slug', 'press')
      expect(data).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('still lets the ARTIST be deleted, cascading its kinds', async () => {
    // The guard is BEFORE DELETE on enquiry_kinds and 'other' is undeletable — so without
    // the pg_trigger_depth() condition, the cascade from `artists` would raise and no
    // artist could ever be removed. Every other test in this file tears down that way, so
    // this pins the reason they can.
    const a = await createThrowawayArtist(svc, 'artist cascade past guard')
    try {
      await deleteThrowawayArtist(svc, a)
      const { data } = await svc.from('enquiry_kinds').select('id').eq('artist_id', a.id)
      expect(data).toEqual([])
    } finally {
      // The delete IS the assertion here, so a failure before it would leak the artist.
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses the same slug twice for one artist', async () => {
    const a = await createThrowawayArtist(svc, 'dup slug')
    try {
      const { error } = await svc
        .from('enquiry_kinds')
        .insert({ artist_id: a.id, slug: 'booking', label: 'Booking again' })

      expect(error?.code).toBe('23505')
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })
})

describe('resolve_enquiry_recipients — the old fallback routes NOTHING (20261002210000)', () => {
  it('CRITICAL: booking_email, the booking link and site text reach nobody — a kind with no list resolves NOBODY', async () => {
    // Before 20261002210000 every kind resolved OPS_TO here (rung 1), for Booking, Demo and
    // Contact alike: one address receiving everything, which is what Sam asked to end.
    const a = await createThrowawayArtist(svc, 'old rungs only')
    try {
      await giveOldRungs(a.id)

      expect(await resolve(a.id, 'booking')).toEqual([])
      expect(await resolve(a.id, 'demo')).toEqual([])
      expect(await resolve(a.id, 'other')).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('CRITICAL: with all three set, a kind reaches EXACTLY its own list — nothing is put in front of it', async () => {
    const a = await createThrowawayArtist(svc, 'old rungs plus list')
    try {
      await giveOldRungs(a.id)
      await addRecipient(a.id, 'booking', MANAGER_TO, 'Manager', '2026-01-01T00:00:00Z')

      expect(await resolve(a.id, 'booking')).toEqual([
        { to_email: MANAGER_TO, recipient_source: 'recipient_list', is_primary: true, ordinal: 1 },
      ])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })
})

describe('resolve_enquiry_recipients — a kind reaches its own list, and only its own', () => {
  it('CRITICAL: the list, in the order each was added; the first-added is the primary', async () => {
    // The ORDINAL is the contract: submit_enquiry aggregates `to_emails` with `order by
    // ordinal` and takes the one `is_primary` row as `to_email`.
    const a = await createThrowawayArtist(svc, 'list alone')
    try {
      await addRecipient(a.id, 'booking', MANAGER_TO, 'Manager', '2026-01-01T00:00:00Z')
      await addRecipient(a.id, 'booking', ARTIST_TO, 'Artist', '2026-01-02T00:00:00Z')

      expect(await resolve(a.id, 'booking')).toEqual([
        { to_email: MANAGER_TO, recipient_source: 'recipient_list', is_primary: true, ordinal: 1 },
        { to_email: ARTIST_TO, recipient_source: 'recipient_list', is_primary: false, ordinal: 2 },
      ])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('CRITICAL: keeps each kind\'s list to itself, and an empty kind reaches nobody', async () => {
    // RULE 2. Both lists exist at once; each resolution must see only its own.
    const a = await createThrowawayArtist(svc, 'per kind')
    try {
      await addRecipient(a.id, 'booking', MANAGER_TO, 'Manager')
      await addRecipient(a.id, 'demo', ARTIST_TO, 'Artist')

      expect((await resolve(a.id, 'booking')).map((r) => r.to_email)).toEqual([MANAGER_TO])
      expect((await resolve(a.id, 'demo')).map((r) => r.to_email)).toEqual([ARTIST_TO])
      expect(await resolve(a.id, 'other')).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('routes an artist-invented kind to its own list', async () => {
    const a = await createThrowawayArtist(svc, 'custom routing')
    try {
      await svc.from('enquiry_kinds').insert({ artist_id: a.id, slug: 'press', label: 'Press' })
      await addRecipient(a.id, 'press', 'publicist@example.com', 'Publicist')
      await addRecipient(a.id, 'booking', MANAGER_TO)

      expect((await resolve(a.id, 'press')).map((r) => r.to_email)).toEqual(['publicist@example.com'])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('an UNKNOWN kind reaches nobody, never another kind\'s list', async () => {
    // submit_enquiry files an unknown purpose under `other` before it ever gets here; this is
    // the resolver's own floor. Falling back to a neighbouring list would route a press
    // enquiry to the demo pile.
    const a = await createThrowawayArtist(svc, 'unknown kind')
    try {
      await addRecipient(a.id, 'booking', MANAGER_TO)
      await addRecipient(a.id, 'demo', ARTIST_TO)

      expect(await resolve(a.id, 'nonexistent-kind')).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('returns exactly one primary, always', async () => {
    // The caller takes the single is_primary row as `enquiries.to_email`. Two would make that
    // read non-deterministic; zero would make a routable kind look unroutable.
    const a = await createThrowawayArtist(svc, 'one primary')
    try {
      await addRecipient(a.id, 'booking', MANAGER_TO)
      await addRecipient(a.id, 'booking', ARTIST_TO)
      await addRecipient(a.id, 'booking', 'third@example.com')

      const rows = await resolve(a.id, 'booking')

      expect(rows.filter((r) => r.is_primary)).toHaveLength(1)
      expect(rows).toHaveLength(3)
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })
})

describe('enquiry_recipients — the table itself', () => {
  it('allows the same person on two different kinds', async () => {
    // The unique index is scoped to the KIND on purpose: one person may well want both
    // booking and demo. Scoping it to the artist would have refused this silently.
    const a = await createThrowawayArtist(svc, 'same person two kinds')
    try {
      await addRecipient(a.id, 'booking', MANAGER_TO)
      const { error } = await svc.from('enquiry_recipients').insert({
        artist_id: a.id,
        kind_id: await kindId(a.id, 'demo'),
        email: MANAGER_TO,
      })

      expect(error).toBeNull()
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses a second copy of an address on the SAME kind, whatever its case', async () => {
    const a = await createThrowawayArtist(svc, 'unique index')
    try {
      await addRecipient(a.id, 'booking', MANAGER_TO)

      const { error } = await svc.from('enquiry_recipients').insert({
        artist_id: a.id,
        kind_id: await kindId(a.id, 'booking'),
        email: MANAGER_TO.toUpperCase(),
      })

      // 23505 unique_violation. The index is on lower(email), so this is the CASE rule
      // being enforced, not merely an exact-match one.
      expect(error?.code).toBe('23505')
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('refuses a value that is not an address', async () => {
    const a = await createThrowawayArtist(svc, 'email check')
    try {
      const { error } = await svc.from('enquiry_recipients').insert({
        artist_id: a.id,
        kind_id: await kindId(a.id, 'booking'),
        email: 'not-an-address',
      })

      // 23514 check_violation. A bad recipient stored here would be addressed on every
      // future enquiry of that kind and would fail the whole send for the good ones too.
      expect(error?.code).toBe('23514')
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it("cannot be attached to ANOTHER artist's kind", async () => {
    // The composite FK, which is why enquiry_kinds carries a redundant-looking unique(id,
    // artist_id). Without it this insert succeeds: kind_id resolves, artist_id is the
    // caller's own, and the RLS policy — which reads artist_id — sees nothing wrong. The
    // row would then route artistB's kind to a list artistA controls.
    const { error } = await svc.from('enquiry_recipients').insert({
      artist_id: artistA.id,
      kind_id: await kindId(artistB.id, 'booking'),
      email: `smuggled-${crypto.randomUUID()}@example.com`,
    })

    // 23503 foreign_key_violation.
    expect(error?.code).toBe('23503')
  })

  it('caps a kind at ten addresses', async () => {
    // MAIL AMPLIFICATION, not tidiness. Submitting an enquiry is public and anonymous, the
    // per-artist flood cap allows 30 an hour, and the list length is the multiplier on every
    // one of them — all leaving a sending domain shared by every artist. Ten is far above
    // any real answer and far below anything that could get that domain blocklisted.
    const a = await createThrowawayArtist(svc, 'recipient cap')
    try {
      for (let i = 0; i < 10; i++) await addRecipient(a.id, 'booking', `cap-${i}@example.com`)

      const { error } = await svc.from('enquiry_recipients').insert({
        artist_id: a.id,
        kind_id: await kindId(a.id, 'booking'),
        email: 'one-too-many@example.com',
      })

      expect(error?.code).toBe('23514')
      const { data } = await svc.from('enquiry_recipients').select('id').eq('artist_id', a.id)
      expect(data).toHaveLength(10)
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('counts the cap PER KIND, not per artist', async () => {
    // Ten booking recipients must not exhaust the demo list. Counting per artist would be
    // the easy mistake and would look identical until someone hit it.
    const a = await createThrowawayArtist(svc, 'cap per kind')
    try {
      for (let i = 0; i < 10; i++) await addRecipient(a.id, 'booking', `b-${i}@example.com`)

      const { error } = await svc.from('enquiry_recipients').insert({
        artist_id: a.id,
        kind_id: await kindId(a.id, 'demo'),
        email: 'demo-list@example.com',
      })

      expect(error).toBeNull()
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('lets an existing row be edited without counting itself', async () => {
    // The cap trigger fires on UPDATE too (moving a row onto a full kind is the same
    // overflow). Excluding new.id is what keeps a full list from freezing in place.
    const a = await createThrowawayArtist(svc, 'cap update')
    try {
      const ids: string[] = []
      for (let i = 0; i < 10; i++) ids.push(await addRecipient(a.id, 'booking', `u-${i}@example.com`))

      const { error } = await svc
        .from('enquiry_recipients')
        .update({ label: 'Renamed' })
        .eq('id', ids[0])

      expect(error).toBeNull()
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('goes with its kind', async () => {
    const a = await createThrowawayArtist(svc, 'kind cascade')
    try {
      const id = await addRecipient(a.id, 'demo', ARTIST_TO)
      await svc.from('enquiry_kinds').delete().eq('artist_id', a.id).eq('slug', 'demo')

      const { data } = await svc.from('enquiry_recipients').select('id').eq('id', id)
      expect(data).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('goes with the artist', async () => {
    const a = await createThrowawayArtist(svc, 'artist cascade')
    try {
      const id = await addRecipient(a.id, 'booking', MANAGER_TO)
      await deleteThrowawayArtist(svc, a)
      const { data } = await svc.from('enquiry_recipients').select('id').eq('id', id)
      expect(data).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })
})

describe('isolation — who can see and change kinds and lists', () => {
  it('anon cannot read the list', async () => {
    // PLANTED WITNESS (AGENTS.md rule 2): prove the row EXISTS as service_role first, or
    // "anon read nothing" is true of an empty table and pins nothing at all.
    const id = await addRecipient(artistA.id, 'booking', `witness-${crypto.randomUUID()}@example.com`)
    const { data: planted } = await svc.from('enquiry_recipients').select('id').eq('id', id)
    expect(planted).toHaveLength(1)

    const { data } = await anonClient().from('enquiry_recipients').select('id').eq('id', id)

    expect(data).toEqual([])
  })

  it('anon cannot read the kinds', async () => {
    const { data: planted } = await svc.from('enquiry_kinds').select('id').eq('artist_id', artistA.id)
    expect(planted!.length).toBeGreaterThan(0)

    const { data } = await anonClient().from('enquiry_kinds').select('id').eq('artist_id', artistA.id)

    expect(data).toEqual([])
  })

  it("a manager cannot read another artist's list", async () => {
    const id = await addRecipient(artistB.id, 'booking', `b-only-${crypto.randomUUID()}@example.com`)
    const { data: planted } = await svc.from('enquiry_recipients').select('id').eq('id', id)
    expect(planted).toHaveLength(1)

    const { data: toA } = await asA.from('enquiry_recipients').select('id').eq('id', id)
    const { data: toB } = await asB.from('enquiry_recipients').select('id').eq('id', id)

    expect(toA).toEqual([])
    expect(toB).toHaveLength(1)
  })

  it('a manager reads and writes their OWN list', async () => {
    const email = `own-${crypto.randomUUID()}@example.com`

    const { error } = await asA.from('enquiry_recipients').insert({
      artist_id: artistA.id,
      kind_id: await kindId(artistA.id, 'booking'),
      email,
    })
    expect(error).toBeNull()

    // Asserted via the SERVICE client: a row-filtered write returns error: null with zero
    // rows matched, so the return value is not evidence (AGENTS.md rule 3).
    const { data } = await svc.from('enquiry_recipients').select('id').eq('email', email)
    expect(data).toHaveLength(1)
  })

  it('a manager renames their own kind', async () => {
    await asA.from('enquiry_kinds').update({ label: 'Bookings & shows' })
      .eq('artist_id', artistA.id).eq('slug', 'booking')

    const { data } = await svc
      .from('enquiry_kinds')
      .select('label')
      .eq('artist_id', artistA.id)
      .eq('slug', 'booking')
      .single()
    expect((data as { label: string }).label).toBe('Bookings & shows')
  })

  it("a manager cannot rename another artist's kind", async () => {
    // A denied UPDATE under RLS returns error: null and zero rows matched. Only the row's
    // STATE afterwards is evidence.
    await asA.from('enquiry_kinds').update({ label: 'Hijacked' })
      .eq('artist_id', artistB.id).eq('slug', 'booking')

    const { data } = await svc
      .from('enquiry_kinds')
      .select('label')
      .eq('artist_id', artistB.id)
      .eq('slug', 'booking')
      .single()
    expect((data as { label: string }).label).toBe('Booking')
  })

  it("a manager cannot add a recipient to another artist", async () => {
    const email = `cross-${crypto.randomUUID()}@example.com`

    const { error } = await asA.from('enquiry_recipients').insert({
      artist_id: artistB.id,
      kind_id: await kindId(artistB.id, 'booking'),
      email,
    })

    expectRlsDenied(error, 'cross-tenant recipient insert')
    const { data } = await svc.from('enquiry_recipients').select('id').eq('email', email)
    expect(data).toEqual([])
  })

  it("a manager cannot delete another artist's recipient", async () => {
    const id = await addRecipient(artistB.id, 'booking', `b-keep-${crypto.randomUUID()}@example.com`)

    await asA.from('enquiry_recipients').delete().eq('id', id)

    const { data } = await svc.from('enquiry_recipients').select('id').eq('id', id)
    expect(data).toHaveLength(1)
  })

  it('anon cannot insert a recipient', async () => {
    const email = `anon-${crypto.randomUUID()}@example.com`

    const { error } = await anonClient().from('enquiry_recipients').insert({
      artist_id: artistA.id,
      kind_id: await kindId(artistA.id, 'booking'),
      email,
    })

    expectRlsDenied(error, 'anon recipient insert')
    const { data } = await svc.from('enquiry_recipients').select('id').eq('email', email)
    expect(data).toEqual([])
  })

  it('anon cannot execute resolve_enquiry_recipients', async () => {
    // Recipient resolution is server-side precisely so routing never leaves. The named
    // assertion refuses PGRST202 ("no such function") as proof that a door is shut.
    const { error } = await anonClient().rpc('resolve_enquiry_recipients', {
      p_artist_id: artistA.id,
      p_purpose: 'booking',
    })

    expectExecuteDenied(error, 'resolve_enquiry_recipients')
  })

  it('a signed-in manager cannot execute it either', async () => {
    const { error } = await asA.rpc('resolve_enquiry_recipients', {
      p_artist_id: artistA.id,
      p_purpose: 'booking',
    })

    expectExecuteDenied(error, 'resolve_enquiry_recipients')
  })
})

describe('set_enquiry_recipients — one transaction, or nothing', () => {
  /** The RPC as a MANAGER: it checks ownership itself, so service_role (no JWT role) is
   *  refused — the app only ever calls it as the signed-in manager. */
  const setList = (client: SupabaseClient, artistId: string, kind: string, list: { email: string; label?: string | null }[]) =>
    kindId(artistId, kind).then((kid) =>
      client.rpc('set_enquiry_recipients', { p_artist_id: artistId, p_kind_id: kid, p_recipients: list }),
    )
  const emails = async (artistId: string, kind: string) => {
    const { data } = await svc
      .from('enquiry_recipients')
      .select('email')
      .eq('kind_id', await kindId(artistId, kind))
      .order('created_at')
    return (data ?? []).map((r) => (r as { email: string }).email)
  }

  it('replaces the list, and returns it as stored', async () => {
    await addRecipient(artistA.id, 'demo', 'gone@example.com')

    const { data, error } = await setList(asA, artistA.id, 'demo', [
      { email: 'skeen@example.com', label: 'Skeen' },
      { email: 'mgr@example.com', label: null },
    ])

    expect(error).toBeNull()
    expect((data as { email: string }[]).map((r) => r.email)).toEqual(['skeen@example.com', 'mgr@example.com'])
    expect(await emails(artistA.id, 'demo')).toEqual(['skeen@example.com', 'mgr@example.com'])
  })

  it('leaves the OLD list untouched when the new one is refused by the cap', async () => {
    // THE BUG. Two PostgREST calls (delete, then insert) meant the 11th address failed
    // AFTER the delete had committed: the list was empty, the dashboard showed the old
    // chips, and every enquiry of that kind went to the primary alone. One function body
    // means the trigger's raise unwinds the delete too. This test was RED against the
    // two-call version.
    const a = await createThrowawayArtist(svc, 'atomic cap', asA)
    try {
      const ten = Array.from({ length: 10 }, (_, i) => ({ email: `keep${i}@example.com`, label: null }))
      const { error: seedErr } = await setList(asA, a.id, 'booking', ten)
      expect(seedErr).toBeNull()
      expect(await emails(a.id, 'booking')).toHaveLength(10)

      const { error } = await setList(asA, a.id, 'booking', [...ten, { email: 'eleventh@example.com', label: null }])

      expect(error?.code).toBe('23514')
      expect(await emails(a.id, 'booking')).toHaveLength(10)
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('leaves the OLD list untouched when one new address is malformed', async () => {
    const a = await createThrowawayArtist(svc, 'atomic shape', asA)
    try {
      await setList(asA, a.id, 'booking', [{ email: 'good@example.com', label: 'Good' }])

      const { error } = await setList(asA, a.id, 'booking', [
        { email: 'good@example.com', label: 'Good' },
        { email: 'not-an-address', label: null },
      ])

      expect(error?.code).toBe('23514')
      expect(await emails(a.id, 'booking')).toEqual(['good@example.com'])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('drops blank entries rather than failing on them', async () => {
    const a = await createThrowawayArtist(svc, 'blank entries', asA)
    try {
      const { error } = await setList(asA, a.id, 'booking', [{ email: '  ' }, { email: 'one@example.com' }, { email: '' }])
      expect(error).toBeNull()
      expect(await emails(a.id, 'booking')).toEqual(['one@example.com'])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it("refuses another artist's kind, and touches nothing", async () => {
    // Planted witness: B's list exists before A tries to overwrite it.
    await addRecipient(artistB.id, 'demo', 'b-witness@example.com')
    expect(await emails(artistB.id, 'demo')).toContain('b-witness@example.com')

    const { error } = await setList(asA, artistB.id, 'demo', [{ email: 'hijack@example.com' }])

    expectRlsDenied(error, 'cross-tenant set_enquiry_recipients')
    expect(await emails(artistB.id, 'demo')).toContain('b-witness@example.com')
    expect(await emails(artistB.id, 'demo')).not.toContain('hijack@example.com')
  })

  it('refuses a kind_id that belongs to B even when artist_id says A', async () => {
    // The two ids disagree; the body's second check catches it before any write.
    const kidB = await kindId(artistB.id, 'booking')
    const { error } = await asA.rpc('set_enquiry_recipients', {
      p_artist_id: artistA.id,
      p_kind_id: kidB,
      p_recipients: [{ email: 'smuggle@example.com' }],
    })
    expectRlsDenied(error, 'mismatched kind/artist')
  })

  it('anon cannot execute it', async () => {
    const { error } = await anonClient().rpc('set_enquiry_recipients', {
      p_artist_id: artistA.id,
      p_kind_id: await kindId(artistA.id, 'booking'),
      p_recipients: [],
    })
    expectExecuteDenied(error, 'set_enquiry_recipients')
  })
  it('two saves at once end as ONE of the two lists, never a merge', async () => {
    // Review 2026-09-23. The per-kind lock was only taken by the cap trigger, i.e. AFTER
    // the DELETE: a second save's DELETE ran on a snapshot that could not see the first
    // save's inserts, kept them, and the kind ended as [X, Y], both removals lost. The
    // race needs the two requests to overlap, so this fires several rounds; see the
    // migration 20260923120000 for the RED run against the lock-less version.
    const a = await createThrowawayArtist(svc, 'concurrent set', asA)
    try {
      const merged: string[][] = []
      for (let round = 0; round < 20; round++) {
        await setList(asA, a.id, 'booking', [{ email: `old${round}@example.com` }])
        const x = [{ email: `x${round}@example.com` }]
        const y = [{ email: `y${round}@example.com` }]
        const [rx, ry] = await Promise.all([setList(asA, a.id, 'booking', x), setList(asA, a.id, 'booking', y)])
        expect(rx.error).toBeNull()
        expect(ry.error).toBeNull()
        const got = await emails(a.id, 'booking')
        if (got.length !== 1) merged.push(got)
      }
      expect(merged).toEqual([])
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })
})


describe('gaps the 2026-09-22 review named', () => {
  it('the cap also refuses MOVING a row onto a full kind', async () => {
    // BEFORE INSERT OR UPDATE: only the self-exclusion half was tested, which passes
    // trivially if the trigger were insert-only.
    const a = await createThrowawayArtist(svc, 'cap on move')
    try {
      for (let i = 0; i < 10; i++) await addRecipient(a.id, 'booking', `full${i}@example.com`)
      const demoRow = await addRecipient(a.id, 'demo', 'mover@example.com')

      const { error } = await svc
        .from('enquiry_recipients')
        .update({ kind_id: await kindId(a.id, 'booking') })
        .eq('id', demoRow)

      expect(error?.code).toBe('23514')
      const { data } = await svc.from('enquiry_recipients').select('kind_id').eq('id', demoRow).single()
      expect((data as { kind_id: string }).kind_id).toBe(await kindId(a.id, 'demo'))
    } finally {
      await deleteThrowawayArtist(svc, a)
    }
  })

  it('a manager cannot INSERT a kind for another artist', async () => {
    // Drop the `with check` clause on enquiry_kinds_write and nothing else here fails.
    const { error } = await asA.from('enquiry_kinds').insert({ artist_id: artistB.id, slug: 'smuggled', label: 'X' })

    expectRlsDenied(error, 'cross-tenant kind insert')
    const { data } = await svc.from('enquiry_kinds').select('id').eq('artist_id', artistB.id).eq('slug', 'smuggled')
    expect(data).toEqual([])
  })

  it('the backfill gave the seed artists their three kinds', async () => {
    // The trigger test uses throwaways created AFTER the migration. This pins that the
    // one-off backfill ran, and that nobody has since deleted them.
    const id = await artistIdBySlug(SEED.artistASlug)
    const { data } = await svc.from('enquiry_kinds').select('slug').eq('artist_id', id).order('sort_order')
    expect((data ?? []).map((k) => (k as { slug: string }).slug)).toEqual(['booking', 'demo', 'other'])
  })
})
