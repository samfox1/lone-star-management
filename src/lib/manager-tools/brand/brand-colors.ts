/**
 * Brand colours: the artist's palette (BRAND_PAGE_PLAN.md, Colors tab).
 *
 * TWO BUILT-INS, THEN A PLAIN LIST (Sam, 2026-09-23 later: "Primary and secondary colors
 * should be default on the colors page, they just dont have to be filled in yet"). Primary
 * and Secondary are rows with a SLOT: a fixed name, no note, not deletable, and no row at
 * all until the manager picks the colour (`setSlotColor`, one upsert). Everything else is
 * an added colour — "Color 3", "Color 4", … — with a name the manager can change, a hex
 * and an optional note. They save as they go, as DRAFTS: since 20260925120000 they are a
 * revisions entity type (`brand_color`), published by the Brand bar, and the site reads each
 * as `--brand-<key>` (BRAND_SYNC_PLAN.md). `key` is set by the database — the slot for a
 * built-in, a slug of the name at creation otherwise — and never changes; the note never
 * publishes. The site editor reads them first in its swatches, by name, Primary and
 * Secondary leading (`listBrandColors`' order).
 *
 * THE DATABASE IS THE AUTHORITY (20260924120000): the hex shape (`#rrggbb`, lowercase), the
 * name (1–40 characters, one line) and the cap (24 per artist, a trigger under a lock). This
 * module only NORMALISES what was typed (`ABC` → `#aabbcc`, a pasted line break → a space)
 * and translates a refusal into a sentence. It does not re-check the rules, because a
 * second copy of a rule is the copy that drifts — and the dashboard is not the only writer.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalHex } from '@/lib/color'
import { brandRefusal, cleanLine, cleanNote } from '@/lib/brand'

/** The cap the trigger enforces — Primary and Secondary count toward it. Stated, not
 *  enforced, here. */
export const MAX_BRAND_COLORS = 24

/** The built-in colours, in the order they lead the palette. The migration's CHECKs
 *  (20260924130000) say the same two names; a third slot is a migration plus a line here. */
export const COLOR_SLOTS = ['primary', 'secondary'] as const
export type ColorSlot = (typeof COLOR_SLOTS)[number]
export const isColorSlot = (v: unknown): v is ColorSlot => (COLOR_SLOTS as readonly unknown[]).includes(v)

/** A built-in's fixed name. The database refuses any other name on a slotted row. */
export const COLOR_SLOT_NAMES: Record<ColorSlot, string> = { primary: 'Primary', secondary: 'Secondary' }

/** How many colours the manager can ADD: the cap, less the room the built-ins always keep,
 *  so a full palette can still be given its Primary and Secondary. */
export const MAX_ADDED_COLORS = MAX_BRAND_COLORS - COLOR_SLOTS.length

/** The number the first added colour's name starts at: "Color 3", after the two built-ins. */
export const FIRST_ADDED_COLOR = COLOR_SLOTS.length + 1

export type BrandColor = {
  id: string
  name: string
  hex: string
  note: string | null
  sortOrder: number
  /** Primary / Secondary, or null for an added colour. */
  slot: ColorSlot | null
}

type Result = { ok: boolean; error?: string }

const COLUMNS = 'id, name, hex, note, sort_order'

function toColor(r: Record<string, unknown>): BrandColor {
  return {
    id: String(r.id),
    name: String(r.name),
    hex: String(r.hex),
    note: (r.note as string | null) ?? null,
    sortOrder: Number(r.sort_order ?? 0),
    slot: isColorSlot(r.slot) ? r.slot : null,
  }
}

/** Primary, Secondary, then the added colours in their own order. Stable, so the added
 *  colours keep the order the database gave them. */
export function paletteOrder<T extends { slot: ColorSlot | null }>(colors: readonly T[]): T[] {
  const rank = (c: T) => (c.slot ? COLOR_SLOTS.indexOf(c.slot) : COLOR_SLOTS.length)
  return [...colors].sort((a, b) => rank(a) - rank(b))
}

/** A typed colour as the database wants it: `#rrggbb` lowercase when it is one, otherwise
 *  the trimmed input unchanged — so the CHECK, not this function, is what says no. */
export function toStoredHex(raw: unknown): string {
  const typed = cleanLine(raw)
  return canonicalHex(typed) || typed.toLowerCase()
}

/** The name a new colour pre-fills: the first "Color N" not already taken, counting from
 *  `from` (the Colors tab passes FIRST_ADDED_COLOR, so its first is "Color 3"). */
export function nextColorName(existing: Iterable<string>, from = 1): string {
  const taken = new Set([...existing].map((n) => n.trim().toLowerCase()))
  for (let n = from; ; n++) if (!taken.has(`color ${n}`)) return `Color ${n}`
}

