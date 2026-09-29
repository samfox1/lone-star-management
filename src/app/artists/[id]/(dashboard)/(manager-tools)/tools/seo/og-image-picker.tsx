'use client'

import { useEffect, useRef, useState } from 'react'
import { OG_BACKGROUNDS, OG_CARD_HEIGHT, OG_CARD_WIDTH, drawOgCard, ogBackgroundHex } from '@/lib/manager-tools/seo/og-card'
import { CardModal } from '../../../card-modal'
import { HeaderIcon, KvLabel, MetaDot, ModalHeader, SelectMenu } from '../../../modal-kit'
import { BrandSwatchProvider, ColorPalette, type NamedSwatch } from '../../../editor/color-picker'
import { saveOgCardAction } from './actions'
import { RowIcon } from '../../_ui/row-icon'

export type OgSource = { url: string; label: string }

/**
 * THE PREVIEW PICTURE (Sam's name for the share image, 2026-09-29), in the modal-kit grammar:
 * the picture big, the Image and Background choices beside it, Save. Pick one of the artist's own images, sit it on a
 * solid background, and store the 1200x630 card that comes out.
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
 * for a consuming site. "Use this picture" renders and stores the card, then closes; closing
 * without it changes nothing.
 */
export function ShareImageModal({
  artistId,
  sources,
  brandColors = [],
  onClose,
  onSaved,
}: {
  artistId: string
  /** The artist's own images — brand logos first, then the hero/profile photos. */
  sources: OgSource[]
  /** The artist's Brand colours, by name: offered first as the background (the standing
   *  colour rule: every colour control is the ColorPalette, swatches + the picker). */
  brandColors?: readonly NamedSwatch[]
  onClose: () => void
  /** The stored card's URL, once saved. */
  onSaved: (url: string) => void
}) {
  const [source, setSource] = useState<string>(sources[0]?.url ?? '')
  /** The background as a hex: a Brand colour, one of the four plain ones, or any mixed. */
  const [background, setBackground] = useState(OG_BACKGROUNDS[0].hex)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      if (!cancelled) setError('That picture couldn’t be loaded.')
    }
    img.src = source
    return () => {
      cancelled = true
    }
  }, [source, background])

  async function save() {
    // The latch is a ref (AGENTS.md rule 5): two fast clicks both read the pre-render state.
    if (busyRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('Couldn’t make the picture.')
      const fd = new FormData()
      fd.set('file', blob, 'og-card.png')
      const result = await saveOgCardAction(artistId, fd)
      if (result.error) setError(result.error)
      else {
        onSaved(result.url ?? '')
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error && e.message === 'Couldn’t make the picture.' ? e.message : 'Couldn’t save the picture.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const footer = (
    <div className="flex items-center justify-between gap-5">
      <div className="min-w-0">
        {error ? (
          <p role="alert" className="font-space text-[11px] text-accent-red">
            {error}
          </p>
        ) : null}
      </div>
      {sources.length ? (
        // ONE explicit action, as the kit's boxed icon (not a pill), and deliberately not an
        // autosave: the card is written to ONE fixed PUBLIC file that shared links read at
        // once, so trying colours must not overwrite what's already out there. Only this does.
        <span className="flex items-center gap-2.5">
          {busy ? <span className="font-space text-[11px] text-ink-faint">Saving…</span> : null}
          <RowIcon icon="check" label="Use this picture" variant="boxed" size="sm" tone="accent" labelSide="top" labelAlign="end" onClick={() => void save()} disabled={busy} />
        </span>
      ) : null}
    </div>
  )

  return (
    // WIDE, and never scrolling (Sam, 2026-09-29: "this modal shouldn't be scrollable. Just
    // make it bigger"): the picture on the left at the shape it's shared at, the two choices
    // beside it. Fits a 1280 × 800 laptop with room to spare.
    <CardModal open wide onClose={onClose} label="Preview picture" footer={footer}>
      <ModalHeader
        mark={<HeaderIcon name="photo" />}
        title="Preview picture"
        meta={
          <>
            {`${OG_CARD_WIDTH} × ${OG_CARD_HEIGHT}`}
            <MetaDot />
            iMessage
            <MetaDot />X<MetaDot />
            Instagram
          </>
        }
      />
      {sources.length === 0 ? (
        // Leads with the absence: a reader with no image needs to know that first.
        <p className="mt-5 text-[14px] text-ink-muted">No logo or main photo yet. Add one on the Brand page.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 items-start gap-6 min-[760px]:grid-cols-[minmax(0,1fr)_240px]">
          {/* Shown at the shape it will be shared at: the background IS the point, so the
              preview must not borrow the page's. */}
          <canvas
            ref={canvasRef}
            width={OG_CARD_WIDTH}
            height={OG_CARD_HEIGHT}
            aria-label="Preview picture"
            className="block w-full rounded-[10px] border border-hairline"
            style={{ backgroundColor: ogBackgroundHex(background) }}
          />
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <KvLabel>Image</KvLabel>
              <SelectMenu label="Image" value={source} options={sources.map((s) => ({ value: s.url, label: s.label }))} required onChange={setSource} />
            </div>
            <div className="flex flex-col gap-1.5">
              <KvLabel>Background</KvLabel>
              <BrandSwatchProvider colors={brandColors}>
                <ColorPalette variant="row" label="Background" aria="Background" value={background} used={OG_BACKGROUNDS.map((b) => b.hex)} onChange={(hex) => hex && setBackground(hex)} />
              </BrandSwatchProvider>
            </div>
          </div>
        </div>
      )}
    </CardModal>
  )
}
