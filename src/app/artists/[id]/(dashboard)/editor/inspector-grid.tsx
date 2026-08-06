import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { mediaThumbUrl, mediaUrl } from '@/lib/site'
import { Icon } from '@/components/ui/icons'
import { modalOverlayClass, modalCardClass } from '@/components/ui/ui'
import { useLockBodyScroll } from '../use-lock-body-scroll'
import { EYEBROW } from './inspector-shared'

/**
 * The inspector's ON-SITE PLACEMENT family — the pieces every collection panel (Images,
 * Videos, Music, component slots) uses to show what's on the site and swap what's on it.
 * Pulled out of editor-inspector.tsx so a panel imports the grid it needs instead of the
 * whole file, and so the placement UX (Add tile → picker modal → Replace/Remove menu)
 * lives in ONE place across every collection type.
 *
 * The vocabulary:
 *  • thumbnails (PhotoThumb / CardThumb / SongThumb) — one item's face at its aspect;
 *  • EmptySlot — the dashed Add/pick tile that opens a picker;
 *  • EditMenu — the Replace/Remove menu a filled slot opens;
 *  • AddFirstLink — the "add your first item" link when the library is empty;
 *  • LibraryPicker<T> — the modal grid of candidates to place;
 *  • MediaGrid<T> — an open collection as on-site cards + an Add tile, wired to the
 *    picker and the edit menu, funnelling every change through one `onSetOnSite`.
 *
 * Purely presentational + local UI state. No data, no server actions, no panel logic.
 */

/** The last path segment — how the editor names a stored object to the manager. */
export function fileNameOf(storagePath: string): string {
  return storagePath.split('/').pop() ?? ''
}

/** A gallery thumbnail at its orientation's aspect (3:2 horizontal, 2:3 vertical).
 *  `fit` defaults to `contain` — the WHOLE photo shows, letterboxed on the neutral
 *  ground, so the manager sees the entire image rather than a cropped centre.
 *  Addressed by storage `path` (downscaled thumb + full-object fallback) or, for a
 *  value that is already a full URL (an image field), by `url` as-is. */
export function PhotoThumb({
  path,
  url,
  aspect,
  fit = 'contain',
}: {
  path?: string
  url?: string
  aspect: string
  fit?: 'cover' | 'contain'
}) {
  return (
    <div className={cx('w-full overflow-hidden bg-track', aspect)}>
      {/* Load a downscaled/compressed thumbnail; fall back to the full object ONCE if
          the transform can't handle this image (guarding the src check against a loop). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url ?? (path ? mediaThumbUrl(path) : '')}
        alt=""
        className={cx('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
        onError={(e) => {
          if (!path) return
          const img = e.currentTarget
          const full = mediaUrl(path)
          if (img.src !== full) img.src = full
        }}
      />
    </div>
  )
}

/** A 16:9 video thumbnail — the muted clip if we have a preview URL, else the poster. */
export function CardThumb({ poster, previewUrl }: { poster: string | null; previewUrl?: string | null }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-track text-ink-faint">
      {previewUrl ? (
        <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="videos" size={20} />
      )}
    </div>
  )
}

/** A square cover thumbnail for a song/project card. */
export function SongThumb({ coverUrl }: { coverUrl: string | null }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-track text-ink-faint">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="tracks" size={22} />
      )}
    </div>
  )
}

/** The dashed "add / pick" tile that opens a picker. `aspect` matches the cards it
 *  sits beside (16:9 videos, 4:3 photos, square songs). */
