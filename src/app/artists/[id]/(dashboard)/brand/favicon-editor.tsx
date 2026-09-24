'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  BRAND_FOLDER,
  DEFAULT_FRAMING,
  FAVICON_SIZE,
  OFFSET_LIMIT,
  ZOOM_MAX,
  ZOOM_MIN,
  type FaviconFraming,
  type IconTarget,
  drawFavicon,
  sameFraming,
} from '@/lib/brand'
import { cx } from '@/lib/cx'
import { mediaUrl } from '@/lib/storage-url'
import {
  acceptFor,
  buildStoragePath,
  contentTypeFor,
  friendlyUploadError,
  IMAGE_UPLOAD_RULES,
  performUpload,
} from '@/lib/upload'
import { createClient } from '@/lib/supabase/client'
import { buttonClass } from '@/components/ui/ui'
import { SelectMenu } from '../modal-kit'
import { toast } from '../toast'
import { UploadField } from '../upload-field'
import { BrandModal } from './_ui/brand-modal'
import { ModalBoard } from './_ui/modal-board'
import { RowIcon } from './_ui/row-icon'
import { addIconSourceAction, saveFramingAction, setBrandAssetAction, setIconSourceAction } from './actions'

/** How long after the last change the icon is written. Long enough to drag a slider. */
export const SAVE_AFTER_MS = 700

/** The row preview's canvas, in pixels: 2× the largest row tile (64px), for retina. */
export const ICON_ROW_CANVAS = 128

/** The board's canvas, in pixels: the 192px icon on the board at 2×, so it is sharp on a
 *  retina screen. The export is FAVICON_SIZE; both come from the same `drawFavicon`. */
export const ICON_BOARD_CANVAS = 384

/** Each icon's shape — on the editor's board and on its row. The home-screen icon is the
 *  phone's rounded square (the prototype's corners); the tab icon a squarer tile. */
export const ICON_SHAPE: Record<IconTarget, { board: string; row: string; name: 'tab' | 'rounded-square' }> = {
  favicon: { board: 'rounded-[36px]', row: 'h-16 w-16 rounded-[12px]', name: 'tab' },
  home_icon: { board: 'rounded-[44px]', row: 'h-14 w-14 rounded-[14px]', name: 'rounded-square' },
}

/** What an icon is framed from: a media id (null = the primary logo) and its full-size
 *  URL (null = nothing to frame). */
export type IconSourceRef = { id: string | null; url: string | null }
/** One entry in "Select a logo…". */
export type IconLogo = { id: string; label: string; url: string }

/**
 * THE ICON ENGINE, shared by both generated icons (the tab icon and the home-screen icon).
 * An icon is DERIVED: its source image, framed by the manager, baked into a 180px PNG —
 * a static file has no CSS at display time, so the framing has to be in the pixels. The
 * board and the export call the same `drawFavicon`, so what is judged is what ships.
 *
 * The guarantees, each with a test (tests/components/site-editor/favicon-editor.test.tsx):
 *   • nothing saves on mount — the server's seed is not an edit (`touched`);
 *   • nothing saves when the framing and source are back where they were last SAVED — a
 *     slider dragged away and back, or Reset on an icon already at the default (`saved`).
 *     A save uploads a new PNG and swaps the row, so re-saving the same icon would raise
 *     the Publish bar for nothing (fix round, 2026-09-23);
 *   • a change saves itself SAVE_AFTER_MS after the last one (no Save needed), and a
 *     change made while a save is in flight saves once more after it, with the framing as
 *     it is by then (`pendingRef`), so there is only ever one save running;
 *   • the framing is written BEFORE the asset, so a failed upload keeps the adjustment;
 *   • closing straight after a change still saves it (the flush on unmount);
 *   • a new source (a logo picked, an image uploaded) regenerates the icon with the
 *     current framing, exactly like a slider change.
 */
