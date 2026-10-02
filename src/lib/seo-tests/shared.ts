/**
 * "Looks right when shared": three tests over the LIVE site. Pure, synchronous, never throws.
 *
 *   share    the share picture, from the file itself (evidence.shareImage, share-image.ts):
 *            it loads, it is a picture, big enough, wide, not huge. Our visit being turned
 *            away (401/403) or the host being busy (429/5xx) is "couldn't check", not broken.
 *   preview  the words and address a shared link carries: og:title, og:description, og:url,
 *            and X's own twitter:card / twitter:title / twitter:description on the home page
 *   alt      every content `<img>` on the pages read has a real description; with no photo
 *            on the pages or in Tapir it does not apply (`na`)
 */
import { clip, homeOf, isBareName, metaOf, namesArtist, pagesOf, shortUrl, siteName, type PageState } from './html'
import { describes } from './match'
import { SHARE_MAX_BYTES } from './share-image'
import type { SeoEvidence, SeoTest, SeoTestId, SeoTestResult } from './types'

type Id = Extract<SeoTestId, 'share' | 'preview' | 'alt'>
type Result = Omit<SeoTestResult, 'id'>

const make = (id: Id, test: (e: SeoEvidence) => Result): SeoTest => (e) => {
  try {
    return { id, ...test(e) }
  } catch {
    return { id, status: 'unknown', value: 'couldn’t check', sentence: 'something went wrong reading your site, so we couldn’t check this.', evidence: [] }
  }
}

function unreadable(state: Extract<PageState, { ok: false }>, what: string): Result {
  return { status: 'unknown', value: 'couldn’t open', sentence: `${state.why}, so we couldn’t ${what}.`, evidence: [{ label: 'home page', value: state.why }], limits: 'We only judge what your site sent us; when a page doesn’t answer, we say so instead of guessing.' }
}

function tooBig(what: string): Result {
  return {
    status: 'unknown', value: 'page too big',
    sentence: `your home page is too big for us to read in full, and ${what} isn’t in the part we read.`,
    evidence: [{ label: 'home page', value: 'only the first 1 MB was read' }],
    limits: 'We read the first 1 MB of each page; anything after that isn’t checked.',
  }
}

/* ── share ──────────────────────────────────────────────────────────────────────────── */

/** Facebook's recommended size (developers.facebook.com/docs/sharing/webmasters/images).
 *  Height has a little slack so X's own 2:1 shape passes too. */
const SHARE_MIN = { width: 1200, height: 600 }
/** 1.91:1 is Facebook's shape, 2:1 is X's; outside this range an app crops it. */
const SHARE_RATIO = { min: 1.7, max: 2.1 }
/** Under this, a picture is a pixel, an icon or a mistake, not a share picture. */
const SHARE_TINY = 200

