/**
 * Asset budgets — the decision at the upload door (BRIEF-asset-compression.md, skeen
 * repo, 2026-08-05).
 *
 * Uploads used to go to storage exactly as they left the manager's camera roll: a 12MB
 * phone photo into a polaroid slot that renders at ~600px, shipped to every visitor
 * forever. The manager cannot know target sizes, and "compress it first" in an error is
 * a dead end — so the editor does it for them, and the SITE says what "appropriate"
 * means, because only the site knows how each slot renders.
 *
 * The site declares budgets in its manifest (`assetBudgets`); this module turns a picked
 * file plus a budget into one of three outcomes:
 *
 *   • upload   — within budget, or no budget declared. No modal, no friction.
 *   • compress — an image over budget: the modal proposes a downscale + re-encode.
 *   • gate     — video, fonts, gif, svg over budget: block, with instructions. The
 *                browser does not transcode video (slower and worse than any export
 *                tool), a canvas re-encode of a GIF keeps one frame, and a rasterized
 *                SVG stops being resolution-independent.
 *
 * Everything here is PURE — decisions, geometry, and the quality walk over an injected
 * encoder — so it is unit-testable without a canvas. The DOM half (decode, draw,
 * toBlob) lives in compress-image.ts and stays thin, the same split og-card uses
 * between geometry and drawing.
 */

/** What a slot needs from an uploaded file. All fields optional; absent means "no
 *  opinion". Mirrors skeen's `AssetBudget` — the manifest is the contract. */
export type AssetBudget = {
  /** Longest-edge pixels the slot can usefully display (2× render size, for retina).
   *  Downscale target only — never upscale. Images only. */
  maxEdgePx?: number
  /** Hard ceiling on stored bytes. Images tune quality to land under it; video/fonts
   *  gate on it. */
  maxBytes?: number
  /** Re-encode target for images (`image/webp`). Never set on video/fonts. */
  mime?: string
}

/** A site's declared budgets: per upload kind, with per-slot overrides keyed
 *  `<component>_<slot>` (`polaroid_photo`). */
export type AssetBudgets = {
  image?: AssetBudget
  video?: AssetBudget
  font?: AssetBudget
  slots?: Record<string, AssetBudget>
}

export type UploadKind = 'image' | 'video' | 'font'

/**
 * The budget that applies to an upload: the slot's own if it declares one, else the
 * kind's, else NONE. Null is a real answer, not a default — older manifests and every
 * built-in template declare nothing, and inventing a budget for them would start gating
 * uploads on sites that never asked.
 */
export function budgetFor(
  budgets: AssetBudgets | undefined,
  kind: UploadKind,
  slotKey?: string,
): AssetBudget | null {
  if (!budgets) return null
  return (slotKey ? budgets.slots?.[slotKey] : undefined) ?? budgets[kind] ?? null
}

/**
 * The FLOOR under every upload, applied when nobody declared anything.
 *
 * `budgetFor` deliberately answers null for an undeclared budget, and for a day that
 * meant no compression at all outside one custom site's editor: budgets travel in the
 * site manifest, the manifest arrives over the editor's frame bridge, and the dashboard
 * pages where managers actually upload (Photos, Media, Brand) have no manifest in scope.
 * Every built-in template declares none either. So a 12MB phone photo went to storage
 * whole and shipped to every visitor forever. Sam, 2026-08-06: "every file that we store
 * has been compressed."
 *
 * IMAGES ONLY, and that is the whole design. A canvas can genuinely shrink an image, so a
 * default there is a smaller file; the browser cannot transcode video or subset a font, so
 * a default for either could only REJECT uploads that work today (the gate's answer is
 * "go and re-export it"), which is not ours to impose on a site that never asked. Their
 * existing hard caps (VIDEO_UPLOAD_RULES / FONT_UPLOAD_RULES) remain the only limit.
 *
 * The numbers are deliberately looser than any single site's own: 2400px covers a
 * full-bleed band on a 1200px retina layout, so the floor never degrades a site it knows
 * nothing about, and a site that renders smaller says so in its manifest and wins. It
 * still cuts a 12MB camera-roll JPEG by an order of magnitude, which is the case this
 * exists for. WebP because re-encoding a photo to JPEG throws away the largest single win
 * available, and it keeps the alpha a logo depends on.
 */
