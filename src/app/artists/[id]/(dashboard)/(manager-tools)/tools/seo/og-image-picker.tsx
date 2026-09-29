'use client'

import { useEffect, useRef, useState } from 'react'
import { buttonClass } from '@/components/ui/ui'
import { Icon } from '@/components/ui/icons'
import { OG_BACKGROUNDS, OG_CARD_HEIGHT, OG_CARD_WIDTH, drawOgCard, ogBackgroundHex } from '@/lib/manager-tools/seo/og-card'
import { CardModal } from '../../../card-modal'
import { KvRow, MetaDot, ModalHeader, SelectMenu } from '../../../modal-kit'
import { saveOgCardAction } from './actions'

export type OgSource = { url: string; label: string }

/**
 * THE SHARE PICTURE, in the modal-kit grammar (round 2's "Share image" card: the picture big,
 * then Image and Background rows, Save). Pick one of the artist's own images, sit it on a
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
 * for a consuming site. Save renders and stores the card, then closes; closing without Save
 * changes nothing.
 */
export function ShareImageModal({
  artistId,
  sources,
  onClose,
  onSaved,
}: {
  artistId: string
  /** The artist's own images — brand logos first, then the hero/profile photos. */
  sources: OgSource[]
  onClose: () => void
  /** The stored card's URL, once saved. */
  onSaved: (url: string) => void
}) {
  const [source, setSource] = useState<string>(sources[0]?.url ?? '')
  const [background, setBackground] = useState(OG_BACKGROUNDS[0].value)
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
      if (!cancelled) setError('That image could not be loaded.')
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
      if (!blob) throw new Error('Could not render the card.')
      const fd = new FormData()
      fd.set('file', blob, 'og-card.png')
      const result = await saveOgCardAction(artistId, fd)
      if (result.error) setError(result.error)
      else {
        onSaved(result.url ?? '')
        onClose()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the card.')
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
        <button type="button" onClick={() => void save()} disabled={busy} className={buttonClass('confirm', 'min-w-[88px] justify-center')}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      ) : null}
    </div>
  )

  return (
    <CardModal open onClose={onClose} label="Share image" footer={footer}>
      <ModalHeader
        square={
          <div className="flex h-full w-full items-center justify-center rounded-xl border border-hairline text-ink">
            <Icon name="photo" size={26} />
          </div>
        }
        title="Share image"
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
        <p className="mt-5 text-[14px] text-ink-muted">No logo or hero image yet. Add one on the Brand page.</p>
      ) : (
        <div className="mt-5">
          {/* Shown at the shape it will be shared at: the background IS the point, so the
              preview must not borrow the page's. */}
          <canvas
            ref={canvasRef}
            width={OG_CARD_WIDTH}
            height={OG_CARD_HEIGHT}
            aria-label="Share picture preview"
            className="block w-full rounded-[10px] border border-hairline"
            style={{ backgroundColor: ogBackgroundHex(background) }}
          />
          <div className="mt-3">
            <KvRow label="Image">
              <SelectMenu label="Image" value={source} options={sources.map((s) => ({ value: s.url, label: s.label }))} required onChange={setSource} />
            </KvRow>
            <KvRow label="Background">
              <SelectMenu label="Background" value={background} options={OG_BACKGROUNDS.map((b) => ({ value: b.value, label: b.label }))} required onChange={setBackground} />
            </KvRow>
          </div>
        </div>
      )}
    </CardModal>
  )
}