function useIconFraming({
  artistId,
  target,
  noun,
  initialFraming,
  initialSource,
}: {
  artistId: string
  target: IconTarget
  /** "tab icon", for error copy. */
  noun: string
  initialFraming: FaviconFraming
  initialSource: IconSourceRef
}) {
  const [framing, setFraming] = useState<FaviconFraming>(initialFraming)
  const [source, setSourceState] = useState<IconSourceRef>(initialSource)
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Set by the manager's own changes only — the seed from the server must not save. */
  const touched = useRef(false)
  const savingRef = useRef(false)
  /** A change made WHILE a save was in flight: the save runs once more when it lands. */
  const pendingRef = useRef(false)
  /** A change waiting out its SAVE_AFTER_MS — what closing the editor must not drop. */
  const dirtyRef = useRef(false)
  /** What a save reads: the latest framing and source, not the ones it was scheduled with. */
  const latest = useRef({ framing, source })
  /** What the stored PNG was last made from — the server's seed, then each successful save. */
  const saved = useRef({ framing: initialFraming, sourceId: initialSource.id })
  const isSaved = useCallback(
    (f: FaviconFraming, s: IconSourceRef) => s.id === saved.current.sourceId && sameFraming(f, saved.current.framing),
    [],
  )
  useEffect(() => {
    latest.current = { framing, source }
  }, [framing, source])
  const saveRef = useRef<() => void>(() => {})

  /** One load per URL, shared by the board and the export — so a save made before the
   *  board has painted (a close straight after picking a logo) still has its image. */
  const images = useRef(new Map<string, Promise<HTMLImageElement>>())
  const loadImage = useCallback((url: string) => {
    let p = images.current.get(url)
    if (!p) {
      p = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Couldn’t load that image.'))
        img.src = url
      })
      images.current.set(url, p)
      // A failed load may be tried again later (a flaky network), not remembered forever.
      p.catch(() => images.current.delete(url))
    }
    return p
  }, [])

  useEffect(() => {
    const url = source.url
    if (!url) return
    let live = true
    loadImage(url).then(
      (img) => live && setLoaded({ url, img }),
      () => live && setFailedUrl(url),
    )
    return () => {
      live = false
    }
  }, [source.url, loadImage])

  const image = loaded && loaded.url === source.url ? loaded.img : null
  const loadFailed = source.url !== null && failedUrl === source.url
  /** A source is chosen and its image is on its way: the board says so (Sam, 2026-09-23:
   *  "blank for ~4s"), and the sliders wait for it. */
  const loading = source.url !== null && !image && !loadFailed

  const save = useCallback(async () => {
    const used = latest.current
    const url = used.source.url
    if (!url) return
    if (savingRef.current) {
      pendingRef.current = true
      return
    }
    // Back where it was saved (the flush on close, or a re-save after one in flight).
    if (isSaved(used.framing, used.source)) return
    savingRef.current = true
    setSaving(true)
    try {
      const img = await loadImage(url)
      const framing = used.framing
      const canvas = document.createElement('canvas')
      canvas.width = FAVICON_SIZE
      canvas.height = FAVICON_SIZE
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      drawFavicon(ctx, img, framing, FAVICON_SIZE)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('export failed')
      // Framing FIRST: if the upload then fails, the adjustment is kept and the next save
      // (or the next visit) starts from it.
      const framed = await saveFramingAction(artistId, framing, target)
      if (framed.error) throw new Error(framed.error)
      const res = await performUpload({
        supabase: createClient() as never,
        bucket: 'media',
        path: buildStoragePath(artistId, BRAND_FOLDER, 'png'),
        file: blob,
        contentType: contentTypeFor('png'),
        writeRow: async (p) => (await setBrandAssetAction(artistId, target, p)).error ?? null,
      })
      if ('error' in res) throw new Error(friendlyUploadError(res.error, { noun }))
      saved.current = { framing, sourceId: used.source.id }
    } catch (e) {
      toast(e instanceof Error ? e.message : `Could not save the ${noun}.`, 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
      if (pendingRef.current) {
        pendingRef.current = false
        saveRef.current()
      }
    }
  }, [artistId, target, noun, loadImage, isSaved])
  useEffect(() => {
    saveRef.current = () => void save()
  }, [save])

  // Autosave: a moment after the last change the manager made — to the framing OR the source.
  // Back where it was saved is caught in `save` itself, which every path goes through (this
  // timer, the flush on close, the re-save after one in flight).
  useEffect(() => {
    if (!touched.current) return
    dirtyRef.current = true
    const t = setTimeout(() => {
      dirtyRef.current = false
      void save()
    }, SAVE_AFTER_MS)
    return () => clearTimeout(t)
  }, [framing, source, save])

  // Closing the editor mid-wait saves the change now instead of dropping it.
  useEffect(
    () => () => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      saveRef.current()
    },
    [],
  )

  const change = (next: FaviconFraming) => {
    touched.current = true
    setFraming(next)
  }
  const setSource = (next: IconSourceRef) => {
    touched.current = true
    setSourceState(next)
  }
  return { framing, change, source, setSource, image, loading, loadFailed, saving }
}

