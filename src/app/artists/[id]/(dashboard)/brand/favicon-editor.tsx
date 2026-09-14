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
import { cx } from '@/lib/cx'
import { buildStoragePath, contentTypeFor, friendlyUploadError, performUpload } from '@/lib/upload'
import { createClient } from '@/lib/supabase/client'
import { Icon } from '@/components/ui/icons'
import { toast } from '../toast'
import { saveFramingAction, setBrandAssetAction } from './actions'

const NUDGE_STEP = 0.05
/** How long after the last change the icon is written. Long enough to drag the slider. */
const SAVE_AFTER_MS = 700

/**
 * THE TAB ICON, as one row (Sam, 2026-09-13): the icon at its true 32px, the zoom line,
 * and up / down / reset as three bare glyphs. No headings, no explanation, and no Save
 * button — a change is written a moment after the manager stops making it, the way
 * every other row on the tool pages saves itself. What is on screen at true size is the
 * file that gets used, because preview and export call the same `drawFavicon`.
 *
 * The icon is DERIVED from the primary logo. With no logo there is nothing to frame, and
 * the row shows nothing rather than a control that cannot work.
 */
export function FaviconEditor({
  artistId,
  logoUrl,
  initialFraming,
}: {
  artistId: string
  /** The PRIMARY logo. Null when none is uploaded. */
  logoUrl: string | null
  initialFraming: FaviconFraming
}) {
  const [framing, setFraming] = useState<FaviconFraming>(initialFraming)
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const trueRef = useRef<HTMLCanvasElement>(null)
  /** Set by the manager's own changes only — the seed from the server must not save. */
  const touched = useRef(false)
  const savingRef = useRef(false)

  useEffect(() => {
    if (!logoUrl) return
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => live && setLoaded({ url: logoUrl, img })
    img.onerror = () => live && setFailedUrl(logoUrl)
    img.src = logoUrl
    return () => {
      live = false
    }
  }, [logoUrl])

  const image = loaded && loaded.url === logoUrl ? loaded.img : null
  const loadFailed = failedUrl !== null && failedUrl === logoUrl

  const paint = useCallback(() => {
    if (!image) return
    const ctx = trueRef.current?.getContext('2d')
    if (ctx) drawFavicon(ctx, image, framing, FAVICON_PREVIEW_SIZE)
  }, [image, framing])
  useEffect(paint, [paint])

  const save = useCallback(async () => {
    if (!image || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = FAVICON_SIZE
      canvas.height = FAVICON_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      drawFavicon(ctx, image, framing, FAVICON_SIZE)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('export failed')
      const framed = await saveFramingAction(artistId, framing)
      if (framed.error) throw new Error(framed.error)
      const path = buildStoragePath(artistId, BRAND_FOLDER, 'png')
      const res = await performUpload({
        supabase: createClient() as never,
        bucket: 'media',
        path,
        file: blob,
        contentType: contentTypeFor('png'),
        writeRow: async (p) => (await setBrandAssetAction(artistId, 'favicon', p)).error ?? null,
      })
      if ('error' in res) throw new Error(friendlyUploadError(res.error, { noun: 'tab icon' }))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the tab icon.', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [artistId, framing, image])

  // Autosave: a moment after the last change the manager made.
  useEffect(() => {
    if (!touched.current) return
    const t = setTimeout(() => void save(), SAVE_AFTER_MS)
    return () => clearTimeout(t)
  }, [framing, save])

  function change(next: FaviconFraming) {
    touched.current = true
    setFraming(next)
  }
  const nudge = (dir: 1 | -1) =>
    change({ ...framing, offsetY: Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, framing.offsetY + dir * NUDGE_STEP)) })

  if (!logoUrl) return <span className="block h-6 leading-6 text-hairline">—</span>
  if (loadFailed) return <span className="font-space text-[11px] text-accent-red">Couldn’t load the primary logo</span>

  return (
    <div className="flex items-center gap-4">
      <canvas
        ref={trueRef}
        width={FAVICON_PREVIEW_SIZE}
        height={FAVICON_PREVIEW_SIZE}
        aria-label="Tab icon at true size"
        className={cx('h-8 w-8 rounded-[7px] bg-[repeating-conic-gradient(#00000010_0_25%,transparent_0_50%)] bg-[length:8px_8px]', saving && 'opacity-60')}
      />
      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.01}
        value={framing.zoom}
        aria-label="Zoom"
        onChange={(e) => change({ ...framing, zoom: Number(e.target.value) })}
        className="h-[2px] w-[120px] cursor-pointer appearance-none bg-hairline accent-ink [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink"
      />
      <span className="flex items-center gap-1.5">
        <button type="button" onClick={() => nudge(-1)} aria-label="Move logo up" className={ACT}>
          <Icon name="chevronLeft" size={13} className="rotate-90" />
        </button>
        <button type="button" onClick={() => nudge(1)} aria-label="Move logo down" className={ACT}>
          <Icon name="chevronLeft" size={13} className="-rotate-90" />
        </button>
        <button type="button" onClick={() => change(DEFAULT_FRAMING)} aria-label="Reset" className={ACT}>
          <Icon name="refresh" size={12} />
        </button>
      </span>
    </div>
  )
}

const ACT = 'flex h-5 w-5 items-center justify-center text-ink-faint transition-colors hover:text-ink'
