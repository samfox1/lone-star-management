/**
 * Custom fonts: uploaded font files an artist's site is typeset in.
 *
 * UPLOADED FILES, not Google Fonts (Sam's call): a foundry font is what makes a music
 * site look like that artist rather than like a template, and half of them are not on any
 * CDN. The manager uploads the file, gives it a name, and it becomes selectable
 * everywhere type is chosen.
 *
 * THREE THINGS EACH FONT HAS, and they are not the same string:
 *   • `label`   — what the manager typed ("PP Mori Semi Mono"). Display only.
 *   • `family`  — the CSS token derived from the label ("pp-mori-semi-mono"). This is
 *                 what lands in the stylesheet and in `.font-<family>`.
 *   • `storage_path` — the object in the PUBLIC `fonts` bucket.
 *
 * `family` is DERIVED ONCE, at upload, and never changes. Per-region style rows store the
 * `font-<family>` class verbatim (site_styles is a raw class string), so renaming a font
 * later would leave every region that used it pointing at a class nothing emits — a
 * site-wide typeface change with no edit behind it and nothing in the UI to explain it.
 *
 * THE SANITIZER IS THE SECURITY BOUNDARY. `family` is interpolated into stylesheet text
 * that is served to every visitor. A label is manager-typed free text, so it is treated
 * as hostile: `sanitizeFamily` is a strict allowlist, never a blocklist, and the emitter
 * re-runs it on whatever the database hands back.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnedStoragePath } from '@/lib/upload'

/** The bucket font objects live in. PUBLIC-READ, unlike `documents`: a fan's browser
 *  fetches the file itself, so there is no server in the middle to sign a URL. */
export const FONTS_BUCKET = 'fonts'

/** The path segment under the artist folder: `{artistId}/fonts/<uuid>.<ext>`. Exported
 *  because the uploader and `gcFontObjects` must agree, and only one of them fails
 *  loudly — a mismatch means replaced fonts are never collected. */
export const FONT_FOLDER = 'fonts'

/** The formats the bucket, the table's CHECK, and the picker all accept. WOFF2 first: it
 *  is the format to actually ship (half the bytes of a TTF, universal support). The other
 *  three are here because a foundry licence often hands over only a TTF or OTF, and
 *  telling a manager to go convert it is how a feature goes unused. */
export const FONT_FORMATS = ['woff2', 'woff', 'ttf', 'otf'] as const
export type FontFormat = (typeof FONT_FORMATS)[number]

/** Site-wide roles. PRIMARY is headings and display type, SECONDARY is body — the two
 *  decisions a typeface choice actually is. A font with no role is still uploaded and
 *  still selectable per-region; the role is a shortcut, not a gate. */
export const FONT_ROLES = ['primary', 'secondary'] as const
export type FontRole = (typeof FONT_ROLES)[number]

/** One row of `artist_fonts`, in the database's own casing (this is what a select
 *  returns, and renaming it here would mean two shapes for one row). */
export type ArtistFont = {
  id: string
  label: string
  family: string
  storage_path: string
  format: FontFormat
  role: FontRole | null
}

/* ── The family token ─────────────────────────────────────────────────────── */

/** Longest token we will emit. Long enough for "helvetica-neue-condensed", short enough
 *  that a pasted invoice line does not become a class name. */
const MAX_FAMILY = 32

/** What a label with nothing usable in it becomes. `sanitizeFamily` must never return
 *  empty: `font-family: ''` and a bare `.font-` selector are invalid CSS, and some
 *  parsers drop the rules that follow them too. */
const FALLBACK_FAMILY = 'font'

/**
 * Tokens the utility class must never claim, because Tailwind already owns `.font-<x>`
 * for them: the three font-family utilities and the nine font-weight ones.
 *
 * A font labelled "Bold" would otherwise emit `.font-bold { font-family: … }`, and every
 * bold word on the site would silently change typeface — from a page the manager never
 * edited, with no style row to point at.
 */
export const RESERVED_FAMILIES = [
  'sans',
  'serif',
  'mono',
  'thin',
  'extralight',
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
] as const

/**
 * Turn a manager-typed label into a CSS-safe family token.
 *
 * STRICT ALLOWLIST — lowercase letters, digits, and single hyphens — because this string
 * is interpolated into `@font-face { font-family: '<family>' }` and into a `.font-<family>`
 * selector. A blocklist here is the wrong shape: CSS has too many ways to close a
 * declaration (quote, semicolon, brace, backslash escape, newline, comment), and the cost
 * of missing one is arbitrary CSS injected into a page served to fans.
 *
 * Accents are FOLDED first (NFKD, then combining marks dropped) so "Grüß Gott" becomes
 * `grus-gott` rather than `gr-gott`. Folding widens what survives, but only ever into
 * characters the allowlist below still has to pass.
 *
 * Never returns empty, never throws on non-string input (it runs over values read back
 * from the database and off server-action arguments).
 */
