/**
 * "Looks right when shared": three tests over the LIVE site. Pure, synchronous, never throws.
 *
 *   share    the share picture, from the file itself (evidence.shareImage, share-image.ts):
 *            it loads, it is a picture, big enough, wide, not huge
 *   preview  the words and address a shared link carries: og:title, og:description, og:url,
 *            twitter:card on the home page
 *   alt      every content `<img>` on every tested page has a real description; with no photo
 *            on the pages or in Tapir it does not apply (`na`)
 */
import {
  clip, homeOf, isBareName, metaOf, namesArtist, pagesOf, shortUrl, type PageState,
} from './html'
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
  return { status: 'unknown', value: 'couldn’t open', sentence: `${state.why}, so we couldn’t ${what}.`, evidence: [{ label: 'home page', value: state.why }] }
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

const share = make('share', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your share picture')
  const named = metaOf(home.page, 'og:image') ?? metaOf(home.page, 'og:image:url') ?? metaOf(home.page, 'og:image:secure_url')
  const img = e.shareImage
  const action = { kind: 'edit', target: 'share', label: 'Change the share picture' } as const
  const limits = 'We check the picture’s size, shape and file, not what’s in it. Each app crops and saves its own copy, so a change can take days to show there.'
  const good = '1200 × 630 pixels, a PNG or JPEG under 5 MB.'
  if (!img) {
    if (named) return { status: 'unknown', value: 'couldn’t open', sentence: 'your site names a share picture, but we didn’t open it this time.', evidence: [{ label: 'picture', value: shortUrl(named, 80) }], limits }
    return { status: 'fail', value: 'none', sentence: 'your site doesn’t name a share picture, so apps pick one or show none.', good, todo: 'Add a share picture on the SEO page, then publish.', action, evidence: [{ label: 'picture', value: 'none named on the home page' }], limits }
  }
  const evidence: { label: string; value: string }[] = [{ label: 'picture', value: shortUrl(img.url, 80) }]
  if (img.status === null) {
    const why: Record<string, string> = {
      'not-https': 'your share picture isn’t on a secure (https) address, so some apps won’t load it.',
      'redirect-not-https': 'your share picture’s address sends visitors to an insecure (http) address, so some apps won’t load it.',
      'not-public': 'your share picture points to a private address that no one outside can open.',
      'bad-url': 'your share picture’s address isn’t a working web address.',
    }
    const said = why[img.error ?? '']
    evidence.push({ label: 'answer', value: img.error ?? 'none' })
    if (said) return { status: 'fail', value: 'can’t load', sentence: said, good, todo: 'Upload the share picture again on the SEO page, then publish.', action, evidence, limits }
    return { status: 'unknown', value: 'couldn’t open', sentence: `the share picture didn’t load when we tried${img.error === 'timeout' ? ' (it timed out)' : ''}.`, evidence, limits }
  }
  const type = (img.contentType ?? '').split(';')[0].trim().toLowerCase()
  const size = [img.width && img.height ? `${img.width} × ${img.height}` : null, img.format ? FORMAT_NAME[img.format] : null, img.bytes !== null ? `${img.tooBig ? 'over ' : ''}${kb(img.bytes)}` : null].filter(Boolean).join(' · ')
  evidence.push({ label: 'answer', value: `${img.status}${type ? ` · ${type}` : ''}` })
  if (size) evidence.push({ label: 'size', value: size })
  const fail = (value: string, sentence: string, lead?: 'Almost'): Result => ({ status: 'fail', ...(lead ? { lead } : {}), value, sentence, good, todo: 'Upload a 1200 × 630 picture on the SEO page, then publish.', action, evidence, limits })
  if (img.status < 200 || img.status >= 300) return fail('broken link', `your share picture’s link is broken: it answers with error ${img.status}.`)
  if (img.format === 'svg') return fail('SVG picture', 'your share picture is an SVG drawing, which sharing apps don’t show.')
  if (!type.startsWith('image/') || img.format === null) return fail('not a picture', 'your share picture’s link doesn’t open a picture.')
  if (img.broken) return fail('broken file', 'your share picture’s file is cut off, so apps can’t show it.')
  if ((img.bytes ?? 0) > SHARE_MAX_BYTES || img.tooBig) return fail('too big', `your share picture is ${img.tooBig ? 'over ' : ''}${kb(img.bytes ?? SHARE_MAX_BYTES)}; X won’t show one over 5 MB.`)
  if (!img.width || !img.height) {
    if (img.format === 'png' || img.format === 'jpeg' || img.format === 'gif' || img.format === 'webp') return fail('broken file', 'your share picture’s file is damaged: we couldn’t read its size.')
    return { status: 'unknown', value: 'couldn’t measure', sentence: `we can’t measure ${img.format ? `${FORMAT_NAME[img.format]} pictures` : 'this kind of picture'} yet, so we don’t know its size.`, evidence, limits }
  }
  const { width: w, height: h } = img
  if (w < SHARE_TINY || h < SHARE_TINY) return fail('tiny', `your share picture is tiny, ${w} × ${h} pixels.`)
  const ratio = w / h
  if (ratio < SHARE_RATIO.min || ratio > SHARE_RATIO.max) return fail(`${w} × ${h}`, `your share picture is ${w} × ${h}, so apps will crop it to a wide shape.`, 'Almost')
  if (w < SHARE_MIN.width || h < SHARE_MIN.height) return fail(`${w} × ${h}`, `your share picture is ${w} × ${h}, smaller than 1200 × 630, so it can look blurry.`, 'Almost')
  return { status: 'pass', value: `${w} × ${h}`, sentence: `Your share picture is ${w} × ${h}, sharp and the right shape.`, evidence, limits }
})

