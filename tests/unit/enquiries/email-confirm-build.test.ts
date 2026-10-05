// The pure half of the email-confirm Edge Function: the confirmation email's words, its
//   HTML, and the request parse. The function itself runs only in Deno, so this is the part
//   `npm test` can reach.
/**
 * Sam, 2026-09-30: "there should be a confirmation email sent with a code for us to make sure
 * the email is legit". This pins what that email says (EMAIL_CONFIRM_PLAN.md, piece 2) and the
 * one rule that cannot be checked by eye: the artist name, site host and kind labels are all
 * typed by managers, and they land in HTML someone opens in their mail client.
 *
 * Stryker survivors left on purpose (2026-10-05): the inline style strings and the blank
 * spacer lines in the text body. That is layout still being designed, checked by eye, not
 * pinned here (AGENTS.md "Test depth").
 */
import { describe, expect, it } from 'vitest'
import {
  buildConfirmHtml,
  buildConfirmSubject,
  buildConfirmText,
  confirmLink,
  escapeHtml,
  formatCode,
  kindsToWords,
  parseConfirmRequest,
  replyStatus,
} from '../../../supabase/functions/email-confirm/build'

const TOKEN = 'Zm9vYmFyYmF6cXV4LXF1dXgtY29yZ2UtZ3JhdWx0LWdhcnBseQ'

const base = {
  artistName: 'Skeen',
  kinds: ['Booking', 'Contact'],
  siteHost: 'skeen.com',
  code: '482913',
  token: TOKEN,
  appUrl: 'https://app.tapirwebsites.com',
}

describe('kindsToWords', () => {
  it('joins two with "and", in lower case', () => {
    expect(kindsToWords(['Booking', 'Contact'])).toBe('booking and contact')
  })

  it('joins three with commas and a final "and"', () => {
    expect(kindsToWords(['Booking', 'Demo', 'Contact'])).toBe('booking, demo and contact')
  })

  it('one kind is just that kind', () => {
    expect(kindsToWords(['Sync licensing'])).toBe('sync licensing')
  })

  it('none is an empty string, so the sentence reads "wants to send enquiries"', () => {
    expect(kindsToWords([])).toBe('')
  })

  it('drops blanks, nulls and repeats (a Postgres text[] can hold a null)', () => {
    expect(kindsToWords(['Booking', ' ', null, 'booking', 'Demo'])).toBe('booking and demo')
  })
})

describe('buildConfirmSubject', () => {
  it("is Confirm <Artist>'s enquiries", () => {
    expect(buildConfirmSubject('Skeen')).toBe("Confirm Skeen's enquiries")
  })

  it('a line break in the artist name cannot start a new mail header', () => {
    // The subject is a mail HEADER; CR/LF is how a Bcc: gets smuggled in.
    const s = buildConfirmSubject('Skeen\r\nBcc: someone@evil.test')
    expect(s).not.toMatch(/[\r\n]/)
    expect(s).toBe("Confirm Skeen Bcc: someone@evil.test's enquiries")
  })

  it('with no artist name it still reads as a sentence', () => {
    expect(buildConfirmSubject('  ')).toBe('Confirm your enquiries address')
  })
})

describe('formatCode', () => {
  it('shows six digits as two groups of three', () => {
    expect(formatCode('482913')).toBe('482 913')
  })

  it('leaves anything that is not exactly six digits alone rather than mangling it', () => {
    expect(formatCode('48291')).toBe('48291')
    expect(formatCode('4829137')).toBe('4829137')
  })
})

