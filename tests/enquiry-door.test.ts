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
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SEED, artistIdBySlug, serviceClient } from './helpers/supabase'

const svc = serviceClient()

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
  from_name: string | null
  from_email: string | null
  artist_name: string | null
  recipient_source: string | null
}

async function submit(over: Partial<Record<string, string>> = {}): Promise<DoorRow> {
  const { data, error } = await svc.rpc('submit_enquiry', {
    p_slug: SEED.artistASlug,
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

/** Strip every rung so each precedence test starts from a known floor. */
async function clearRungs() {
  await svc.from('artist_mail_settings').delete().eq('artist_id', artistA)
  await svc.from('links').delete().eq('artist_id', artistA).eq('role', 'booking')
  await svc.from('site_content').delete().eq('artist_id', artistA).eq('key', 'booking_email')
}

beforeAll(async () => {
  artistA = await artistIdBySlug(SEED.artistASlug)

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
 * The per-IP counter is neutralised by freshIp(), but the per-artist cap (30/hour) is
 * a counter over `enquiries` that this suite shares with anything else that recently
 * submitted for lone-pine — an earlier run of this same file within the hour, a manual
 * curl against the endpoint, the isolation suite. That residue made this file flake:
 * the rate-limit tests would trip the ARTIST cap early and report `rate_limited` from a
 * test that was asserting `ok`.
 *
 * Deleting by artist within the last hour is safe here because lone-pine is a seeded
 * fixture on a dev project, and enquiries for it are by definition test traffic.
 */
async function resetArtistWindow() {
  await svc
    .from('enquiries')
    .delete()
    .eq('artist_id', artistA)
    .gt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
}

beforeEach(resetArtistWindow)
afterEach(resetArtistWindow)

afterAll(async () => {
  await clearRungs()
  await resetArtistWindow()
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

  it('an unrecognized purpose is COERCED to other, never rejected', async () => {
    await clearRungs()
    const row = await submit({ p_purpose: 'wedding-gig' })
    expect(row.status).toBe('ok')
    const { data } = await svc.from('enquiries').select('purpose').eq('id', row.enquiry_id!).single()
    expect(data?.purpose).toBe('other')
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

    // Five INVALID attempts create no enquiries at all...
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
        p_slug: SEED.artistASlug,
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
