// Editor UI and dashboard tool pages must be self-evident: no explanatory paragraphs.
/**
 * THE STANDING RULE (Sam, repeated many times, most recently 2026-08-12: "the goal is
 * for the ui to be easy enough to not need them"): no instructional caption text in
 * editor UI or dashboard tool pages — no explanatory paragraphs, no headings with an
 * explainer beneath. It has drifted because nothing enforced it (CODE_AUDIT 2026-09-18)
 * — `style-tools.tsx:364-366` even carries a comment recording that such a line was
 * deliberately removed once, and everything added since drifted past it by hand.
 *
 * WHAT THIS WALKS: every `.tsx` file under the editor tree and the dashboard tools tree,
 * by READING THE DIRECTORY (never a hand-listed file array — AGENTS.md rule 4), so a
 * file added tomorrow is swept tomorrow.
 *
 * WHAT COUNTS AS A VIOLATION: a `<p>` element whose literal (non-interpolated) text
 * reads as a sentence of guidance — "how this works", "what to do next", "why this
 * looks the way it does" — as opposed to: a value or dynamic status (too short to be a
 * sentence, or built entirely from `{expr}`), a validation/error message (marked
 * `role="alert"` or styled `accent-red` — it reports what went wrong, not how to avoid
 * it next time), a decision prompt in a confirm dialog (ends in `?` — the user must
 * answer it, it is not decoration), or a sanctioned empty state ("Nothing here yet",
 * "No X yet", "There is nothing ... yet").
 *
 * PROVING IT CAN FAIL (AGENTS.md rule 1): run this file against the tree as it stood
 * before the allowlist below existed — every entry in KNOWN_VIOLATIONS turned this test
 * red. That's how the list was built, not guessed.
 *
 * THE ALLOWLIST BELOW IS DOCUMENTED, DATED, KNOWN DEBT — never license for a new one.
 * It must only ever SHRINK: deleting the instructional copy at a listed location and
 * removing its entry is the only way it changes size. Adding an entry for a NEW
 * violation is not what this list is for — a new one should never ship in the first
 * place, because this test fails on it the day it lands.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src/app/artists/[id]/(dashboard)')
const SWEPT_DIRS = ['editor', 'tools']

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

/** A sanctioned empty state: "Nothing here yet", "No photos yet", "There is nothing…". */
function looksLikeEmptyState(text: string): boolean {
  return /^(nothing\b|no\s|there('|’)?s?\s+is\s+no|there\s+is\s+nothing)/i.test(text)
}

/** A short status word/phrase reporting the CURRENT state ("Saved", "Checking for
 *  changes…") is not a sentence of guidance — a sentence needs room to explain
 *  something, and under six words there isn't any. */
const MIN_GUIDANCE_WORDS = 6

/** Every `<p>` element in a file, classified. Deliberately simple (regex, not a real
 *  JSX parser): this codebase's `<p>` elements do not nest another `<p>`, so a
 *  non-greedy match to the next `</p>` is exact for every file this sweep covers. */
function findInstructionalParagraphs(file: string): Hit[] {
  const src = readFileSync(file, 'utf8')
  const hits: Hit[] = []
  const re = /<p([^>]*)>([\s\S]*?)<\/p>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const [, attrs, inner] = m
    const text = decode(stripTags(stripExpressions(inner))).replace(/\s+/g, ' ').trim()
    if (!text) continue // pure interpolation ({error}, {children}) — a value, not prose
    if (looksLikeErrorReport(attrs)) continue
    if (text.endsWith('?')) continue // a decision the user must answer, not a caption
    if (looksLikeEmptyState(text)) continue
    const words = text.split(' ').filter(Boolean)
    if (words.length < MIN_GUIDANCE_WORDS) continue
    // "…nothing to publish", "…nothing else to do" — a short status wrapped around the
    // word "nothing" reads as state, not instruction, as long as it stays short.
    if (/\bnothing\b/i.test(text) && words.length <= 10) continue
    const line = src.slice(0, m.index).split('\n').length
    hits.push({ file: relative(process.cwd(), file), line, text })
  }
  return hits
}

function sweep(): Hit[] {
  const hits: Hit[] = []
  for (const d of SWEPT_DIRS) hits.push(...allTsxFiles(join(ROOT, d)).flatMap(findInstructionalParagraphs))
  return hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
}

/**
 * KNOWN VIOLATIONS — recorded 2026-09-18 by the CODE_AUDIT sweep, owned by other
 * agents mid-edit at the time (site-tools.tsx, style-tools.tsx, merch-editor.tsx,
 * text-field-editor.tsx, editor-publish.tsx, restore-version.tsx, og-image-picker.tsx).
 * Each line is `file:line` exactly as this sweep reports it; the match is on file+line,
 * so fixing one (deleting the copy, or rewording it into a control's own label) makes
 * this list stale in one place and the entry must be deleted, not edited around.
 *
 * This list SHRINKS ONLY. Confirm a removal by re-running the sweep; never add a line
 * here for copy written after 2026-09-18 — that copy should not have shipped, and this
 * test failing on it is the point.
 */
const KNOWN_VIOLATIONS = new Set<string>([
  // "Small PNGs with a transparent background work best — the site scales anything
  // bigger down to 32px." — a cursor-image upload hint.
  'src/app/artists/[id]/(dashboard)/editor/panels/site-tools.tsx:226',
  // "The image trail follows your cursor image — set one above first."
  'src/app/artists/[id]/(dashboard)/editor/panels/site-tools.tsx:258',
  // "This site hasn't declared any styleable sections. A custom site sends its own
  // edit-list when the preview loads; the built-in templates don't tag sections yet."
  'src/app/artists/[id]/(dashboard)/editor/panels/style-tools.tsx:355',
  // "Synced from Shopify. Change the name, price or link in Shopify — the site reads
  // the price live, so it updates without republishing."
  'src/app/artists/[id]/(dashboard)/editor/merch-editor.tsx:116',
  // "This site hasn't made {field} styleable, so there's no font, size or thickness to
  // set here. Its appearance comes from the site's own design."
  'src/app/artists/[id]/(dashboard)/editor/text-field-editor.tsx:165',
  // Publish bar: "{n} change(s) since your last publish. Enter your password to make
  // them live." — the count is a status; "Enter your password…" is an instruction the
  // input's own placeholder ("Your password") already carries.
  'src/app/artists/[id]/(dashboard)/editor/editor-publish.tsx:142',
  // Restore-version modal: "Put the site back to how it looked at an earlier publish.
  // Anything changed since then will be lost."
  'src/app/artists/[id]/(dashboard)/editor/restore-version.tsx:161',
  // Social-preview image picker: "Upload a logo on the Brand page, or a hero image on
  // the Site page, and it can be used here."
  'src/app/artists/[id]/(dashboard)/tools/seo/og-image-picker.tsx:106',
  // Social-preview image picker: "A transparent logo turns invisible in dark-mode
  // social clients, so the background is baked into the saved image. 1200×630, the
  // size the platforms crop to."
  'src/app/artists/[id]/(dashboard)/tools/seo/og-image-picker.tsx:167',
])

describe('no instructional copy in editor UI or dashboard tool pages', () => {
  it('CRITICAL: the sweep still fires — deleting the allowlist must turn this red (mutation check)', () => {
    // This is the proof the detector is not vacuous: with NO allowlist, the sweep must
    // still find every one of today's known violations. If this ever finds fewer than
    // KNOWN_VIOLATIONS.size, the detector regressed and would silently wave through
    // new copy that happens to resemble one it used to catch.
    const hits = sweep()
    const found = new Set(hits.map((h) => `${h.file}:${h.line}`))
    for (const loc of KNOWN_VIOLATIONS) expect(found.has(loc), `expected the sweep to still catch ${loc}`).toBe(true)
  })

  it('every instructional <p> found today is on the dated, shrinking allowlist', () => {
    const hits = sweep()
    const unlisted = hits.filter((h) => !KNOWN_VIOLATIONS.has(`${h.file}:${h.line}`))
    if (unlisted.length) {
      const report = unlisted.map((h) => `  ${h.file}:${h.line} — "${h.text}"`).join('\n')
      throw new Error(`New instructional copy found outside the allowlist:\n${report}`)
    }
    expect(unlisted).toEqual([])
  })

  it('reports the known-violation list so a fix is visible when one lands (informational, cannot fail)', () => {
    console.info(`no-instruction-copy: ${KNOWN_VIOLATIONS.size} known violation(s), to be removed:\n${[...KNOWN_VIOLATIONS].map((l) => `  ${l}`).join('\n')}`)
    expect(true).toBe(true)
  })

  it('the allowlist names only locations the sweep can still find (catches stale entries)', () => {
    const hits = sweep()
    const found = new Set(hits.map((h) => `${h.file}:${h.line}`))
    const stale = [...KNOWN_VIOLATIONS].filter((loc) => !found.has(loc))
    expect(stale, `stale allowlist entries (already fixed — delete these lines): ${stale.join(', ')}`).toEqual([])
  })
})
