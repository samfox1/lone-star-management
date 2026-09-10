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
  composeExtras,
  decideDoor,
  firstForwardedIp,
  formatFrom,
  hasContent,
  hashIp,
  parseAllowedOrigins,
  pickOrigin,
  retentionCutoffIso,
  sanitiseFilename,
  shouldSweep,
  stripHeader,
  validateAttachments,
  validateBody,
  validateDemoUrl,
} from '../../../supabase/functions/contact/validate'

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

  it.each(['slug', 'name', 'email'])('reports missing_field for a blank %s', (field) => {
    const r = validateBody({ ...good, [field]: '   ' })
    expect(r).toMatchObject({ kind: 'error', error: 'missing_field' })
  })

  it('NO LONGER rejects a blank message on its own — a demo is a link and some audio', () => {
    // Changed 2026-08-04: skeen's demo form sends an empty message, because "here are two
    // tracks" is a complete submission without a covering sentence, and this rejected
    // every one of them. The real rule — the enquiry must carry SOMETHING — moved to
    // `hasContent`, which can see the demo link and the attachment count. This function
    // cannot: both are validated after it runs.
    expect(validateBody({ ...good, message: '' })).toMatchObject({ kind: 'ok' })
    expect(validateBody({ ...good, message: '   ' })).toMatchObject({ kind: 'ok' })
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

/* ── Block B: demo links and audio attachments ──────────────────────────────────── */

describe('validateDemoUrl', () => {
  it('accepts an https URL', () => {
    expect(validateDemoUrl('https://soundcloud.com/artist/track')).toEqual({
      value: 'https://soundcloud.com/artist/track',
      skipped: [],
    })
  })

  it('treats absent, empty and whitespace as "not provided"', () => {
    for (const v of [undefined, null, '', '   ', 123]) {
      expect(validateDemoUrl(v)).toEqual({ value: null, skipped: [] })
    }
  })

  it('CRITICAL: drops every scheme except https — and never loses the enquiry over it', () => {
    // This is attacker-controlled text a MANAGER clicks in their dashboard. javascript:
    // and data: are the ones that matter; http: goes too, since a demo link is not worth
    // a downgrade. The link is dropped, the message still arrives.
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://example.com/demo',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example.com',
      '/relative/path',
      'not a url',
    ]) {
      const res = validateDemoUrl(bad)
      expect(res.value, bad).toBeNull()
      expect(res.skipped, bad).toEqual([{ item: 'demo link', reason: 'invalid_demo_url' }])
    }
  })

  it('drops a URL over the length cap', () => {
    expect(validateDemoUrl(`https://example.com/${'a'.repeat(2100)}`).value).toBeNull()
  })
})

describe('validateAttachments', () => {
  const mp3 = { filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: 1000 }

  it('treats absent as none', () => {
    expect(validateAttachments(undefined)).toEqual({ value: [], skipped: [] })
    expect(validateAttachments([])).toEqual({ value: [], skipped: [] })
  })

  it('accepts up to three audio files', () => {
    const three = [
      mp3,
      { ...mp3, filename: 'b.wav', mime_type: 'audio/wav' },
      { ...mp3, filename: 'c.flac', mime_type: 'audio/flac' },
    ]
    expect(validateAttachments(three).value).toHaveLength(3)
    expect(validateAttachments(three).skipped).toEqual([])
  })

  it('CRITICAL: a stray non-audio file is DROPPED, not fatal — the message still gets through', () => {
    // The flaw skeen caught. Rejecting the whole enquiry meant one .zip picked alongside a
    // demo lost the entire message, in an endpoint that stores the enquiry before sending
    // precisely so a message is never lost.
    const res = validateAttachments([mp3, { filename: 'notes.zip', mime_type: 'application/zip', bytes: 10 }])
    expect(res.value.map((a) => a.filename)).toEqual(['demo.mp3'])
    expect(res.skipped).toEqual([{ item: 'notes.zip', reason: 'unsupported_audio_type' }])
  })

  it('CRITICAL: names what it dropped — silence would read as acceptance', () => {
    // A visitor who deliberately attached a file expects it to arrive.
    const res = validateAttachments([{ filename: 'song.pdf', mime_type: 'application/pdf', bytes: 1 }])
    expect(res.skipped).toEqual([{ item: 'song.pdf', reason: 'unsupported_audio_type' }])
  })

  it('CRITICAL: keeps the first three and names the rest', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ ...mp3, filename: `${n}.mp3` }))
    const res = validateAttachments(five)
    expect(res.value.map((a) => a.filename)).toEqual(['a.mp3', 'b.mp3', 'c.mp3'])
    expect(res.skipped).toEqual([
      { item: 'd.mp3', reason: 'too_many_attachments' },
      { item: 'e.mp3', reason: 'too_many_attachments' },
    ])
  })

  it('rejects every non-audio type', () => {
    for (const bad of ['application/pdf', 'image/png', 'text/html', 'application/octet-stream', '']) {
      expect(validateAttachments([{ ...mp3, mime_type: bad }]).value, bad).toEqual([])
    }
  })

  it('ignores entries with no filename, and junk in place of the list', () => {
    expect(validateAttachments([{ ...mp3, filename: '' }]).value).toEqual([])
    expect(validateAttachments('nope')).toEqual({ value: [], skipped: [] })
    expect(validateAttachments([null]).value).toEqual([])
  })
})

