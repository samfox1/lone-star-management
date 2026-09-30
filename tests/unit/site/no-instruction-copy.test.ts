// Editor UI and dashboard tool pages must be self-evident: no explanatory paragraphs,
//   except a short, explicitly-approved guidance line in a genuinely confusing spot.
/**
 * THE STANDING RULE, SOFTENED (Sam, 2026-08-12: "the goal is for the ui to be easy
 * enough to not need them"; Sam, 2026-09-28: "Only brief when it adds nice guidance in
 * confusing parts"). The rule is no longer a flat ban on every instructional sentence —
 * it is a ban on FILLER and LONG instruction, with a narrow, reviewed exception for
 * short guidance that earns its place. It drifted once already because nothing enforced
 * it (CODE_AUDIT 2026-09-18) — `style-tools.tsx:364-366` even carries a comment
 * recording that such a line was deliberately removed, and everything added since
 * drifted past it by hand — so the exception below is deliberately narrow, not a
 * reopening of that drift.
 *
 * WHAT THIS WALKS: every `.tsx` file under the editor tree and the dashboard tools tree,
 * by READING THE DIRECTORY (never a hand-listed file array — AGENTS.md rule 4), so a
 * file added tomorrow is swept tomorrow.
 *
 * THE RULE THIS TEST NOW ENFORCES: a `<p>` element whose literal (non-interpolated)
 * text reads as a sentence — six words or more (`MIN_GUIDANCE_WORDS`) — fails UNLESS it
 * is one of:
 *   - a value or dynamic status (too short to be a sentence, or built entirely from
 *     `{expr}`);
 *   - a validation/error message (marked `role="alert"` or styled `accent-red` — it
 *     reports what went wrong, not how to avoid it next time);
 *   - a decision prompt in a confirm dialog (ends in `?` — the user must answer it, it
 *     is not decoration);
 *   - one of four STRUCTURALLY sanctioned shapes: an empty state, a blocked state, a
 *     destructive consequence, or a provenance note; or
 *   - APPROVED GUIDANCE: text that is BOTH (a) capped at `MAX_GUIDANCE_WORDS` — short
 *     enough to read as one clarifying sentence, never a paragraph — AND (b) an EXACT
 *     match to a string in `ALLOWED_GUIDANCE` below. Nothing is approved by matching a
 *     pattern or a topic; a line qualifies only by being copied into that list verbatim,
 *     which is a deliberate, reviewable, one-line diff. Filler and long instruction still
 *     fail: being short is necessary but not sufficient, and being unreviewed fails
 *     regardless of length.
 *
 * PROVING IT CAN FAIL (AGENTS.md rule 1): the `detector itself` block plants samples
 * every way — copy that teaches and must be caught, sanctioned shapes that must not be,
 * and the approved-guidance mechanism proven to bite (unapproved, and approved-but-too-
 * long) as well as to pass (approved and short). A sweep that finds nothing proves
 * nothing unless it is also shown to find something, so all of this is CRITICAL, and so
 * is the walker's own precondition test.
 *
 * `ALLOWED_GUIDANCE` IS NOT THE OLD ALLOWLIST. One existed for a single afternoon
 * (2026-09-18) as a list of KNOWN VIOLATIONS not yet fixed — that rotted by design (a
 * violation sits there forever, since nothing asks it to be resolved) and is gone for
 * good; the note above the planted samples records how each of the nine originals was
 * resolved (deleted, trimmed, or reclassified as one of the four sanctioned shapes).
 * `ALLOWED_GUIDANCE` is the opposite shape: an opt-IN list of copy Sam has reviewed and
 * signed off as worth keeping. Nothing lands there by drifting past review — a new
 * guidance line fails this test by default until someone deliberately adds its exact
 * text here.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src/app/artists/[id]/(dashboard)')
/** The editor, and the tools tree (the Overview and SEO / GEO), which moved into the
 *  `(manager-tools)` route group on 2026-09-24 — same files, new folder. The other manager
 *  tools (brand, epk, enquiries, site…) were never swept; widening to the whole group finds
 *  five lines today, which is a copy decision for Sam, not a path fix. */
const SWEPT_DIRS = ['editor', '(manager-tools)/tools']

type Hit = { file: string; line: number; text: string }

/** Every .tsx file under the swept trees, walked (never hand-listed). */
function allTsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...allTsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Strip a `{...}` JS expression (one level of nested braces — enough for the plain
 *  interpolations and ternaries these files use; a literal sentence never needs more). */
function stripExpressions(s: string): string {
  return s.replace(/\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ')
}

/** Strip nested tags (a `<p>` commonly wraps a `<span>` for one bold word). */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ')
}