export const DEFAULT_BUDGETS: AssetBudgets = {
  image: { maxEdgePx: 2400, maxBytes: 1_000_000, mime: 'image/webp' },
}

/**
 * The budget the DOOR applies to THIS file: what the site declared, else the floor.
 *
 * Takes the file's type because the floor is only defensible where a canvas can act. A
 * declared budget gates an oversized GIF (the site asked, and its manager can be told to
 * ship an mp4 instead); an invented one would block a file that uploaded fine yesterday
 * with no way forward in the UI. Same reasoning that keeps video and fonts out of
 * DEFAULT_BUDGETS, applied one level down to a format rather than a kind.
 *
 * The gate calls this itself rather than trusting callers to resolve it — the call sites
 * are exactly where this went wrong before.
 */
export function withFloor(
  budget: AssetBudget | null | undefined,
  kind: UploadKind | undefined,
  /** The picked file's mime. Defaulted rather than optional so the membership test below
   *  is the whole condition: an unknown type is judged on bytes, like everywhere else. */
  fileType: string = '',
): AssetBudget | null {
  // No kind = an upload no budget can describe (a PDF rider, a song master). Nothing
  // gates those, INCLUDING a budget handed over by mistake — without a kind there is no
  // way to honour one, and acting on it would mean running a photo pipeline over a PDF.
  if (!kind) return null
  if (budget) return budget
  if (NON_RASTERIZABLE.has(fileType)) return null
  return DEFAULT_BUDGETS[kind] ?? null
}

export type BudgetVerdict =
  | { action: 'upload' }
  | {
      action: 'compress'
      /** True when the original breaches maxBytes by more than 4×. "Upload original"
       *  stays available as a rule — the budget is a strong default, not a cage — but a
       *  200MB hero clip or a 2MB polaroid photo is never the right upload. */
      mustCompress: boolean
    }
  | { action: 'gate' }

/** How far over maxBytes an original may be with "upload original" still offered. */
const DECLINE_CEILING = 4

/** Formats the canvas pipeline would silently damage: a GIF re-encodes to its first
 *  frame, an SVG rasterizes into a fixed grid. Over budget these GATE like video. */
const NON_RASTERIZABLE = new Set(['image/gif', 'image/svg+xml'])

/**
 * Is this file the iPhone's HEIC/HEIF? By mime OR extension — Windows reports no mime
 * for HEIC at all (no registry entry, the same measured reality FONT_UPLOAD_RULES
 * documents), so a type-only check waves through exactly the files it exists to catch.
 */
export function isHeic(file: { type: string; name?: string }): boolean {
  return /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '')
}

/**
 * The decision for one picked file. `edgePx` is the file's longest edge when the caller
 * has decoded it; undefined (decode failed, or not an image) judges on bytes alone —
 * the byte ceiling still protects storage when a corrupt file defeats the decoder.
 */
export function budgetVerdict(
  file: { size: number; type: string; name?: string; edgePx?: number },
  kind: UploadKind,
  budget: AssetBudget | null,
): BudgetVerdict {
  if (!budget) return { action: 'upload' }

  // HEIC compresses because of what it IS, not how big it is: the media bucket's
  // allowed_mime_types refuses image/heic, and a fan on Chrome or Firefox cannot render
  // one — a within-budget 'upload' verdict would ship a file that either bounces at
  // storage or is invisible to most visitors. mustCompress for the same reason: for
  // every other format "Upload original" uploads something that works; here it's a trap.
  if (kind === 'image' && isHeic(file)) return { action: 'compress', mustCompress: true }

  const overBytes = budget.maxBytes != null && file.size > budget.maxBytes
  if (kind !== 'image' || NON_RASTERIZABLE.has(file.type)) {
    return overBytes ? { action: 'gate' } : { action: 'upload' }
  }

  const overEdge = budget.maxEdgePx != null && file.edgePx != null && file.edgePx > budget.maxEdgePx
  if (!overBytes && !overEdge) return { action: 'upload' }
  return {
    action: 'compress',
    mustCompress: budget.maxBytes != null && file.size > budget.maxBytes * DECLINE_CEILING,
  }
}