describe('sanitiseFilename', () => {
  it('keeps an ordinary name intact', () => {
    expect(sanitiseFilename('demo-track_02.mp3')).toBe('demo-track_02.mp3')
  })

  it('CRITICAL: strips path separators and traversal', () => {
    // The name lands in a storage path. A slash or a .. would let a visitor choose where
    // their file is written, escaping the per-enquiry folder the ticket is scoped to.
    expect(sanitiseFilename('../../etc/passwd')).not.toContain('..')
    expect(sanitiseFilename('../../etc/passwd')).not.toContain('/')
    expect(sanitiseFilename('a/b\\c.mp3')).not.toMatch(/[/\\]/)
  })

  it('replaces characters that do not belong in a URL path', () => {
    expect(sanitiseFilename('my song (final?) #2.mp3')).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('caps the length so the path cannot grow without bound', () => {
    expect(sanitiseFilename(`${'a'.repeat(400)}.mp3`).length).toBeLessThanOrEqual(120)
  })

  it('never returns empty, even for a name made entirely of junk', () => {
    // An empty segment would produce a path ending in the separator and an unusable key.
    expect(sanitiseFilename('///').length).toBeGreaterThan(0)
    expect(sanitiseFilename('....').length).toBeGreaterThan(0)
  })
})

describe('attachment retention', () => {
  const NOW = Date.parse('2026-08-04T12:00:00Z')

  it('expires files older than 90 days', () => {
    const cutoff = retentionCutoffIso(NOW)
    expect(cutoff).toBe(new Date(Date.parse('2026-05-06T12:00:00Z')).toISOString())
  })

  it('CRITICAL: the cutoff is in the PAST — a sign error would delete everything', () => {
    // The failure mode worth pinning: a `+` instead of a `-` produces a future cutoff, and
    // then "created before the cutoff" matches every attachment ever uploaded.
    expect(Date.parse(retentionCutoffIso(NOW))).toBeLessThan(NOW)
  })

  it('honours a custom window', () => {
    expect(Date.parse(retentionCutoffIso(NOW, 1))).toBe(NOW - 24 * 60 * 60 * 1000)
  })

  it('sweeps on roughly one roll in a hundred', () => {
    expect(shouldSweep(0.005)).toBe(true)
    expect(shouldSweep(0.5)).toBe(false)
    expect(shouldSweep(0.01)).toBe(false) // boundary: strictly below
  })
})

describe('hasContent — an enquiry must carry something', () => {
  it('accepts a written message on its own', () => {
    expect(hasContent({ message: 'hello', demoUrl: null, attachmentCount: 0 })).toBe(true)
  })

  it('CRITICAL: accepts a demo with only a link, or only audio', () => {
    // The case that was being rejected. Neither is visible to validateBody, which is why
    // this check is separate and runs after both have been validated.
    expect(hasContent({ message: '', demoUrl: 'https://sc.com/x', attachmentCount: 0 })).toBe(true)
    expect(hasContent({ message: '', demoUrl: null, attachmentCount: 1 })).toBe(true)
  })

  it('CRITICAL: rejects an enquiry carrying nothing at all', () => {
    // A name and an email with no message, no link and no audio is not a submission.
    expect(hasContent({ message: '', demoUrl: null, attachmentCount: 0 })).toBe(false)
    expect(hasContent({ message: '   ', demoUrl: null, attachmentCount: 0 })).toBe(false)
  })
})

describe('composeExtras — merge the optional fields after validation', () => {
  // This step lived inline in index.ts, where nothing typechecks or tests it. It owns
  // one rule: a bad link or file NEVER fails the enquiry (dropped + named in skipped),
  // but an enquiry carrying NOTHING still must be rejected — and that rejection can only
  // be decided here, after demo/attachment validation, because validateBody cannot see
  // either field.

  it('a message alone goes through with nothing skipped', () => {
    const r = composeExtras('hello', undefined, undefined)
    expect(r).toEqual({ kind: 'ok', demoUrl: null, attachments: [], skipped: [] })
  })

  it('CRITICAL: a demo with only a link and audio goes through with an empty message', () => {
    // The case that once bounced every skeen demo with missing_field.
    const r = composeExtras('', 'https://soundcloud.com/x', [
      { filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: 1000 },
    ])
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.demoUrl).toBe('https://soundcloud.com/x')
      expect(r.attachments).toHaveLength(1)
    }
  })

  it('CRITICAL: empty message + nothing usable is missing_field, not a stored empty row', () => {
    const r = composeExtras('', undefined, undefined)
    expect(r).toEqual({ kind: 'reject', error: 'missing_field' })
  })

  it('CRITICAL: an enquiry whose ONLY content was an invalid link is rejected, not stored empty', () => {
    // The link is dropped by validation, so nothing remains. Storing a blank row here
    // would hand the manager a nameless shrug; the visitor should hear it failed.
    const r = composeExtras('', 'javascript:alert(1)', undefined)
    expect(r).toEqual({
      kind: 'reject',
      error: 'missing_field',
    })
  })

  it('a bad link never fails an enquiry that has a message — dropped and named', () => {
    const r = composeExtras('hello', 'http://insecure.example', undefined)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.demoUrl).toBeNull()
      expect(r.skipped).toEqual([{ item: 'demo link', reason: 'invalid_demo_url' }])
    }
  })

  it('skipped merges link and attachment drops in one list', () => {
    const r = composeExtras('hello', 'ftp://x', [
      { filename: 'notes.zip', mime_type: 'application/zip', bytes: 10 },
    ])
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') {
      expect(r.skipped.map((s) => s.reason).sort()).toEqual([
        'invalid_demo_url',
        'unsupported_audio_type',
      ])
    }
  })
})