/**
 * An icon drawn LIVE from its source and framing — the row preview before any PNG exists
 * (fix round, 2026-09-23: Skeen's home-screen icon row was blank although its source, the
 * primary logo, was right there). The same `drawFavicon` the editor's board and the export
 * use, so the row shows what a save would make. Loads with CORS (the public media bucket
 * answers `*`), like the editor, so the browser can reuse the one download.
 */
export function IconLivePreview({
  url,
  framing,
  label,
  className,
}: {
  url: string
  framing: FaviconFraming
  label: string
  className?: string
}) {
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null)
  useEffect(() => {
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => live && setLoaded({ url, img })
    img.src = url
    return () => {
      live = false
    }
  }, [url])
  return (
    <IconCanvas
      image={loaded && loaded.url === url ? loaded.img : null}
      framing={framing}
      size={ICON_ROW_CANVAS}
      label={label}
      role="img"
      className={className}
    />
  )
}

/** A canvas that paints the framed image at its own size — the board, or a row preview. */
function IconCanvas({
  image,
  framing,
  size,
  label,
  role,
  className,
}: {
  image: HTMLImageElement | null
  framing: FaviconFraming
  size: number
  label: string
  role?: 'img'
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    if (image) drawFavicon(ctx, image, framing, size)
    else ctx.clearRect(0, 0, size, size)
  }, [image, framing, size])
  return <canvas ref={ref} width={size} height={size} role={role} aria-label={label} className={className} />
}

const LABEL = 'font-space text-[11px] uppercase tracking-[0.08em] text-ink-faint'
const OUTPUT = 'min-w-[44px] text-right font-space text-[12px] text-ink-muted'

/** Size and Up / down (Reset lives in the footer, beside Save). Disabled — greyed, never
 *  hidden — when there is nothing to frame yet, so the modal keeps one shape. */
function FramingControls({
  framing,
  onChange,
  disabled,
}: {
  framing: FaviconFraming
  onChange: (next: FaviconFraming) => void
  disabled: boolean
}) {
  const id = useId()
  return (
    // `mt-4`: the "Upload new" hover label hangs 8px + 24px under the +; the column's 20px gap
    // plus this 16px keeps it clear of the Size label (Sam, 2026-09-23: it covered SIZE).
    <div data-framing="" className={cx('mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2.5', disabled && 'opacity-35')}>
      <span aria-hidden="true" className={LABEL}>Size</span>
      <input
        id={`${id}-size`}
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.01}
        value={framing.zoom}
        aria-label="Size"
        disabled={disabled}
        onChange={(e) => onChange({ ...framing, zoom: Number(e.target.value) })}
        className="w-full cursor-pointer accent-ink disabled:cursor-default"
      />
      <output htmlFor={`${id}-size`} className={OUTPUT}>{`${Math.round(framing.zoom * 100)}%`}</output>
      <span aria-hidden="true" className={LABEL}>Up / down</span>
      <input
        id={`${id}-y`}
        type="range"
        min={-OFFSET_LIMIT}
        max={OFFSET_LIMIT}
        step={0.01}
        value={framing.offsetY}
        aria-label="Up or down"
        disabled={disabled}
        onChange={(e) => onChange({ ...framing, offsetY: Number(e.target.value) })}
        className="w-full cursor-pointer accent-ink disabled:cursor-default"
      />
      <output htmlFor={`${id}-y`} className={OUTPUT}>{`${Math.round(framing.offsetY * FAVICON_SIZE)}px`}</output>
    </div>
  )
}

/**
 * THE ICON EDITOR (Sam, 2026-09-23, BRAND_PAGE_PLAN.md "Tab icon"): one editor for the tab
 * icon and the home-screen icon, each with its OWN source and framing (`target` goes to
 * every action). A BrandModal titled only "<name> edit" (no thumbnail): the icon on the
 * board (its own shape, no background circles); beside it, level with the board's top,
 * "+" (Upload new) and "Select a logo…", then Size and Up / down; Reset in the footer,
 * just left of Save.
 *
 * Source changes save at once (they are a choice, not a drag); the icon then regenerates
 * from the new source with the current framing. Save closes — everything is already saved,
 * and anything still waiting is flushed as the editor closes.
 */