/* ── preview ────────────────────────────────────────────────────────────────────────── */

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')

const preview = make('preview', (e) => {
  const home = homeOf(e)
  if (!home.ok) return unreadable(home, 'read your link preview')
  const name = e.known.artistName.trim()
  const ogTitle = metaOf(home.page, 'og:title')
  const ogDesc = metaOf(home.page, 'og:description')
  const ogUrl = metaOf(home.page, 'og:url')
  const card = metaOf(home.page, 'twitter:card')
  const evidence = [
    { label: 'shared title', value: ogTitle ? clip(ogTitle, 120) : 'none' },
    { label: 'shared summary', value: ogDesc ? clip(ogDesc, 200) : 'none' },
    { label: 'shared address', value: ogUrl ?? 'none' },
    { label: 'X card', value: card ?? 'none' },
  ]
  if (ogTitle && home.page.title) evidence.push({ label: 'same as the page title', value: ogTitle === home.page.title ? 'yes' : 'no' })
  const problems: { short: string; say: string; soft?: boolean }[] = []
  if (!ogTitle) problems.push({ short: 'no title', say: 'no title' })
  else if (name && !namesArtist(ogTitle, name)) problems.push({ short: 'no name', say: 'a title without your name' })
  if (!ogDesc) problems.push({ short: 'no summary', say: 'no summary' })
  else if (name && isBareName(ogDesc, name)) problems.push({ short: 'bare summary', say: 'a summary that only says your name' })
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
    else if (bareHost(u.hostname) !== bareHost(site.hostname)) problems.push({ short: 'other site', say: `an address on another site (${bareHost(u.hostname)})` })
    else if (u.pathname.replace(/\/+$/, '') !== '') problems.push({ short: 'other page', say: `the address of another page (${u.pathname})` })
  }
  if (!card) problems.push({ short: 'no X card', say: 'no card size for X', soft: true })
  const limits = 'Each app draws its own preview, and some keep an old one for days. We read what your home page tells them, not what each app shows.'
  if (!problems.length) return { status: 'pass', value: 'name + summary', sentence: 'Shared links show your name and a one-line summary.', evidence, limits }
  const says = problems.map((p) => p.say)
  const list = says.length === 1 ? says[0] : `${says.slice(0, -1).join(', ')} and ${says[says.length - 1]}`
  return {
    status: 'fail', ...(problems.every((p) => p.soft) ? { lead: 'Almost' as const } : {}),
    value: problems.length === 1 ? problems[0].short : `${problems.length} problems`,
    sentence: `shared links of your home page have ${list}.`,
    todo: 'Check the title and summary on the SEO page, then publish. If it stays, your site needs an update from whoever built it.',
    action: { kind: 'edit', target: 'listing', label: 'Change the title and summary' }, evidence, limits,
  }
})

