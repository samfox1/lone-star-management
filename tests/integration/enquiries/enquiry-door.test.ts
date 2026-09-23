// The privileged door behind the contact form: recipients, validation, and rate limiting.
/**
 * submit_enquiry — the privileged door behind the /contact Edge Function.
 *
 * Exercised as service_role, which is how the Edge Function calls it. The anon and
 * cross-tenant boundaries live in enquiries.isolation.test.ts.
 *
 * LIVE-DB HAZARD, PLEASE KEEP: the rate-limit windows are one hour and one day, and
 * this suite runs against the REAL hosted project. A hardcoded test ip_hash would
 * poison every rerun for 24 hours — the suite would pass once and then fail all day
 * for reasons nobody would connect back to here. Every test therefore mints a FRESH
 * random ip_hash via freshIp() and afterAll sweeps them.
 *
 * TENANCY, AND WHY THE ARTIST IS A THROWAWAY. This file used to run on the shared seed
 * artist `lone-pine`, and its `clearRungs()` — called at the top of more than twenty
 * tests — deleted that artist's booking link, its `site_content.booking_email` row and
 * its WHOLE `artist_mail_settings` row. None of those were created here. The mail-settings
 * row is the very one `booking-email-door.test.ts` snapshots and restores, so this file
 * was quietly destroying another suite's premise (and any real booking address a human
 * had set) twenty times a run. A second teardown, `resetArtistWindow()`, deleted every
 * enquiry filed for lone-pine in the last hour — again including rows it never wrote.
 *
 * Those deletes also made assertions true for the wrong reason: "five invalid attempts
 * created no enquiries" counts rows for the artist and expects 0, which is a statement
 * about an EMPTY table, and the table was empty only because the teardown kept emptying
 * it. The per-artist flood cap has the same shape from the other side — it counts up to
 * 30 rows in an hour, so a second run inside the hour would have measured leftovers from
 * the first.
 *
 * The artist is now created by this file and dropped by it. "Delete every rung / every
 * enquiry for this artist" IS "delete exactly what I created", the counts below are true
 * about a genuinely empty table, and the random slug is what lets the flood-cap test run
 * twice in a row. The global `mail_settings` singleton is NOT per-artist, so it keeps its
 * save-then-restore treatment.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { serviceClient } from '@tests/helpers/supabase'
import { createThrowawayArtist, deleteThrowawayArtist, type ThrowawayArtist } from '@tests/helpers/artist'

const svc = serviceClient()

let artist: ThrowawayArtist
/** Shorthand for the many `.eq('artist_id', …)` calls below. */
let artistA: string

