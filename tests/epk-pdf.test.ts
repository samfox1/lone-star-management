/**
 * The generated press kit.
 *
 * Two halves, tested at the level each deserves.
 *
 * `wrapText` is where the real logic is — laying out a bio on a fixed-width page with no
 * layout engine — so it is pure over an injected measure function and tested directly.
 *
 * `buildEpkPdf` is orchestration over pdf-lib. The assertions that matter there are about
 * SHAPE and FAILURE, not typography: does it produce a real PDF, does the rider actually
 * get stapled on, and — the one that decides whether a manager can trust the button — does
 * a broken attachment degrade to a press kit without it, rather than failing the download.
 */
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PHOTO_SIZE, buildEpkPdf, headerBottom, pdfImageFormat, pdfSafeText, wrapText } from '@/lib/epk-pdf'
import type { SiteData } from '@/lib/site'

/** A measure fn where every character is exactly 10 units wide — makes the arithmetic
 *  checkable by eye instead of depending on real font metrics. */
const measure = (s: string) => s.length * 10

describe('wrapText', () => {
  it('keeps a short line whole', () => {
    expect(wrapText('hello', 1000, measure)).toEqual(['hello'])
  })

  it('breaks on spaces at the width limit', () => {
    // 'aaa bbb' is 70 units; a 50-unit line fits only one word.
    expect(wrapText('aaa bbb', 50, measure)).toEqual(['aaa', 'bbb'])
  })

  it('fits as many words as it can per line', () => {
    // 'aa bb' is 50 units including the space; 'aa bb cc' is 80, so the third word wraps.
    expect(wrapText('aa bb cc dd', 50, measure)).toEqual(['aa bb', 'cc dd'])
    // And at exactly the width of three words, all three fit — greedy, not conservative.
    expect(wrapText('aa bb cc dd', 80, measure)).toEqual(['aa bb cc', 'dd'])
  })

  it('CRITICAL: a single word longer than the line is broken, not dropped', () => {
    // A URL or a long band name would otherwise vanish or overflow the page silently.
    const out = wrapText('aaaaaaaaaa', 30, measure)
    expect(out.join('')).toBe('aaaaaaaaaa')
    expect(out.every((l) => measure(l) <= 30)).toBe(true)
  })

  it('preserves paragraph breaks as separate blocks', () => {
    expect(wrapText('one\n\ntwo', 1000, measure)).toEqual(['one', '', 'two'])
  })

  it('collapses runs of spaces rather than emitting empty words', () => {
    expect(wrapText('aa    bb', 1000, measure)).toEqual(['aa bb'])
  })

  it('returns nothing for empty or whitespace-only input', () => {
    expect(wrapText('', 100, measure)).toEqual([])
    expect(wrapText('   ', 100, measure)).toEqual([])
  })

  it('never returns a line wider than the limit', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps running for a while'
    for (const line of wrapText(text, 120, measure)) expect(measure(line)).toBeLessThanOrEqual(120)
  })
})

/* ── buildEpkPdf ─────────────────────────────────────────────────────────────────── */

function site(over: Partial<SiteData['artist']> = {}): SiteData {
  return {
    artist: {
      id: 'a1',
      slug: 'lone-pine',
      name: 'Lone Pine',
      bio: 'Dusty alt-country out of West Texas.\n\nA second paragraph about the band.',
      hero_image_url: null,
      template: 'classic',
      spotify_artist_id: null,
      press_pitch: 'Austin four-piece with a debut out this autumn.',
      press_quotes: [{ quote: 'A blistering live act.', source: 'NME', url: null }],
      ...over,
    },
    tracks: [],
    tour_dates: [],
    merch: [],
    links: [{ id: 'l1', label: 'Booking', url: 'mailto:book@example.com', sort_order: 0 }] as never,
    videos: [],
    media: [],
    site_content: {},
    styles: {},
  }
}

const RELEASES = [{ title: 'First Light', release_date: '2025-03-01' }]

/** A real, minimal PDF to stand in for an uploaded rider. */
async function fakePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    doc.addPage([612, 792]).drawText(`rider page ${i + 1}`, { x: 50, y: 700, size: 12, font })
  }
  return doc.save()
}