const HTML_ENTITIES: Record<string, string> = { apos: "'", quot: '"', amp: '&', lt: '<', gt: '>', times: '×', nbsp: ' ' }

function decode(s: string): string {
  return s.replace(/&([a-z]+);/gi, (whole, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? whole)
}

/** A validation/error report, not guidance: it says what went wrong, never how to avoid
 *  it — style-tools.tsx's own removed-instruction-line comment is the reason this stays
 *  narrow rather than swallowing every red string in the tree. */
function looksLikeErrorReport(attrs: string): boolean {
  return /role\s*=\s*"alert"/.test(attrs) || /accent-red/.test(attrs)
}

/** A sanctioned empty state: "Nothing here yet", "No photos yet", "There is nothing…".
 *  Also the capability-absent form — "This site hasn't declared any styleable sections",
 *  "This site hasn't made Heading styleable" — which is the same thing said about a
 *  connected site's declaration rather than about a list. Both lead with the absence,
 *  which is the test: an empty state reports what is not there, it does not set homework. */
function looksLikeEmptyState(text: string): boolean {
  if (/^(nothing\b|no\s|there('|’)?s?\s+is\s+no|there\s+is\s+nothing)/i.test(text)) return true
  return /^this site (has\s?n'?o?t|hasn('|’)?t)\s+(declared|made|sent)\b/i.test(text)
}

/** A BLOCKED STATE: the option is chosen, a precondition is missing, and this says which.
 *  Narrow on purpose — it must wear `text-status-pending`, the codebase's own marker for
 *  "chosen but not yet in effect", the same way looksLikeErrorReport keys on accent-red.
 *  That styling only appears on copy that is conditionally rendered, so the category
 *  cannot be borrowed by a caption that is always on screen. */
function looksLikeBlockedState(attrs: string): boolean {
  return /text-status-pending/.test(attrs)
}

/** A DESTRUCTIVE CONSEQUENCE: one clause naming what an irreversible action will take
 *  away. "Anything changed since then will be lost." is not instruction — it is the cost,
 *  and a commit surface that hides the cost is worse than one that states it. Capped
 *  short so it cannot grow an explanation: the moment it needs a second sentence it is
 *  teaching again, and this test says so. */
const DESTRUCTIVE = /\bwill be lost\b|\bcan(?:'|’)?not be undone\b|\bcan(?:'|’)?t be undone\b|\bpermanently (?:deleted|removed|gone)\b/i

function looksLikeDestructiveConsequence(text: string, words: string[]): boolean {
  return DESTRUCTIVE.test(text) && words.length <= 12
}

/** PROVENANCE: where a read-only value came from. The fields beside it are disabled, so
 *  naming the source is what makes them legible rather than broken. "Synced from Shopify.
 *  Price updates live." Kept to the source and the consequence — no errand. */
function looksLikeProvenance(text: string, words: string[]): boolean {
  return /^(synced|imported|pulled|read) from\b/i.test(text) && words.length <= 10
}

/** A short status word/phrase reporting the CURRENT state ("Saved", "Checking for
 *  changes…") is not a sentence of guidance — a sentence needs room to explain
 *  something, and under six words there isn't any. */
const MIN_GUIDANCE_WORDS = 6

/** APPROVED GUIDANCE (Sam, 2026-09-28: "Only brief when it adds nice guidance in
 *  confusing parts"). Two independent conditions, both required:
 *   1. capped at MAX_GUIDANCE_WORDS — one clarifying sentence, never a paragraph;
 *   2. an EXACT match to a string in ALLOWED_GUIDANCE — an opt-in list Sam has actually
 *      reviewed, not a pattern any short line can slide through.
 *  Editing an approved line at all — a word, a comma, one extra clause — drops it out of
 *  the list (no longer an exact match), so it has to be re-approved too. The cap is
 *  enforced even for a listed string: if a future edit stretches an approved line past
 *  MAX_GUIDANCE_WORDS while somehow keeping the old text ALSO in the list, it still
 *  fails, so raising the word count is never itself the thing that sneaks past review. */
const MAX_GUIDANCE_WORDS = 16

/** Empty on purpose: nothing in the swept trees needs this exception today. Add a guide
 *  line here ONLY as its own reviewed decision — the exact text, copied verbatim from
 *  the JSX — never to make a failing test pass without reading why it failed. */
const ALLOWED_GUIDANCE: string[] = []

function looksLikeApprovedGuidance(text: string, words: string[]): boolean {
  return words.length <= MAX_GUIDANCE_WORDS && ALLOWED_GUIDANCE.includes(text)
}

/** Every `<p>` element in a file, classified. Deliberately simple (regex, not a real
 *  JSX parser): this codebase's `<p>` elements do not nest another `<p>`, so a
 *  non-greedy match to the next `</p>` is exact for every file this sweep covers. */
export function instructionalParagraphsIn(src: string, file: string): Hit[] {
  const hits: Hit[] = []
  // `<p` followed by a space or `>`: a `<pre>` (or `<path>`) is not a paragraph (2026-09-30: a
  // `<pre>` holding a robots.txt was read as a `<p>` running on to the next `</p>`).
  const re = /<p(?=[\s>])([^>]*)>([\s\S]*?)<\/p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const [, attrs, inner] = m
    const text = decode(stripTags(stripExpressions(inner))).replace(/\s+/g, ' ').trim()
    if (!text) continue // pure interpolation ({error}, {children}) — a value, not prose
    if (looksLikeErrorReport(attrs)) continue
    if (looksLikeBlockedState(attrs)) continue
    if (text.endsWith('?')) continue // a decision the user must answer, not a caption
    if (looksLikeEmptyState(text)) continue
    const words = text.split(' ').filter(Boolean)
    if (words.length < MIN_GUIDANCE_WORDS) continue
    if (looksLikeDestructiveConsequence(text, words)) continue
    if (looksLikeProvenance(text, words)) continue
    if (looksLikeApprovedGuidance(text, words)) continue
    // "…nothing to publish", "…nothing else to do" — a short status wrapped around the
    // word "nothing" reads as state, not instruction, as long as it stays short.
    if (/\bnothing\b/i.test(text) && words.length <= 10) continue
    const line = src.slice(0, m.index).split('\n').length
    hits.push({ file, line, text })
  }
  return hits
}

function findInstructionalParagraphs(file: string): Hit[] {
  return instructionalParagraphsIn(readFileSync(file, 'utf8'), relative(process.cwd(), file))
}

function sweep(): Hit[] {
  const hits: Hit[] = []
  for (const d of SWEPT_DIRS) hits.push(...allTsxFiles(join(ROOT, d)).flatMap(findInstructionalParagraphs))
  return hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
}

/**
 * THE OLD ALLOWLIST STAYED GONE; A DIFFERENT ONE REPLACED IT (2026-09-28).
 *
 * The first one existed for one afternoon (2026-09-18) because the nine violations this
 * sweep found sat in files other agents held open. Every one was resolved, and each in
 * exactly one of three ways — never by parking it on a list:
 *
 *   DELETED — copy that taught. "Small PNGs with a transparent background work best…",
 *     "A transparent logo turns invisible in dark-mode social clients…".
 *   TRIMMED — one useful clause welded to one instructional clause; the clause that
 *     carried a value or a cost stayed, the errand went. The publish bar keeps its count
 *     and drops "Enter your password to make them live"; the restore modal keeps
 *     "Anything changed since then will be lost" and drops the sentence its own button
 *     already says.
 *   SANCTIONED — not instruction at all, and now recognised STRUCTURALLY by the
 *     classifiers above rather than by file:line. An empty state, a blocked state, a
 *     destructive consequence, a provenance note.
 *
 * That list rotted by design: a violation sits on a "known, not yet fixed" list forever,
 * since nothing about being listed asks anyone to fix it. `ALLOWED_GUIDANCE` (above,
 * near MIN_GUIDANCE_WORDS) cannot rot the same way, because it is not a list of problems
 * — it is a list of decisions Sam already made. Nothing joins it by drifting; a line
 * joins only when someone deliberately copies its exact text there, which is the same
 * one-line, reviewable diff every time. If a future case genuinely needs a wider
 * exception than "short and on the list," widen a classifier deliberately and write down
 * why — do not go back to listing known violations.
 */

/** Planted samples. The detector has to be shown to bite AND shown not to over-bite;
 *  a sweep that finds nothing is worthless if it also finds nothing when something is
 *  wrong. These are inline so they cannot drift with the tree. */
const TEACHES = [
  '<p className="text-xs">Small PNGs with a transparent background work best — the site scales anything bigger down to 32px.</p>',
  '<p className="text-xs">Upload a logo on the Brand page, or a hero image on the Site page, and it can be used here.</p>',
  '<p className="text-xs">Enter your password below to make these changes live on the site.</p>',
]

const SANCTIONED = [
  ['empty state', '<p className="text-sm">Nothing here yet, so there is nothing to publish today.</p>'],
  ['capability-absent empty state', "<p className=\"text-sm\">This site hasn&apos;t declared any styleable sections, so there is nothing to set.</p>"],
  ['blocked state', '<p className="text-[10px] text-status-pending">The image trail follows your cursor image — set one above first.</p>'],
  ['destructive consequence', '<p className="text-sm">Anything changed since then will be lost.</p>'],
  ['provenance', '<p className="text-[10px]">Synced from Shopify. Price updates live.</p>'],
  ['error report', '<p role="alert" className="accent-red">That file is bigger than the 30 MB this bucket accepts.</p>'],
  ['a question', '<p className="text-sm">Delete this show and everything attached to it?</p>'],
  ['a bare value', '<p className="text-sm">{count}</p>'],
  // A <pre> holding a file the site sent (robots.txt) is not a paragraph, whatever it says.
  ['a <pre> block, which is not a paragraph', '<pre className="m-0">Upload a logo on the Brand page, or a hero image on the Site page, and it can be used here.</pre><p className="text-sm">{count}</p>'],
] as const

describe('the detector itself', () => {
  it.each(TEACHES)('CRITICAL: catches copy that teaches — %s', (sample) => {
    expect(instructionalParagraphsIn(sample, 'planted.tsx')).toHaveLength(1)
  })

  it.each(SANCTIONED)('CRITICAL: leaves a %s alone', (_kind, sample) => {
    expect(instructionalParagraphsIn(sample, 'planted.tsx')).toEqual([])
  })

  it('CRITICAL: the walker actually descends — a sweep over nothing would pass forever', () => {
    // Without this, every assertion below is vacuous the day the walk breaks.
    // EACH swept tree must yield files, not just the total: a stale path for one of them
    // (the tools tree moved into (manager-tools)/ on 2026-09-24) would otherwise hide
    // behind the other's count. The total floor dropped from 40 to 30 when the SEO page's
    // unused copy-button.tsx was deleted (40 files left).
    for (const d of SWEPT_DIRS) expect(allTsxFiles(join(ROOT, d)).length, d).toBeGreaterThan(5)
    const files = SWEPT_DIRS.flatMap((d) => allTsxFiles(join(ROOT, d)))
    expect(files.length).toBeGreaterThan(30)
    expect(files.some((f) => f.endsWith('site-tools.tsx'))).toBe(true)
    expect(files.some((f) => f.endsWith('og-image-picker.tsx'))).toBe(true)
  })
})

/** The approved-guidance exception, proven both ways: default-deny (nothing is exempt
 *  just for being short), the approval actually working, the cap still applying to an
 *  approved line, and an edited line falling back out of the list. `ALLOWED_GUIDANCE` is
 *  cleared after every test here so no planted approval leaks into another test or into
 *  the real sweep below. */
describe('approved guidance — exact match AND capped, never a pattern', () => {
  afterEach(() => {
    ALLOWED_GUIDANCE.length = 0
  })

  // 14 words — under MAX_GUIDANCE_WORDS on its own; the cap test below is what pushes a
  // variant of it over.
  const SHORT = 'Drop an image here, or paste a link to use it as the cover.'

  it('CRITICAL: a short guidance line is still caught while it is NOT on the list — nothing is exempt by default', () => {
    expect(instructionalParagraphsIn(`<p className="text-xs">${SHORT}</p>`, 'planted.tsx')).toHaveLength(1)
  })

  it('CRITICAL: the same line, once approved, is let through', () => {
    ALLOWED_GUIDANCE.push(SHORT)
    expect(instructionalParagraphsIn(`<p className="text-xs">${SHORT}</p>`, 'planted.tsx')).toEqual([])
  })

  it('CRITICAL: an approved line that grows past the cap is caught anyway — short is necessary, not just listed', () => {
    const long = `${SHORT} Also, here is more text stretching this well past the word cap on purpose today.`
    ALLOWED_GUIDANCE.push(long)
    expect(instructionalParagraphsIn(`<p className="text-xs">${long}</p>`, 'planted.tsx')).toHaveLength(1)
  })

  it('an approved line edited even slightly is no longer an exact match, so it is caught too', () => {
    ALLOWED_GUIDANCE.push(SHORT)
    const edited = SHORT.replace('image', 'photo')
    expect(instructionalParagraphsIn(`<p className="text-xs">${edited}</p>`, 'planted.tsx')).toHaveLength(1)
  })
})

describe('no instructional copy in editor UI or dashboard tool pages', () => {
  it('CRITICAL: the swept trees are clean', () => {
    const hits = sweep()
    const report = hits.map((h) => `  ${h.file}:${h.line} — "${h.text}"`).join('\n')
    expect(hits, hits.length ? `Instructional copy found:\n${report}` : '').toEqual([])
  })
})
