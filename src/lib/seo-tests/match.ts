/**
 * How the who / shared / facts tests decide that two pieces of text are "the same words", that
 * a picture's description describes anything, and that a release title is shown on a page.
 * Pure. Kept apart from html.ts (the page reader) so the matching rules can change without
 * touching how a page is read.
 *
 * Every rule here was written against a repro from the independent check
 * (scratchpad verify-content.md, 2026-09-29): B1 typography, A2 junk descriptions, R1 titles
 * matched across word boundaries.
 */
import { collapse, pageNodes, hasType, isObj, textOf, type LdNode, type Page } from './html'

/* ── typography ─────────────────────────────────────────────────────────────────────── */

/** Characters a site's typesetting adds or swaps that are not a different WORD: curly quotes,
 *  dashes, soft hyphens, zero-width marks. A bio typed with straight quotes and `--` is the
 *  same bio shown with “ ” and —. */
function plainType(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/&shy;|&zwnj;|&zwj;|&lrm;|&rlm;/gi, '')
    .replace(/[­​-‏⁠﻿]/g, '')
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/-{2,}/g, '-')
    .toLowerCase()
}

/** For comparing short text (a title, a genre): typography folded, whitespace collapsed. */
export const matchFold = (s: string): string => collapse(plainType(s))

/** For finding text inside text: typography folded and every space removed (a tag between two
 *  words may or may not leave one). Apply to BOTH sides. */
export const matchSquash = (s: string): string => plainType(s).replace(/\s+/g, '')

/** A text's sentences: split after . ! ? … and the CJK / Arabic stops 。！？؟. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|(?<=[。！？؟])/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

/* ── picture descriptions ───────────────────────────────────────────────────────────── */

/** Scripts written without spaces between words: two letters there can already be a word. */
const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u
/** Whole descriptions that describe nothing (a CMS default, a code word, a bare label). */
const EMPTY_WORDS = new Set(['undefined', 'null', 'none', 'nan', 'alt', 'alt text', 'alttext', 'image', 'img', 'photo', 'picture', 'pic', 'untitled', 'placeholder', 'graphic', 'thumbnail', 'banner', 'logo', 'icon', 'avatar', 'cover', 'default', 'file', 'photo description', 'image description'])
/** A camera or screenshot file name, or a label with a number: "IMG_1234", "DSC00123",
 *  "Image 1", "photo3", "Screen Shot 2026-09-01 at 10.00.00 AM". */
const FILE_NAME = /^(?:img|dsc[nf]?|dcim|pxl|mvimg|image|photo|picture|pic|untitled|screen ?shot|screenshot|capture)[\s_-]*[\d\s._:-]*(?:at [\d.: ]+(?:am|pm)?)?$/i
const FILE_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|heic|tiff?|bmp)$/i

/** Does this alt text describe the picture at all? Empty, a file name, a camera code, a bare
 *  label word or punctuation does not. Real words do, in any script. */
export function describes(alt: string | undefined | null): boolean {
  const text = collapse(alt ?? '')
  if (!text) return false
  const lower = text.toLowerCase()
  if (EMPTY_WORDS.has(lower) || FILE_EXT.test(text) || FILE_NAME.test(text)) return false
  const letters = (text.match(/\p{L}/gu) ?? []).length
  return DENSE.test(text) ? letters >= 2 : letters >= 3 && /\p{L}{3,}/u.test(text)
}

/* ── is a title shown on a page? ────────────────────────────────────────────────────── */