/* ── alt ────────────────────────────────────────────────────────────────────────────── */

/** A description that describes nothing: a file name, or a placeholder word. */
const NOT_A_DESCRIPTION = /^(?:.*\.(?:jpe?g|png|gif|webp|avif|svg|heic)|image|img|photo|picture|pic|untitled|placeholder|alt|graphic|thumbnail|banner)$/i

const alt = make('alt', (e) => {
  const pages = pagesOf(e)
  const readable = pages.filter((p): p is Extract<PageState, { ok: true }> => p.ok)
  if (!readable.length) {
    const home = homeOf(e)
    return unreadable(home.ok ? { ok: false, path: '/', why: 'no page could be read', noAnswer: true } : home, 'look at your photos')
  }
  const seen = new Set<string>()
  let total = 0
  const missing: string[] = []
  for (const p of readable) {
    for (const a of p.page.images) {
      if (decorative(a)) continue
      const src = a.src ?? a['data-src'] ?? ''
      let key = src
      try {
        key = new URL(src, `${e.origin}${p.path}`).toString()
      } catch {
        key = `${p.path}#${src}`
      }
      if (seen.has(key)) continue
      seen.add(key)
      total++
      const text = (a.alt ?? '').replace(/\s+/g, ' ').trim()
      if (!text || NOT_A_DESCRIPTION.test(text)) missing.push(`${p.path}: ${shortUrl(src || '(no address)', 70)}`)
    }
  }
  const blind = pages.filter((p) => (!p.ok && p.noAnswer) || (p.ok && p.truncated)).map((p) => p.path)
  const described = total - missing.length
  const evidence = [
    { label: 'pages read', value: readable.map((p) => p.path).join(' · ') },
    { label: 'photos', value: String(total) },
    { label: 'with a description', value: String(described) },
    ...(missing.length ? [{ label: 'without a description', value: missing.slice(0, 5).join(' · ') + (missing.length > 5 ? ` · and ${missing.length - 5} more` : '') }] : []),
    ...(blind.length ? [{ label: 'not fully read', value: blind.join(', ') }] : []),
  ]
  const limits = 'We read the pictures in each page as it arrives; ones a script adds later aren’t counted. A picture marked with an empty description but not hidden counts as missing one, because we can’t tell a decoration from a photo.'
  if (missing.length) {
    return {
      status: 'fail', value: `${described} of ${total}`,
      sentence: `${missing.length} of your ${total} photos ${missing.length === 1 ? 'has' : 'have'} no description.`,
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
      return { status: 'unknown', value: 'couldn’t check', sentence: `we found no photos in your pages as they arrive, though you published ${published} in Tapir, so a script may add them where we can’t see.`, evidence: [...evidence, { label: 'in Tapir: photos', value: `${published} published` }], limits }
    }
    return { status: 'na', value: 'no photos', sentence: 'we found no photos on your pages and none in Tapir, so this doesn’t apply.', evidence, limits }
  }
  return { status: 'pass', value: `${described} of ${total}`, sentence: total === 1 ? 'Your one photo has a description.' : `All ${total} photos have a description.`, evidence, limits }
})

/** A picture marked as decoration, hidden, or a one-pixel tracker: not a photo to describe. */
function decorative(a: Record<string, string>): boolean {
  if ((a['aria-hidden'] ?? '').trim().toLowerCase() === 'true') return true
  const role = (a.role ?? '').trim().toLowerCase()
  if (role === 'presentation' || role === 'none') return true
  if ('hidden' in a) return true
  const w = Number.parseInt(a.width ?? '', 10)
  const h = Number.parseInt(a.height ?? '', 10)
  return w >= 0 && h >= 0 && w <= 1 && h <= 1
}

export const SHARED_TESTS: Record<Id, SeoTest> = { share, preview, alt }