describe('confirmLink', () => {
  it('is APP_URL + /confirm-email/<token>, with a trailing slash on APP_URL not doubled', () => {
    expect(confirmLink('https://app.tapirwebsites.com/', TOKEN)).toBe(
      `https://app.tapirwebsites.com/confirm-email/${TOKEN}`,
    )
  })

  it('a pasted APP_URL with spaces or several trailing slashes still makes one clean link', () => {
    expect(confirmLink(' https://a.test// ', TOKEN)).toBe(`https://a.test/confirm-email/${TOKEN}`)
  })

  it('is null without APP_URL: the link page only works where the dashboard is online', () => {
    expect(confirmLink('', TOKEN)).toBeNull()
    expect(confirmLink(null, TOKEN)).toBeNull()
  })

  it('a token carrying / or + cannot leave its path segment', () => {
    expect(confirmLink('https://a.test', 'ab/c+d')).toBe('https://a.test/confirm-email/ab%2Fc%2Bd')
  })
})

describe('buildConfirmText', () => {
  it('says who, which kinds, from where, the code, the link and the opt-out', () => {
    const t = buildConfirmText(base)
    expect(t).toContain(
      "Skeen's team wants to send booking and contact enquiries from skeen.com to this address.",
    )
    expect(t).toContain('482 913')
    expect(t).toContain(`https://app.tapirwebsites.com/confirm-email/${TOKEN}`)
    expect(t).toContain('Not you? Ignore this email and nothing is sent.')
  })

  it('puts the sentence on a line of its own', () => {
    expect(buildConfirmText(base).split('\n')[0]).toBe(
      "Skeen's team wants to send booking and contact enquiries from skeen.com to this address.",
    )
  })

  it('with no artist name the sentence still has a subject', () => {
    expect(buildConfirmText({ ...base, artistName: '' })).toContain(
      'A team on Tapir wants to send booking and contact enquiries from skeen.com to this address.',
    )
  })

  it('drops "from <host>" when the artist has no site address', () => {
    const t = buildConfirmText({ ...base, siteHost: null })
    expect(t).toContain("Skeen's team wants to send booking and contact enquiries to this address.")
  })

  it('with no kinds the sentence still reads', () => {
    const t = buildConfirmText({ ...base, kinds: [] })
    expect(t).toContain("Skeen's team wants to send enquiries from skeen.com to this address.")
  })

  it('has no link line at all without APP_URL, and no stray token', () => {
    const t = buildConfirmText({ ...base, appUrl: null })
    expect(t).not.toMatch(/confirm here|confirm-email|null/i)
    expect(t).not.toContain(TOKEN)
    expect(t).toContain('482 913')
  })
})

