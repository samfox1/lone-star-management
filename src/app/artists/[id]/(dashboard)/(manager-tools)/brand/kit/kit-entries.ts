/**
 * What goes in the brand kit, and what each file is called — decided from the PUBLISHED
 * door's payload alone (BRAND_PAGE_PLAN.md: "a zip of what is live on the site"). Pure, so
 * the route only has to fetch what this lists.
 *
 * Names are OURS, never a storage key and never a title verbatim: a fixed word per built-in
 * (`logo-primary`, `tab-icon`), and for an added logo its title folded to `[a-z0-9-]`. The
 * extension comes from the storage path, which `isOwnedStoragePath` has already pinned to
 * `[a-z0-9]{2,5}`. `buildBrandKitZip` flattens names again on the way into the zip; this is
 * the layer that keeps them readable and keeps `.png` at the END when two titles collide.
 */
import { FONTS_BUCKET, FONT_SLOTS } from '@/lib/fonts'
import { isGoogleFamilyName } from '@/lib/google-fonts'
import type { BrandColor } from '@/lib/manager-tools/brand/brand-kit'
import { isOwnedStoragePath } from '@/lib/upload'

/**
 * The most the kit carries, in total. The zip is built in memory and sent as one response
 * body, and a serverless response body tops out at 4.5 MB — past that the platform refuses
 * the whole download, which is worse than a kit that says what it left out. Logos and
 * icons are small; this only bites on a very large logo file, which the upload already
 * warns about.
 */
export const MAX_KIT_BYTES = 4 * 1024 * 1024

/** The slice of `get_public_site` the kit reads. Loose on purpose: the door's media carry
 *  purposes the bridge's wire type may not list yet (`logo`, `home_icon`). */
export type LiveBrand = {
  media?: { purpose?: string | null; path?: string | null; label?: string | null }[] | null
  fonts?:
    | { family?: string | null; label?: string | null; path?: string | null; source?: string | null; google_family?: string | null }[]
    | null
  font_slots?: Record<string, string | null | undefined> | null
  brand?: { colors?: { key?: string | null; name?: string | null; hex?: string | null }[] | null } | null
} | null

export type KitEntry = { name: string; bucket: 'media' | typeof FONTS_BUCKET; path: string }
export type KitSkip = { name: string; reason: string }

/** The built-ins, in the order they go in (and are counted against the cap). */
const BUILT_INS = [
  ['logo_primary', 'logo-primary'],
  ['logo_secondary', 'logo-secondary'],
  ['favicon', 'tab-icon'],
  ['home_icon', 'home-screen-icon'],
] as const

/** A title as a file-name token: accents folded, anything outside `[a-z0-9]` a hyphen,
 *  40 characters at most. '' when nothing survives — the caller has the fallback. */
export function nameSlug(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1)

/**
 * Every file the kit should hold, in order: primary, secondary, tab icon, home-screen icon,
 * the fonts that fill a published slot (slot order, each file once), then the added logos.
 * A path outside this artist's folder is never listed for fetching — it is reported.
 */
export function planBrandKit(artistId: string, live: LiveBrand): { entries: KitEntry[]; skipped: KitSkip[] } {
  const entries: KitEntry[] = []
  const skipped: KitSkip[] = []
  if (!live) return { entries, skipped }
  const used = new Set<string>()
  const add = (base: string, bucket: KitEntry['bucket'], path: string | null | undefined) => {
    if (typeof path !== 'string' || !isOwnedStoragePath(artistId, path)) {
      skipped.push({ name: base, reason: 'not a file of this artist' })
      return
    }
    const ext = extOf(path)
    let name = `${base}.${ext}`
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.${ext}`
    used.add(name)
    entries.push({ name, bucket, path })
  }

  const media = live.media ?? []
  for (const [purpose, base] of BUILT_INS) {
    // Single occupancy: a stray second row (a script, a race) must not ship twice. The door
    // orders by sort_order, and a replace writes the newest, so the last one is current.
    const row = media.filter((m) => m?.purpose === purpose).at(-1)
    if (row) add(base, 'media', row.path)
  }

  const fonts = live.fonts ?? []
  const slots = live.font_slots ?? {}
  const shipped = new Set<string>()
  const googled = new Set<string>()
  for (const slot of FONT_SLOTS) {
    const family = slots[slot]
    if (!family) continue
    const font = fonts.find((f) => f?.family === family)
    if (!font) continue
    const base = `font-${nameSlug(font.label) || nameSlug(family) || 'font'}`
    // A Google font has no file (20260925120000: the door gives it no path). Say where it
    // lives rather than leave the manager wondering why Primary is missing. The family goes
    // into the line only when it is Google-shaped: skipped.txt is one line per file.
    if (font.source === 'google') {
      if (googled.has(family)) continue
      googled.add(family)
      const where = isGoogleFamilyName(font.google_family) ? `get ${font.google_family}` : 'get it'
      skipped.push({ name: base, reason: `a Google font, ${where} from fonts.google.com` })
      continue
    }
    if (!font.path || shipped.has(font.path)) continue
    shipped.add(font.path)
    add(base, FONTS_BUCKET, font.path)
  }

  for (const row of media) {
    if (row?.purpose !== 'logo') continue
    add(`logo-${nameSlug(row.label) || 'added'}`, 'media', row.path)
  }

  return { entries, skipped }
}

/**
 * colors.txt's palette: the door's `brand.colors` (20260925120000), in the site's order —
 * the PUBLISHED colours, like every other file in the kit, never the working rows. Empty
 * before anything is published and on a door older than the key.
 */
export function liveColors(live: LiveBrand): BrandColor[] {
  return (live?.brand?.colors ?? []).flatMap((c) =>
    typeof c?.name === 'string' && typeof c.hex === 'string' ? [{ name: c.name, hex: c.hex }] : [],
  )
}

/** skipped.txt: one line per file left out, `name: why`. */
export function skippedTxt(skipped: KitSkip[], notes: string[] = []): string {
  return [...notes, ...skipped.map((s) => `${s.name}: ${s.reason}`)].join('\n') + '\n'
}