const wordsIn = (s: string) => plainType(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Do `want`'s words appear in `have`, whole and in order? Also allows the title's words run
 *  together ("OutWest" for "Out West") or split, but only on WORD boundaries at both ends. */
function wordsFound(want: string[], have: string[]): boolean {
  const flat = want.join('')
  for (let i = 0; i < have.length; i++) {
    let joined = ''
    for (let j = i; j < have.length && joined.length < flat.length; j++) {
      joined += have[j]
      if (joined === flat) return true
    }
  }
  return false
}

/** Words every artist site has in its menu or footer. A release titled with one of them alone
 *  ("Home", "Tour", "Music") can't be told from the menu by its words. */
const MENU_WORDS = new Set([
  'home', 'tour', 'tours', 'music', 'about', 'bio', 'contact', 'shop', 'store', 'merch', 'news', 'videos', 'video', 'shows', 'events', 'dates',
  'press', 'epk', 'gallery', 'photos', 'listen', 'watch', 'follow', 'subscribe', 'blog', 'links', 'booking', 'faq', 'search', 'menu', 'more',
  'login', 'cart', 'releases', 'discography', 'live', 'new', 'latest', 'stream', 'download', 'tickets', 'social', 'connect', 'newsletter',
])

/** A title that can stand for a release when found in text: at least 3 letters or digits, and
 *  not one common menu word alone ("Home", "Tour"). */
export function distinctiveTitle(title: string): boolean {
  const words = wordsIn(title)
  const letters = words.join('').length
  return letters >= 3 && !(words.length === 1 && MENU_WORDS.has(words[0]))
}

/** Scripts written without spaces between words (a word is found as a run of characters). */
const denseScript = (s: string): boolean => DENSE.test(s)

/** Does `text` name `phrase` as whole words, in any case and typography? In a script written
 *  without spaces, as a run of characters. */
export function namesPhrase(text: string, phrase: string): boolean {
  const want = wordsIn(phrase)
  if (!want.length) return false
  if (denseScript(phrase)) return matchSquash(text).includes(matchSquash(phrase))
  return wordsFound(want, wordsIn(text))
}

/** Words in a text, the way a reader counts them: Intl's word segmenter (so Chinese and
 *  Japanese count words, not whole sentences), else runs of letters and digits. */
export function wordCount(text: string): number {
  try {
    const seg = new Intl.Segmenter('und', { granularity: 'word' })
    let n = 0
    for (const s of seg.segment(text)) if (s.isWordLike) n++
    return n
  } catch {
    return wordsIn(text).length
  }
}

/**
 * Is a release titled `title` shown on these pages, as words or a picture's description?
 *   'yes'     its words, whole and in order, in the page's words or a picture's description
 *   'no'      nowhere
 *   'unsure'  the title is one common menu word ("Home", "Tour") found only in running text,
 *             where the menu can't be told from the release; or it has no letters or digits
 *             at all ("🔥🔥"). A one-word title that is NOT a menu word counts where found,
 *             even inside a sentence (said in the test's limits).
 */
export function titleShown(title: string, pages: readonly Page[]): 'yes' | 'no' | 'unsure' {
  const want = wordsIn(title)
  if (!want.length) return 'unsure'
  let inText = false
  for (const p of pages) {
    for (const alt of p.images.map((i) => i.alt ?? '')) if (wordsFound(want, wordsIn(alt))) return 'yes'
    if (wordsFound(want, wordsIn(p.text))) inText = true
  }
  if (!inText) return 'no'
  return want.length === 1 && MENU_WORDS.has(want[0]) ? 'unsure' : 'yes'
}

/* ── whose fact card is it? ─────────────────────────────────────────────────────────── */

/**
 * The artist's OWN node on a page: a top-level MusicGroup or Person that the page ties to this
 * artist, by `@id` ending `#artist` (the bridge's), by `url` on the artist's own site, or by the
 * artist's name. Never simply "the first one": a page can carry another band's card. Several
 * nodes with the chosen `@id` are merged (JSON-LD reads them as one).
 * `others` = the names of the MusicGroup/Person nodes that are NOT the artist.
 */
export function ownArtistNode(page: Page, artistName: string, origin: string): { node: LdNode | null; others: string[] } {
  const candidates = pageNodes(page).filter((n) => hasType(n, 'MusicGroup', 'Person'))
  const others = () => candidates.map((n) => textOf(n.name) ?? 'an unnamed artist')
  const byId = candidates.filter((n) => typeof n['@id'] === 'string' && /#artist$/.test(n['@id'] as string))
  if (byId.length) {
    const id = byId[0]['@id']
    return { node: Object.assign({}, ...byId.filter((n) => n['@id'] === id).reverse()) as LdNode, others: [] }
  }
  const host = (u: unknown) => {
    try {
      return typeof u === 'string' ? new URL(u, origin).hostname.toLowerCase().replace(/^www\./, '') : null
    } catch {
      return null
    }
  }
  const site = host(origin)
  const name = matchFold(artistName)
  const mine = candidates.find((n) => (site && host(n.url) === site) || (name && matchFold(textOf(n.name) ?? '') === name))
  return mine ? { node: mine, others: [] } : { node: null, others: candidates.length ? others() : [] }
}

/** A sameAs entry as a web address: a string, or `{ "@id": … }` / `{ url: … }`. */
export function sameAsUrls(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v]
  const out: string[] = []
  for (const x of list) {
    const u = typeof x === 'string' ? x : isObj(x) ? (typeof x['@id'] === 'string' ? x['@id'] : typeof x.url === 'string' ? x.url : null) : null
    if (u && collapse(u)) out.push(collapse(u))
  }
  return out
}
