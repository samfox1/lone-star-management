import { useMemo, useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { applyStyleValue, buildItemStyleControls } from '@/lib/site-editor/style-controls'
import { colorClass, resolveStyle } from '@/lib/site-editor/style-apply'
import { GroupLabel, SaveLine, SCROLL_BODY } from './inspector-shared'
import { StyleControlRow } from './panels/style-tools'
import { ColorPalette } from './color-picker'
import { LibraryPicker } from './inspector-grid'
import { useStyleRegionSave } from './use-style-save'

/**
 * The per-ITEM editor (SITE_EDITOR_PLAN.md — image/video customization). Clicking Edit on an
 * image or video hands the WHOLE left panel to that one item: a live preview, Replace /
 * Remove, the visual controls (size, transparency, border + colour, corners, shadow), and a
 * Revert to the state the editor opened in.
 *
 * The visual style is a per-item class string stored + applied through the SAME style system
 * as the section regions (site_styles.class_names keyed by the item's `styleKey`, optimistic
 * `apply-style` to the frame, debounced save). ADDITIVE, not replace: these classes augment
 * the item's own layout on the site, so the saved string is just the manager's overlay. The
 * preview here applies them directly, so the effect is visible before the site renders it.
 */

/** One candidate in the Replace picker — an id plus how to show it. */
export type PickCandidate = { id: string; label: string; thumb: React.ReactNode }

/** How this item is replaced: pick another from the library, with an optional uploader
 *  in the picker's footer for adding a fresh file. */
export type ItemReplace = {
  title: string
  candidates: PickCandidate[]
  onPick: (id: string) => void
  uploader?: React.ReactNode
}

export function ItemEditor({
  artistId,
  styleKey,
  label,
  initialClasses,
  preview,
  replace,
  swatches = [],
  onRemove,
  onApplyStyle,
  onBack,
}: {
  artistId: string
  /** Per-item style-region key (`slot:<role>`, `image:<id>`, …). The frame styles the element
   *  marked `data-lse-style="<styleKey>"`; until the site tags it, the save persists and the
   *  panel preview shows the effect. */
  styleKey: string
  label: string
  /** The item's current overlay class string (from the draft styles), '' if unstyled. Revert
   *  returns here. */
  initialClasses: string
  /** The item's thumbnail; the editor applies the live style around it. */
  preview: React.ReactNode
  replace: ItemReplace
  /** The palette's quick-pick row: the site's declared colours + ones already used
   *  (`siteSwatches`). */
  swatches?: string[]
  onRemove: () => void
  onApplyStyle?: (key: string, className: string) => void
  onBack: () => void
}) {
  const [classes, setClasses] = useState(initialClasses)
  const [picking, setPicking] = useState(false)
  const controls = useMemo(() => buildItemStyleControls(), [])
  // Optimistic paint on the site is a no-op until the frame tags the item's region.
  const { status, save } = useStyleRegionSave(artistId, onApplyStyle)

  function change(next: string) {
    setClasses(next)
    save(styleKey, next)
  }

  // The preview resolves the class string exactly as the frame and the site do, so what the
  // manager sees here is what the page will render — including the colours that have to be
  // inline because no build can compile an arbitrary hex. The border hex is read back out
  // of the same resolution, so the picker and the preview can't disagree.
  const shown = resolveStyle(classes)
  const borderHex = shown.style.borderColor ?? ''
  const dirty = classes !== initialClasses

  return (
    <>
      {/* Header: back, the live thumbnail, then this item's name ("Edit Slot 3"). The
          preview lives HERE, outside the scrolling body, because the styling controls are
          what you scroll to — and judging a border or a corner radius against an image you
          have to scroll back up to see is guesswork. It carries the same resolved style as
          the frame, so it changes under the sliders as you drag them. */}
      <div className="flex items-center gap-2.5 border-b border-hairline px-4 pb-2.5 pt-[15px]">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex-none rounded-md p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className="grid h-14 w-14 flex-none place-items-center overflow-hidden rounded-lg bg-surface p-1.5">
          <span className={cx('block w-full overflow-hidden', shown.className)} style={shown.style}>
            {preview}
          </span>
        </span>
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">Edit {label}</h2>
      </div>

      <div className={SCROLL_BODY}>
        <div className="px-5 pt-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex-1 rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted transition-colors hover:border-accent hover:text-accent"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="flex-1 rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-accent-red transition-colors hover:bg-danger-soft"
            >
              Remove
            </button>
          </div>
        </div>

        <GroupLabel>Style</GroupLabel>
        <div className="px-5 pb-3">
          {controls.map((control) =>
            control.kind === 'color' ? (
              <ColorPalette
                key={control.id}
                label={control.label}
                aria={`${label} ${control.label}`}
                value={borderHex}
                used={swatches}
                onChange={(hex) => change(applyStyleValue(classes, control, hex ? colorClass('border', hex) : ''))}
              />
            ) : (
              <StyleControlRow
                key={control.id}
                regionLabel={label}
                control={control}
                cls={classes}
                onChange={(v) => change(applyStyleValue(classes, control, v))}
              />
            ),
          )}
        </div>

        {/* Revert everything back to the state the editor opened in. */}
        <div className="px-5 pt-1">
          <button
            type="button"
            onClick={() => change(initialClasses)}
            disabled={!dirty}
            className="w-full rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted transition-colors enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-40"
          >
            Revert changes
          </button>
        </div>

        <SaveLine status={status} />
      </div>

      {picking && (
        <LibraryPicker<PickCandidate>
          title={replace.title}
          candidates={replace.candidates}
          keyOf={(c) => c.id}
          labelOf={(c) => c.label}
          renderThumb={(c) => c.thumb}
          empty={<p className="py-2 text-center text-xs text-ink-muted">Nothing else in your library. Upload one below.</p>}
          footer={replace.uploader}
          onPick={(c) => {
            setPicking(false)
            replace.onPick(c.id)
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </>
  )
}