export function EmptySlot({
  label,
  onClick,
  aspect = 'aspect-video',
  ariaLabel,
  title,
  stretch = false,
}: {
  label: string
  onClick: () => void
  aspect?: string
  /** Grow to the grid row's height (the gallery grid, where a placed card is taller than
   *  its thumbnail). OFF by default: where a cell also holds a caption or hint below the
   *  slot, stretching fights that text for the row and it overflows into the next card. */
  stretch?: boolean
  /** Accessible name, when the visible label repeats across cards. Two polaroids both
   *  showing "Add photo" would be ambiguous to a screen reader and to getByRole. */
  ariaLabel?: string
  /** Hover text — the site's description of the slot, kept off the card face. */
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={title}
      className={cx(
        'flex w-full flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-hairline px-2 text-center text-ink-muted hover:border-accent hover:text-accent',
        stretch && 'h-full',
        aspect,
      )}
    >
      <Icon name="plus" size={18} />
      <span className="font-space text-[10px] font-bold uppercase leading-tight tracking-[0.08em]">{label}</span>
    </button>
  )
}

/** The little Replace / Remove menu a filled slot's edit button opens. Replace opens
 *  the picker; Remove empties the slot. */
export function EditMenu({ onReplace, onRemove }: { onReplace: () => void; onRemove: () => void }) {
  return (
    <div data-edit-menu className="flex w-full gap-1">
      <button
        type="button"
        onClick={onReplace}
        className="flex-1 rounded-md border border-hairline px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:border-accent hover:text-accent"
      >
        Replace
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="flex-1 rounded-md border border-hairline px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.06em] text-accent-red hover:bg-danger-soft"
      >
        Remove
      </button>
    </div>
  )
}

/** A Replace / Remove menu that COVERS the thumbnail — two stacked, full-height rows,
 *  opened by a tile's edit button. For tiles that are just an image with no caption row to
 *  hold a side-by-side EditMenu (the image slots, gallery cards, image fields). Sits over a
 *  `relative` thumbnail wrapper; tag `data-edit-menu` so an outside-click can dismiss it.
 *  `replaceAria` / `removeAria` name the buttons where several tiles share the panel. */
export function CoverEditMenu({
  onReplace,
  onRemove,
  replaceAria,
  removeAria,
}: {
  onReplace: () => void
  onRemove: () => void
  replaceAria?: string
  removeAria?: string
}) {
  return (
    <div data-edit-menu className="absolute inset-0 z-10 flex flex-col overflow-hidden">
      <button
        type="button"
        aria-label={replaceAria}
        onClick={onReplace}
        className="flex flex-1 items-center justify-center gap-1.5 bg-black/70 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-black/80"
      >
        <Icon name="edit" size={12} /> Replace
      </button>
      <span className="h-px bg-white/20" />
      <button
        type="button"
        aria-label={removeAria}
        onClick={onRemove}
        className="flex flex-1 items-center justify-center gap-1.5 bg-black/70 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-red-300 transition-colors hover:bg-black/80 hover:text-red-200"
      >
        <Icon name="trash" size={12} /> Remove
      </button>
    </div>
  )
}

/** The hover "Edit" corner button a selectable tile floats over its thumbnail — opens
 *  the tile's edit affordance (a CoverEditMenu, or the full-panel item editor). One
 *  component so the treatment can't drift per panel. Appears on `group/slot` hover,
 *  which `SelectableTile` provides. */
export function TileEditButton({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className="absolute right-1.5 top-1.5 rounded-lg bg-black/60 p-2 text-white/90 opacity-0 transition-opacity hover:bg-black/75 hover:text-white group-hover/slot:opacity-100"
    >
      <Icon name="edit" size={16} />
    </button>
  )
}

/**
 * The selectable image tile every collection shares: a bordered wrapper that rings when
 * focused, a full-bleed Select button over the content, and whatever floats above it as
 * `children` (a TileEditButton, a CoverEditMenu, a busy overlay). This was hand-rolled
 * per panel — identical ring, aria and hover treatment three times — before it lived here.
 */
/**
 * Scroll the element into view when `focused` flips true.
 *
 * A frame click routes to the right panel and rings the right tile — but the polaroid
 * tiles live at the bottom of a long scrolling panel, and a ring below the fold is
 * indistinguishable from a dropped select (Sam, 2026-08-06: "the images on the polaroid,
 * when clicked, dont bring it up in the side panel" — they did; nobody could see it).
 * Fires only on the false→true EDGE: re-scrolling on every render would fight the
 * manager's own scrolling while they work near a selected tile.
 */
