'use client'

import { useEffect, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { buttonClass, inputClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import {
  OG_BACKGROUNDS,
  OG_CARD_HEIGHT,
  OG_CARD_WIDTH,
  drawOgCard,
  ogBackgroundHex,
} from '@/lib/og-card'
import { toast } from '../../toast'
import { saveOgCardAction } from './actions'

export type OgSource = { url: string; label: string }

/**
 * The social preview image: pick one of the artist's own images, sit it on a solid
 * background, and store the 1200x630 card that comes out.
 *
 * This replaces a URL text box. Two things that box could not do, and both fail where
 * nobody can see them — on someone else's server, in someone else's dark-mode client:
 *
 *   • A logo PNG is RGBA. Platforms composite og:image onto THEIR background, so a black
 *     logo on alpha is black-on-black in every dark-mode share.
 *   • A 1.42:1 logo in a 1.91:1 slot gets cropped or letterboxed, platform's choice.
 *
 * The canvas is the SAME `drawOgCard` the export calls, so the preview is the file. The
 * stored value stays a plain absolute https URL under `og_image` — no contract change
 * for a consuming site.
 */
export function OgImagePicker({
  artistId,
  sources,
  currentUrl,
}: {
  artistId: string
  /** The artist's own images — brand logos first, then the hero/profile photos. */
  sources: OgSource[]
  currentUrl: string
}) {
  const [source, setSource] = useState<string>(sources[0]?.url ?? '')
  const [background, setBackground] = useState(OG_BACKGROUNDS[0].value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(currentUrl)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const busyRef = useRef(false)

  // Redraw whenever the source or the background changes. The image has to be DECODED
  // before a canvas can draw from it, and it must be fetched cross-origin-clean or the
  // canvas taints and toBlob throws SecurityError on save — the storage bucket serves
  // permissive CORS, so `crossOrigin` is set rather than assumed.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !source) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!cancelled) drawOgCard(ctx, img, background)
    }
    img.onerror = () => {
      if (!cancelled) setError('That image could not be loaded.')
    }
    img.src = source
    return () => {
      cancelled = true
    }
  }, [source, background])

  async function save() {
    if (busy || busyRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('Could not render the card.')
      const fd = new FormData()
      fd.set('file', blob, 'og-card.png')
      const result = await saveOgCardAction(artistId, fd)
      if (result.error) {
        setError(result.error)
      } else {
        setSaved(result.url ?? '')
        toast('Social preview saved')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the card.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (sources.length === 0) {
    return (
      <p className="font-space text-[11px] leading-relaxed text-ink-faint">
        Upload a logo on the{' '}
        <span className="font-bold text-ink">Brand</span> page, or a hero image on the Site page, and
        it can be used here.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
            Image
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Social preview image"
            className={cx('mt-1.5 w-full', inputClass)}
          >
            {sources.map((s) => (
              <option key={s.url} value={s.url}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-faint">
            Background
          </span>
          <select
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            aria-label="Social preview background"
            className={cx('mt-1.5 w-full', inputClass)}
          >
            {OG_BACKGROUNDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Shown at the shape it will be shared at, on a checkerboard-free surface: the
          background IS the point, so the preview must not borrow the page's. */}
      <div className="overflow-hidden rounded-lg border border-hairline">
        <canvas
          ref={canvasRef}
          width={OG_CARD_WIDTH}
          height={OG_CARD_HEIGHT}
          aria-label="Social preview"
          className="block w-full"
          style={{ backgroundColor: ogBackgroundHex(background) }}
        />
      </div>

      <p className="font-space text-[11px] leading-relaxed text-ink-faint">
        A transparent logo turns invisible in dark-mode social clients, so the background is
        baked into the saved image. 1200&times;630, the size the platforms crop to.
      </p>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={buttonClass('accent')}>
          {busy ? 'Saving…' : 'Save social preview'}
        </button>
        {saved && !busy && (
          <span className="inline-flex items-center gap-1 font-space text-[11px] text-ink-muted">
            <Icon name="check" size={14} /> Saved
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="font-space text-[11px] text-accent-red">
          {error}
        </p>
      )}
    </div>
  )
}
