import { MEDIA_KINDS, type MediaKind } from '@samfox1/site-bridge/payload'
import { modalCardClass, modalOverlayClass } from '@/components/ui/ui'
import { useMemo, useState } from 'react'
import { PortalModal } from '@/components/ui/portal-modal'
import { applyStyleValue, buildItemStyleControls, fromItemStored, toItemStored, type StyleControl } from '@/lib/site-editor/style-controls'
import { EYEBROW, GroupLabel, SaveLine, type SaveStatus } from './inspector-shared'
import { EditorPanel } from './editor-panel'
import { StyleControlRow } from './panels/style-tools'
import type { SiteStyleOptions } from '@/lib/site-editor/style-controls'
import type { RegionMeasurements } from '@samfox1/site-bridge/protocol'
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

/** Plain words for the fact-sheet kinds. `Record<MediaKind, …>` is the compile guard:
 *  a kind added to the registry with no label here fails tsc. */
const KIND_LABEL: Record<MediaKind, string> = { photo: 'Photo', artwork: 'Artwork', none: 'Not listed' }

/**
 * Alt text + fact-sheet kind live behind ONE thin, underlined, centred "Edit alt tag"
 * link (Sam, 2026-08-26: "this seems like too much… just needs to say edit alt tag on the
 * main panel, not the name"). It opens a small modal; the recommended alt sits in the
 * input as its placeholder.
 */
