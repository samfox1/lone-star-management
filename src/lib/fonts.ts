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

/**
 * The PLATFORM-WIDE slot vocabulary (Sam's call, 2026-08-05). Every site lone-star feeds
 * — built-in template or custom (skeen) — speaks these five names and no others, so a key
 * in the payload always means the same thing on both sides.
 *
 * PRIMARY is headings and display type, SECONDARY is body: the two decisions a typeface
 * choice actually is. `custom_1..3` are for a site that wants a third face (a mono for
 * credits, an accent for a hero) without inventing private names nobody else reads.
 *
 * A slot is a property of the SITE ("what is the heading font?"), not of the font. That
 * is why it lives in `artist_font_slots` and not as a column on `artist_fonts`: with the
 * old `role` column, using ONE typeface for headings AND body meant uploading the same
 * file twice under two names (20260805180000).
 *
 * Extending the list is a migration (the CHECK on `artist_font_slots.slot`) plus one line
 * here. RESERVED_FAMILIES derives from it, so a new slot reserves its own class token
 * automatically — the two can never drift.
 */
export const FONT_SLOTS = ['primary', 'secondary', 'custom_1', 'custom_2', 'custom_3'] as const
export type FontSlot = (typeof FONT_SLOTS)[number]

/**
 * How many fonts one artist may upload.
 *
 * EVERY published font becomes an `@font-face` in the stylesheet of EVERY page, and each
 * one is a separate file a fan's browser may fetch. A real site uses two or three faces;
 * twelve leaves room for a full weight set (regular/italic/medium/bold) of two families
 * plus alternates, and still bounds the stylesheet at something a phone can parse. There
 * is nothing in the UI that would otherwise tell a manager that their fortieth upload is
 * costing every visitor — so the number has to exist somewhere, and it is here.
 */
export const MAX_FONTS_PER_ARTIST = 12

/** One row of the `artist_fonts_with_slots` view, in the database's own casing (this is
 *  what a select returns, and renaming it here would mean two shapes for one row).
 *  `slots` is the set of slots this font fills — possibly several, possibly none. */
export type ArtistFont = {
  id: string
  label: string
  family: string
  storage_path: string
  format: FontFormat
  slots: FontSlot[]
}

/** slot → family. Only ASSIGNED slots are present: an absent key means "this site has no
 *  font for that slot", which is not the same as a slot set to nothing. This is the shape
 *  the payload carries and the shape a consuming site iterates to set its CSS variables. */
export type FontSlotMap = Partial<Record<FontSlot, string>>

/* ── The family token ─────────────────────────────────────────────────────── */

/** Longest token we will emit. Long enough for "helvetica-neue-condensed", short enough
 *  that a pasted invoice line does not become a class name. */
const MAX_FAMILY = 32

/** What a label with nothing usable in it becomes. `sanitizeFamily` must never return
 *  empty: `font-family: ''` and a bare `.font-` selector are invalid CSS, and some
 *  parsers drop the rules that follow them too. */
const FALLBACK_FAMILY = 'font'

/**
 * Tokens Tailwind already owns `.font-<x>` for: the three font-family utilities and the
 * nine font-weight ones.
 *
 * A font labelled "Bold" would otherwise emit `.font-bold { font-family: … }`, and every
 * bold word on the site would silently change typeface — from a page the manager never
 * edited, with no style row to point at.
 */
