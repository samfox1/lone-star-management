/**
 * The generated press kit: one PDF a manager can attach to an email.
 *
 * Built with pdf-lib alone, deliberately. The alternatives were a headless browser
 * (~50MB of Chrome, slow cold start, the option most likely to break at deploy) or a React
 * PDF renderer — but that cannot merge existing PDFs, and merging is the whole point of
 * decision 4: the rider and stage plot are stapled on so a promoter gets ONE attachment.
 * So pdf-lib was needed either way, and one dependency beats two.
 *
 * The cost is that there is no layout engine: no flexbox, no automatic text flow. That is
 * paid for by `wrapText` below, which is pure and therefore properly testable — a better
 * trade than it sounds, since a printed page needs fixed size and explicit page breaks
 * that a web layout would have fought anyway.
 *
 * Everything here reads PUBLISHED content (Sam's decision 2), so the file and the public
 * /[slug]/epk link can never disagree.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { parsePressQuotes, resolveEpkContact } from '@/lib/epk'
import type { SiteData } from '@/lib/site'

/** The PRIVATE bucket press documents live in. Exported here because the download route
 *  is the only thing that ever reads them, and it reads them to staple into this PDF. */

/** US Letter, in points. Letter over A4 because the likeliest recipient is a US promoter,
 *  and the two are close enough that neither prints badly on the other's paper. */
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54 // 0.75in
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.42, 0.42, 0.42)
const RULE = rgb(0.85, 0.85, 0.85)

/**
 * Break text into lines that fit `maxWidth`, measured by the caller's font.
 *
 * `measure` is injected rather than taken from a font so this stays pure and testable —
 * the wrapping rules are the part worth pinning, not the metrics.
 *
 * A blank line is preserved as `''` so paragraph breaks survive; a single word wider than
 * the line is broken mid-word rather than dropped or allowed to run off the page, which
 * is what a long URL or an unbroken band name would otherwise do.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = []

  for (const [i, para] of text.split(/\n/).entries()) {
    if (i > 0 && para.trim() === '') {
      // Collapse a run of blank lines into a single spacer, and never lead with one.
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) continue

    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) out.push(line)
      // The word alone still may not fit: break it to whatever does.
      let rest = word
      while (measure(rest) > maxWidth) {
        let cut = rest.length - 1
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--
        out.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    if (line) out.push(line)
  }

  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/** The characters WinAnsi encodes above Latin-1 — the useful typography (curly quotes,
 *  dashes, ellipsis, bullet) plus the handful of letters that ride along with it. */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

/**
 * Make text safe for pdf-lib's standard fonts.
 *
 * Those fonts are WinAnsi-encoded and **throw** on any character they cannot represent —
 * they do not substitute or skip. The bio, the pitch and the quotes are free text a
 * manager pastes in, so an emoji, a Japanese collaborator's name or a Cyrillic credit
 * would take the entire download down with an error naming a character code. Unactionable
 * for the manager, and no press kit arrives.
 *
 * Losing an unrepresentable character is acceptable; losing the sentence around it is not.
 * Everything WinAnsi DOES support is kept, including the curly quotes and dashes — folding
 * those to ASCII would make every press kit look worse to fix a problem that isn't there.
 *
 * The real fix is embedding a Unicode font, which means shipping a font file and choosing
 * one with CJK coverage. Worth doing the day an artist needs it; not before.
 */
export function pdfSafeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    // Tab and newline are handled by the layout, never drawn.
    if (code === 0x09 || code === 0x0a) out += ch
    else if (code >= 0x20 && code <= 0xff) out += ch
    else if (WINANSI_EXTRAS.has(code)) out += ch
    else out += '?'
  }
  return out
}

/**
 * Which of pdf-lib's two embeddable formats this is, by magic bytes — or null.
 *
 * This matters more than it looks: `IMAGE_UPLOAD_RULES` accepts webp and gif, and pdf-lib
 * can embed NEITHER. So a manager whose profile photo happens to be a webp passes the
 * download gate (which requires a photo) and would then hit a thrown error from deep
 * inside `embedPng`. Sniffing here turns that into a skip.
 *
 * Sniffed rather than trusted from a filename or content-type, because the bytes are what
 * pdf-lib actually parses.
 */
export function pdfImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return null
}

/** The header portrait's side, in points. Square because the source is a profile photo and
 *  a promoter scans the header rather than studying it. */
export const PHOTO_SIZE = 96

/**
 * Where content resumes after the header block.
 *
 * The portrait is drawn at a fixed size on the left while the name and pitch flow beside
 * it, so whichever is TALLER decides where the Bio heading can start. Without this the
 * heading collides with the photo the moment the text is shorter than 96pt — which is the
 * common case, since most artists have a short name and no pitch.
 *
 * Pure because the collision is otherwise invisible: a test that counts pages cannot see
 * two things drawn on top of each other, and only a human looking at the PDF would catch it.
 */
export function headerBottom(input: { headerTop: number; textBottom: number; hasPhoto: boolean }): number {
  if (!input.hasPhoto) return input.textBottom
  return Math.min(input.textBottom, input.headerTop - PHOTO_SIZE)
}

export type EpkAttachment = { label: string; bytes: Uint8Array }

type BuildInput = {
  site: SiteData
  releases: { title: string; release_date?: string | null }[]
  attachments: EpkAttachment[]
  /** The artist's published profile photo (or hero image) as raw bytes. Optional: the
   *  download gate requires one, but it may still be unfetchable or in a format pdf-lib
   *  cannot embed, and neither is worth failing the download over. */
  photo?: Uint8Array
  /** Return `{ bytes, skipped }` instead of bare bytes, so a caller can tell the manager
   *  which attachment failed to merge. */
  collectSkipped?: boolean
}

