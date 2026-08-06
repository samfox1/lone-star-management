/**
 * The decision at the upload door (BRIEF-asset-compression.md, skeen repo).
 *
 * A manager picks a file; the site's manifest says what that slot needs (bytes, longest
 * edge, re-encode target). Three outcomes and nothing else:
 *
 *   • upload   — within budget, or no budget declared. No modal, no friction.
 *   • compress — an image over budget: the modal opens with a proposal.
 *   • gate     — video, fonts, and non-rasterizable images (gif/svg) over budget: block
 *                with instructions. The browser does not transcode video, and a canvas
 *                re-encode of an animated gif silently flattens it to one frame.
 *
 * Everything here is pure — the DOM half (createImageBitmap, canvas) stays thin and
 * separate, exactly like og-card's split between geometry and drawing.
 */
import { describe, expect, it } from 'vitest'
import {
  budgetFor,
  budgetVerdict,
  fitWithinEdge,
  walkQuality,
  budgetSlotKey,
  type AssetBudgets,
} from '@/lib/site-editor/asset-budget'

// Skeen's real declared budgets, from its editList.
const BUDGETS: AssetBudgets = {
  image: { maxEdgePx: 2000, maxBytes: 800_000, mime: 'image/webp' },
  video: { maxBytes: 25_000_000 },
  font: { maxBytes: 2_000_000 },
  slots: { polaroid_photo: { maxEdgePx: 1200, maxBytes: 400_000, mime: 'image/webp' } },
}

describe('budgetFor — which budget applies', () => {
  it('a slot override beats the kind budget', () => {
    expect(budgetFor(BUDGETS, 'image', 'polaroid_photo')?.maxBytes).toBe(400_000)
  })
  it('an unknown slot falls back to the kind', () => {
    expect(budgetFor(BUDGETS, 'image', 'no_such_slot')?.maxBytes).toBe(800_000)
    expect(budgetFor(BUDGETS, 'image')?.maxBytes).toBe(800_000)
  })
  it('CRITICAL: no manifest budgets means NO budget — the old behaviour survives', () => {
    // Older skeen builds announce no assetBudgets; every template site announces none.
    // A default here would silently start gating uploads on sites that never asked.
    expect(budgetFor(undefined, 'image', 'polaroid_photo')).toBeNull()
    expect(budgetFor({}, 'video')).toBeNull()
  })
})

describe('budgetSlotKey — a placed role maps to its budget key', () => {
  it('strips the instance index: the budget belongs to the SLOT, not the copy', () => {
    // site_role is `polaroid_1_photo` … `polaroid_5_photo`; the budget is declared once
    // per slot as `polaroid_photo`. Five identical budgets keyed by index would be the
    // hand-listed-fixture smell in manifest form.
    expect(budgetSlotKey('polaroid_1_photo')).toBe('polaroid_photo')
    expect(budgetSlotKey('polaroid_5_photo')).toBe('polaroid_photo')
  })
  it('passes through a role with no index', () => {
    expect(budgetSlotKey('hero_clip')).toBe('hero_clip')
  })
  it('…and the mapped key actually finds skeen’s declared budget', () => {
    expect(budgetFor(BUDGETS, 'image', budgetSlotKey('polaroid_3_photo'))?.maxBytes).toBe(400_000)
  })
})

