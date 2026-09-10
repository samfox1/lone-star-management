/**
 * NO UPLOADER MAY ASSEMBLE ITS OWN DROP FIELD.
 *
 * The compression gate shipped on 2026-08-06 wired into the uploaders that existed in
 * `media-uploader.tsx`. The editor's hero-image / profile-photo modal, written the same
 * day in `photo-tools.tsx`, hand-assembled the identical `FileDropField` +
 * `useStorageUpload` pair and got no gate — so the SAME oversized photo compressed when
 * placed from the Images panel and uploaded whole when placed from the editor tile. No
 * error, no warning; the two paths simply disagreed.
 *
 * That is a shape, not a slip: three pieces that must be composed, seven call sites, and
 * nothing to notice when one gets two of the three. `UploadField` composes them once, and
 * this test keeps it the only place that does — a new uploader either uses it or fails
 * here, which is the point at which someone reads why.
 *
 * A file-shape test rather than a behavioural one, deliberately. What is being protected
 * is that a seam does not reopen, and no runtime assertion can see a seam that a future
 * component has not created yet.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DASHBOARD = join(process.cwd(), 'src/app/artists/[id]/(dashboard)')

/** The one component allowed to compose the drop field with the upload hook. */
const COMPOSER = 'upload-field.tsx'
/**
 * Uploaders that legitimately drive `useStorageUpload` themselves.
 *
 * `track-audio-uploader.tsx` renders no drop field at all (it is a bare button over a
 * hidden input), and audio has no budget to gate on — there is nothing for UploadField
 * to give it. Every entry here is a claim that the file uploads something the gate has
 * no opinion about; adding one to silence this test is how the seam reopens.
 */
const ALLOWED_SOLO = new Set([
  // Renders no drop field at all — a bare button over a hidden input.
  'track-audio-uploader.tsx',
  // Its drop field STAGES a file (`onFile={setFile}`) for a multi-field form and uploads
  // on submit, so there is no drop→upload seam for UploadField to own. When the videos
  // page gains a manifest, the gate belongs at stage time rather than here.
  'video-add.tsx',
  COMPOSER,
])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return name.endsWith('.tsx') || name.endsWith('.ts') ? [full] : []
  })
}

const files = walk(DASHBOARD).map((path) => ({
  path,
  name: path.split('/').pop()!,
  src: readFileSync(path, 'utf8'),
}))

describe('every upload path goes through UploadField', () => {
  it('sanity: the sweep actually found the dashboard files', () => {
    // Guards the guard. A broken path would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((f) => f.name === COMPOSER)).toBe(true)
  })

  it('CRITICAL: no component pairs FileDropField with useStorageUpload itself', () => {
    // The exact shape that shipped ungated. Either piece alone is fine; together they are
    // an uploader, and an uploader assembled by hand is one nobody remembered to gate.
    const handRolled = files
      .filter((f) => !ALLOWED_SOLO.has(f.name))
      .filter((f) => f.src.includes('FileDropField') && /useStorageUpload\(/.test(f.src))
      .map((f) => f.name)
    expect(handRolled).toEqual([])
  })

  it('CRITICAL: UploadField is the only place the gate is composed with the upload', () => {
    // The other direction: a caller could import useBudgetGate and re-implement the
    // composition badly (gating AFTER the upload, or dropping the modal). One composer.
    const composers = files.filter((f) => f.src.includes('useBudgetGate')).map((f) => f.name)
    expect(composers.sort()).toEqual(['budget-gate.tsx', COMPOSER])
  })

  it('CRITICAL: the composer renders the gate modal AND awaits the gate', () => {
    // Returning `prepare` without rendering `modal` is silent and total: the promise
    // never settles, so the drop field sits idle forever with no error anywhere.
    const composer = files.find((f) => f.name === COMPOSER)!.src
    expect(composer).toContain('gate.modal')
    expect(composer).toContain('await gate.prepare')
  })

  it('CRITICAL: the gate applies the FLOOR itself — no caller can produce an ungated door', () => {
    // Every dashboard uploader passes no budget (no manifest is in scope outside the
    // editor), so a gate that fired only on a supplied budget was inert on the Photos,
    // Media and Brand pages — which is where managers actually upload. Resolving the
    // floor inside the gate rather than at each call site is what makes "every stored
    // file is compressed" a property of the code instead of seven remembered props.
    const gate = files.find((f) => f.name === 'budget-gate.tsx')!.src
    expect(gate).toContain('withFloor(')
  })

  it('every editor image uploader is handed a budget', () => {
    // The gate is inert without one, so an uploader inside the editor — where the
    // manifest IS in scope — that forgets `budget=` is ungated in practice even though
    // it uses the composer.
    const editorPanels = files.filter((f) => f.path.includes('/editor/'))
    const uploaders = editorPanels.filter(
      (f) => f.src.includes('<UploadField') || f.src.includes('<GallerySlotUploader'),
    )
    expect(uploaders.length).toBeGreaterThan(0)
    for (const f of uploaders) {
      const tags = f.src.match(/<(?:UploadField|GallerySlotUploader)\b[\s\S]*?\/>/g) ?? []
      expect(tags.length, `${f.name} uploader tags`).toBeGreaterThan(0)
      for (const tag of tags) expect(tag, `${f.name}: ${tag.slice(0, 60)}`).toMatch(/budget=/)
    }
  })
})
