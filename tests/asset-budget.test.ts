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
  bytesLabel,
  withFloor,
  DEFAULT_BUDGETS,
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
  it('reports only what the SITE declared — null is "no opinion", not "no gate"', () => {
    // Older skeen builds announce no assetBudgets; every built-in template announces
    // none. This function stays the DECLARED layer so the two are distinguishable; the
    // floor under it is withFloor's job, and it is what the door actually applies.
    expect(budgetFor(undefined, 'image', 'polaroid_photo')).toBeNull()
    expect(budgetFor({}, 'video')).toBeNull()
  })
})

describe('withFloor — the budget the DOOR applies', () => {
  it('CRITICAL: an image with no declared budget still gets one', () => {
    // Sam, 2026-08-06: "every file that we store has been compressed". Compression used
    // to require the SITE to declare budgets, which arrive only through the editor's
    // frame bridge — so the dashboard pages (Photos, Media, Brand) and every built-in
    // template stored 12MB phone photos whole. The floor is what makes the door apply
    // everywhere rather than only inside the editor of one custom site.
    const floor = withFloor(null, 'image')
    expect(floor).not.toBeNull()
    expect(floor!.maxBytes).toBeGreaterThan(0)
    expect(floor!.maxEdgePx).toBeGreaterThan(0)
    // WebP, because the floor exists to make files small; re-encoding a 12MB JPEG to
    // JPEG throws away the single biggest win available.
    expect(floor!.mime).toBe('image/webp')
    expect(withFloor(undefined, 'image')).toEqual(floor)
  })

  it('CRITICAL: the floor bites a phone photo and leaves a web-sized one alone', () => {
    // A floor nobody can feel is decoration; a floor that fires on a 240KB hero crop is
    // a modal in front of every upload. Both halves are the actual contract.
    const floor = withFloor(null, 'image')
    expect(budgetVerdict({ size: 12_000_000, type: 'image/jpeg', edgePx: 4032 }, 'image', floor).action).toBe('compress')
    expect(budgetVerdict({ size: 240_000, type: 'image/jpeg', edgePx: 1600 }, 'image', floor).action).toBe('upload')
  })

  it('CRITICAL: video and fonts get NO floor — there a budget is a wall, not a shrink', () => {
    // The browser cannot transcode video or subset a font, so an invented budget for
    // either can only REJECT uploads that succeed today (the gate copy tells the manager
    // to go and re-export). Their existing hard caps stay the only limit; a site that
    // wants tighter declares it, and then the gate is its choice rather than ours.
    expect(withFloor(null, 'video')).toBeNull()
    expect(withFloor(null, 'font')).toBeNull()
    expect(DEFAULT_BUDGETS.video).toBeUndefined()
    expect(DEFAULT_BUDGETS.font).toBeUndefined()
  })

  it('CRITICAL: a site’s own declaration always wins over the floor', () => {
    // The site knows how the slot renders; the floor only covers the case where nobody
    // said. A floor that overrode a declared budget would silently ship 2400px into a
    // 600px polaroid — the exact waste the budgets were declared to stop.
    expect(withFloor(BUDGETS.slots!.polaroid_photo, 'image')).toEqual(BUDGETS.slots!.polaroid_photo)
    expect(withFloor(BUDGETS.image!, 'image')).toEqual(BUDGETS.image)
  })

  it('CRITICAL: the floor never applies to a GIF — there it would be a wall', () => {
    // A canvas re-encode of an animated GIF keeps ONE frame, so budgetVerdict gates it
    // rather than compressing. Under an invented budget that turns into a hard block on
    // a file that uploaded fine yesterday, with no way forward from the UI — the same
    // objection that keeps video and fonts out of DEFAULT_BUDGETS.
    expect(withFloor(null, 'image', 'image/gif')).toBeNull()
    expect(withFloor(null, 'image', 'image/svg+xml')).toBeNull()
    // A photo is unaffected, and a DECLARED budget still gates the gif: the site asked
    // for that, and its manager can be told to ship an mp4 instead.
    expect(withFloor(null, 'image', 'image/jpeg')).toEqual(DEFAULT_BUDGETS.image)
    expect(withFloor(BUDGETS.image!, 'image', 'image/gif')).toEqual(BUDGETS.image)
  })

  it('no kind means no gate — PDFs and track audio are not images', () => {
    // The EPK's rider and a song's master have no rasterizable form; the floor must not
    // leak into an uploader that passes no kind at all.
    expect(withFloor(undefined, undefined)).toBeNull()
    expect(withFloor(null, undefined)).toBeNull()
    // …and a budget arriving WITHOUT a kind is refused rather than honoured: nothing can
    // interpret it, and acting on it would mean running the photo pipeline over a PDF.
    expect(withFloor(BUDGETS.image!, undefined)).toBeNull()
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

  it('CRITICAL: EXACTLY at the limit uploads — the budget is a ceiling, not a fence', () => {
    // `>` vs `>=` is one character and completely invisible: a file at exactly 400,000
    // bytes would open a modal proposing to shrink a file that already fits.
    expect(budgetVerdict(img(400_000, 1200), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({ action: 'upload' })
    expect(budgetVerdict(img(400_001, 1200), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: false,
    })
    // …and the same boundary on the EDGE cap.
    expect(budgetVerdict(img(100_000, 1201), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: false,
    })
    // Video's gate boundary too, which is a different branch entirely.
    expect(budgetVerdict({ size: 25_000_000, type: 'video/mp4' }, 'video', BUDGETS.video!)).toEqual({ action: 'upload' })
    expect(budgetVerdict({ size: 25_000_001, type: 'video/mp4' }, 'video', BUDGETS.video!)).toEqual({ action: 'gate' })
  })

  it('the mustCompress ceiling is exactly 4×, not 4× minus a byte', () => {
    const b = BUDGETS.slots!.polaroid_photo
    expect(budgetVerdict(img(1_600_000, 1100), 'image', b)).toEqual({ action: 'compress', mustCompress: false })
    expect(budgetVerdict(img(1_600_001, 1100), 'image', b)).toEqual({ action: 'compress', mustCompress: true })
  })

  it('a budget with only an EDGE cap never gates on bytes', () => {
    // A legal budget shape the manifest allows and nothing else covered: no maxBytes at
    // all. Every byte comparison must fall through rather than compare against undefined.
    const edgeOnly = { maxEdgePx: 1000 }
    expect(budgetVerdict(img(90_000_000, 500), 'image', edgeOnly)).toEqual({ action: 'upload' })
    expect(budgetVerdict(img(90_000_000, 1400), 'image', edgeOnly)).toEqual({
      action: 'compress',
      // Never mandatory: with no byte ceiling there is no "4× over" to be past.
      mustCompress: false,
    })
  })

  it('a budget with only a BYTE cap ignores dimensions', () => {
    const bytesOnly = { maxBytes: 500_000 }
    expect(budgetVerdict(img(400_000, 9000), 'image', bytesOnly)).toEqual({ action: 'upload' })
  })

  it('an image with unknown dimensions is judged on bytes alone', () => {
    // Decode can fail (corrupt file); the byte ceiling still protects storage.
    expect(budgetVerdict(img(300_000, undefined), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({ action: 'upload' })
    expect(budgetVerdict(img(500_000, undefined), 'image', BUDGETS.slots!.polaroid_photo)).toEqual({
      action: 'compress',
      mustCompress: false,
    })
  })

  it('CRITICAL: HEIC always compresses, even tiny and within every limit', () => {
    // Size is irrelevant for HEIC: the FORMAT cannot ship. The media bucket's
    // allowed_mime_types has no image/heic (checked live, deliberate), and a fan on
    // Chrome or Firefox cannot render one — so a within-budget verdict of 'upload'
    // would send a file storage refuses, or worse, one visitors can't see. And
    // mustCompress, so the modal never offers "Upload original": for every other
    // format that button uploads something that works, for HEIC it's a trap.
    expect(budgetVerdict(img(90_000, 800, 'image/heic'), 'image', BUDGETS.image!)).toEqual({
      action: 'compress',
      mustCompress: true,
    })
    expect(budgetVerdict(img(90_000, 800, 'image/heif'), 'image', BUDGETS.image!)).toEqual({
      action: 'compress',
      mustCompress: true,
    })
  })

  it('CRITICAL: HEIC with a BLANK mime is still caught, by extension', () => {
    // Windows and some share paths report no mime for HEIC (same reality the font rules
    // document). Detection on type alone would wave those through to a bucket that
    // refuses them — the exact dead end this change removes, back again for one OS.
    expect(
      budgetVerdict({ size: 90_000, type: '', name: 'IMG_4021.HEIC', edgePx: undefined }, 'image', BUDGETS.image!),
    ).toEqual({ action: 'compress', mustCompress: true })
  })
})

describe('budgetSlotKey — a placed role maps to its budget key (index widths)', () => {
  it('CRITICAL: a two-digit instance index still maps', () => {
    // `/_\d_/` (one digit) reads fine and is wrong the moment a site declares ten
    // instances: `polaroid_10_photo` would match nothing, silently fall back to the
    // looser kind budget, and ship 2000px into a 600px card with no error anywhere.
    expect(budgetSlotKey('polaroid_10_photo')).toBe('polaroid_photo')
    expect(budgetSlotKey('grid_123_image')).toBe('grid_image')
  })
  it('only the FIRST index segment is collapsed', () => {
    // The role shape is `<component>_<n>_<slot>`; a slot name containing digits must
    // survive intact rather than being eaten as a second index.
    expect(budgetSlotKey('polaroid_2_photo_2x')).toBe('polaroid_photo_2x')
  })
})

describe('bytesLabel — the number the whole modal is arguing about', () => {
  it('shows KB below a megabyte, MB at or above', () => {
    // upload.ts's sizeLabel rounds to whole MB and renders a 310KB result as "0 MB",
    // which turns the modal's before/after pitch into nonsense. This is why it exists.
    expect(bytesLabel(310 * 1024)).toBe('310 KB')
    expect(bytesLabel(1024 * 1024)).toBe('1.0 MB')
    expect(bytesLabel(4.2 * 1024 * 1024)).toBe('4.2 MB')
  })
  it('never renders "0 KB" — a real file always has a size worth showing', () => {
    expect(bytesLabel(1)).toBe('1 KB')
    expect(bytesLabel(0)).toBe('1 KB')
  })
  it('keeps one decimal on MB, so 4.0 MB does not read as 4 MB of precision', () => {
    expect(bytesLabel(4 * 1024 * 1024)).toBe('4.0 MB')
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