describe('buildConfirmHtml', () => {
  it('carries the same sentence, code, link and opt-out as the text', () => {
    const h = buildConfirmHtml(base)
    expect(h).toContain(
      'Skeen&#39;s team wants to send booking and contact enquiries from skeen.com to this address.',
    )
    expect(h).toContain('>482 913<')
    expect(h).toContain(`href="https://app.tapirwebsites.com/confirm-email/${TOKEN}"`)
    expect(h).toContain('Not you? Ignore this email and nothing is sent.')
  })

  it('the visible words are the sentence, the code, its life, Confirm and the opt-out: nothing else', () => {
    // Text between tags, in order. Catches a stray token, an "undefined", or junk between blocks.
    const visible = (h: string) =>
      h
        .split(/<[^>]*>/)
        .map((s) => s.trim())
        .filter(Boolean)
    expect(visible(buildConfirmHtml(base))).toEqual([
      'Skeen&#39;s team wants to send booking and contact enquiries from skeen.com to this address.',
      '482 913',
      'The code works for 15 minutes.',
      'Confirm',
      'Not you? Ignore this email and nothing is sent.',
    ])
  })

  it('shows the code in a monospace font', () => {
    const h = buildConfirmHtml(base)
    expect(h).toMatch(/<[^>]*font-family:[^"]*monospace[^>]*>482 913</)
  })

  it('has no button and no token without APP_URL', () => {
    const h = buildConfirmHtml({ ...base, appUrl: '' })
    expect(h).not.toContain('<a ')
    expect(h).not.toContain(TOKEN)
  })

  it('CRITICAL: escapes a hostile artist name, host and kind label', () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const h = buildConfirmHtml({
      ...base,
      artistName: hostile,
      siteHost: '"><script>alert(2)</script>',
      kinds: ['<b>Booking</b>'],
    })
    // Planted witness: the payloads DID reach the output (escaped), so "no <img" below is
    // not passing because the name was dropped.
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(h).toContain('&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(h).toContain('&lt;b&gt;booking&lt;/b&gt;')
    expect(h).not.toContain('<img')
    expect(h).not.toContain('<script')
    expect(h).not.toContain('<b>')
  })

  it('the href is attribute-escaped: a quote cannot break out of it', () => {
    // Aimed at APP_URL, not the token: the token is already URI-encoded by confirmLink (a
    // quote becomes %22), so a quote planted there never reaches this escape and the test
    // passed with the escape deleted. APP_URL goes into the href as written.
    const h = buildConfirmHtml({ ...base, appUrl: 'https://a.test/x"onmouseover="alert(1)' })
    expect(h).toContain('href="https://a.test/x&quot;onmouseover=&quot;alert(1)/confirm-email/')
    expect(h).not.toContain('"onmouseover="')
  })
})

describe('escapeHtml', () => {
  it('escapes all five characters that matter in text and attributes', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('parseConfirmRequest', () => {
  const id = '6f1c2a3e-1b2c-4d5e-8f90-1234567890ab'

  it('takes { artistId, email }, trimmed and lower-cased', () => {
    expect(parseConfirmRequest({ artistId: id, email: '  Ross@Example.COM ' })).toEqual({
      artistId: id,
      email: 'ross@example.com',
    })
  })

  it('refuses an artistId that is not a uuid (it would 500 in PostgREST, not 400)', () => {
    expect(parseConfirmRequest({ artistId: 'skeen', email: 'ross@example.com' })).toBeNull()
    // An array stringifies to its one element, so the regex alone would let it through.
    expect(parseConfirmRequest({ artistId: [id], email: 'ross@example.com' })).toBeNull()
  })

  it('refuses a missing, non-string or malformed email', () => {
    expect(parseConfirmRequest({ artistId: id })).toBeNull()
    expect(parseConfirmRequest({ artistId: id, email: 42 })).toBeNull()
    expect(parseConfirmRequest({ artistId: id, email: 'not an email' })).toBeNull()
    expect(parseConfirmRequest({ artistId: id, email: `${'a'.repeat(320)}@b.co` })).toBeNull()
  })

  it('takes an address of exactly 320 characters, the most an address can be', () => {
    const longest = `${'a'.repeat(315)}@b.co`
    expect(parseConfirmRequest({ artistId: id, email: longest })?.email).toBe(longest)
    expect(parseConfirmRequest({ artistId: id, email: `a${longest}` })).toBeNull()
  })

  it('refuses a body that is not an object', () => {
    expect(parseConfirmRequest(null)).toBeNull()
    expect(parseConfirmRequest(undefined)).toBeNull()
    expect(parseConfirmRequest('x')).toBeNull()
  })
})

describe('replyStatus', () => {
  it('passes the status word the SQL returned straight through', () => {
    for (const s of ['sent', 'confirmed', 'too_soon', 'too_many', 'not_listed', 'not_allowed']) {
      expect(replyStatus({ status: s, code: '482913', token: TOKEN })).toBe(s)
    }
  })

  it('reads a one-row array as PostgREST returns a set-returning function', () => {
    expect(replyStatus([{ status: 'too_soon' }])).toBe('too_soon')
  })

  it('is null for no row, no status, or anything that is not a plain status word', () => {
    expect(replyStatus(null)).toBeNull()
    expect(replyStatus([])).toBeNull()
    expect(replyStatus({ code: '482913' })).toBeNull()
    // Never echo something that could be a code or an address back to the caller.
    expect(replyStatus({ status: '482913' })).toBeNull()
    expect(replyStatus({ status: 'ross@example.com' })).toBeNull()
  })
})