export function useScrollIntoFocus<T extends HTMLElement>(focused: boolean): React.RefObject<T | null> {
  const ref = useRef<T | null>(null)
  const was = useRef(false)
  useEffect(() => {
    // Optional-called: jsdom ships no scrollIntoView, and a missing nicety must never
    // crash the panel that just routed correctly.
    if (focused && !was.current) ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    was.current = focused
  }, [focused])
  return ref
}

export function SelectableTile({
  label,
  focused,
  onSelect,
  title,
  rounded = 'rounded-md',
  thumb,
  children,
}: {
  /** Names the tile: the Select button is `Select ${label}`. */
  label: string
  focused: boolean
  onSelect: () => void
  /** Hover text on the wrapper (e.g. the stored file's name). */
  title?: string
  rounded?: string
  /** The tile's face — a thumbnail, optionally with a caption row. */
  thumb: React.ReactNode
  children?: React.ReactNode
}) {
  // A tile focused from the FRAME may sit below the fold — bring it to the manager.
  const scrollRef = useScrollIntoFocus<HTMLDivElement>(focused)
  return (
    <div
      ref={scrollRef}
      title={title}
      className={cx(
        'group/slot relative overflow-hidden border transition-shadow',
        rounded,
        focused ? 'border-accent ring-2 ring-accent' : 'border-hairline',
      )}
    >
      <button type="button" onClick={onSelect} aria-label={`Select ${label}`} aria-pressed={focused} className="block w-full text-left">
        {thumb}
      </button>
      {children}
    </div>
  )
}

/** Close an open edit menu when the pointer goes down outside any `data-edit-menu`
 *  element (CoverEditMenu / EditMenu tag themselves — the attribute contract lives in
 *  this file, so its dismiss does too). The edit button that OPENS a menu fires on
 *  click, after this mousedown, so it never self-closes. */
export function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-edit-menu]')) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])
}

/** The dashed "add your first item" link shown in a picker with no candidates left —
 *  points at the collection's own page (Videos / Music) to add one. */
export function AddFirstLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-6 text-ink-muted hover:border-accent hover:text-accent"
    >
      <Icon name="plus" size={16} />
      <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">{label}</span>
    </Link>
  )
}

/** Library picker as a MODAL — a large grid of candidate items to place on the site.
 *  Opening it (an empty slot / Add tile, or a filled item's Replace) covers the site
 *  with an overlay so the choices get real room, rather than cramming a list into the
 *  left panel. Generic over the item type: videos, photos, and songs all reuse it via
 *  the `renderThumb` / `labelOf` callbacks. `empty` renders when there are no
 *  candidates (an "add first" link); `footer` sits under the grid (an uploader). */