/** A cursor that owns page breaks, so no caller has to remember to check for one. */
class Sheet {
  page: PDFPage
  y: number
  constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  private room(h: number) {
    if (this.y - h >= MARGIN) return
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  gap(h: number) {
    this.y -= h
  }

  text(
    body: string,
    { size = 10.5, bold = false, color = INK, indent = 0, leading = 1.45 } = {},
  ) {
    const font = bold ? this.bold : this.regular
    const width = CONTENT_W - indent
    // ONE choke point: every string drawn on the page goes through here, so sanitising
    // at this line means no caller can forget and crash the download.
    const lines = wrapText(pdfSafeText(body), width, (s) => font.widthOfTextAtSize(s, size))
    const lineH = size * leading
    for (const line of lines) {
      if (line === '') {
        this.gap(lineH * 0.6)
        continue
      }
      this.room(lineH)
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color })
      this.y -= lineH
    }
  }

  heading(label: string) {
    this.gap(14)
    this.room(28)
    this.text(label.toUpperCase(), { size: 8.5, bold: true, color: MUTED })
    this.gap(2)
    this.room(8)
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    })
    this.gap(10)
  }
}

/**
 * Build the press kit.
 *
 * Attachments are merged LAST and defensively: a rider that fails to parse is skipped and
 * named, never fatal. A manager who uploaded a broken PDF should still get their press
 * kit — an error with nothing actionable in it, and no file at all, is the worse outcome.
 */
export async function buildEpkPdf(input: BuildInput & { collectSkipped: true }): Promise<{ bytes: Uint8Array; skipped: string[] }>
export async function buildEpkPdf(input: BuildInput): Promise<Uint8Array>
export async function buildEpkPdf(
  input: BuildInput,
): Promise<Uint8Array | { bytes: Uint8Array; skipped: string[] }> {
  const { site, releases, attachments } = input
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const sheet = new Sheet(doc, regular, bold)

  const { artist } = site
  doc.setTitle(pdfSafeText(`${artist.name} — Press Kit`))
  doc.setAuthor(pdfSafeText(artist.name))

  const skipped: string[] = []

  // The portrait sits LEFT with the name beside it, rather than as a banner: a promoter
  // scans the header, and a face next to a name reads faster than either alone.
  let indent = 0
  if (input.photo) {
    const embedded = await embedPhoto(doc, input.photo)
    if (embedded) {
      sheet.page.drawImage(embedded, {
        x: MARGIN,
        y: sheet.y - PHOTO_SIZE,
        width: PHOTO_SIZE,
        height: PHOTO_SIZE,
      })
      indent = PHOTO_SIZE + 16
    } else {
      // Unembeddable (webp/gif) or corrupt. Named so the caller can tell the manager why
      // their press kit has no photo, instead of leaving them to notice.
      skipped.push('Photo')
    }
  }

  const headerTop = sheet.y
  sheet.text('PRESS KIT', { size: 8.5, bold: true, color: MUTED, indent })
  sheet.gap(6)
  sheet.text(artist.name, { size: 26, bold: true, indent })
  const pitch = artist.press_pitch?.trim()
  if (pitch) {
    sheet.gap(4)
    sheet.text(pitch, { size: 11.5, color: MUTED, indent })
  }
  // Clear the portrait even when the text beside it is shorter, so the Bio heading never
  // collides with the photo.
  sheet.y = headerBottom({ headerTop, textBottom: sheet.y, hasPhoto: indent > 0 })

  if (artist.bio?.trim()) {
    sheet.heading('Bio')
    sheet.text(artist.bio.trim())
  }

  const quotes = parsePressQuotes(artist.press_quotes)
  if (quotes.length) {
    sheet.heading('Press')
    for (const q of quotes) {
      sheet.text(`“${q.quote}”`, { indent: 12 })
      if (q.source) {
        sheet.text(`— ${q.source}`, { size: 9.5, color: MUTED, indent: 12 })
      }
      sheet.gap(6)
    }
  }

  if (releases.length) {
    sheet.heading('Releases')
    for (const r of releases) {
      const year = r.release_date ? String(r.release_date).slice(0, 4) : ''
      sheet.text(year ? `${r.title}  (${year})` : r.title)
    }
  }

  // Shared resolver, so the PDF, the gate, and the public page can never disagree.
  const { address, socials } = resolveEpkContact(site)
  if (address || socials.length) {
    sheet.heading('Contact')
    if (address) sheet.text(address, { bold: true })
    for (const s of socials) sheet.text(`${s.label}: ${s.url}`, { size: 9.5, color: MUTED })
  }

  for (const att of attachments) {
    try {
      const src = await PDFDocument.load(att.bytes)
      const pages = await doc.copyPages(src, src.getPageIndices())
      for (const p of pages) doc.addPage(p)
    } catch {
      // Unparseable, encrypted, or not a PDF at all. Name it so the caller can say which.
      skipped.push(att.label)
    }
  }

  const bytes = await doc.save()
  return input.collectSkipped ? { bytes, skipped } : bytes
}

/** Embed the portrait, or null if it cannot be. Two failure modes, both non-fatal: a
 *  format pdf-lib does not support, and bytes that claim a format but do not parse. */
async function embedPhoto(doc: PDFDocument, bytes: Uint8Array) {
  const format = pdfImageFormat(bytes)
  if (!format) return null
  try {
    return format === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    return null
  }
}