describe('decideDoor — the RPC status → HTTP outcome map', () => {
  // Extracted from index.ts so the mapping is pinned by tests: this is where the
  // deployment-only bugs lived, and where "unroutable is a success for the visitor"
  // could quietly regress to a 500.

  it('ok proceeds, not unroutable', () => {
    expect(decideDoor({ status: 'ok', enquiry_id: 'e1' })).toEqual({
      kind: 'proceed',
      unroutable: false,
    })
  })

  it('CRITICAL: no_recipient with a stored row PROCEEDS — the visitor must see success', () => {
    // While mail is unconfigured EVERY submission takes this path. Mapping it back to an
    // error would tell every visitor their message failed when it is safely stored.
    expect(decideDoor({ status: 'no_recipient', enquiry_id: 'e1' })).toEqual({
      kind: 'proceed',
      unroutable: true,
    })
  })

  it('no_recipient WITHOUT a stored row is a 500 — nothing was kept, do not claim success', () => {
    expect(decideDoor({ status: 'no_recipient', enquiry_id: null })).toEqual({
      kind: 'reject',
      httpStatus: 500,
      error: 'send_failed',
    })
  })

  it('rate_limited is 429 with Retry-After', () => {
    expect(decideDoor({ status: 'rate_limited', enquiry_id: null })).toEqual({
      kind: 'reject',
      httpStatus: 429,
      error: 'rate_limited',
      retryAfterSeconds: 3600,
    })
  })

  it('invalid and unknown_artist are both client errors', () => {
    expect(decideDoor({ status: 'invalid', enquiry_id: null })).toMatchObject({
      kind: 'reject',
      httpStatus: 400,
      error: 'missing_field',
    })
    expect(decideDoor({ status: 'unknown_artist', enquiry_id: null })).toMatchObject({
      kind: 'reject',
      httpStatus: 400,
      error: 'missing_field',
    })
  })

  it('no row, or a status this map was never taught, is a 500', () => {
    expect(decideDoor(undefined)).toMatchObject({ kind: 'reject', httpStatus: 500 })
    expect(decideDoor({ status: 'surprise_new_status', enquiry_id: null })).toMatchObject({
      kind: 'reject',
      httpStatus: 500,
    })
  })
})