const FORMAT_NAME: Record<string, string> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', svg: 'SVG', avif: 'AVIF', heic: 'HEIC' }
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`)

const sameUrl = (a: string, b: string, base: string) => {
  try {
    return new URL(a, base).toString() === new URL(b, base).toString()
  } catch {
    return a === b
  }
}

const share = make('share', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your preview picture')
  const named = metaOf(home.page, 'og:image') ?? metaOf(home.page, 'og:image:url') ?? metaOf(home.page, 'og:image:secure_url')
  const forX = metaOf(home.page, 'twitter:image')
  const img = e.shareImage
  const action = { kind: 'edit', target: 'share', label: 'Change the preview picture' } as const
  const limits = 'We open the picture that shows when someone shares your link and check its size, shape and file, not what’s in it. X can use a different picture your site names just for X, which we list but don’t open. Each app keeps its own copy, so a change can take days to show there.'
  const good = 'A wide picture, 1200 × 630 pixels.'
  const todo = 'Make a new preview picture on the Listing tab, then publish.'
  const xRow = forX && (!named || !sameUrl(forX, named, `${e.origin}/`)) ? [{ label: 'X picture', value: `${shortUrl(forX, 80)} (not opened)` }] : []
  if (!img) {
    if (named) return { status: 'unknown', value: 'couldn’t open', sentence: 'your site names a preview picture, but we didn’t open it this time.', evidence: [{ label: 'picture', value: shortUrl(named, 80) }, ...xRow], limits }
    if (home.truncated) return tooBig('a preview picture')
    return { status: 'fail', value: 'none', sentence: 'your site doesn’t name a preview picture, so apps pick one or show none.', good, todo, action, evidence: [{ label: 'picture', value: 'none named on the home page' }, ...xRow], limits }
  }
  const evidence: { label: string; value: string }[] = [{ label: 'picture', value: shortUrl(img.url, 80) }, ...xRow]
  if (img.status === null) {
    const why: Record<string, string> = {
      'not-https': 'your preview picture isn’t on a secure address, so some apps won’t show it.',
      'redirect-not-https': 'your preview picture’s address sends visitors on to an insecure address, so some apps won’t show it.',
      'not-public': 'your preview picture points to a private address that no one outside can open.',
      'bad-url': 'your preview picture’s address isn’t a working web address.',
    }
    const said = why[img.error ?? '']
    evidence.push({ label: 'answer', value: img.error ?? 'none' })
    if (said) return { status: 'fail', value: 'can’t load', sentence: said, good, todo, action, evidence, limits }
    return { status: 'unknown', value: 'couldn’t open', sentence: `the preview picture didn’t load when we tried${img.error === 'timeout' ? ' (it timed out)' : ''}.`, evidence, limits }
  }
  const type = (img.contentType ?? '').split(';')[0].trim().toLowerCase()
  // "over" only when the size is unknown past our 5 MB download (no stated length).
  const unsized = img.tooBig === true && (img.bytes ?? 0) <= SHARE_MAX_BYTES
  const size = [img.width && img.height ? `${img.width} × ${img.height}` : null, img.format ? FORMAT_NAME[img.format] : null, img.bytes !== null ? `${unsized ? 'over ' : ''}${kb(img.bytes)}` : null].filter(Boolean).join(' · ')
  evidence.push({ label: 'answer', value: `${img.status}${type ? ` · ${type}` : ''}` })
  if (size) evidence.push({ label: 'size', value: size })
  const fail = (value: string, sentence: string, lead?: 'Almost'): Result => ({ status: 'fail', ...(lead ? { lead } : {}), value, sentence, good, todo, action, evidence, limits })
  const s = img.status
  // Turned away or busy is about OUR visit, not the picture: a sharing app may be let in.
  if (s === 401 || s === 403) return { status: 'unknown', value: `turned away (${s})`, sentence: `the picture’s host turned our visit away (error ${s}); sharing apps may still be let in.`, evidence, limits }
  if (s === 429 || s >= 500) return { status: 'unknown', value: `didn’t load (${s})`, sentence: `the preview picture didn’t load this time (error ${s}).`, evidence, limits }
  if (s < 200 || s >= 300) return fail('broken link', `your preview picture’s link is broken: it answers with error ${s}.`)
  if (img.format === 'svg') return fail('SVG picture', 'your preview picture is a kind of file sharing apps don’t show (SVG).')
  if (img.format === null) return fail('not a picture', 'your preview picture’s link doesn’t open a picture.')
  if (!type.startsWith('image/')) {
    return fail('wrong label', `your preview picture is a picture, but its server labels it “${clip(type || 'nothing', 30)}”, so apps that trust the label may not show it.`, 'Almost')
  }
  if (img.broken) return fail('broken file', 'your preview picture’s file is cut off, so apps can’t show it.')
  if ((img.bytes ?? 0) > SHARE_MAX_BYTES || img.tooBig) return fail('too big', `your preview picture is ${unsized ? 'over ' : ''}${kb(img.bytes ?? SHARE_MAX_BYTES)}; X won’t show one over 5 MB.`)
  if (!img.width || !img.height) {
    if (img.format === 'png' || img.format === 'jpeg' || img.format === 'gif' || img.format === 'webp') return fail('broken file', 'your preview picture’s file is damaged: we couldn’t read its size.')
    return { status: 'unknown', value: 'couldn’t measure', sentence: `we can’t measure ${img.format ? `${FORMAT_NAME[img.format]} pictures` : 'this kind of picture'} yet, so we don’t know its size.`, evidence, limits }
  }
  const { width: w, height: h } = img
  if (w < SHARE_TINY || h < SHARE_TINY) return fail('tiny', `your preview picture is tiny, ${w} × ${h} pixels.`)
  const ratio = w / h
  if (ratio < SHARE_RATIO.min || ratio > SHARE_RATIO.max) return fail(`${w} × ${h}`, `your preview picture is ${w} × ${h}, so apps will crop it to a wide shape.`, 'Almost')
  if (w < SHARE_MIN.width || h < SHARE_MIN.height) return fail(`${w} × ${h}`, `your preview picture is ${w} × ${h}, smaller than 1200 × 630, so it can look blurry.`, 'Almost')
  return { status: 'pass', value: `${w} × ${h}`, sentence: `Your preview picture is ${w} × ${h}, the right size and shape.`, evidence, limits }
})

/* ── preview ────────────────────────────────────────────────────────────────────────── */

/** X's card kinds (developer.x.com): anything else is ignored by X. */
const X_CARDS = new Set(['summary', 'summary_large_image', 'app', 'player'])

const preview = make('preview', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your link preview')
  const name = e.known.artistName.trim()
  const ogTitle = metaOf(home.page, 'og:title')
  const ogDesc = metaOf(home.page, 'og:description')
  const ogUrl = metaOf(home.page, 'og:url')
  const card = metaOf(home.page, 'twitter:card')
  const xTitle = metaOf(home.page, 'twitter:title')
  const xDesc = metaOf(home.page, 'twitter:description')
  if (home.truncated && (!ogTitle || !ogDesc || !ogUrl || !card)) return tooBig('every part of your link preview')
  const evidence = [
    { label: 'shared title', value: ogTitle ? clip(ogTitle, 120) : 'none' },
    { label: 'shared description', value: ogDesc ? clip(ogDesc, 200) : 'none' },
    { label: 'shared address', value: ogUrl ?? 'none' },
    { label: 'X card', value: card ?? 'none' },
    ...(xTitle ? [{ label: 'X title', value: clip(xTitle, 120) }] : []),
    ...(xDesc ? [{ label: 'X description', value: clip(xDesc, 200) }] : []),
  ]
  if (ogTitle && home.page.title) evidence.push({ label: 'same as the page title', value: ogTitle === home.page.title ? 'yes' : 'no' })
  const problems: { short: string; say: string; soft?: boolean }[] = []
  const judgeTitle = (t: string | null, who: string) => {
    if (!t) return
    if (name && isBareName(t, name)) problems.push({ short: 'title is just your name', say: `${who} that is only your name` })
    else if (name && !namesArtist(t, name)) problems.push({ short: 'no name', say: `${who} without your name` })
  }
  if (!ogTitle) problems.push({ short: 'no title', say: 'no title' })
  else judgeTitle(ogTitle, 'a title')
  judgeTitle(xTitle, 'an X title')
  if (!ogDesc) problems.push({ short: 'no description', say: 'no description' })
  else if (name && isBareName(ogDesc, name)) problems.push({ short: 'description is your name', say: 'a description that only says your name' })
  if (xDesc && name && isBareName(xDesc, name)) problems.push({ short: 'X description is your name', say: 'an X description that only says your name' })
  if (!ogUrl) problems.push({ short: 'no address', say: 'no address for your site' })
  else {
    let u: URL | null = null
    try {
      u = new URL(ogUrl, `${e.origin}/`)
    } catch {
      u = null
    }
    const site = new URL(`${e.origin}/`)
    if (!u || !/^https?:$/.test(u.protocol)) problems.push({ short: 'bad address', say: 'an address that isn’t a web address' })
    else if (siteName(u.hostname) !== siteName(site.hostname)) problems.push({ short: 'other site', say: `an address on another site (${siteName(u.hostname)})` })
    else if (/[^/]/.test(u.pathname)) problems.push({ short: 'other page', say: `the address of another page (${u.pathname})` })
  }
  if (!card) problems.push({ short: 'X shows it small', say: 'nothing telling X to show the big picture', soft: true })
  else if (!X_CARDS.has(card.toLowerCase())) problems.push({ short: 'X shows it small', say: `an X card setting X doesn’t know (“${clip(card, 20)}”)`, soft: true })
  const limits = 'Each app draws its own preview, and some keep an old one for days. We read what your home page tells them, not what each app shows.'
  if (!problems.length) return { status: 'pass', value: 'name + description', sentence: 'Shared links show your name and a description.', evidence, limits }
  const says = problems.map((p) => p.say)
  const list = says.length === 1 ? says[0] : `${says.slice(0, -1).join(', ')} and ${says[says.length - 1]}`
  return {
    status: 'fail', ...(problems.every((p) => p.soft) ? { lead: 'Almost' as const } : {}),
    value: problems.length === 1 ? problems[0].short : `${problems.length} problems`,
    sentence: `shared links of your home page have ${list}.`,
    todo: 'Check the title and description on the Listing tab, then publish. If it stays, your site needs an update from whoever built it.',
    action: { kind: 'edit', target: 'listing', label: 'Change the title and description' }, evidence, limits,
  }
})

/* ── alt ────────────────────────────────────────────────────────────────────────────── */

/** Where a picture really comes from: `src`, a lazy loader's attribute, or the first
 *  `srcset` entry. Null when it names none (then it is never merged with another). */
function pictureAddress(a: Record<string, string>): string | null {
  for (const k of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-srcset', 'srcset']) {
    const v = (a[k] ?? '').trim()
    if (!v) continue
    const first = k.endsWith('srcset') ? v.split(',')[0].trim().split(/\s+/)[0] : v
    if (first && !first.startsWith('data:')) return first
  }
  return null
}

const alt = make('alt', (e) => {
  const pages = pagesOf(e)
  const readable = pages.filter((p): p is Extract<PageState, { ok: true }> => p.ok)
  if (!readable.length) {
    const home = homeOf(e)
    return unreadable(home.ok ? { ok: false, path: '/', why: 'no page could be read', noAnswer: true } : home, 'look at your photos')
  }
  // One entry per picture. A picture shown twice is described only if EVERY copy is.
  const seen = new Map<string, { where: string; described: boolean }>()
  let nameless = 0
  for (const p of readable) {
    for (const a of p.page.images) {
      if (decorative(a)) continue
      const src = pictureAddress(a)
      let key: string
      if (!src) key = `#no-address-${nameless++}`
      else {
        try {
          key = new URL(src, `${e.origin}${p.path}`).toString()
        } catch {
          key = `${p.path}#${src}`
        }
      }
      const ok = describes(a.alt)
      const was = seen.get(key)
      if (was) was.described = was.described && ok
      else seen.set(key, { where: `${p.path}: ${shortUrl(src ?? '(no address)', 70)}`, described: ok })
    }
  }
  const total = seen.size
  const missing = [...seen.values()].filter((x) => !x.described).map((x) => x.where)
  const blind = pages.filter((p) => (!p.ok && p.noAnswer) || (p.ok && p.truncated)).map((p) => (p.ok ? `${p.path} (too big to read in full)` : p.path))
  const described = total - missing.length
  const n = readable.length
  const where = `the ${n === 1 ? 'page' : `${n} pages`} we read`
  const evidence = [
    { label: 'pages read', value: readable.map((p) => p.path).join(' · ') },
    { label: 'photos', value: String(total) },
    { label: 'with a description', value: String(described) },
    ...(missing.length ? [{ label: 'without a description', value: missing.slice(0, 5).join(' · ') + (missing.length > 5 ? ` · and ${missing.length - 5} more` : '') }] : []),
    ...(blind.length ? [{ label: 'not fully read', value: blind.join(', ') }] : []),
  ]
  const limits = 'We read your home page and the first pages your sitemap lists (5 at most), as they arrive: pictures a script adds later aren’t counted, and small icons (48 pixels or less) aren’t photos. A picture with an empty description that isn’t marked hidden counts as missing one, and so does a file name or a word like “image”.'
  if (missing.length) {
    return {
      status: 'fail', value: `${described} of ${total}`,
      sentence: total === 1 ? `your one photo on ${where} has no real description.` : `${missing.length} of your ${total} photos on ${where} ${missing.length === 1 ? 'has' : 'have'} no real description.`,
      todo: 'Add a short description to each one, like “Skeen on stage at the Salt Shed”.'.replace('Skeen', e.known.artistName.trim() || 'you'),
      action: { kind: 'edit', target: 'alt', label: 'Describe your photos' }, evidence, limits,
    }
  }
  if (blind.length) return { status: 'unknown', value: 'couldn’t check', sentence: `we couldn’t read all of ${blind.join(', ')}, so we can’t say every photo has a description.`, evidence, limits }
  if (!total) {
    // No photo in the pages as they arrive. If Tapir published photos, the site may add them
    // with a script we don't run: we couldn't see them, which is not "none". With none
    // anywhere there is nothing to describe: the test doesn't apply (not a pass).
    const published = e.known.published?.photos.length ?? 0
    if (published) {
      return { status: 'unknown', value: 'couldn’t check', sentence: `we found no photos on ${where}, though you published ${published} in Tapir, so a script may add them where we can’t see.`, evidence: [...evidence, { label: 'in Tapir: photos', value: `${published} published` }], limits }
    }
    return { status: 'na', value: 'no photos', sentence: `we found no photos on ${where} and none in Tapir.`, evidence, limits }
  }
  return { status: 'pass', value: `${described} of ${total}`, sentence: total === 1 ? `Your one photo on ${where} has a description.` : `All ${total} photos on ${where} have a description.`, evidence, limits }
})

/** A picture marked as decoration, hidden, a one-pixel tracker, or a small icon: not a photo. */
function decorative(a: Record<string, string>): boolean {
  if ((a['aria-hidden'] ?? '').trim().toLowerCase() === 'true') return true
  const role = (a.role ?? '').trim().toLowerCase()
  if (role === 'presentation' || role === 'none') return true
  if ('hidden' in a) return true
  const w = Number.parseInt(a.width ?? '', 10)
  const h = Number.parseInt(a.height ?? '', 10)
  // Both sides stated and 48 px or less: a social icon or a tracker, not a photo.
  return Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0 && w <= 48 && h <= 48
}

export const SHARED_TESTS: Record<Id, SeoTest> = { share, preview, alt }