/**
 * The palette: Primary, Secondary, then the added colours in their order. RLS scopes the
 * read: someone else's artist reads empty.
 *
 * `select('*')`, not a column list, ON PURPOSE: `slot` arrives with 20260924130000, and a
 * list naming it would make this read — and every page that awaits it (Logos, Colors, the
 * kit) — fail until that migration is pushed. `*` reads the same rows either side of the
 * push; before it every colour simply has no slot.
 */
export async function listBrandColors(supabase: SupabaseClient, artistId: string): Promise<BrandColor[]> {
  const { data, error } = await supabase
    .from('brand_colors')
    .select('*')
    .eq('artist_id', artistId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return paletteOrder(((data ?? []) as Record<string, unknown>[]).map(toColor))
}

/**
 * Give Primary or Secondary its colour: ONE upsert on (artist_id, slot), so the first pick
 * makes the row and every later pick changes it — never a second Primary (the unique
 * constraint says the same), and no read-then-write for two tabs to race through.
 *
 * The name is the slot's fixed one, written every time, so the row can only ever say
 * "Primary" (the database refuses anything else on a slotted row). The note is left out:
 * a built-in has none. The cap trigger does not count the row being replaced, so re-picking
 * Primary on a full palette works (20260924130000).
 */
export async function setSlotColor(
  supabase: SupabaseClient,
  artistId: string,
  slot: ColorSlot,
  hex: string,
): Promise<Result & { color?: BrandColor }> {
  if (!isColorSlot(slot)) return { ok: false, error: 'Unknown color.' }
  const { data, error } = await supabase
    .from('brand_colors')
    .upsert({ artist_id: artistId, slot, name: COLOR_SLOT_NAMES[slot], hex: toStoredHex(hex) }, { onConflict: 'artist_id,slot' })
    .select(`${COLUMNS}, slot`)
  if (error) return { ok: false, error: brandRefusal(error, 'Could not save that color.') }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) return { ok: false, error: 'Could not save that color.' }
  return { ok: true, color: toColor(row) }
}

/** Add a colour at the END of the palette. The row is written once it has its hex (the
 *  add flow keeps a nameless, hexless row client-side until then). */
export async function addBrandColor(
  supabase: SupabaseClient,
  artistId: string,
  input: { name: string; hex: string; note?: string | null },
): Promise<Result & { color?: BrandColor }> {
  const { data: last } = await supabase
    .from('brand_colors')
    .select('sort_order')
    .eq('artist_id', artistId)
    .order('sort_order', { ascending: false })
    .limit(1)
  const sort_order = Number((last as { sort_order?: number }[] | null)?.[0]?.sort_order ?? -1) + 1

  const { data, error } = await supabase
    .from('brand_colors')
    .insert({
      artist_id: artistId,
      name: cleanLine(input.name),
      hex: toStoredHex(input.hex),
      note: cleanNote(input.note),
      sort_order,
    })
    .select(COLUMNS)
    .single()
  if (error) return { ok: false, error: brandRefusal(error, 'Could not add that color.') }
  if (!data) return { ok: false, error: 'Could not add that color.' }
  return { ok: true, color: toColor(data as Record<string, unknown>) }
}

/** One write to one of this artist's colours. Zero rows back means RLS or a stale id
 *  refused it (AGENTS.md rule 3), so it is an error, never a quiet success. */
async function writeColor(
  supabase: SupabaseClient,
  artistId: string,
  colorId: string,
  patch: Record<string, unknown>,
  fallback: string,
): Promise<Result> {
  const { data, error } = await supabase
    .from('brand_colors')
    .update(patch)
    .eq('id', colorId)
    .eq('artist_id', artistId)
    .select('id')
  if (error) return { ok: false, error: brandRefusal(error, fallback) }
  if (!(data ?? []).length) return { ok: false, error: 'That color is no longer there.' }
  return { ok: true }
}

export function renameBrandColor(supabase: SupabaseClient, artistId: string, colorId: string, name: string): Promise<Result> {
  return writeColor(supabase, artistId, colorId, { name: cleanLine(name) }, 'Could not rename that color.')
}

export function setBrandColorHex(supabase: SupabaseClient, artistId: string, colorId: string, hex: string): Promise<Result> {
  return writeColor(supabase, artistId, colorId, { hex: toStoredHex(hex) }, 'Could not change that color.')
}

export function setBrandColorNote(
  supabase: SupabaseClient,
  artistId: string,
  colorId: string,
  note: string | null,
): Promise<Result> {
  return writeColor(supabase, artistId, colorId, { note: cleanNote(note) }, 'Could not save that note.')
}

export async function deleteBrandColor(supabase: SupabaseClient, artistId: string, colorId: string): Promise<Result> {
  const { data, error } = await supabase
    .from('brand_colors')
    .delete()
    .eq('id', colorId)
    .eq('artist_id', artistId)
    .select('id')
  if (error) return { ok: false, error: brandRefusal(error, 'Could not remove that color.') }
  if (!(data ?? []).length) return { ok: false, error: 'That color is no longer there.' }
  return { ok: true }
}