const TAILWIND_RESERVED = [
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
 * Turn a manager-typed label into a CSS-safe token. THE ALLOWLIST, and nothing else.
 *
 * Split out from `sanitizeFamily` for one reason: RESERVED_FAMILIES is DERIVED by running
 * this over FONT_SLOTS, and `sanitizeFamily` consults RESERVED_FAMILIES — deriving the
 * list from a function that reads the list is a module-init cycle whose failure mode is a
 * silently empty reserved list.
 *
 * STRICT ALLOWLIST — lowercase letters, digits, and single hyphens — because this string
 * is interpolated into `@font-face { font-family: '<family>' }` and into a `.font-<family>`
 * selector. A blocklist here is the wrong shape: CSS has too many ways to close a
 * declaration (quote, semicolon, brace, backslash escape, newline, comment), and the cost
 * of missing one is arbitrary CSS injected into a page served to fans.
 *
 * Accents are FOLDED first (NFKD, then combining marks dropped) so "Grüß Gott" becomes
 * `gruss-gott` rather than `gr-gott`. Folding widens what survives, but only ever into
 * characters the allowlist below still has to pass.
 *
 * Never returns empty, never throws on non-string input (it runs over values read back
 * from the database and off server-action arguments).
 */
export function slugify(label: unknown): string {
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

  return token || FALLBACK_FAMILY
}

/**
 * Tokens a font's family must never be, DERIVED so it cannot fall out of step.
 *
 * Two sources, one list:
 *   • Tailwind's own `.font-*` utilities (above).
 *   • The sanitized form of EVERY slot name. A font labelled "Primary" sanitizes to
 *     `primary` and emits `.font-primary` — which is the class a consuming site hangs
 *     `--font-primary` off. The site would then render the uploaded font everywhere the
 *     primary slot is used, whatever the manager actually assigned, and nothing anywhere
 *     would fail. Note `custom_1` sanitizes to `custom-1`: reserving the raw slot name
 *     would reserve a token that can never appear in a class.
 *
 * Derived from FONT_SLOTS rather than hand-listed, so adding a sixth slot reserves its
 * token in the same edit. A hand-written copy is exactly how the publish window's
 * SECTIONS list silently omitted site_styles.
 */
export const RESERVED_FAMILIES: readonly string[] = [
  ...TAILWIND_RESERVED,
  ...FONT_SLOTS.map((slot) => slugify(slot)),
]

/** EXACT match only. `primary-sans` cannot collide with `.font-primary`, and refusing it
 *  would turn a collision guard into a naming policy over the manager's own fonts. */
export function isReservedFamily(token: string): boolean {
  return RESERVED_FAMILIES.includes(token)
}

/**
 * The family token for a label, safe to interpolate into CSS.
 *
 * Still BUMPS a reserved token rather than throwing: this is the emitter's last gate, and
 * it runs over rows that may predate the upload-time rejection or have been written by a
 * script. Emitting `.font-bold` because an old row says so is the failure it prevents.
 * The manager-facing refusal lives in `setArtistFont`, where there is someone to tell.
 */
export function sanitizeFamily(label: unknown): string {
  const token = slugify(label)
  return isReservedFamily(token) ? `${token}-1` : token
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

/** What the PUBLISHED payload carries per font (get_public_site's `fonts` array and the
 *  working-payload mirror). `path` is the storage path; the renderer resolves it.
 *  NO slot field: a font does not know what it is used for — `font_slots` says that, and
 *  it is a map precisely so one font can appear in several slots. */
export type SiteFont = {
  family: string
  label: string
  path: string
  format: string
}

/** The CSS custom property for a slot, spelled in ONE place. `custom_1` is
 *  `--font-custom-1`: the variable is CSS, so it wears the sanitized spelling, not the
 *  database's. A consuming site reading `--font-custom_1` would find nothing. */
export function fontSlotVar(slot: FontSlot): string {
  return `--font-${slugify(slot)}`
}

/**
 * The complete `<style>` block a rendered site gets: every @font-face + utility class,
 * then one `:root` variable per ASSIGNED slot, then the element rules the built-in
 * templates need.
 *
 * The variables are the contract for custom sites (skeen): they set one property per
 * slot and hang their own classes off it. The `h1..h6` / `body` rules exist because the
 * BUILT-IN templates have no slot classes of their own — nothing in them would read a
 * variable, so primary/secondary have to reach them as element rules.
 *
 * A slot is emitted ONLY when its family survived `fontFaceCss`'s gates. A variable
 * pointing at a dropped face sends the site hunting for a family no stylesheet defines,
 * falling back browser-by-browser instead of by our declared fallback — and, unlike a
 * missing font, it looks deliberate.
 *
 * Emitted in FONT_SLOTS order, not the map's, so the payload is byte-stable and cacheable
 * whatever order the door aggregated the keys in.
 *
 * Precedence (region > slot > template) is the cascade itself: `.font-<family>` is a
 * class, the heading rule is element-level, the body rule is inheritance — so this
 * emitter must never gain `!important` or an id selector.
 */
export function fontStyleCss(
  fonts: SiteFont[],
  slots: FontSlotMap | Record<string, string> = {},
  opts: { origin?: string } = {},
): string {
  const faces = fontFaceCss(fonts, opts)
  if (!faces) return ''

  // Only slots in the vocabulary (the map comes off a published payload, which a script
  // or an older writer could have shaped) whose family actually appears in the faces.
  const assigned: [FontSlot, string][] = []
  for (const slot of FONT_SLOTS) {
    const raw = (slots as Record<string, string | undefined>)[slot]
    if (!raw) continue
    const family = sanitizeFamily(raw)
    if (faces.includes(`font-family:'${family}'`)) assigned.push([slot, family])
  }
  if (!assigned.length) return faces

  const bySlot = new Map(assigned)
  const parts = [faces, `:root{${assigned.map(([slot, family]) => `${fontSlotVar(slot)}:'${family}'`).join(';')}}`]
  const primary = bySlot.get('primary')
  const secondary = bySlot.get('secondary')
  if (primary) parts.push(`h1,h2,h3,h4,h5,h6{font-family:'${primary}',sans-serif}`)
  if (secondary) parts.push(`body{font-family:'${secondary}',sans-serif}`)
  return parts.join('')
}

/* ── Server-side reads and writes ─────────────────────────────────────────── */

/** The publishable projection of a font: the row plus the slots it fills. Read through
 *  the VIEW, never the bare table, so the UI, the publish snapshot and the payload all
 *  see one shape — see 20260805180000 for why slots ride the font's own row. */
export const FONTS_VIEW = 'artist_fonts_with_slots'

/** Every font this artist has uploaded, oldest first. RLS scopes the read (the view is
 *  `security_invoker`), so a caller who does not manage the artist gets an empty list
 *  rather than someone else's fonts. */
export async function listArtistFonts(supabase: SupabaseClient, artistId: string): Promise<ArtistFont[]> {
  const { data } = await supabase
    .from(FONTS_VIEW)
    .select('id, label, family, storage_path, format, slots')
    .eq('artist_id', artistId)
    .order('created_at')
  // `slots` is a Postgres text[]; coalesced to '{}' in the view, but a legacy/partial read
  // must still yield an array — every caller maps over it.
  return ((data ?? []) as ArtistFont[]).map((f) => ({ ...f, slots: (f.slots ?? []) as FontSlot[] }))
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

  // A RESERVED name is refused, not quietly bumped. `sanitizeFamily` would turn "Primary"
  // into `primary-1` and the upload would appear to work — leaving a manager whose font
  // is filed under a token that is not the one they typed and not the one the editor's
  // dropdown implies. Names are one-way (the token is written into every per-region style
  // row), so the moment to say no is now, out loud.
  if (isReservedFamily(slugify(label)))
    return { ok: false, error: `“${label}” is a reserved name. Try another.` }

  // Read the taken tokens rather than letting the unique index decide: the constraint
  // message is not something a manager can act on, and two ordinary labels ("PP Mori",
  // "pp mori") collide by design.
  const existing = await listArtistFonts(supabase, artistId)
  // Every published font is an @font-face on every page load, and nothing else in the UI
  // would tell a manager that. Checked BEFORE the insert so the refusal is a sentence
  // rather than a constraint error.
  if (existing.length >= MAX_FONTS_PER_ARTIST)
    return {
      ok: false,
      error: `You can keep up to ${MAX_FONTS_PER_ARTIST} fonts. Remove one before adding another.`,
    }
  const family = uniqueFamily(sanitizeFamily(label), existing.map((f) => f.family))

  const { data, error } = await supabase
    .from('artist_fonts')
    .insert({ artist_id: artistId, label, family, storage_path: input.storagePath, format: input.format })
    .select('id, label, family, storage_path, format')
    .single()
  // A blocked INSERT under RLS returns an error, but a no-row success must not read as
  // one either — the caller shows a success toast off this return value.
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Could not save that font.' }
  // A brand-new font fills no slots. Stated rather than left undefined: every caller maps
  // over `slots`, and the insert returns the TABLE's columns, not the view's.
  return { ok: true, font: { ...(data as Omit<ArtistFont, 'slots'>), slots: [] } }
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
 * Point a slot at a font, or empty the slot with `fontId: null`.
 *
 * SLOT-KEYED, not font-keyed: this is an UPSERT on (artist_id, slot), so filling an
 * occupied slot replaces its occupant in one statement. The old `setFontRole` had to
 * vacate the incumbent first because the role lived on the font row and a unique index
 * would have rejected the second claimant — a two-step write that could half-succeed and
 * leave a site with no heading font at all.
 *
 * The same font may fill as many slots as the manager likes; that is the whole point of
 * the table, and nothing here prevents it.
 *
 * `slot` arrives from the client, so it is checked against FONT_SLOTS rather than trusted
 * into a write — the CHECK constraint would catch it, but with a message no manager can
 * read, and the vocabulary is ours to state.
 */
export async function setFontSlot(
  supabase: SupabaseClient,
  artistId: string,
  slot: FontSlot,
  fontId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!(FONT_SLOTS as readonly string[]).includes(slot)) return { ok: false, error: 'Unknown font slot.' }

  if (fontId === null) {
    const { data, error } = await supabase
      .from('artist_font_slots')
      .delete()
      .eq('artist_id', artistId)
      .eq('slot', slot)
      .select('slot')
    if (error) return { ok: false, error: error.message }
    // A row-filtered DELETE returns `error: null` and zero rows, so "nothing came back"
    // is the ONLY signal that RLS refused. The UI only ever offers to clear a slot that
    // is filled, so zero rows here means the write did not land — never "already empty".
    if (!(data ?? []).length) return { ok: false, error: 'That slot is no longer set.' }
    return { ok: true }
  }

  const { data, error } = await supabase
    .from('artist_font_slots')
    .upsert({ artist_id: artistId, slot, font_id: fontId }, { onConflict: 'artist_id,slot' })
    .select('slot')
  if (error) return { ok: false, error: error.message }
  // Same reason as removeArtistFont: a row-filtered write is a silent no-op, and the UI
  // shows a success toast off this return value.
  //
  // HONESTY NOTE: today's RLS makes this unreachable — a cross-tenant upsert fails the
  // policy's WITH CHECK and comes back 42501 on BOTH halves (measured 2026-08-05; the
  // conflict-update raises "new row violates row-level security policy" rather than
  // matching zero rows). So this line cannot be mutation-proven, unlike the DELETE branch
  // above, which DOES silently row-filter and is pinned by fonts.isolation.test.ts. It
  // stays because the day artist_font_slots_rw is split into per-command policies — the
  // usual reason a USING clause and a WITH CHECK clause stop agreeing — the update half
  // starts row-filtering and this is the only thing between that and a success toast.
  if (!(data ?? []).length) return { ok: false, error: 'That font is no longer there.' }
  return { ok: true }
}
