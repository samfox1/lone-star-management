/**
 * The share picture a home page names (og:image), fetched and measured.
 *
 * The address comes from the LIVE page, so it is untrusted: it is fetched only through
 * guardedFetch, https only on every hop (a public host can redirect to a private address or
 * to http), with a timeout and a byte cap. The size is read from the file's own first bytes
 * (PNG, GIF, JPEG, WebP), never from the page's og:image:width or the server's label; no
 * image library, no new dependency.
 *
 * Never throws: no answer is `status: null` with the reason in `error` (types.ts).
 */
import { trimTrailingSlashes } from '@/lib/url'
import { guardedFetch } from '@/lib/guarded-fetch'
import { metaOf, parsePage } from './html'
import type { SeoEvidence } from './types'

/** X's cap for a large card picture (developer.x.com, summary_large_image: under 5 MB). We
 *  download no more than this: a bigger file fails the test either way. */
export const SHARE_MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000

type Format = NonNullable<NonNullable<SeoEvidence['shareImage']>['format']>
export type ImageHeader = { format: Format | null; width: number | null; height: number | null }

const at = (b: Uint8Array, i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

/** SOF markers: C0–CF except C4 (DHT), C8 (JPG), CC (DAC). */
const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) return null
    while (i < b.length && b[i] === 0xff) i++ // fill bytes
    if (i >= b.length) return null
    const marker = b[i++]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no length
    if (marker === 0xd9 || marker === 0xda) return null // end, or the picture data, before any size
    if (i + 1 >= b.length) return null
    const len = be16(b, i)
    if (len < 2) return null
    if (isSof(marker)) {
      if (i + 6 >= b.length) return null
      const height = be16(b, i + 3)
      const width = be16(b, i + 5)
      return width && height ? { width, height } : null
    }
    i += len
  }
  return null
}

/** A file's format and pixel size from its first bytes. Size null = the format is known but
 *  the bytes end before the size (a cut file), or it is a format we don't measure. */
export function readImageHeader(b: Uint8Array): ImageHeader {
  const none = (format: Format | null): ImageHeader => ({ format, width: null, height: null })
  if (b.length >= 8 && be32(b, 0) === 0x89504e47 && be32(b, 4) === 0x0d0a1a0a) {
    if (b.length < 24 || !at(b, 12, 'IHDR')) return none('png')
    const width = be32(b, 16)
    const height = be32(b, 20)
    return width && height ? { format: 'png', width, height } : none('png')
  }
  if (b.length >= 6 && (at(b, 0, 'GIF87a') || at(b, 0, 'GIF89a'))) {
    return b.length >= 10 ? { format: 'gif', width: le16(b, 6), height: le16(b, 8) } : none('gif')
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const s = jpegSize(b)
    return s ? { format: 'jpeg', ...s } : none('jpeg')
  }
  if (b.length >= 16 && at(b, 0, 'RIFF') && at(b, 8, 'WEBP')) {
    if (at(b, 12, 'VP8 ')) {
      if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return none('webp')
      return { format: 'webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
    }
    if (at(b, 12, 'VP8L')) {
      if (b.length < 25 || b[20] !== 0x2f) return none('webp')
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (at(b, 12, 'VP8X')) {
      if (b.length < 30) return none('webp')
      return { format: 'webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
    }
    return none('webp')
  }
  if (b.length >= 12 && at(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand === 'avif' || brand === 'avis') return none('avif')
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return none('heic')
  }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 1024)).replace(/^﻿/, '').trimStart()
  if (/^<svg[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<svg[\s>]/i.test(head))) return none('svg')
  return none(null)
}

type ShareImage = NonNullable<SeoEvidence['shareImage']>

/**
 * The share picture the home page names, fetched and measured, or null when the page names
 * none (or there is no page). The address is og:image, then og:image:url, then
 * og:image:secure_url, resolved against the site (relative and `//host` addresses work).
 */
export async function fetchShareImage(
  homeHtml: string | null,
  origin: string,
  opts: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SeoEvidence['shareImage']> {
  if (!homeHtml) return null
  const page = parsePage(homeHtml)
  const raw = metaOf(page, 'og:image') ?? metaOf(page, 'og:image:url') ?? metaOf(page, 'og:image:secure_url')
  if (!raw) return null
  const noAnswer = (url: string, error: string): ShareImage => ({ url, status: null, contentType: null, width: null, height: null, bytes: null, error })
  let u: URL
  try {
    u = new URL(raw, `${trimTrailingSlashes(origin)}/`)
  } catch {
    return noAnswer(raw, 'bad-url')
  }
  const url = u.toString()
  if (u.protocol === 'http:') return noAnswer(url, 'not-https')
  if (u.protocol !== 'https:') return noAnswer(url, 'bad-url')
  if (opts.signal?.aborted) return noAnswer(url, 'timeout')
  const r = await guardedFetch(url, {
    fetcher: opts.fetcher,
    as: 'bytes',
    maxBytes: SHARE_MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    // Every hop, the first included: https only. isPublicSiteUrl runs before this.
    allow: (next) => /^https:\/\//i.test(next),
  })
  if (r.status === null) {
    const error = r.error === 'not-allowed' ? (r.hops > 0 ? 'redirect-not-https' : 'not-https') : (r.error ?? 'network')
    return noAnswer(url, error)
  }
  const got = r.bytes ?? new Uint8Array()
  const head = readImageHeader(got)
  const stated = Number.parseInt(r.headers['content-length'] ?? '', 10)
  const hasStated = Number.isFinite(stated) && stated >= 0
  // A compressed answer's stated length is the compressed one: it can't be compared.
  const broken = hasStated && !r.truncated && !r.headers['content-encoding'] && got.length < stated
  return {
    url: r.finalUrl ?? url,
    status: r.status,
    contentType: r.headers['content-type'] ?? null,
    width: head.width,
    height: head.height,
    bytes: hasStated ? Math.max(stated, got.length) : got.length,
    format: head.format,
    ...(r.truncated ? { tooBig: true } : {}),
    ...(broken ? { broken: true } : {}),
  }
}