export function LibraryPicker<T>({
  title,
  candidates,
  keyOf,
  labelOf,
  renderThumb,
  empty,
  footer,
  onPick,
  onCancel,
}: {
  /** What the manager is filling, e.g. "Landscape · desktop" — shown as the heading. */
  title: string
  candidates: T[]
  keyOf: (v: T) => string
  labelOf: (v: T, i: number) => string
  renderThumb: (v: T) => React.ReactNode
  empty: React.ReactNode
  footer?: React.ReactNode
  onPick: (v: T) => void
  onCancel: () => void
}) {
  useLockBodyScroll(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pick from your library: ${title}`}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className={cx(modalCardClass, 'no-scrollbar w-[720px] gap-4')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={EYEBROW}>Pick from your library</div>
            <h2 className="mt-1 text-lg font-bold leading-tight tracking-[-0.01em]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex-none rounded-md px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint hover:text-ink"
          >
            Close
          </button>
        </div>
        {candidates.length === 0 ? (
          empty
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {candidates.map((v, i) => (
              <button
                key={keyOf(v)}
                type="button"
                onClick={() => onPick(v)}
                className="group overflow-hidden rounded-lg border border-hairline text-left transition-colors hover:border-accent"
              >
                {renderThumb(v)}
                <span className="block truncate px-2 py-1.5 text-xs group-hover:text-accent">{labelOf(v, i)}</span>
              </button>
            ))}
          </div>
        )}
        {footer}
      </div>
    </div>
  )
}

/* ── MediaGrid: an open-ended collection as on-site cards + an Add tile ───────────
 *
 * Images and Music aren't fixed slots like the video hero/band — they're open
 * collections. This shows what's ON the site as a 2-up card grid (each card carries
 * the same edit → Replace/Remove menu as the video slots), plus a trailing Add tile
 * that opens the LibraryPicker over the rest of the library. Remove takes an item OFF
 * the site (never deletes); Replace swaps it for another, and — like the video band —
 * the old item only leaves once a replacement is actually chosen (closing the picker
 * keeps it). `onSetOnSite(item, next)` is the single write both paths funnel through. */
export function MediaGrid<T>({
  onSiteItems,
  library,
  noun,
  keyOf,
  labelOf,
  renderThumb,
  aspect,
  cols = 'grid-cols-2',
  pickTitle,
  addLabel,
  empty,
  pickerFooter,
  onSetOnSite,
  select,
}: {
  onSiteItems: T[]
  /** Off-site items — the picker's candidates. */
  library: T[]
  /** Singular noun for aria labels, e.g. "photo" → "Edit photo 1". */
  noun: string
  keyOf: (v: T) => string
  labelOf: (v: T, i: number) => string
  renderThumb: (v: T) => React.ReactNode
  /** Aspect of the Add tile — matches the cards' thumbnails. */
  aspect: string
  /** Column count for the on-site card grid (Tailwind class). Photos are 3-up; the
   *  default 2-up suits the wider video/song cards. */
  cols?: string
  pickTitle: string
  addLabel: string
  /** Shown in the picker when the library is empty. */
  empty: React.ReactNode
  pickerFooter?: React.ReactNode
  onSetOnSite: (v: T, next: boolean) => void
  /** Two-way selection + per-card editing (the Images panel): clicking a card SELECTS it
   *  (highlights the matching region in the live frame), `isFocused` draws its ring, and
   *  the hover Edit button opens the full-panel editor. Optional as ONE unit — Music and
   *  other callers omit it and their cards are plain. */
  select?: {
    onSelect: (v: T) => void
    isFocused: (v: T) => boolean
    onEdit: (v: T, i: number) => void
  }
}) {
  const [picking, setPicking] = useState(false)

  return (
    <div className="space-y-3 px-5 py-4">
      <div className={cx('grid gap-2', cols)}>
        {onSiteItems.map((item, i) => {
          const k = keyOf(item)
          const caption = (
            <div className="px-2 py-1.5">
              <span className="block truncate text-xs">{labelOf(item, i)}</span>
            </div>
          )
          // A selectable card is the shared tile (ring + Select + hover Edit); a plain
          // card (Music) is just its thumbnail and caption.
          return select ? (
            <SelectableTile
              key={k}
              label={`${noun} ${i + 1}`}
              focused={select.isFocused(item)}
              onSelect={() => select.onSelect(item)}
              rounded="rounded-lg"
              thumb={
                <>
                  {renderThumb(item)}
                  {caption}
                </>
              }
            >
              <TileEditButton label={`Edit ${noun} ${i + 1}`} title="Customize this image" onClick={() => select.onEdit(item, i)} />
            </SelectableTile>
          ) : (
            <div key={k} className="overflow-hidden rounded-lg border border-hairline">
              {renderThumb(item)}
              {caption}
            </div>
          )
        })}
        <EmptySlot label={addLabel} aspect={aspect} stretch onClick={() => setPicking(true)} />
      </div>

      {picking && (
        <LibraryPicker
          title={pickTitle}
          candidates={library}
          keyOf={keyOf}
          labelOf={labelOf}
          renderThumb={renderThumb}
          empty={empty}
          footer={pickerFooter}
          onPick={(v) => {
            setPicking(false)
            onSetOnSite(v, true)
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  )
}
