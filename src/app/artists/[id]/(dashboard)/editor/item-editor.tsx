import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui/icons'
import { PortalModal } from '@/components/ui/portal-modal'
import { applyStyleValue, buildItemStyleControls, type StyleControl } from '@/lib/site-editor/style-controls'
import { colorClass, resolveStyle } from '@/lib/site-editor/style-apply'
import { EYEBROW, GroupLabel, SaveLine, type SaveStatus } from './inspector-shared'
import { EditorPanel } from './editor-panel'
import { StyleControlRow } from './panels/style-tools'
import { ColorPalette } from './color-picker'
import { LibraryPicker } from './inspector-grid'
import { saveEditorStyleAction } from '../actions'

/**
 * The per-ITEM editor (SITE_EDITOR_PLAN.md — image/video customization). Clicking Edit on an
 * image or video hands the WHOLE left panel to that one item: a live preview in the site
 * frame, Replace / Remove, and the visual controls (size, transparency, border + colour,
 * corners, shadow — or the video sets).
 *
 * STAGED, not autosaved (Sam, 2026-08-03): dragging a slider paints the frame immediately
 * (`apply-style` over the bridge) but persists NOTHING. The explicit pair at the bottom is
 * the exit contract — Revert restores the last-saved state, Save writes it — and backing
 * out with unsaved changes asks Save/Discard rather than deciding for the manager. The
 * stored value is still one overlay class string per item key (`site_styles`), ADDITIVE
 * over the element's own classes.
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
  /** Shown when there are no candidates. Defaults to an upload hint — pass something
   *  else where the library is filled elsewhere (videos point at the Videos page). */
  empty?: React.ReactNode
}

const FOOT_BUTTON =
  'flex-1 rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] transition-colors disabled:opacity-40'

export function ItemEditor({
  artistId,
  styleKey,
  label,
  initialClasses,
  preview,
  replace,
  controls: controlsProp,
  swatches = [],
  onRemove,
  onApplyStyle,
  onBack,
}: {
  artistId: string
  /** Per-item style-region key. The rule, not a list: `<kind>:<id>` — either
   *  `slot:<role>` for a named placement, or `<assetType>:<id>` for one library asset
   *  (`image:`, `video:`, `track:`, `merch:`, `tour_date:`, `link:` — the set is
   *  `ASSET_TYPES` in `lib/site-editor/markers.ts`, and skeen emits `video:` today).
   *  Earlier docs here enumerated two of them, which read as the whole vocabulary.
   *  The frame styles the element marked `data-lse-style="<styleKey>"`. */
  styleKey: string
  label: string
  /** The item's SAVED overlay class string (from the draft styles), '' if unstyled. */
  initialClasses: string
  /** The item's identifying thumbnail — static; the site frame is the live preview. */
  preview: React.ReactNode
  replace: ItemReplace
  /** The visual controls for this item kind. Defaults to the image set; videos pass
   *  `buildVideoItemStyleControls` (no borders; Speed where playback is controllable). */
  controls?: StyleControl[]
  /** The palette's quick-pick row: the site's declared colours + ones already used
   *  (`siteSwatches`). */
  swatches?: string[]
  onRemove: () => void
  onApplyStyle?: (key: string, className: string) => void
  onBack: () => void
}) {
  const [classes, setClasses] = useState(initialClasses)
  /** What is actually persisted — Revert's target, and what `dirty` compares against.
   *  Starts at the stored value and moves only when Save succeeds. */
  const [savedClasses, setSavedClasses] = useState(initialClasses)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [picking, setPicking] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const defaultControls = useMemo(() => buildItemStyleControls(), [])
  const controls = controlsProp ?? defaultControls
  const dirty = classes !== savedClasses

  /** Stage a change: paint the frame, persist nothing. */
  function change(next: string) {
    setClasses(next)
    onApplyStyle?.(styleKey, next)
  }

  async function save(): Promise<boolean> {
    setStatus('saving')
    const res = await saveEditorStyleAction(artistId, styleKey, classes)
    if (!res.ok) {
      setStatus('error')
      return false
    }
    setSavedClasses(classes)
    setStatus('saved')
    return true
  }

  /** Back to the last-saved state — on the sliders AND on the site frame. */
  function revert() {
    change(savedClasses)
  }

  function requestBack() {
    if (dirty) setConfirmExit(true)
    else onBack()
  }

  // The border hex is read back out of the same resolution the site uses, so the picker
  // always reflects what is actually staged.
  const borderHex = resolveStyle(classes).style.borderColor ?? ''

  return (
    <>
      <EditorPanel label={label} thumb={preview} onBack={requestBack}>
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

        {/* The exit contract: Revert restores the last-saved state, Save commits what's
            staged. Both idle until something is actually different. */}
        <div className="flex gap-2 px-5 pt-1">
          <button
            type="button"
            onClick={revert}
            disabled={!dirty}
            className={`${FOOT_BUTTON} text-ink-muted enabled:hover:border-accent enabled:hover:text-accent`}
          >
            Revert changes
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || status === 'saving'}
            className={`${FOOT_BUTTON} border-ink bg-ink text-white enabled:hover:bg-black`}
          >
            Save
          </button>
        </div>

        <SaveLine status={status} />
      </EditorPanel>

      {picking && (
        <LibraryPicker<PickCandidate>
          title={replace.title}
          candidates={replace.candidates}
          keyOf={(c) => c.id}
          labelOf={(c) => c.label}
          renderThumb={(c) => c.thumb}
          empty={
            replace.empty ?? (
              <p className="py-2 text-center text-xs text-ink-muted">Nothing else in your library. Upload one below.</p>
            )
          }
          footer={replace.uploader}
          onPick={(c) => {
            setPicking(false)
            replace.onPick(c.id)
          }}
          onCancel={() => setPicking(false)}
        />
      )}

      {/* Leaving with staged changes: ask, don't decide. Escape / backdrop just closes
          the question and stays in the editor. */}
      {confirmExit && (
        <PortalModal ariaLabel={`Save changes to ${label}?`} onClose={() => setConfirmExit(false)}>
          <div className={`${EYEBROW} mb-2 pr-6`}>Unsaved changes</div>
          <p className="mb-3 text-[13px] leading-relaxed text-ink">
            You changed {label}&apos;s style. Save it, or discard and leave it as it was?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                revert()
                setConfirmExit(false)
                onBack()
              }}
              className={`${FOOT_BUTTON} text-ink-muted hover:border-accent-red hover:text-accent-red`}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => {
                void save().then((ok) => {
                  setConfirmExit(false)
                  if (ok) onBack()
                })
              }}
              disabled={status === 'saving'}
              className={`${FOOT_BUTTON} border-ink bg-ink text-white enabled:hover:bg-black`}
            >
              Save &amp; close
            </button>
          </div>
        </PortalModal>
      )}
    </>
  )
}
