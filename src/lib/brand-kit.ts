/**
 * The brand kit download: `colors.txt` plus whatever asset bytes the caller collected
 * (logos, tab/home-screen icons, font files for published slots) — zipped in-memory
 * with fflate (`zipSync`, sync/pure, no worker) so this stays a plain function the
 * route handler can call with bytes it already fetched from storage.
 *
 * Entry-name safety lives here because the caller's `path` is built from user-editable
 * titles (a logo's or font slot's renamable name) and, at the route boundary, arbitrary
 * storage keys — neither is a name a zip's central directory should ever see literally.
 * A `../../etc/passwd`-shaped path is not a real risk for a browser unzip, but plenty of
 * unzip tools on plenty of OSes still honour it (the "zip-slip" family of bugs), so
 * every entry is flattened to a single path segment before it reaches `zipSync`: no
 * slash survives, so there is nothing left for a `..` to climb out OF.
 */
import { zipSync, strToU8 } from 'fflate'
import { canonicalHex } from '@/lib/color'

export type BrandColor = { name: string; hex: string }
export type BrandKitFile = { path: string; bytes: Uint8Array }

/** Characters with no business in a filename: C0 controls and DEL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/**
 * Collapses a possibly hostile path into one safe, flat segment: splits on both slash
 * styles, drops empty/`.`/`..` segments (so "../../etc/passwd" loses the traversal and
 * becomes "etc-passwd", not "etcpasswd" run together illegibly), rejoins with `-`, then
 * strips control characters. Falls back to `fallback` if nothing printable survives.
 */
function safeEntryName(path: string, fallback: string): string {
  const flattened = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('-')
    .replace(CONTROL_CHARS, '')
    .trim()
  return flattened || fallback
}

/** One line per colour: `name, #rrggbb, RGB r, g, b`. An unparsable hex (shouldn't
 *  happen — brand_colors is CHECK-constrained — but this module doesn't trust the
 *  caller) prints the raw hex and skips the RGB column rather than throwing. */
export function colorsTxt(colors: BrandColor[]): string {
  const lines = colors.map(({ name, hex }) => {
    const full = canonicalHex(hex)
    if (!full) return `${name}, ${hex}`
    const r = parseInt(full.slice(1, 3), 16)
    const g = parseInt(full.slice(3, 5), 16)
    const b = parseInt(full.slice(5, 7), 16)
    return `${name}, ${full}, RGB ${r}, ${g}, ${b}`
  })
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/**
 * Zips `files` alongside a generated `colors.txt`. `colors.txt` is reserved up front —
 * a hostile or coincidental file path that sanitises to "colors.txt" is renamed instead
 * of silently replacing the real manifest.
 */
export function buildBrandKitZip(files: BrandKitFile[], colors: BrandColor[]): Uint8Array {
  const RESERVED = 'colors.txt'
  const used = new Set<string>([RESERVED])
  const zipInput: Record<string, Uint8Array> = {}

  files.forEach((file, i) => {
    const base = safeEntryName(file.path, `file-${i + 1}`)
    let candidate = base
    let n = 2
    while (used.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    used.add(candidate)
    zipInput[candidate] = file.bytes
  })

  zipInput[RESERVED] = strToU8(colorsTxt(colors))

  return zipSync(zipInput)
}
