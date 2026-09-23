// The pure helpers behind the /contact edge function, which npm test cannot run directly.
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
  EMAIL_MAX,
  DEMO_URL_MAX,
  MESSAGE_MAX,
  buildSubject,
  coercePurpose,
  composeExtras,
  composeText,
  SLUG_STORE_MAX,
  decideDoor,
  formatFrom,
  hasContent,
  hashIp,
  parseAllowedOrigins,
  pickOrigin,
  pickRecipients,
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
  it('passes the three the live sites send through', () => {
    for (const p of ['booking', 'demo', 'other']) expect(coercePurpose(p)).toBe(p)
  })

  it('passes an artist-invented kind through', () => {
    // THE RULE THAT CHANGED (2026-09-21). Kinds live in enquiry_kinds and are the artist's
    // to define, so this function cannot hold the list — it would need redeploying every
    // time somebody added one. It enforces the SHAPE and nothing more. The old version
    // folded every unknown slug into 'other', which would have quietly routed every press
    // enquiry to the general pile.
    for (const p of ['press', 'sync-licensing', 'a', 'x1-2-3']) expect(coercePurpose(p)).toBe(p)
  })

  it('normalises case and surrounding space', () => {
    // The slug is compared by equality against enquiry_kinds.slug, which is lowercase by
    // its own CHECK. 'Booking' arriving from a site would otherwise match no kind at all
    // and silently lose that kind's recipient list.
    expect(coercePurpose('  Booking ')).toBe('booking')
    expect(coercePurpose('PRESS')).toBe('press')
  })

  it('coerces a MALFORMED value to other instead of failing', () => {
    // Still coerces rather than rejects: a site shipping something odd must still deliver.
    // These are all shapes enquiries_purpose_check would refuse at the table.
    for (const p of ['', '  ', '-leading', 'has space', 'UPPER_SCORE', 'x'.repeat(41), 'é', null, undefined, 7, {}]) {
      expect(coercePurpose(p), `${JSON.stringify(p)} should coerce`).toBe('other')
    }
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

  it('builds the documented subject line from the kind\'s LABEL', () => {
    // Takes the label, not the slug. The old three-entry map here could not name a kind
    // the artist invented; submit_enquiry now returns `purpose_label` instead.
    expect(buildSubject('Booking', 'Skeen', 'Jane Promoter')).toBe(
      '[Booking] Skeen — enquiry from Jane Promoter',
    )
    expect(buildSubject('Sync licensing', 'Skeen', 'Jane')).toMatch(/^\[Sync licensing\]/)
  })

  it('falls back to Contact when the row carries no label', () => {
    // A kind deleted between submit and send, or an older door still deployed. An empty
    // bracket in someone's inbox is worse than a generic word.
    expect(buildSubject('', 'Skeen', 'Jane')).toMatch(/^\[Contact\]/)
    expect(buildSubject('   ', 'Skeen', 'Jane')).toMatch(/^\[Contact\]/)
  })

  it('falls back for a label that is ONLY control characters', () => {
    // This is the case that makes the stripHeader INSIDE buildSubject load-bearing rather
    // than a duplicate of the one wrapping the whole line. String.trim() does not remove
    // \u0001, so without the inner call the label survives as a non-empty string, skips
    // the fallback, and the outer strip turns it into a space — putting `[ ]` in someone's
    // inbox instead of `[Contact]`. Found by deleting the inner call and watching every
    // test stay green.
    expect(buildSubject('\u0001\u0002', 'Skeen', 'Jane')).toMatch(/^\[Contact\]/)
  })

  it('a kind LABEL carrying a newline cannot escape the Subject header', () => {
    // The label is manager-supplied text landing in a mail header. ek_label_clean refuses
    // CR/LF at the storage layer; this is the other half of the same belt and braces, and
    // it is the half that still holds if a label ever arrives from somewhere else.
    const subject = buildSubject('Booking\r\nBcc: attacker@evil.com', 'Skeen', 'Jane')

    // The property is that NO CR/LF survives — that is what would end the Subject header
    // and start a new one. The words "Bcc:" remain, harmlessly, as text inside the
    // subject, because stripHeader turns control characters into spaces rather than
    // deleting the line. Asserting their absence would be pinning the wrong rule: it
    // would pass today and fail the day stripHeader is correctly changed to keep more of
    // the label, while saying nothing about injection either way.
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toBe('[Booking Bcc: attacker@evil.com] Skeen — enquiry from Jane')
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

describe('pickRecipients — everyone the enquiry is addressed to', () => {
  it('uses the full to_emails list, in the order the resolver gave it', () => {
    // Order is load-bearing: resolve_enquiry_recipients puts the PRIMARY first (the
    // booking rung), and the primary is what `enquiries.to_email` freezes for the audit
    // trail. A helper that sorted or reversed this would silently disagree with the row.
    expect(
      pickRecipients({ to_email: 'booking@x.com', to_emails: ['booking@x.com', 'mgr@y.com'] }),
    ).toEqual(['booking@x.com', 'mgr@y.com'])
  })

  it('falls back to the single to_email when to_emails is absent', () => {
    // The real case: the Edge Function and the database deploy separately, so an older
    // submit_enquiry (no to_emails column in its return) is live for the length of a
    // deploy. Dropping to zero recipients there would make every enquiry unroutable.
    expect(pickRecipients({ to_email: 'solo@x.com', to_emails: null })).toEqual(['solo@x.com'])
    expect(pickRecipients({ to_email: 'solo@x.com' })).toEqual(['solo@x.com'])
  })

  it('falls back when to_emails is present but EMPTY', () => {
    // `[]` is not "use the empty list", it is array_agg over no rows. Treating it as
    // authoritative would send to nobody while a perfectly good primary sat right there.
    expect(pickRecipients({ to_email: 'solo@x.com', to_emails: [] })).toEqual(['solo@x.com'])
  })

  it('de-duplicates case-insensitively', () => {
    // enquiry_recipients' unique index is on lower(email), but this helper must be right
    // on its own — the same reason submit_enquiry re-validates what the endpoint checked.
    expect(
      pickRecipients({ to_email: 'A@x.com', to_emails: ['A@x.com', 'a@X.com', 'mgr@y.com'] }),
    ).toEqual(['A@x.com', 'mgr@y.com'])
  })

  it('drops entries that are not addresses rather than failing the whole send', () => {
    // Resend rejects the ENTIRE request over one malformed recipient, which would take
    // the good addresses down with the bad one.
    expect(
      pickRecipients({ to_email: null, to_emails: ['good@x.com', 'not-an-email', '', '  '] }),
    ).toEqual(['good@x.com'])
  })

  it('trims surrounding whitespace', () => {
    expect(pickRecipients({ to_email: null, to_emails: ['  good@x.com \n'] })).toEqual([
      'good@x.com',
    ])
  })

  it('returns [] when there is nobody to send to', () => {
    // The caller must not hand Resend `to: []` — that is a 4xx recorded as a send
    // failure, which would disguise a configuration problem as a transport one.
    expect(pickRecipients(null)).toEqual([])
    expect(pickRecipients(undefined)).toEqual([])
    expect(pickRecipients({ to_email: null, to_emails: null })).toEqual([])
    expect(pickRecipients({ to_email: 'nope', to_emails: [] })).toEqual([])
  })

  it('ignores non-string entries without throwing', () => {
    // to_emails arrives as parsed JSON from PostgREST, so its element type is a promise
    // the wire does not actually keep.
    const row = { to_email: null, to_emails: [null, 42, { a: 1 }, 'good@x.com'] as never }
    expect(pickRecipients(row)).toEqual(['good@x.com'])
  })
})

describe('composeText — the body a stranger reads', () => {
  const base = {
    name: 'Jane Promoter',
    email: 'jane@venue.example',
    purposeLabel: 'Booking',
    message: 'Can you play?',
    demoUrl: null,
    attachmentCount: 0,
    dashboardUrl: null,
  }

  it('prints the kind\'s LABEL, matching the subject', () => {
    // It used to print the slug here while the subject showed the label — two names for
    // one thing in one email. Moved out of index.ts so it can be pinned.
    expect(composeText({ ...base, purposeLabel: 'Sync licensing' })).toContain('Purpose: Sync licensing')
  })

  it('falls back to Contact for an empty label', () => {
    expect(composeText({ ...base, purposeLabel: '' })).toContain('Purpose: Contact')
  })

  it('never lets a label carry a line break into the body', () => {
    // The property is that the label cannot START A NEW LINE — a body is plain text, but
    // the same value reaches a header elsewhere. stripHeader collapses the break to a
    // space, so the injected words stay INSIDE the Purpose line, harmlessly. (An earlier
    // draft asserted the words were absent, which is the wrong rule — see the buildSubject
    // test above for the same lesson.)
    const out = composeText({ ...base, purposeLabel: 'Booking\r\nX-Injected: yes' })
    const lines = out.split('\n')
    expect(lines.find((l) => l.startsWith('Purpose:'))).toBe('Purpose: Booking X-Injected: yes')
    expect(lines.some((l) => l.startsWith('X-Injected'))).toBe(false)
  })

  it('links the dashboard for attachments when it has an address, and says so in prose when it does not', () => {
    expect(composeText({ ...base, attachmentCount: 2, dashboardUrl: 'https://app.example/artists/a/enquiries' }))
      .toContain('Listen or download: https://app.example/artists/a/enquiries')
    expect(composeText({ ...base, attachmentCount: 1 })).toContain('Open the enquiry in Lone Star to listen')
    expect(composeText({ ...base, attachmentCount: 1 })).toContain('1 audio file attached')
    expect(composeText({ ...base, attachmentCount: 2 })).toContain('2 audio files attached')
  })

  it('omits the attachment block entirely when there are none', () => {
    expect(composeText(base)).not.toMatch(/audio file/)
  })

  // WHAT THE MANAGER ACTUALLY READS. Mutation testing (2026-09-22) found every line below
  // unwatched: the tests above pinned the Purpose line and the attachment block and nothing
  // else, so deleting the visitor's MESSAGE, or the From line, or the demo link left the
  // suite green. An email that arrives with the message missing is the worst outcome this
  // whole feature has, and nothing would have failed.

  it('carries the visitor\'s message, verbatim', () => {
    expect(composeText({ ...base, message: 'Aug 14 at Mohawk, 45 min set?' }))
      .toContain('Aug 14 at Mohawk, 45 min set?')
  })

  it('opens with who it is from, name and address', () => {
    expect(composeText(base).split('\n')[0]).toBe('From:    Jane Promoter <jane@venue.example>')
  })

  it('includes the demo link when there is one, and no Demo line when there is not', () => {
    // On a demo, the link IS most of the payload.
    const out = composeText({ ...base, demoUrl: 'https://sound.example/track' })
    expect(out.split('\n').find((l) => l.startsWith('Demo:'))).toBe('Demo:    https://sound.example/track')
    expect(composeText(base)).not.toMatch(/^Demo:/m)
  })

  it('says when the audio expires, so nobody sits on it', () => {
    expect(composeText({ ...base, attachmentCount: 1 })).toContain('deleted after 90 days')
  })

  it('signs off with how to reply', () => {
    expect(composeText(base).split('\n').at(-1)).toBe(
      '— Sent from your Lone Star site contact form. Reply to this email to answer directly.',
    )
  })

  it('separates the header lines from the message with a blank line', () => {
    // `lines.push('', b.message, '')` — the blanks are what stop the message running into
    // the Purpose line and the sign-off.
    const out = composeText({ ...base, message: 'Hello' }).split('\n')
    const i = out.indexOf('Hello')
    expect(out[i - 1]).toBe('')
    expect(out[i + 1]).toBe('')
  })
})

describe('validateBody — the slug is bounded', () => {
  it('stores at most SLUG_STORE_MAX characters of a slug', () => {
    // The slug is logged on every REJECTED attempt too; unbounded, it is free storage for
    // anyone probing the endpoint. contact_attempts_slug_len mirrors this in the database.
    const r = validateBody({
      slug: 'x'.repeat(500), purpose: 'booking', name: 'Jane', email: 'jane@venue.example', message: 'hi', website: '',
    })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.value.slug).toHaveLength(SLUG_STORE_MAX)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────
// Gaps mutation testing found (2026-09-22). Every `it` below was written because the line
// it names could be deleted with the whole suite still green. The existing tests around
// them assert loosely — `not.toContain('..')`, `toMatch(/^[A-Za-z0-9._-]+$/)` — which is
// true of a great many wrong answers, so the exact value is what bites here.
// ─────────────────────────────────────────────────────────────────────────────────────

describe('validateAttachments — the shape of what a stranger sent', () => {
  const mp3 = { filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: 1000 }

  it('trims the filename and the mime type, and lowercases the mime', () => {
    // Both arrive from a public JSON body. An untrimmed mime misses the allowlist and the
    // file is silently dropped as "unsupported"; an untrimmed filename becomes a storage
    // path with a space on the end.
    const res = validateAttachments([{ filename: '  demo.mp3  ', mime_type: '  AUDIO/MPEG  ', bytes: 1 }])
    expect(res.value).toEqual([{ filename: 'demo.mp3', mime_type: 'audio/mpeg', bytes: 1 }])
  })

  it('coerces a byte count that is not a usable number to 0', () => {
    // `bytes` reaches the database. A string, NaN or Infinity in that column is a broken
    // row; a negative is a nonsense one.
    for (const bad of ['1000', null, undefined, NaN, Infinity, -Infinity, {}]) {
      expect(validateAttachments([{ ...mp3, bytes: bad }]).value[0].bytes, String(bad)).toBe(0)
    }
  })

  it('floors a fractional size and clamps a negative one', () => {
    expect(validateAttachments([{ ...mp3, bytes: 1000.9 }]).value[0].bytes).toBe(1000)
    expect(validateAttachments([{ ...mp3, bytes: -5 }]).value[0].bytes).toBe(0)
  })
})

describe('sanitiseFilename — exact output, not just a shape', () => {
  it('collapses a RUN of bad characters into ONE dash', () => {
    // `+` on the character class. Without it "my  song" becomes "my--song": still matches
    // the allowlist the old test asserted, still wrong.
    expect(sanitiseFilename('my  song (final?).mp3')).toBe('my-song-final-.mp3')
  })

  it('collapses a run of dots to one, which is what kills traversal', () => {
    // `..` is the reason this function exists. The old test only asserted the result did
    // not CONTAIN '..', which is also true of a function that deletes the dots entirely.
    expect(sanitiseFilename('a..b.mp3')).toBe('a.b.mp3')
    expect(sanitiseFilename('../../etc/passwd')).toBe('etc-passwd')
  })

  it('strips every leading dot and dash, not just the first', () => {
    expect(sanitiseFilename('..hidden.mp3')).toBe('hidden.mp3')
    expect(sanitiseFilename('--x.mp3')).toBe('x.mp3')
  })

  it('falls back for a name that is absent, not only for one that is junk', () => {
    expect(sanitiseFilename(undefined as unknown as string)).toBe('audio')
    expect(sanitiseFilename('....')).toBe('audio')
  })
})

describe('validateDemoUrl — the boundaries', () => {
  const pad = (n: number) => `https://x.example/${'a'.repeat(n - 'https://x.example/'.length)}`

  it('accepts a link of exactly the maximum length and rejects one character more', () => {
    expect(validateDemoUrl(pad(DEMO_URL_MAX)).value).toHaveLength(DEMO_URL_MAX)
    expect(validateDemoUrl(pad(DEMO_URL_MAX + 1))).toEqual({
      value: null,
      skipped: [{ item: 'demo link', reason: 'invalid_demo_url' }],
    })
  })

  it('refuses a link carrying a control character or a raw space', () => {
    // It used to ACCEPT these: the collapsed copy was only used for the prefix test, and
    // the raw string — carriage return and all — was what got returned, stored and printed
    // into the email body.
    for (const bad of ['https://x.example/a\rb', 'https://x.example/a b', '\u0001https://x.example']) {
      expect(validateDemoUrl(bad), JSON.stringify(bad)).toEqual({
        value: null,
        skipped: [{ item: 'demo link', reason: 'invalid_demo_url' }],
      })
    }
  })

  it('rejects a link that passes the prefix but cannot be parsed', () => {
    // "https://" with no host reaches `new URL` and throws. Nothing exercised that catch,
    // so an empty block there would have looked fine.
    expect(validateDemoUrl('https://').value).toBeNull()
    expect(validateDemoUrl('https://').skipped).toEqual([{ item: 'demo link', reason: 'invalid_demo_url' }])
  })
})

describe('validateBody — the checks below the obvious ones', () => {
  const ok = { slug: 'skeen', purpose: 'booking', name: 'Jane', email: 'jane@venue.example', website: '' }

  it('trims the message before storing it', () => {
    const r = validateBody({ ...ok, message: '   hello   ' })
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.value.message).toBe('hello')
  })

  it('names message_too_long exactly, not merely "an error"', () => {
    const r = validateBody({ ...ok, message: 'x'.repeat(MESSAGE_MAX + 1) })
    expect(r).toMatchObject({ kind: 'error', error: 'message_too_long' })
  })

  it('rejects an address that is WELL FORMED but too long', () => {
    // The syntax half of that condition passes it; only the length half refuses. Without
    // the length check a 2KB address goes to the database and then to the mail provider.
    const long = `${'a'.repeat(EMAIL_MAX)}@venue.example`
    expect(validateBody({ ...ok, email: long, message: 'hi' })).toMatchObject({
      kind: 'error',
      error: 'invalid_email',
    })
  })

  it('accepts an address of exactly the maximum length', () => {
    // The boundary `>` vs `>=`. Without this the rule could tighten by one character and
    // quietly start refusing addresses that are within the limit.
    const exact = `${'a'.repeat(EMAIL_MAX - '@venue.example'.length)}@venue.example`
    expect(exact).toHaveLength(EMAIL_MAX)
    expect(validateBody({ ...ok, email: exact, message: 'hi' }).kind).toBe('ok')
  })

  it('rejects an address with anything trailing it', () => {
    // EMAIL_RE's `$`. Without the anchor "jane@venue.example rm -rf" matches its prefix
    // and is accepted as an address.
    expect(validateBody({ ...ok, email: 'jane@venue.example extra', message: 'hi' })).toMatchObject({
      kind: 'error',
      error: 'invalid_email',
    })
  })
})

describe('decideDoor — the error CODE, not just the status', () => {
  it('says send_failed on both 500 paths', () => {
    // The visitor sees this string. A test that only checks the number passes while the
    // body reads `{"ok":false,"error":""}`.
    expect(decideDoor(null)).toEqual({ kind: 'reject', httpStatus: 500, error: 'send_failed' })
    expect(decideDoor({ status: 'something-new', enquiry_id: null })).toEqual({
      kind: 'reject',
      httpStatus: 500,
      error: 'send_failed',
    })
  })
})

describe('buildSubject / composeText — the last two unwatched lines', () => {
  it('tolerates a missing label rather than printing "null"', () => {
    expect(buildSubject(null as unknown as string, 'Skeen', 'Jane')).toBe(
      '[Contact] Skeen — enquiry from Jane',
    )
  })

  it('leaves a blank line after the attachment block', () => {
    // Without it the retention sentence runs straight into the sign-off.
    const out = composeText({
      name: 'Jane', email: 'jane@venue.example', purposeLabel: 'Demo', message: 'hi',
      demoUrl: null, attachmentCount: 1, dashboardUrl: null,
    }).split('\n')
    const i = out.findIndex((l) => l.startsWith('Files are deleted'))
    expect(out[i + 1]).toBe('')
  })
})
