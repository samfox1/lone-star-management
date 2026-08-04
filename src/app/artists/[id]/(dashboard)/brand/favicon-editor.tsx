'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BRAND_FOLDER,
  DEFAULT_FRAMING,
  FAVICON_PREVIEW_SIZE,
  FAVICON_SIZE,
  OFFSET_LIMIT,
  ZOOM_MAX,
  ZOOM_MIN,
  type FaviconFraming,
  drawFavicon,
} from '@/lib/brand'
import { buildStoragePath, contentTypeFor, friendlyUploadError, performUpload } from '@/lib/upload'
import { createClient } from '@/lib/supabase/client'
import { buttonClass } from '@/components/ui/ui'
import { toast } from '../toast'
import { saveFramingAction, setBrandAssetAction } from './actions'

/** One nudge press. Small enough to land a wordmark's baseline where you want it,
 *  large enough that adjusting doesn't take twenty clicks. */
const NUDGE_STEP = 0.05

/** The magnified working canvas, in backing-store pixels: 2x the 128px display box so
 *  it stays sharp on a retina screen. Must match the <canvas> width/height attributes —
 *  drawFavicon paints for the size it is told, so a mismatch silently crops. */
const WORK_CANVAS_SIZE = 256

/**
 * Frame the primary logo into a browser-tab icon.
 *
 * A favicon is a static file — there is no CSS at display time — so the zoom and nudge
 * have to be BAKED INTO THE PIXELS. This draws the logo into a canvas and, on save,
 * exports exactly what it drew. Both canvases and the export call the same `drawFavicon`,
 * so the 32px preview is not an approximation of the result: it is the result, at the
 * size a browser tab will actually show it.
 *
 * The working canvas is a magnified view of the SAME drawing, for aiming. The true-size
 * preview sits next to it because a tab icon is unforgiving and a flattering enlargement
 * would hide exactly the problem the manager needs to see.
 */