describe('budgetVerdict', () => {
  const img = (size: number, edgePx?: number, type = 'image/jpeg') => ({ size, type, edgePx })

  it('CRITICAL: within budget uploads untouched — no modal at all', () => {
    expect(budgetVerdict(img(300_000, 1100), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({ action: 'upload' })
  })

  it('no budget uploads anything, however large', () => {
    expect(budgetVerdict(img(50_000_000, 8000), 'image', null)).toEqual({ action: 'upload' })
  })

  it('an image over BYTES compresses', () => {
    expect(budgetVerdict(img(1_200_000, 1100), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: false,
    })
  })

  it('CRITICAL: an image over EDGE compresses even when its bytes fit', () => {
    // The efficient-JPEG case: a 4000px photo can be 350KB. Bytes pass, but the slot can
    // only display 1200px — shipping 4000 is 11× the pixels for nothing.
    expect(budgetVerdict(img(350_000, 4000), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: false,
    })
  })

  it('CRITICAL: >4× over bytes makes compression mandatory', () => {
    // "Upload original" stays available as a rule — the budget is a default, not a cage —
    // EXCEPT when the original breaches by more than 4×: a 200MB hero clip is never right.
    expect(budgetVerdict(img(1_700_000, 1100), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: true,
    })
  })

  it('video over budget GATES; within uploads', () => {
    expect(budgetVerdict({ size: 200_000_000, type: 'video/mp4' }, 'video', BUDGETS.video!)).toEqual({ action: 'gate' })
    expect(budgetVerdict({ size: 18_000_000, type: 'video/mp4' }, 'video', BUDGETS.video!)).toEqual({ action: 'upload' })
  })

  it('fonts over budget GATE — no re-encoding a woff2 in a browser', () => {
    expect(budgetVerdict({ size: 5_000_000, type: 'font/ttf' }, 'font', BUDGETS.font!)).toEqual({ action: 'gate' })
  })

  it('CRITICAL: an animated-capable format never goes through the canvas', () => {
    // A canvas re-encode of a GIF keeps exactly one frame; an SVG rasterized to webp
    // stops being resolution-independent. Both silently destroy what the file IS, so
    // over-budget they gate like video rather than compress.
    expect(budgetVerdict(img(2_000_000, 500, 'image/gif'), 'image', BUDGETS.image!)).toEqual({ action: 'gate' })
    expect(budgetVerdict(img(2_000_000, 500, 'image/svg+xml'), 'image', BUDGETS.image!)).toEqual({ action: 'gate' })
    // …and within budget they pass untouched, like everything else.
    expect(budgetVerdict(img(90_000, 500, 'image/gif'), 'image', BUDGETS.image!)).toEqual({ action: 'upload' })
  })

  it('an image with unknown dimensions is judged on bytes alone', () => {
    // Decode can fail (corrupt file); the byte ceiling still protects storage.
    expect(budgetVerdict(img(300_000, undefined), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({ action: 'upload' })
    expect(budgetVerdict(img(500_000, undefined), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: false,
    })
  })
})

describe('fitWithinEdge — the downscale target', () => {
  it('scales the longest edge to the cap, preserving aspect', () => {
    expect(fitWithinEdge(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 })
    expect(fitWithinEdge(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 })
  })
  it('CRITICAL: never upscales', () => {
    // A 600px original in a 1200px slot stays 600px — invented pixels are pure bytes.
    expect(fitWithinEdge(600, 400, 1200)).toEqual({ width: 600, height: 400 })
  })
  it('rounds to whole pixels and never emits zero', () => {
    expect(fitWithinEdge(10000, 1, 1200)).toEqual({ width: 1200, height: 1 })
  })
  it('no cap means no change', () => {
    expect(fitWithinEdge(4000, 3000, undefined)).toEqual({ width: 4000, height: 3000 })
  })
})

describe('walkQuality — highest quality that fits the byte budget', () => {
  // The encoder is injected, so the walk is testable without a canvas: each fake maps
  // quality → bytes. Real encoders are roughly monotonic; the walk must not assume more.
  const linear = (q: number) => Promise.resolve(Math.round(q * 1_000_000))

  it('returns the ceiling quality when even that fits', async () => {
    // The 1×1-image case: everything fits, so don't degrade anything.
    const r = await walkQuality(async () => 500, 400_000)
    expect(r).toEqual({ quality: 0.92, bytes: 500, fits: true })
  })

  it('finds a quality under budget, close to the highest that fits', async () => {
    // 600KB on this encoder is reachable at q ≤ 0.6 — inside the [0.5, 0.92] range the
    // walk searches. (A budget only reachable BELOW the floor is the fits:false case.)
    const r = await walkQuality(linear, 600_000)
    expect(r.fits).toBe(true)
    expect(r.bytes).toBeLessThanOrEqual(600_000)
    // Binary search should land near the boundary, not just anywhere under it.
    expect(r.bytes).toBeGreaterThan(550_000)
    expect(r.quality).toBeGreaterThanOrEqual(0.5)
  })

  it('CRITICAL: incompressible input converges and reports fits:false', async () => {
    // Noise barely compresses: nothing in [0.5, 0.92] fits. The walk must terminate and
    // say so — the caller decides whether best-effort is acceptable, not this function.
    let calls = 0
    const r = await walkQuality(async () => { calls += 1; return 2_000_000 }, 400_000)
    expect(r.fits).toBe(false)
    expect(r.quality).toBe(0.5) // the floor: the best effort it is allowed to make
    expect(calls).toBeLessThanOrEqual(8) // bounded, not a spin
  })

  it('never returns a quality below the floor', async () => {
    const r = await walkQuality(linear, 100) // impossibly tight
    expect(r.quality).toBeGreaterThanOrEqual(0.5)
    expect(r.fits).toBe(false)
  })

  it('caps the number of encodes — each one is a full canvas re-encode', async () => {
    let calls = 0
    await walkQuality(async (q) => { calls += 1; return Math.round(q * 1_000_000) }, 654_321)
    expect(calls).toBeLessThanOrEqual(8)
  })
})