function AltRow({
  label,
  alt,
  kind,
  slug,
}: {
  label: string
  alt: { value: string; preset: string; onSave: (next: string) => void }
  kind: { value: MediaKind | null; onSave: (next: MediaKind) => void }
  slug?: { value: string; preset: string; onSave: (next: string) => void }
}) {
  const [open, setOpen] = useState(false)
  return (
    // pt-4 above; the Style label brings its own pt-4 below: equal air both sides.
    <div className="flex justify-center px-5 pt-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit alt for ${label}`}
        className="text-[11px] font-normal text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        Edit alt tag
      </button>
      {open && <AltModal label={label} alt={alt} kind={kind} slug={slug} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** The little window "Edit alt" opens (Sam, 2026-08-26: a modal, not more side panel).
 *  Same overlay/card as the other editor dialogs; saves live as the title does. */
function AltModal({
  label,
  alt,
  kind,
  slug,
  onClose,
}: {
  label: string
  alt: { value: string; preset: string; onSave: (next: string) => void }
  kind: { value: MediaKind | null; onSave: (next: MediaKind) => void }
  slug?: { value: string; preset: string; onSave: (next: string) => void }
  onClose: () => void
}) {
  const [text, setText] = useState(alt.value)
  const [name, setName] = useState(slug?.value ?? '')
  // The file name is a storage copy, so it saves on Done — not per keystroke.
  const done = () => {
    const next = name.trim() || slug?.preset || ''
    if (slug && next && next !== slug.value) slug.onSave(next)
    onClose()
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Alt text for ${label}`}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`${modalCardClass} w-[420px] gap-3`}>
        <div className="flex items-start justify-between gap-4">
          <div className={EYEBROW}>Alt text</div>
          <button type="button" onClick={onClose} aria-label="Close" className={`${EYEBROW} text-ink-faint hover:text-ink`}>
            Close
          </button>
        </div>
        <input
          autoFocus
          value={text}
          placeholder={alt.preset}
          aria-label={`Alt text for ${label}`}
          onChange={(e) => {
            setText(e.target.value)
            alt.onSave(e.target.value)
          }}
          className="w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className={`${EYEBROW} mt-1`}>Type</div>
        <select
          value={kind.value ?? 'photo'}
          aria-label={`Type for ${label}`}
          onChange={(e) => kind.onSave(e.target.value as MediaKind)}
          className="w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {MEDIA_KINDS.map((o) => (
            <option key={o} value={o}>
              {KIND_LABEL[o]}
            </option>
          ))}
        </select>
        {slug && (
          <>
            <div className={`${EYEBROW} mt-1`}>File name</div>
            <input
              value={name}
              placeholder={slug.preset}
              aria-label={`File name for ${label}`}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-hairline bg-paper px-3 py-2 font-space text-sm outline-none focus:border-accent"
            />
          </>
        )}
        <button type="button" onClick={done} className="mt-1 self-end rounded-lg border border-hairline px-4 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] hover:bg-paper">
          Done
        </button>
      </div>
    </div>
  )
}

/**
 * The item's name, saved as it is typed (debounced) rather than staged with the styles.
 * On a site that locks its look this is the ONLY thing about a piece the manager owns:
 * the art is the artist's, the caption is theirs (Sam, 2026-08-21).
 */
function ItemTitleField({ label, title }: { label: string; title: { value: string; onSave: (next: string) => void } }) {
  return <ItemTextField heading="Title" label={label} field={title} />
}

/** One typed-and-saved text row (title, alt text): the same live-save shape for both. */
function ItemTextField({
  heading,
  label,
  field: title,
}: {
  heading: string
  label: string
  field: { value: string; onSave: (next: string) => void }
}) {
  const [text, setText] = useState(title.value)
  // Re-seed when the panel is handed a DIFFERENT item (the editor is one component
  // reused across items), without clobbering what is being typed into this one.
  const [seeded, setSeeded] = useState(title.value)
  if (seeded !== title.value) {
    setSeeded(title.value)
    setText(title.value)
  }
  return (
    <>
      <GroupLabel>{heading}</GroupLabel>
      <div className="px-5 pb-3">
        <input
          value={text}
          aria-label={`${heading} for ${label}`}
          onChange={(e) => {
            setText(e.target.value)
            title.onSave(e.target.value)
          }}
          className="w-full rounded-lg border border-hairline bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
    </>
  )
}

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
  palette,
  onRemove,
  title,
  alt,
  kind,
  slug,
  onApplyStyle,
  onBack,
  measured,
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
  /** The site's declared palette, so an unset colour shows what the item inherits
   *  rather than a "no colour" mark (Sam, 2026-08-15). */
  palette?: SiteStyleOptions
  onRemove: () => void
  /** The item's editable TITLE — what the site shows under it. Present only where the
   *  site reads one (a gallery photo's `media.label`). Saved on its own, LIVE: it is a
   *  name, not a staged style change, and pairing it with Save/Revert would mean a
   *  manager typing a caption is asked what to do about sliders they never touched. */
  title?: { value: string; onSave: (next: string) => void }
  /** Alt text + JSON-LD kind (SEO_GEO_PLAN B6b). Saved live, like the title. */
  alt?: { value: string; preset: string; onSave: (next: string) => void }
  kind?: { value: MediaKind | null; onSave: (next: MediaKind) => void }
  slug?: { value: string; preset: string; onSave: (next: string) => void }
  onApplyStyle?: (key: string, className: string) => void
  onBack: () => void
  /** What this item's element actually renders (bridge 0.25.2, measure-on-open) —
   *  sliders with nothing stored park on it instead of mid-scale. */
  measured?: RegionMeasurements
}) {
  // The editor WORKS in plain changed tokens; a stored 0.25.4 delta row wears the
  // sentinel only in storage (fromItemStored strips it, toItemStored puts it back).
  // Items joined the delta model deliberately (Sam, 2026-08-18): a raw string freezes
  // whatever the site's card looked like on the day of the edit, and connected sites
  // redeploy on their own schedules.
  const [classes, setClasses] = useState(() => fromItemStored(initialClasses))
  /** What is actually persisted — Revert's target, and what `dirty` compares against.
   *  Starts at the stored value and moves only when Save succeeds. */
  const [savedClasses, setSavedClasses] = useState(() => fromItemStored(initialClasses))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [picking, setPicking] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  // Built with the palette (the shell's EditorStyleOptions): in phone view the scale
  // control twins to `scalesm-[…]` and tags itself (Mobile).
  const defaultControls = useMemo(() => buildItemStyleControls(palette), [palette])
  const controls = controlsProp ?? defaultControls
  const dirty = classes !== savedClasses

  /** Stage a change: paint the frame, persist nothing. */
  function change(next: string) {
    setClasses(next)
    onApplyStyle?.(styleKey, next)
  }

  async function save(): Promise<boolean> {
    setStatus('saving')
    const res = await saveEditorStyleAction(artistId, styleKey, toItemStored(palette, classes))
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

        {title && <ItemTitleField label={label} title={title} />}
        {alt && kind && <AltRow label={label} alt={alt} kind={kind} slug={slug} />}

        {controls.length > 0 && <GroupLabel>Style</GroupLabel>}
        <div className="px-5 pb-3">
          {/* Every control — border colour included — goes through StyleControlRow now
              (2026-08-12 consolidation): borderColor gained its own hexOf/toToken, so it
              renders a ColorPalette through the generic colour branch like every other
              picker, instead of a hand-wired special case here. */}
          {controls.map((control) => (
            <StyleControlRow
              key={control.id}
              regionLabel={label}
              control={control}
              cls={classes}
              swatches={swatches}
              palette={palette}
              measured={measured}
              onChange={(v) => change(applyStyleValue(classes, control, v))}
            />
          ))}
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