export function FaviconEditor({
  artistId,
  logoUrl,
  initialFraming,
}: {
  artistId: string
  /** The PRIMARY logo. Null when none is uploaded — there is nothing to frame. */
  logoUrl: string | null
  initialFraming: FaviconFraming
}) {
  const [framing, setFraming] = useState<FaviconFraming>(initialFraming)
  /** The decoded logo, TAGGED with the url it came from. */
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null)
  const [saving, setSaving] = useState(false)
  /** The url that failed to decode, TAGGED like `loaded` — see below. */
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const workRef = useRef<HTMLCanvasElement>(null)
  const trueRef = useRef<HTMLCanvasElement>(null)

  // The logo has to be DECODED before anything can be drawn from it: a canvas needs the
  // natural dimensions, and an <img> that hasn't loaded reports 0.
  useEffect(() => {
    if (!logoUrl) return
    let live = true
    const img = new Image()
    // MUST be set before `src` — a browser ignores it afterwards. Without it the export
    // canvas taints and `toBlob` throws SecurityError, so every save fails. It also fails
    // CLOSED: an origin that sends no CORS header refuses to load rather than tainting.
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (live) setLoaded({ url: logoUrl, img })
    }
    // Without this the editor showed two blank canvases, no message, and a Save button
    // that silently returned — indistinguishable from "still loading", forever.
    img.onerror = () => {
      if (live) setFailedUrl(logoUrl)
    }
    img.src = logoUrl
    return () => {
      live = false
    }
  }, [logoUrl])

  // Derived, not stored: the effect never has to synchronously clear state (which would
  // cascade a render), and — the real win — a decoded image is only ever used for the url
  // it was decoded FROM. Replacing the logo can't briefly draw the previous one.
  const image = loaded && loaded.url === logoUrl ? loaded.img : null
  // Tagged for the same two reasons: the effect never clears state synchronously (which
  // would cascade a render), and a failure is only ever attributed to the url that
  // actually failed — replacing a broken logo with a good one clears the error by itself.
  const loadFailed = failedUrl !== null && failedUrl === logoUrl

  const paint = useCallback(() => {
    if (!image) return
    for (const [ref, size] of [
      [workRef, WORK_CANVAS_SIZE] as const,
      [trueRef, FAVICON_PREVIEW_SIZE] as const,
    ]) {
      const ctx = ref.current?.getContext('2d')
      if (ctx) drawFavicon(ctx, image, framing, size)
    }
  }, [image, framing])

  useEffect(paint, [paint])

  async function save() {
    if (!image || saving) return
    setSaving(true)
    try {
      // Export at FAVICON_SIZE, not preview size: browsers downscale cleanly and the
      // same file covers the home-screen icon.
      const canvas = document.createElement('canvas')
      canvas.width = FAVICON_SIZE
      canvas.height = FAVICON_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      drawFavicon(ctx, image, framing, FAVICON_SIZE)

      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('export failed')

      // Framing first: if the asset write fails, the manager's adjustment still survives
      // the page reload rather than being silently thrown away.
      const framed = await saveFramingAction(artistId, framing)
      if (framed.error) throw new Error(framed.error)

      // Through `performUpload`, not a bare storage call: it removes the uploaded object
      // when the row write fails. Hand-rolling the upload here would strand a PNG in a
      // public bucket on every failed save — the exact dance lib/upload.ts exists to stop
      // being reinvented. `useStorageUpload` doesn't fit (it validates a picked File by
      // name and size; this is a generated Blob), but performUpload takes `file: unknown`.
      const path = buildStoragePath(artistId, BRAND_FOLDER, 'png')
      const res = await performUpload({
        // Same cast the shared hook uses: UploadClient is a minimal structural slice, and
        // supabase-js's `upload` is typed narrower than its `file: unknown`.
        supabase: createClient() as never,
        bucket: 'media',
        path,
        file: blob,
        contentType: contentTypeFor('png'),
        writeRow: async (p) => (await setBrandAssetAction(artistId, 'favicon', p)).error ?? null,
      })
      if ('error' in res) throw new Error(friendlyUploadError(res.error, { noun: 'tab icon' }))

      toast('Tab icon saved')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the tab icon.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!logoUrl) {
    return (
      <p className="font-space text-xs leading-relaxed text-ink-faint">
        Add a primary logo above and you can set the browser-tab icon here.
      </p>
    )
  }

  if (loadFailed) {
    return (
      <p className="font-space text-xs leading-relaxed text-accent-red">
        Couldn&rsquo;t load the primary logo, so the tab icon can&rsquo;t be previewed. Try
        re-uploading it.
      </p>
    )
  }

  const nudge = (dir: -1 | 1) =>
    setFraming((f) => ({
      ...f,
      offsetY: Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, f.offsetY + dir * NUDGE_STEP)),
    }))

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-6">
        <div>
          <canvas
            ref={workRef}
            width={WORK_CANVAS_SIZE}
            height={WORK_CANVAS_SIZE}
            aria-label="Tab icon, magnified for adjusting"
            className="h-32 w-32 rounded-xl border border-hairline bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
          />
          <p className="mt-1 font-space text-[11px] text-ink-faint">Adjust</p>
        </div>
        <div>
          <canvas
            ref={trueRef}
            width={FAVICON_PREVIEW_SIZE}
            height={FAVICON_PREVIEW_SIZE}
            aria-label="Tab icon at true size"
            // NOT scaled up: this is what a browser tab shows, and seeing it honestly is
            // the entire point of having it here.
            className="rounded border border-hairline"
            style={{ width: FAVICON_PREVIEW_SIZE, height: FAVICON_PREVIEW_SIZE }}
          />
          <p className="mt-1 font-space text-[11px] text-ink-faint">Actual size</p>
        </div>
      </div>

      <label className="block">
        <span className="font-space text-[11px] font-bold uppercase tracking-[0.1em] text-ink-faint">Zoom</span>
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={framing.zoom}
          aria-label="Zoom"
          onChange={(e) => setFraming((f) => ({ ...f, zoom: Number(e.target.value) }))}
          className="mt-1.5 w-full max-w-xs"
        />
      </label>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => nudge(-1)} className={buttonClass('ghost')} aria-label="Move logo up">
          Move up
        </button>
        <button type="button" onClick={() => nudge(1)} className={buttonClass('ghost')} aria-label="Move logo down">
          Move down
        </button>
        <button
          type="button"
          onClick={() => setFraming(DEFAULT_FRAMING)}
          className={buttonClass('ghost')}
        >
          Reset
        </button>
      </div>

      <button type="button" onClick={save} disabled={saving} className={buttonClass('ghost')}>
        {saving ? 'Saving…' : 'Save tab icon'}
      </button>
    </div>
  )
}