/** Every ip_hash this file has used, so cleanup is exact. */
const usedIps: string[] = []
function freshIp(): string {
  const ip = `test-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
  usedIps.push(ip)
  return ip
}

/**
 * The mail_settings singleton this suite found on arrival, so afterAll can put it back
 * exactly as it was. The precedence tests assert on a KNOWN default address, so this
 * file has to own the singleton's value while it runs — but it is real infrastructure
 * config, and clobbering it permanently would silently repoint every unrouted enquiry.
 * null means there was no row and afterAll should delete ours.
 */
type MailSettings = {
  default_to_email: string
  sending_domain: string
  from_local_part: string
}
let priorMailSettings: MailSettings | null = null

const DEFAULT_TO = 'fallback-desk@example.com'
const OPS_TO = 'ops-override@example.com'
const LINK_TO = 'booking-link@example.com'
const CONTENT_TO = 'booking-content@example.com'

type DoorRow = {
  status: string
  enquiry_id: string | null
  to_email: string | null
  /** Everyone addressed: the primary first, then enquiry_recipients. */
  to_emails: string[] | null
  from_name: string | null
  from_email: string | null
  artist_name: string | null
  recipient_source: string | null
  /** The artist's own label for this kind, for the email subject's `[Booking]` prefix. */
  purpose_label: string | null
}

async function submit(over: Partial<Record<string, string>> = {}): Promise<DoorRow> {
  const { data, error } = await svc.rpc('submit_enquiry', {
    p_slug: artist.slug,
    p_purpose: 'booking',
    p_name: 'Jane Promoter',
    p_email: 'jane@venue.example',
    p_message: 'Would love to book you for a show in March.',
    p_ip_hash: freshIp(),
    ...over,
  })
  if (error) throw new Error(`submit_enquiry failed: ${error.message}`)
  return (data as DoorRow[])[0]
}

/**
 * Strip every rung so each precedence test starts from a known floor.
 *
 * A blanket per-artist delete, which is safe ONLY because this file created the artist:
 * no other suite and no human has a row under it. On the seed artist this same code was
 * destroying the booking address `booking-email-door.test.ts` had snapshotted.
 */
async function clearRungs() {
  await svc.from('artist_mail_settings').delete().eq('artist_id', artistA)
  await svc.from('links').delete().eq('artist_id', artistA).eq('role', 'booking')
  await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', 'booking_email')
  // The lists are not rungs, but they change `to_emails`, so the precedence assertions
  // above are only about rungs if these start empty. The KINDS are left alone: they were
  // seeded by the trigger when this file created the artist, and every test below looks
  // one up by slug.
  await svc.from('enquiry_recipients').delete().eq('artist_id', artistA)
}

beforeAll(async () => {
  artist = await createThrowawayArtist(svc, 'Enquiry door')
  artistA = artist.id

  // Take ownership of the singleton for the duration of this file, remembering what
  // was there so afterAll restores it. Upserting unconditionally (rather than "seed
  // only if absent") is what makes the precedence assertions deterministic no matter
  // what ran before us.
  const { data: existing } = await svc
    .from('mail_settings')
    .select('default_to_email, sending_domain, from_local_part')
    .maybeSingle()
  priorMailSettings = (existing as MailSettings | null) ?? null

  const { error } = await svc.from('mail_settings').upsert({
    id: true,
    default_to_email: DEFAULT_TO,
    sending_domain: 'mail.example.com',
    from_local_part: 'noreply',
  })
  if (error) throw new Error(`mail_settings seed failed: ${error.message}`)

  await clearRungs()
})

/**
 * Reset the PER-ARTIST rate-limit window before every test.
 *
 * The per-IP counter is neutralised by freshIp(), but the per-artist cap (30/hour) is a
 * counter over `enquiries`, and this file files well over thirty of them — so without a
 * reset the later tests would trip the ARTIST cap and report `rate_limited` from a test
 * asserting `ok`.
 *
 * On the seed artist this was a delete of rows the file had not written (the last hour's
 * traffic for lone-pine, whoever filed it). On a throwaway artist every enquiry under it
 * is ours by construction, so no time filter is needed and nothing else can be caught.
 */
async function resetArtistWindow() {
  await svc.from('enquiries').delete().eq('artist_id', artistA)
}

beforeEach(resetArtistWindow)
afterEach(resetArtistWindow)

afterAll(async () => {
  // Dropping the artist cascades its enquiries, links, site_content and mail settings —
  // one statement that cannot miss a table someone adds later. `contact_attempts` is the
  // exception: its artist_id is `on delete set null`, so the ledger rows survive and are
  // swept by the ip_hashes this file minted.
  await deleteThrowawayArtist(svc, artist)
  if (usedIps.length) await svc.from('contact_attempts').delete().in('ip_hash', usedIps)
  if (priorMailSettings) {
    await svc.from('mail_settings').upsert({ id: true, ...priorMailSettings })
  } else {
    await svc.from('mail_settings').delete().eq('id', true)
  }
})

describe('submit_enquiry — recipient precedence', () => {
  it('rung 4: falls back to the configured default when nothing else is set', async () => {
    await clearRungs()
    const row = await submit()
    expect(row).toMatchObject({ status: 'ok', recipient_source: 'default', to_email: DEFAULT_TO })
  })

  it('rung 3: site_content.booking_email beats the default', async () => {
    await clearRungs()
    await svc.from('site_content').insert({ artist_id: artistA, key: 'booking_email', value: CONTENT_TO })
    const row = await submit()
    expect(row).toMatchObject({ status: 'ok', recipient_source: 'site_content', to_email: CONTENT_TO })
  })

  it('rung 2: the booking link beats site_content, and a mailto: prefix is stripped', async () => {
    await clearRungs()
    await svc.from('site_content').insert({ artist_id: artistA, key: 'booking_email', value: CONTENT_TO })
    await svc.from('links').insert({
      artist_id: artistA,
      role: 'booking',
      label: 'Bookings',
      url: `mailto:${LINK_TO}?subject=Booking%20enquiry`,
    })
    const row = await submit()
    expect(row).toMatchObject({ status: 'ok', recipient_source: 'link', to_email: LINK_TO })
  })

  it('rung 1: the ops override beats everything', async () => {
    await clearRungs()
    await svc.from('site_content').insert({ artist_id: artistA, key: 'booking_email', value: CONTENT_TO })
    await svc.from('links').insert({ artist_id: artistA, role: 'booking', label: 'Bookings', url: `mailto:${LINK_TO}` })
    await svc.from('artist_mail_settings').insert({ artist_id: artistA, booking_email: OPS_TO })
    const row = await submit()
    expect(row).toMatchObject({ status: 'ok', recipient_source: 'mail_settings', to_email: OPS_TO })
  })

  it('a booking link holding an https page URL FALLS THROUGH instead of being emailed', async () => {
    await clearRungs()
    await svc.from('site_content').insert({ artist_id: artistA, key: 'booking_email', value: CONTENT_TO })
    await svc.from('links').insert({
      artist_id: artistA,
      role: 'booking',
      label: 'Bookings',
      url: 'https://example.com/booking-form',
    })
    const row = await submit()
    expect(row).toMatchObject({ status: 'ok', recipient_source: 'site_content', to_email: CONTENT_TO })
  })
})

describe('submit_enquiry — sender identity', () => {
  it('derives "<Artist> Site" from the artist record by default', async () => {
    await clearRungs()
    const row = await submit()
    expect(row.from_name).toMatch(/ Site$/)
    expect(row.from_email).toBe('noreply@mail.example.com')
  })

  it('honours a per-artist from_name override', async () => {
    await clearRungs()
    await svc.from('artist_mail_settings').insert({ artist_id: artistA, from_name: 'Lone Pine Bookings' })
    const row = await submit()
    expect(row.from_name).toBe('Lone Pine Bookings')
  })

  it('rejects CR/LF in from_name at the storage layer (header injection)', async () => {
    await clearRungs()
    const { error } = await svc
      .from('artist_mail_settings')
      .insert({ artist_id: artistA, from_name: 'Evil\r\nBcc: victim@example.com' })
    // 23514 (CHECK violation), not just "an error": anything else — a permission
    // failure, a typo'd table — would also be non-null and prove nothing about the
    // header-injection guard this test is named for.
    expect(error?.code).toBe('23514')
  })
})

describe('submit_enquiry — validation', () => {
  it('an unknown slug is reported, not raised', async () => {
    const row = await submit({ p_slug: 'no-such-artist-xyz' })
    expect(row.status).toBe('unknown_artist')
    expect(row.to_email).toBeNull()
  })

  it('a message over 5000 chars is invalid', async () => {
    await clearRungs()
    const row = await submit({ p_message: 'x'.repeat(5001) })
    expect(row.status).toBe('invalid')
  })

  it('a message of exactly 5000 chars is accepted', async () => {
    await clearRungs()
    const row = await submit({ p_message: 'x'.repeat(5000) })
    expect(row.status).toBe('ok')
  })

  it('a malformed visitor email is invalid', async () => {
    await clearRungs()
    expect((await submit({ p_email: 'not-an-email' })).status).toBe('invalid')
  })

  it('a blank name is invalid', async () => {
    await clearRungs()
    expect((await submit({ p_name: '   ' })).status).toBe('invalid')
  })

  it('a well-formed purpose that names one of the ARTIST\'S kinds is kept, with its label', async () => {
    // Kinds are the artist's to invent, and the kinds table is the registry: adding one is
    // a row, not a deploy, so the door keeps any slug the artist actually has.
    await clearRungs()
    await svc.from('enquiry_kinds').insert({ artist_id: artistA, slug: 'wedding-gig', label: 'Weddings' })
    try {
      const row = await submit({ p_purpose: 'wedding-gig' })

      expect(row.status).toBe('ok')
      expect(row.purpose_label).toBe('Weddings')
      const { data } = await svc.from('enquiries').select('purpose').eq('id', row.enquiry_id!).single()
      expect(data?.purpose).toBe('wedding-gig')
    } finally {
      await svc.from('enquiry_kinds').delete().eq('artist_id', artistA).eq('slug', 'wedding-gig')
    }
  })

  it('a well-formed purpose that names NO kind is filed under other, wearing its label', async () => {
    // CHANGED 2026-09-22 (security review). The 21st's version kept any well-formed slug
    // and fell back to initcap(slug) for the subject — so a VISITOR could put
    // `[Urgent Invoice Overdue]` on mail the manager trusts. Unknown means `other`.
    await clearRungs()
    const row = await submit({ p_purpose: 'urgent-invoice-overdue' })

    expect(row.status).toBe('ok')
    expect(row.purpose_label).toBe('Contact')
    const { data } = await svc.from('enquiries').select('purpose').eq('id', row.enquiry_id!).single()
    expect(data?.purpose).toBe('other')
  })

  it('purpose_label follows a RENAMED kind', async () => {
    // The one new value every manager reads, in every subject line. Nothing pinned it.
    await clearRungs()
    await svc.from('enquiry_kinds').update({ label: 'Bookings & shows' }).eq('artist_id', artistA).eq('slug', 'booking')
    try {
      const row = await submit({ p_purpose: 'booking' })
      expect(row.purpose_label).toBe('Bookings & shows')
    } finally {
      await svc.from('enquiry_kinds').update({ label: 'Booking' }).eq('artist_id', artistA).eq('slug', 'booking')
    }
  })

  it('purpose_label is returned on the UNROUTABLE path too', async () => {
    await clearRungs()
    const { data: prior } = await svc.from('mail_settings').select('default_to_email, sending_domain, from_local_part').maybeSingle()
    await svc.from('mail_settings').delete().eq('id', true)
    try {
      const row = await submit({ p_purpose: 'demo' })
      expect(row.status).toBe('no_recipient')
      expect(row.purpose_label).toBe('Demo')
    } finally {
      if (prior) await svc.from('mail_settings').upsert({ id: true, ...(prior as MailSettings) })
    }
  })

  it('a MALFORMED purpose is still coerced to other, never rejected', async () => {
    // Still coerces rather than rejects: a site shipping something odd must still deliver.
    // These are the shapes enquiries_purpose_check would refuse at the table, so without
    // the coercion submit_enquiry would RAISE — and it has a hard never-raise invariant,
    // because a raise rolls back its own contact_attempts ledger insert.
    for (const bad of ['Has Caps', 'has space', '-leading', 'x'.repeat(41)]) {
      await clearRungs()
      const row = await submit({ p_purpose: bad })

      expect(row.status, `purpose ${JSON.stringify(bad)}`).toBe('ok')
      const { data } = await svc.from('enquiries').select('purpose').eq('id', row.enquiry_id!).single()
      expect(data?.purpose, `purpose ${JSON.stringify(bad)}`).toBe('other')
    }
  })

  it('a purpose differing only in case routes to the SAME kind', async () => {
    // enquiry_kinds.slug is lowercase by its own CHECK, and routing compares by equality.
    // 'Booking' from a site would otherwise match no kind and silently skip its list.
    await clearRungs()
    const row = await submit({ p_purpose: '  BOOKING  ' })

    const { data } = await svc.from('enquiries').select('purpose').eq('id', row.enquiry_id!).single()
    expect(data?.purpose).toBe('booking')
  })

  it('an empty message is ACCEPTED — a demo can be a link and some audio', async () => {
    await clearRungs()
    // This rule flip-flopped three times on 2026-08-04: 20260804230000 dropped all
    // validation, 240000 restored message-required byte-for-byte, 260000 removed it
    // again on purpose. If a future "restore validation" migration copy-pastes 240000,
    // this is the test that catches it re-bouncing every one of skeen's demo
    // submissions with missing_field.
    const row = await submit({ p_message: '' })
    expect(row.status).toBe('ok')
    expect(row.enquiry_id).not.toBeNull()
  })

  it('reports no_recipient when no rung resolves and there is no default', async () => {
    await clearRungs()
    // The CHECK constraint forbids storing a non-address, so the only way to have
    // "no default" is to have no row. We restore it immediately after.
    await svc.from('mail_settings').delete().eq('id', true)
    const row = await submit()
    expect(row.status).toBe('no_recipient')
    // The enquiry is STILL STORED, as status='unroutable' — while mail is unconfigured
    // this row is the only copy of the message that exists. Reverting 20260804230000's
    // store-before-routing (returning early instead) would discard every real enquiry
    // and this status check alone would stay green.
    expect(row.enquiry_id).not.toBeNull()
    const { data: stored } = await svc
      .from('enquiries')
      .select('status')
      .eq('id', row.enquiry_id!)
      .single()
    expect(stored?.status).toBe('unroutable')
    await svc.from('mail_settings').insert({
      default_to_email: DEFAULT_TO,
      sending_domain: 'mail.example.com',
      from_local_part: 'noreply',
    })
  })
})

describe('submit_enquiry — rate limiting', () => {
  it('the 6th attempt in an hour from one IP is rate_limited AND still logged', async () => {
    await clearRungs()
    const ip = freshIp()

    for (let i = 0; i < 5; i++) {
      const row = await submit({ p_ip_hash: ip })
      expect(row.status).toBe('ok')
    }

    const { count: before } = await svc
      .from('contact_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ip)

    const sixth = await submit({ p_ip_hash: ip })
    expect(sixth.status).toBe('rate_limited')
    expect(sixth.to_email).toBeNull()

    // THE REGRESSION THIS FILE EXISTS FOR. If submit_enquiry is ever "cleaned up" to
    // `raise` on rejection, the raise rolls back its own ledger insert, this count
    // stays flat, and the limiter silently forgets every rejection it ever made —
    // handing an attacker over the cap infinite free retries.
    const { count: after } = await svc
      .from('contact_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ip)
    expect(after).toBe((before ?? 0) + 1)
  })

  it('rejected attempts count toward the window, so probing is not free', async () => {
    await clearRungs()
    const ip = freshIp()

    // Five INVALID attempts create no enquiries at all. The count below is an ABSOLUTE
    // zero over this artist's inbox — on the shared seed artist it read zero because the
    // teardown had just emptied the table, which is the same number for the wrong reason.
    for (let i = 0; i < 5; i++) {
      expect((await submit({ p_ip_hash: ip, p_email: 'nope' })).status).toBe('invalid')
    }
    const { count } = await svc
      .from('enquiries')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistA)
      .eq('email', 'jane@venue.example')
    expect(count).toBe(0)

    // ...but they have still burned the IP's hourly budget.
    expect((await submit({ p_ip_hash: ip })).status).toBe('rate_limited')
  })

  it('honeypot drops logged via log_contact_attempt also burn the budget', async () => {
    await clearRungs()
    const ip = freshIp()
    for (let i = 0; i < 5; i++) {
      const { error } = await svc.rpc('log_contact_attempt', {
        p_slug: artist.slug,
        p_purpose: 'booking',
        p_ip_hash: ip,
        p_outcome: 'honeypot',
      })
      expect(error).toBeNull()
    }
    expect((await submit({ p_ip_hash: ip })).status).toBe('rate_limited')
  })

  it('the 31st enquiry for one artist inside an hour is rate_limited even from a fresh IP', async () => {
    await clearRungs()
    // The botnet case the per-IP window cannot see: every request arrives from a new
    // address. The cap counts rows in `enquiries`, so seed the 30 stored enquiries
    // directly instead of submitting 30 times — same signal, without 30 round trips.
    //
    // This cap was silently DROPPED by the 20260804230000 rewrite and the omission
    // survived two further rewrites, because nothing tested it. The rule that had a
    // test (char_length) survived the same rewrites. That asymmetry is why this test
    // exists.
    const seed = Array.from({ length: 30 }, (_, i) => ({
      artist_id: artistA,
      purpose: 'booking',
      name: `Flood ${i}`,
      email: 'flood@example.com',
      message: 'flood',
      status: 'queued',
    }))
    const { error } = await svc.from('enquiries').insert(seed)
    expect(error).toBeNull()

    const ip = freshIp()
    const row = await submit({ p_ip_hash: ip })
    expect(row.status).toBe('rate_limited')
    expect(row.enquiry_id).toBeNull()

    // The rejection is logged like every other outcome — never raised, never forgotten.
    const { data: logged } = await svc
      .from('contact_attempts')
      .select('outcome')
      .eq('ip_hash', ip)
    expect(logged?.map((l) => l.outcome)).toEqual(['rate_limited'])
  })

  it('a different IP is unaffected by another IP hitting the cap', async () => {
    await clearRungs()
    const hot = freshIp()
    for (let i = 0; i < 5; i++) await submit({ p_ip_hash: hot })
    expect((await submit({ p_ip_hash: hot })).status).toBe('rate_limited')
    expect((await submit({ p_ip_hash: freshIp() })).status).toBe('ok')
  })
})

describe('mark_enquiry_sent', () => {
  it('flips queued → sent and stamps the provider id', async () => {
    await clearRungs()
    const row = await submit()
    expect(row.status).toBe('ok')

    const { error } = await svc.rpc('mark_enquiry_sent', {
      p_id: row.enquiry_id,
      p_ok: true,
      p_provider_id: 'resend-abc123',
    })
    expect(error).toBeNull()

    const { data } = await svc
      .from('enquiries')
      .select('status, sent_at, provider_message_id, send_error')
      .eq('id', row.enquiry_id!)
      .single()
    expect(data).toMatchObject({ status: 'sent', provider_message_id: 'resend-abc123', send_error: null })
    expect(data?.sent_at).not.toBeNull()
  })

  it('records a failure with its error, keeping the row for the manager', async () => {
    await clearRungs()
    const row = await submit()
    await svc.rpc('mark_enquiry_sent', {
      p_id: row.enquiry_id,
      p_ok: false,
      p_error: 'resend 429 rate limited',
    })
    const { data } = await svc
      .from('enquiries')
      .select('status, send_error, sent_at')
      .eq('id', row.enquiry_id!)
      .single()
    expect(data).toMatchObject({ status: 'failed', send_error: 'resend 429 rate limited', sent_at: null })
  })
})

describe('submit_enquiry — forwarding to more than one person', () => {
  /** The list for ONE KIND, on top of whichever rung resolved the primary. */
  async function addRecipient(slug: string, email: string, label?: string) {
    const { data: kind, error: e1 } = await svc
      .from('enquiry_kinds')
      .select('id')
      .eq('artist_id', artistA)
      .eq('slug', slug)
      .single()
    if (e1) throw new Error(`kind ${slug}: ${e1.message}`)
    const { error } = await svc.from('enquiry_recipients').insert({
      artist_id: artistA,
      kind_id: (kind as { id: string }).id,
      email,
      label: label ?? null,
    })
    if (error) throw new Error(`addRecipient(${slug}, ${email}): ${error.message}`)
  }

  async function storedRow(id: string) {
    const { data, error } = await svc
      .from('enquiries')
      .select('to_email, to_emails, recipient_source, status')
      .eq('id', id)
      .single()
    if (error) throw new Error(`read enquiry: ${error.message}`)
    return data as {
      to_email: string | null
      to_emails: string[] | null
      recipient_source: string | null
      status: string
    }
  }

  it('addresses the primary alone when no list is configured', async () => {
    await clearRungs()
    await svc.from('links').insert({ artist_id: artistA, role: 'booking', label: 'Bookings', url: `mailto:${LINK_TO}` })

    const row = await submit()

    expect(row).toMatchObject({ status: 'ok', to_email: LINK_TO })
    expect(row.to_emails).toEqual([LINK_TO])
  })

  it('addresses the primary AND the configured list, primary first', async () => {
    await clearRungs()
    await svc.from('links').insert({ artist_id: artistA, role: 'booking', label: 'Bookings', url: `mailto:${LINK_TO}` })
    await addRecipient('booking', 'skeen@example.com', 'Skeen')
    await addRecipient('booking', 'manager@example.com', 'Manager')

    const row = await submit()

    // to_email is UNCHANGED in meaning — still the primary, still what recipient_source
    // describes. Widening it would have broken every consumer that reads "where did this
    // one go?" as a single address.
    expect(row).toMatchObject({ status: 'ok', to_email: LINK_TO, recipient_source: 'link' })
    expect(row.to_emails).toEqual([LINK_TO, 'skeen@example.com', 'manager@example.com'])
  })

  it('freezes the whole addressed set on the enquiry row', async () => {
    // Same reason to_email was frozen in the first place: recipient resolution reads
    // WORKING rows, so after the manager edits the list, the row is the only record of
    // who actually received a given message.
    await clearRungs()
    await svc.from('links').insert({ artist_id: artistA, role: 'booking', label: 'Bookings', url: `mailto:${LINK_TO}` })
    await addRecipient('booking', 'frozen@example.com')

    const row = await submit()
    expect(row.enquiry_id).not.toBeNull()

    // Change the list AFTER the submission. The stored row must not follow it.
    await svc.from('enquiry_recipients').delete().eq('artist_id', artistA)

    const stored = await storedRow(row.enquiry_id!)
    expect(stored.to_emails).toEqual([LINK_TO, 'frozen@example.com'])
    expect(stored.to_email).toBe(LINK_TO)
  })

  it('does not address one inbox twice when the list repeats the rung', async () => {
    await clearRungs()
    await svc.from('links').insert({ artist_id: artistA, role: 'booking', label: 'Bookings', url: `mailto:${LINK_TO}` })
    await addRecipient('booking', LINK_TO.toUpperCase())

    const row = await submit()

    expect(row.to_emails).toEqual([LINK_TO])
  })

  it('records the list on an UNROUTABLE enquiry too', async () => {
    // Storing before sending is the whole point of this table (20260804230000). An
    // unroutable enquiry that forgot who it was FOR would lose that on the day mail is
    // finally configured and someone goes back through the backlog.
    await clearRungs()
    await svc.from('links').insert({ artist_id: artistA, role: 'booking', label: 'Bookings', url: `mailto:${LINK_TO}` })
    await addRecipient('booking', 'waiting@example.com')

    // Remove the SENDER, not the recipient: no verified domain means unroutable while the
    // recipients are perfectly well known.
    const { data: prior } = await svc
      .from('mail_settings')
      .select('default_to_email, sending_domain, from_local_part')
      .maybeSingle()
    await svc.from('mail_settings').delete().eq('id', true)
    try {
      const row = await submit()

      expect(row.status).toBe('no_recipient')
      expect(row.enquiry_id).not.toBeNull()

      const stored = await storedRow(row.enquiry_id!)
      expect(stored.status).toBe('unroutable')
      // The booking LINK above is rung 2 and still resolves — removing the singleton took
      // away the SENDER and rung 4, not the recipients. That is the whole point of this
      // test: an enquiry nobody can send still records exactly who it was for, so the
      // backlog is answerable on the day mail is finally configured.
      expect(stored.to_emails).toEqual([LINK_TO, 'waiting@example.com'])
    } finally {
      if (prior) await svc.from('mail_settings').upsert({ id: true, ...(prior as MailSettings) })
    }
  })
})

describe('log_contact_attempt — the ledger writer for paths that never reach the door', () => {
  it("records an 'attachment' outcome (it silently recorded nothing for a month)", async () => {
    // 20260804200000 widened the table CHECK to allow 'attachment' but the FUNCTION's own
    // `where p_outcome in (…)` was never redefined, so "each upload ticket burns a
    // rate-limit slot" inserted zero rows and raised nothing. RED against that version.
    const ip = freshIp()
    const { error } = await svc.rpc('log_contact_attempt', {
      p_slug: artist.slug, p_purpose: 'demo', p_ip_hash: ip, p_outcome: 'attachment',
    })
    expect(error).toBeNull()

    const { data } = await svc.from('contact_attempts').select('outcome, purpose').eq('ip_hash', ip)
    expect(data).toEqual([{ outcome: 'attachment', purpose: 'demo' }])
  })

  it('keeps a well-formed custom purpose instead of folding it into other', async () => {
    // The third hand-listed copy of the retired three-value enum.
    const ip = freshIp()
    await svc.rpc('log_contact_attempt', { p_slug: artist.slug, p_purpose: 'Press ', p_ip_hash: ip, p_outcome: 'honeypot' })

    const { data } = await svc.from('contact_attempts').select('purpose').eq('ip_hash', ip).single()
    expect((data as { purpose: string }).purpose).toBe('press')
  })
})

describe('submit_enquiry — what a rejected request may store', () => {
  it('bounds the slug it logs for an unknown artist', async () => {
    // Stored on every REJECTED attempt; unbounded, it was free storage for anyone probing
    // the endpoint. contact_attempts_slug_len (80) is the database half of the rule.
    const ip = freshIp()
    const row = await submit({ p_slug: 'x'.repeat(300), p_ip_hash: ip })
    expect(row.status).toBe('unknown_artist')

    const { data } = await svc.from('contact_attempts').select('slug').eq('ip_hash', ip).single()
    expect((data as { slug: string }).slug).toHaveLength(80)
  })
})