/**
 * The downscale target: longest edge to the cap, aspect preserved, whole pixels, and
 * NEVER upscaled — a 600px original in a 1200px slot stays 600px, because invented
 * pixels are pure bytes.
 */
export function fitWithinEdge(
  width: number,
  height: number,
  maxEdgePx: number | undefined,
): { width: number; height: number } {
  const edge = Math.max(width, height)
  if (maxEdgePx == null || edge <= maxEdgePx) return { width, height }
  const scale = maxEdgePx / edge
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The quality range the walk searches. 0.92 is visually lossless for photos; below 0.5
 *  artifacts are visible at slot size, and a result that ugly should be a explicit
 *  fits:false rather than something we quietly ship. */
const Q_CEILING = 0.92
const Q_FLOOR = 0.5
/** Each probe is a full canvas re-encode of the image; bound the work. Six bisections
 *  resolve the range to ~0.007, finer than any encoder's visible steps. */
const MAX_PROBES = 6

/**
 * The HIGHEST quality in [0.5, 0.92] whose encoding fits `maxBytes`, by binary search
 * over an injected encoder (quality → bytes). Injected so the walk is testable without
 * a canvas, and so the caller owns the expensive part.
 *
 * `fits: false` means even the floor is over budget — the result is the floor's, and
 * whether best-effort is acceptable is the CALLER's decision (the modal says yes for a
 * marginal miss, the mustCompress path may not).
 */
export async function walkQuality(
  encode: (quality: number) => Promise<number>,
  maxBytes: number,
): Promise<{ quality: number; bytes: number; fits: boolean }> {
  // The ceiling first: photos with easy content fit at top quality, and degrading
  // anything that already fits would be pure loss.
  const atCeiling = await encode(Q_CEILING)
  if (atCeiling <= maxBytes) return { quality: Q_CEILING, bytes: atCeiling, fits: true }

  // The floor next: if even that misses, no search will help — report and stop.
  const atFloor = await encode(Q_FLOOR)
  if (atFloor > maxBytes) return { quality: Q_FLOOR, bytes: atFloor, fits: false }

  // Bisect for the highest fitting quality. `lo` always holds a fitting result.
  let lo = Q_FLOOR
  let loBytes = atFloor
  let hi = Q_CEILING
  for (let i = 0; i < MAX_PROBES; i++) {
    const mid = (lo + hi) / 2
    const bytes = await encode(mid)
    if (bytes <= maxBytes) {
      lo = mid
      loBytes = bytes
    } else {
      hi = mid
    }
  }
  return { quality: lo, bytes: loBytes, fits: true }
}

/**
 * The budget key for a PLACED role: `polaroid_1_photo` → `polaroid_photo`. A budget
 * belongs to the slot, not to the copy — the manifest declares it once per component
 * slot, while site_role carries the instance index.
 */
export function budgetSlotKey(role: string): string {
  return role.replace(/_\d+_/, '_')
}

/** "310 KB" / "4.0 MB" — finer than upload.ts's sizeLabel, which rounds to whole MB and
 *  shows a 300KB result as "0 MB". The modal's entire pitch is the before/after number. */
export function bytesLabel(bytes: number): string {
  const mib = bytes / (1024 * 1024)
  if (mib >= 1) return `${mib.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