const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

describe('buildEpkPdf', () => {
  it('produces a real PDF', async () => {
    const bytes = await buildEpkPdf({ site: site(), releases: RELEASES, attachments: [] })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('CRITICAL: staples an attachment onto the end', async () => {
    const rider = await fakePdf(2)
    const base = await buildEpkPdf({ site: site(), releases: RELEASES, attachments: [] })
    const withRider = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [{ label: 'Tech rider', bytes: rider }],
    })
    expect(await pageCount(withRider)).toBe((await pageCount(base)) + 2)
  })

  it('staples several attachments in order', async () => {
    const withBoth = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [
        { label: 'Stage plot', bytes: await fakePdf(1) },
        { label: 'Tech rider', bytes: await fakePdf(3) },
      ],
    })
    const base = await buildEpkPdf({ site: site(), releases: RELEASES, attachments: [] })
    expect(await pageCount(withBoth)).toBe((await pageCount(base)) + 4)
  })

  it('CRITICAL: a corrupt attachment is skipped, not fatal', async () => {
    // A rider that fails to parse must not take the whole download with it — the manager
    // would get an error with nothing to act on, and no press kit at all.
    const junk = new TextEncoder().encode('this is not a pdf')
    const bytes = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [{ label: 'Tech rider', bytes: junk }],
    })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('reports which attachments were skipped, so the caller can say so', async () => {
    const junk = new TextEncoder().encode('nope')
    const res = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [{ label: 'Tech rider', bytes: junk }],
      collectSkipped: true,
    })
    expect(res.skipped).toEqual(['Tech rider'])
  })

  it('renders without a pitch, without quotes, and without releases', async () => {
    // Only the four gate items are guaranteed; everything else is optional and must not
    // throw when absent. An empty section renders nothing (the placeholder rule).
    const bare = site({ press_pitch: null, press_quotes: [] })
    const bytes = await buildEpkPdf({ site: bare, releases: [], attachments: [] })
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('CRITICAL: survives characters the PDF font cannot encode', async () => {
    // pdf-lib's standard fonts are WinAnsi and THROW on anything outside it. The bio and
    // the quotes are free text a manager pastes in, so an emoji, a CJK name or a Cyrillic
    // credit would otherwise take the whole download down with an error naming a
    // character code — unactionable, and the press kit never arrives.
    const exotic = site({
      name: 'Lone Pine 🌲',
      bio: 'Touring with 東京の友達 and Кирилл. Emoji in the bio: 🎸🔥',
      press_pitch: 'Austin four-piece — “quietly enormous” 🌟',
      press_quotes: [{ quote: 'すばらしい live act.', source: 'ロッキング・オン', url: null }],
    })
    const bytes = await buildEpkPdf({ site: exotic, releases: RELEASES, attachments: [] })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('keeps the punctuation WinAnsi DOES support rather than mangling it', async () => {
    // Curly quotes, en/em dashes and ellipses are all representable — folding them to
    // ASCII would make every press kit look worse for no reason.
    for (const ch of ['\u2018', '\u2019', '\u201c', '\u201d', '\u2013', '\u2014', '\u2026', '\u00e9', '\u00f6']) {
      expect(pdfSafeText(`a${ch}b`)).toBe(`a${ch}b`)
    }
  })

  it('replaces an unsupported character instead of dropping the line', () => {
    // Losing the character is fine; losing the sentence around it is not.
    expect(pdfSafeText('Tokyo 東京 show')).toBe('Tokyo ?? show')
  })

  it('survives a very long bio by adding pages rather than overflowing one', async () => {
    const long = site({ bio: 'word '.repeat(4000) })
    const bytes = await buildEpkPdf({ site: long, releases: RELEASES, attachments: [] })
    expect(await pageCount(bytes)).toBeGreaterThan(1)
  })
})

/* ── the artist photo ────────────────────────────────────────────────────────────── */

/** A real 1x1 PNG. pdf-lib parses it for real, so this is not a stub. */
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)
const bytesOf = (...n: number[]) => Uint8Array.from(n)

describe('pdfImageFormat', () => {
  it('recognises PNG and JPEG — the only two pdf-lib can embed', () => {
    expect(pdfImageFormat(PNG_1X1)).toBe('png')
    expect(pdfImageFormat(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('jpeg')
  })

  it('CRITICAL: rejects webp and gif, which the uploader ACCEPTS but pdf-lib cannot embed', () => {
    // IMAGE_UPLOAD_RULES allows both, so a manager can upload a profile photo in a format
    // the PDF cannot use. Detecting it here is what turns a thrown error into a skip.
    const webp = bytesOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)
    const gif = bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
    expect(pdfImageFormat(webp)).toBeNull()
    expect(pdfImageFormat(gif)).toBeNull()
  })

  it('rejects junk and empty input rather than guessing', () => {
    expect(pdfImageFormat(new TextEncoder().encode('not an image'))).toBeNull()
    expect(pdfImageFormat(new Uint8Array())).toBeNull()
    expect(pdfImageFormat(bytesOf(0x89))).toBeNull()
  })
})

describe('buildEpkPdf — the photo', () => {
  it('embeds a PNG photo', async () => {
    const bytes = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [],
      photo: PNG_1X1,
    })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('CRITICAL: a webp photo is skipped, not fatal', async () => {
    // The gate requires a photo, so this path is reachable by any manager whose profile
    // photo happens to be a webp. Failing the download would be absurd.
    const webp = bytesOf(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)
    const res = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [],
      photo: webp,
      collectSkipped: true,
    })
    expect(new TextDecoder().decode(res.bytes.slice(0, 5))).toBe('%PDF-')
    expect(res.skipped).toEqual(['Photo'])
  })

  it('CRITICAL: a corrupt photo is skipped, not fatal', async () => {
    // Right magic bytes, wrong everything after — pdf-lib throws deep inside embedPng.
    const brokenPng = Uint8Array.from([...PNG_1X1.slice(0, 12), 9, 9, 9, 9, 9, 9])
    const res = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [],
      photo: brokenPng,
      collectSkipped: true,
    })
    expect(new TextDecoder().decode(res.bytes.slice(0, 5))).toBe('%PDF-')
    expect(res.skipped).toEqual(['Photo'])
  })

  it('reports the photo AND a bad attachment separately', async () => {
    const res = await buildEpkPdf({
      site: site(),
      releases: RELEASES,
      attachments: [{ label: 'Tech rider', bytes: new TextEncoder().encode('nope') }],
      photo: bytesOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
      collectSkipped: true,
    })
    expect(res.skipped).toEqual(['Photo', 'Tech rider'])
  })

  it('renders fine with no photo at all', async () => {
    const res = await buildEpkPdf({ site: site(), releases: RELEASES, attachments: [], collectSkipped: true })
    expect(res.skipped).toEqual([])
    expect(await pageCount(res.bytes)).toBeGreaterThanOrEqual(1)
  })
})

describe('headerBottom — the portrait must not be written over', () => {
  const headerTop = 700

  it('CRITICAL: short header text still clears the portrait', () => {
    // The common case: a short name, no pitch. The text ends well above the bottom of the
    // 96pt photo, so content has to resume BELOW the photo, not below the text.
    expect(headerBottom({ headerTop, textBottom: 660, hasPhoto: true })).toBe(headerTop - PHOTO_SIZE)
  })

  it('long header text wins when it runs past the portrait', () => {
    const textBottom = headerTop - PHOTO_SIZE - 40
    expect(headerBottom({ headerTop, textBottom, hasPhoto: true })).toBe(textBottom)
  })

  it('with no photo, the text decides on its own', () => {
    expect(headerBottom({ headerTop, textBottom: 660, hasPhoto: false })).toBe(660)
  })

  it('never returns a position above the text — content cannot move back up', () => {
    for (const textBottom of [699, 660, 600, 500]) {
      expect(headerBottom({ headerTop, textBottom, hasPhoto: true })).toBeLessThanOrEqual(textBottom)
    }
  })
})