export function sanitizeFamily(label: unknown): string {
  const raw = typeof label === 'string' ? label : ''
  const folded = raw
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // combining marks left behind by the decomposition
    .replace(/ß/g, 'ss')
    .toLowerCase()

  const token = folded
    .replace(/[^a-z0-9]+/g, '-') // THE allowlist. Everything else becomes a separator.
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_FAMILY)
    .replace(/-$/, '') // the cut can land mid-hyphen; a trailing one is not a token

  if (!token) return FALLBACK_FAMILY
  // Bump rather than reject: the manager named their font "Bold" and the name is fine —
  // it is our class prefix that collides, so we move, not them.
  return (RESERVED_FAMILIES as readonly string[]).includes(token) ? `${token}-1` : token
}

/**
 * A family token not already taken by one of this artist's fonts.
 *
 * Two different labels routinely sanitize to one token ("PP Mori" and "pp mori"), and the
 * table has a unique (artist_id, family) so the CSS can never be ambiguous. Without this
 * the second upload dies on a constraint violation the manager has no way to read.
 */
export function uniqueFamily(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, MAX_FAMILY - 4)}-${n}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, MAX_FAMILY - 4)}-${Date.now() % 1000}`
}

/** The utility class for a family, spelled in ONE place. The editor dropdown, the emitted
 *  CSS and the templates all have to agree on this string; three hand-written copies of
 *  `font-${family}` is exactly how they stop agreeing. */
export function fontClass(family: string): string {
  return `font-${sanitizeFamily(family)}`
}

/* ── The emitted CSS ──────────────────────────────────────────────────────── */

/** The CSS `format()` hint per stored format. NOT the extension for half of them: `ttf`
 *  is `truetype` and `otf` is `opentype`, and a wrong hint makes some browsers skip the
 *  source entirely and fall back to the template font. */
const FORMAT_HINT: Record<FontFormat, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
}

/**
 * A URL safe to sit inside `url('…')`.
 *
 * Deliberately narrow: scheme, host, and a path of the characters `buildStoragePath`
 * actually produces. A quote or a paren here closes the function and the declaration, so
 * anything that does not match is DROPPED rather than escaped — every path this app
 * writes is uuid-shaped, so a non-matching one did not come from the app.
 */
const SAFE_URL = /^https?:\/\/[a-z0-9.\-:]+(\/[a-zA-Z0-9._~\-]+)+$/i

/** Public URL for a font object. The bucket is public-read, so this is the URL a fan's
 *  browser fetches directly — no signing, no server hop. */
export function fontUrl(path: string, origin: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''): string {
  return `${origin.replace(/\/+$/, '')}/storage/v1/object/public/${FONTS_BUCKET}/${path}`
}

/** What `fontFaceCss` needs about a font: `path` (a storage path) or a ready `url`. */
export type FontFace = {
  family: string
  format: string
  path?: string
  url?: string
}

/**
 * The stylesheet for an artist's fonts: an `@font-face` per font plus the matching
 * `.font-<family>` utility class the editor's per-region tokens resolve against.
 *
 * Every interpolated value is either re-sanitized here (the family) or a known-safe enum
 * (the format hint) or matched against SAFE_URL (the source). Re-sanitizing is not
 * belt-and-braces: this function is the LAST gate before the bytes reach a fan's browser,
 * and a row could have been written by a script, a migration, or a version of this code
 * older than the sanitizer.
 *
 * Deterministic — sorted by family, one rule per family — so the payload is byte-stable
 * across requests and cacheable, and a diff of two published sites is readable.
 *
 * `font-display: swap` on purpose: text renders immediately in the fallback and swaps
 * when the file lands. The alternative is an invisible headline for as long as the
 * download takes, on a page whose entire job is the headline.
 */
export function fontFaceCss(
  fonts: FontFace[],
  opts: { origin?: string } = {},
): string {
  const origin = opts.origin ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const seen = new Set<string>()
  const blocks: string[] = []

  for (const font of [...fonts].sort((a, b) => String(a.family).localeCompare(String(b.family)))) {
    const format = font.format as FontFormat
    if (!(FONT_FORMATS as readonly string[]).includes(format)) continue // never guess a format
    const family = sanitizeFamily(font.family)
    if (seen.has(family)) continue
    const url = font.url ?? (font.path ? fontUrl(font.path, origin) : '')
    if (!SAFE_URL.test(url)) continue
    seen.add(family)
    blocks.push(
      `@font-face{font-family:'${family}';src:url('${url}') format('${FORMAT_HINT[format]}');font-display:swap}` +
        `.${fontClass(family)}{font-family:'${family}',sans-serif}`,
    )
  }
  return blocks.join('')
}

/* ── Server-side reads and writes ─────────────────────────────────────────── */

/** Every font this artist has uploaded, oldest first. RLS scopes the read, so a caller
 *  who does not manage the artist gets an empty list rather than someone else's fonts. */
export async function listArtistFonts(supabase: SupabaseClient, artistId: string): Promise<ArtistFont[]> {
  const { data } = await supabase
    .from('artist_fonts')
    .select('id, label, family, storage_path, format, role')
    .eq('artist_id', artistId)
    .order('created_at')
  return (data ?? []) as ArtistFont[]
}

/**
 * Record an uploaded font file.
 *
 * The path arrives from the CLIENT — the browser uploads direct-to-Storage and then asks
 * us to record where it put the object. Storage RLS pins the UPLOAD to this tenant's
 * folder and row RLS pins the ROW, but nothing ties the two together, so without
 * `isOwnedStoragePath` a manager could record a row pointing at any path at all: another
 * artist's folder, or a traversal string that `fontUrl` would concatenate into a URL and
 * serve from their public site. Same guard `setBrandAsset` uses.
 */
export async function setArtistFont(
  supabase: SupabaseClient,
  artistId: string,
  input: { label: string; storagePath: string; format: string },
): Promise<{ ok: boolean; error?: string; font?: ArtistFont }> {
  const label = String(input.label ?? '').trim().slice(0, 80)
  if (!label) return { ok: false, error: 'Give the font a name first.' }
  if (!(FONT_FORMATS as readonly string[]).includes(input.format))
    return { ok: false, error: 'That font format is not supported.' }
  if (!isOwnedStoragePath(artistId, input.storagePath))
    return { ok: false, error: 'That file location is not valid.' }

  // Read the taken tokens rather than letting the unique index decide: the constraint
  // message is not something a manager can act on, and two ordinary labels ("PP Mori",
  // "pp mori") collide by design.
  const existing = await listArtistFonts(supabase, artistId)
  const family = uniqueFamily(sanitizeFamily(label), existing.map((f) => f.family))

  const { data, error } = await supabase
    .from('artist_fonts')
    .insert({ artist_id: artistId, label, family, storage_path: input.storagePath, format: input.format })
    .select('id, label, family, storage_path, format, role')
    .single()
  // A blocked INSERT under RLS returns an error, but a no-row success must not read as
  // one either — the caller shows a success toast off this return value.
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Could not save that font.' }
  return { ok: true, font: data as ArtistFont }
}

/**
 * Delete a font row and hand back the object it pointed at, so the caller can sweep it.
 *
 * Asserts a row actually came back. RLS ROW-FILTERS a delete rather than failing it, so a
 * cross-tenant attempt returns `error: null` and zero rows — indistinguishable from
 * success unless the row count is checked.
 */
export async function removeArtistFont(
  supabase: SupabaseClient,
  artistId: string,
  fontId: string,
): Promise<{ ok: boolean; error?: string; storagePath?: string }> {
  const { data, error } = await supabase
    .from('artist_fonts')
    .delete()
    .eq('id', fontId)
    .eq('artist_id', artistId)
    .select('storage_path')
  if (error) return { ok: false, error: error.message }
  const row = (data ?? [])[0] as { storage_path?: string } | undefined
  if (!row) return { ok: false, error: 'That font is no longer there.' }
  return { ok: true, storagePath: row.storage_path }
}

/**
 * Give a font the primary or secondary role, or clear its role with `null`.
 *
 * A role is SINGLE-OCCUPANCY (one primary, one secondary, enforced by a partial unique
 * index), so assigning one must vacate the incumbent first. Doing it in the other order
 * hits the constraint and fails a perfectly ordinary "make this one the heading font".
 */
export async function setFontRole(
  supabase: SupabaseClient,
  artistId: string,
  fontId: string,
  role: FontRole | null,
): Promise<{ ok: boolean; error?: string }> {
  if (role !== null && !(FONT_ROLES as readonly string[]).includes(role))
    return { ok: false, error: 'Unknown font role.' }

  if (role !== null) {
    const vacate = await supabase
      .from('artist_fonts')
      .update({ role: null })
      .eq('artist_id', artistId)
      .eq('role', role)
      .neq('id', fontId)
    if (vacate.error) return { ok: false, error: vacate.error.message }
  }

  const { data, error } = await supabase
    .from('artist_fonts')
    .update({ role })
    .eq('id', fontId)
    .eq('artist_id', artistId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  // Same reason as removeArtistFont: a row-filtered UPDATE is a silent no-op.
  if (!(data ?? []).length) return { ok: false, error: 'That font is no longer there.' }
  return { ok: true }
}
