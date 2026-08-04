/**
 * Pure helpers behind the /contact Edge Function.
 *
 * The function itself only ever runs in Deno on Supabase's edge, which `npm test`
 * cannot execute — so validate.ts is deliberately kept free of imports and Deno globals
 * and covered here instead. Everything a bad request can do to us is decided in this
 * file; index.ts is mostly plumbing around it.
 */
import { describe, expect, it } from 'vitest'
import {
  MESSAGE_MAX,
  buildSubject,
  coercePurpose,
  firstForwardedIp,
  formatFrom,
  hashIp,
  parseAllowedOrigins,
  pickOrigin,
  stripHeader,
  validateBody,
} from '../supabase/functions/contact/validate'

const good = {
  slug: 'skeen',
  purpose: 'booking',
  name: 'Jane Promoter',
  email: 'jane@venue.com',
  message: 'Would love to book you.',
  website: '',
}

describe('validateBody', () => {
  it('accepts a well-formed submission and trims it', () => {
    const r = validateBody({ ...good, name: '  Jane Promoter  ', email: ' jane@venue.com ' })
    expect(r).toEqual({
      kind: 'ok',
      value: {
        slug: 'skeen',
        purpose: 'booking',
        name: 'Jane Promoter',
        email: 'jane@venue.com',
        message: 'Would love to book you.',
      },
    })
  })

  it('treats a non-empty honeypot as a bot, whatever else is wrong with the body', () => {
    expect(validateBody({ ...good, website: 'http://spam.example' }).kind).toBe('honeypot')
    // Checked BEFORE validation, so a bot with a broken body still gets the silent
    // drop rather than a 400 that tells it which field to fix.
    expect(validateBody({ website: 'x', slug: '', email: 'nope' }).kind).toBe('honeypot')
  })

  it('a whitespace-only honeypot is a real user, not a bot', () => {
    expect(validateBody({ ...good, website: '   ' }).kind).toBe('ok')
  })

  it.each(['slug', 'name', 'email', 'message'])('reports missing_field for a blank %s', (field) => {
    const r = validateBody({ ...good, [field]: '   ' })
    expect(r).toMatchObject({ kind: 'error', error: 'missing_field' })
  })

  it('reports missing_field for non-string junk', () => {
    expect(validateBody({ ...good, name: 42 })).toMatchObject({ error: 'missing_field' })
    expect(validateBody(null)).toMatchObject({ error: 'missing_field' })
    expect(validateBody('not an object')).toMatchObject({ error: 'missing_field' })
  })

  it.each([
    'not-an-email',
    'no@domain',
    'two@@ats.com',
    'spaces in@example.com',
    '@example.com',
    'trailing@example.',
  ])('reports invalid_email for %s', (email) => {
    expect(validateBody({ ...good, email })).toMatchObject({ error: 'invalid_email' })
  })

  it('accepts a message of exactly the cap and rejects one over it', () => {
    expect(validateBody({ ...good, message: 'x'.repeat(MESSAGE_MAX) }).kind).toBe('ok')
    expect(validateBody({ ...good, message: 'x'.repeat(MESSAGE_MAX + 1) })).toMatchObject({
      error: 'message_too_long',
    })
  })

  it('reports length before syntax, so a huge blob is not blamed on the address', () => {
    const r = validateBody({ ...good, email: 'bad', message: 'x'.repeat(MESSAGE_MAX + 1) })
    expect(r).toMatchObject({ error: 'message_too_long' })
  })

  it('truncates an overlong name rather than rejecting it', () => {
    const r = validateBody({ ...good, name: 'z'.repeat(500) })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.value.name).toHaveLength(200)
  })

  it('carries slug and purpose out on the error paths, so the drop can still be logged', () => {
    expect(validateBody({ ...good, purpose: 'demo', email: 'bad' })).toMatchObject({
      kind: 'error',
      slug: 'skeen',
      purpose: 'demo',
    })
  })
})

describe('coercePurpose', () => {
  it('passes the three known values through', () => {
    for (const p of ['booking', 'demo', 'other']) expect(coercePurpose(p)).toBe(p)
  })

  it('coerces anything else to other instead of failing', () => {
    // A site shipping a new purpose before the backend knows it must still deliver.
    for (const p of ['wedding', '', null, undefined, 7, {}]) expect(coercePurpose(p)).toBe('other')
  })
})