export function IconEditor({
  artistId,
  target,
  label,
  initialFraming,
  source,
  logos,
  onClose,
}: {
  artistId: string
  target: IconTarget
  /** "Tab icon" / "Home-screen icon": the modal's title and accessible name. */
  label: string
  initialFraming: FaviconFraming
  /** The saved source, resolved (null id = the primary logo). */
  source: IconSourceRef
  /** Primary, Secondary, then the added logos. */
  logos: IconLogo[]
  onClose: () => void
}) {
  const noun = label.toLowerCase()
  const ed = useIconFraming({ artistId, target, noun, initialFraming, initialSource: source })
  /** One source change at a time (AGENTS.md rule 5: a ref, not state). */
  const choosing = useRef(false)

  async function chooseLogo(id: string) {
    const logo = logos.find((l) => l.id === id)
    if (!logo || choosing.current) return
    choosing.current = true
    try {
      const res = await setIconSourceAction(artistId, target, id)
      if (res.error) {
        toast(res.error, 'error')
        return
      }
      ed.setSource({ id, url: logo.url })
    } catch {
      toast(`Couldn’t change the ${noun}.`, 'error')
    } finally {
      choosing.current = false
    }
  }

  /** performUpload's `writeRow`: an error means NO row was written and the object goes. */
  async function writeUploadedSource(path: string): Promise<string | null> {
    const added = await addIconSourceAction(artistId, target, path)
    if (added.error || !added.mediaId) return added.error ?? 'Could not save that image.'
    // The row is in and already this icon's source (addIconSource sets it); this confirms
    // it the same way a picked logo is set. Past this point the object must stay, so a
    // refusal here is a toast, never an error handed back to the upload.
    const set = await setIconSourceAction(artistId, target, added.mediaId)
    if (set.error) toast(set.error, 'error')
    ed.setSource({ id: added.mediaId, url: mediaUrl(path) })
    return null
  }

  const shape = ICON_SHAPE[target]
  const selected = logos.some((l) => l.id === ed.source.id) ? (ed.source.id as string) : ''
  const empty = !ed.source.url
  const sourceName = logos.find((l) => l.id === ed.source.id)?.label ?? 'image'
  const board = (
    <ModalBoard value="transparent" onChange={() => {}} backgrounds={false}>
      <div className={cx('relative grid h-[192px] w-[192px] place-items-center overflow-hidden border border-hairline', shape.board)}>
        <IconCanvas
          image={ed.image}
          framing={ed.framing}
          size={ICON_BOARD_CANVAS}
          label={`${label} preview`}
          className={cx('absolute inset-0 h-full w-full', ed.saving && 'opacity-60')}
        />
        {empty ? (
          <span className="relative rounded-lg bg-paper px-3 py-1.5 text-[14px] text-ink-muted">No logo yet</span>
        ) : ed.loading ? (
          <span
            role="status"
            aria-label={`Loading ${sourceName}`}
            className="relative rounded-lg bg-paper px-3 py-1.5 text-[13px] text-ink-muted motion-safe:animate-pulse"
          >
            Loading…
          </span>
        ) : ed.loadFailed ? (
          <span className="relative rounded-lg bg-paper px-3 py-1.5 text-[13px] text-accent-red">Couldn’t load that image</span>
        ) : null}
      </div>
    </ModalBoard>
  )

  return (
    <BrandModal
      label={label}
      meta="edit"
      onClose={onClose}
      board={board}
      controlsAlign="start"
      beforeSave={
        <button
          type="button"
          disabled={!ed.image}
          onClick={() => ed.change(DEFAULT_FRAMING)}
          className={buttonClass('ghost')}
        >
          Reset
        </button>
      }
    >
      <div className="flex items-center gap-3.5">
        {/* The explicit allowlist, never image/* — SVG is a script vector on a public bucket. */}
        <UploadField
          accept={acceptFor(IMAGE_UPLOAD_RULES)}
          label={`${label} image`}
          kind="image"
          budget={null}
          bucket="media"
          artistId={artistId}
          category={BRAND_FOLDER}
          noun="image"
          rules={IMAGE_UPLOAD_RULES}
          successMessage="Image uploaded"
          writeRow={writeUploadedSource}
          trigger={(open, { busy }) => (
            // Its label opens below (above, the modal body's scroll edge clips it now that the
            // + sits at the column's top); the sliders keep clear of it — see FramingControls.
            <RowIcon icon="plus" label="Upload new" variant="boxed" onClick={open} disabled={busy} />
          )}
        />
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-hairline px-3">
          <SelectMenu
            label="Select a logo"
            value={selected}
            options={logos.map((l) => ({ value: l.id, label: l.label }))}
            required
            placeholder="Select a logo…"
            onChange={(id) => void chooseLogo(id)}
          />
        </div>
      </div>
      <FramingControls framing={ed.framing} onChange={ed.change} disabled={!ed.image} />
    </BrandModal>
  )
}