describe('firstForwardedIp', () => {
  const h = (values: Record<string, string>) => new Headers(values)

  it('takes the FIRST entry of x-forwarded-for, never the last', () => {
    // The last entries are proxy-appended and forgeable — trusting them would let a
    // caller choose their own rate-limit bucket on every request.
    expect(firstForwardedIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe(
      '203.0.113.7',
    )
  })

  it('handles a single entry and stray whitespace', () => {
    expect(firstForwardedIp(h({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(firstForwardedIp(h({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('prefers x-forwarded-for over x-real-ip', () => {
    expect(
      firstForwardedIp(h({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.4' })),
    ).toBe('203.0.113.7')
  })

  it('buckets a header-stripping caller into "unknown" rather than exempting them', () => {
    expect(firstForwardedIp(h({}))).toBe('unknown')
    expect(firstForwardedIp(h({ 'x-forwarded-for': '   ' }))).toBe('unknown')
  })
})

describe('hashIp', () => {
  it('is deterministic', async () => {
    expect(await hashIp('salt', '203.0.113.7')).toBe(await hashIp('salt', '203.0.113.7'))
  })

  it('separates different IPs', async () => {
    expect(await hashIp('salt', '203.0.113.7')).not.toBe(await hashIp('salt', '203.0.113.8'))
  })

  it('CHANGES WITH THE SALT — an unsalted hash would be a reversible IP column', async () => {
    expect(await hashIp('salt-a', '203.0.113.7')).not.toBe(await hashIp('salt-b', '203.0.113.7'))
  })

  it('fits the ip_hash CHECK constraint (8..64 chars, hex)', async () => {
    const h = await hashIp('salt', '203.0.113.7')
    expect(h).toHaveLength(32)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })
})

describe('stripHeader / formatFrom / buildSubject — SMTP header injection', () => {
  it('strips CR and LF, the actual injection vector', () => {
    expect(stripHeader('Evil\r\nBcc: victim@example.com')).toBe('Evil Bcc: victim@example.com')
    expect(stripHeader('a\nb')).toBe('a b')
  })

  it('strips other control characters and collapses the whitespace', () => {
    expect(stripHeader('a\u0000b\u0007c')).toBe('a b c')
    expect(stripHeader('  lots   of   space  ')).toBe('lots of space')
  })

  it('quotes the display name so a comma cannot split the address list', () => {
    expect(formatFrom('Skeen Site', 'noreply@mail.example.com')).toBe(
      '"Skeen Site" <noreply@mail.example.com>',
    )
    expect(formatFrom('Lone Pine, Records', 'noreply@mail.example.com')).toBe(
      '"Lone Pine, Records" <noreply@mail.example.com>',
    )
  })

  it('a name carrying a newline cannot escape the From header', () => {
    const out = formatFrom('Evil\r\nBcc: victim@example.com', 'noreply@mail.example.com')
    expect(out).not.toMatch(/[\r\n]/)
    expect(out).toBe('"Evil Bcc: victim@example.com" <noreply@mail.example.com>')
  })

  it('drops embedded quotes and backslashes that would break out of the quoting', () => {
    expect(formatFrom('He said "hi" \\ bye', 'a@b.com')).toBe('"He said hi  bye" <a@b.com>')
  })

  it('falls back to a bare address when the name strips to nothing', () => {
    expect(formatFrom('\r\n', 'noreply@mail.example.com')).toBe('noreply@mail.example.com')
  })

  it('builds the documented subject line', () => {
    expect(buildSubject('booking', 'Skeen', 'Jane Promoter')).toBe(
      '[Booking] Skeen — enquiry from Jane Promoter',
    )
    expect(buildSubject('demo', 'Skeen', 'Jane')).toMatch(/^\[Demo\]/)
    expect(buildSubject('other', 'Skeen', 'Jane')).toMatch(/^\[Contact\]/)
  })

  it('a visitor name carrying a newline cannot escape the Subject header', () => {
    const s = buildSubject('booking', 'Skeen', 'Jane\r\nBcc: victim@example.com')
    expect(s).not.toMatch(/[\r\n]/)
  })

  it('caps the subject length', () => {
    expect(buildSubject('booking', 'A', 'z'.repeat(400)).length).toBeLessThanOrEqual(200)
  })
})

describe('CORS origin selection', () => {
  it('parses and normalises the allowlist secret', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com/ ,')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
    expect(parseAllowedOrigins(undefined)).toEqual([])
  })

  it('echoes an allowed origin', () => {
    expect(pickOrigin('https://b.com', ['https://a.com', 'https://b.com'])).toBe('https://b.com')
  })

  it('never echoes an origin that is not on the list', () => {
    // The browser then blocks the response, which is the point: an open endpoint would
    // let any site deliver its form through our verified sending domain.
    expect(pickOrigin('https://evil.example', ['https://a.com'])).toBe('https://a.com')
    expect(pickOrigin(null, ['https://a.com'])).toBe('https://a.com')
  })

  it('degrades to "null" when nothing is configured, rather than to "*"', () => {
    expect(pickOrigin('https://evil.example', [])).toBe('null')
  })
})
