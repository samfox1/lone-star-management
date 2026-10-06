import { MEDIA_KINDS, type MediaKind } from '@samfox1/site-bridge/payload'
import { buttonClass } from '@/components/ui/ui'
import { PortalModal } from '@/components/ui/portal-modal'
import { useMemo, useState } from 'react'
import { applyStyleValue, buildItemStyleControls, fromItemStored, toItemStored, type StyleControl } from '@/lib/site-editor/style-controls'
import { PanelRow, FIELD, GroupLabel, SaveLine } from './inspector-shared'
import { EditorPanel } from './editor-panel'
import { StyleControlRow } from './panels/style-tools'
import type { SiteStyleOptions } from '@/lib/site-editor/style-controls'
import type { RegionMeasurements } from '@samfox1/site-bridge/protocol'
import { LibraryPicker } from './inspector-grid'
import { useStyleRegionSave } from './use-style-save'
import { RowIcon } from '../(manager-tools)/_ui/row-icon'
import { KvRow } from '../modal-kit'

/**
 * The per-ITEM editor (SITE_EDITOR_PLAN.md — image/video customization). Clicking Edit on an
 * image or video hands the WHOLE left panel to that one item: a live preview in the site
 * frame, Replace / Remove, and the visual controls (size, transparency, border + colour,
 * corners, shadow — or the video sets).
 *
 * AUTOSAVED to the draft, like every other panel (Sam removed the middle layer on
 * 2026-08-14; this editor kept it until 2026-09-28). Dragging a slider paints the frame at
 * once (`apply-style` over the bridge) and writes the DRAFT after the shared 500ms
 * debounce (`useStyleRegionSave`). Leaving by any route (Back, Remove, a click on the
 * preview, another editor opening, the tab going to the background) writes a change still
 * waiting, so nothing is dropped. Publish is the only public step. The staged version had
 * a Save / Revert pair and a Save-or-Discard question on Back, but a preview click closed
 * it without asking, and the style the frame was still showing was thrown away.
 *
 * The stored value is one overlay class string per item key (`site_styles`), ADDITIVE over
 * the element's own classes.
 */

/** Plain words for the fact-sheet kinds. `Record<MediaKind, …>` is the compile guard:
 *  a kind added to the registry with no label here fails tsc. */
const KIND_LABEL: Record<MediaKind, string> = { photo: 'Photo', artwork: 'Artwork', none: 'Not listed' }

/**
 * Alt text + fact-sheet kind: ONE row on the panel, the description itself (Sam, 2026-10-05:
 * click-to-edit, no "Edit alt tag" words). It is a PanelRow: "ALT TEXT" over the words,
 * a pencil that shows on hover, and a click anywhere on the row opens the small modal. Never the
 * recommendation (Sam, 2026-08-26: "not the name"): that is the modal input's placeholder.
 *
 * The modal is a SIBLING of the row, not inside it: it is portaled, and a click in it would
 * bubble through React to the row and open it again as it closes.
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
    <>
      {/* pt-2 above; the Style label brings its own pt-4 below. px-1 + the row's px-4 puts its
          words on the panel's 20px line, under the ↻ and over STYLE. */}
      <div className="px-1 pt-2">
        <PanelRow label="Alt text" value={alt.value || 'Not set'} empty={!alt.value} editLabel={`alt for ${label}`} onEdit={() => setOpen(true)} />
      </div>
      {open && <AltModal label={label} alt={alt} kind={kind} slug={slug} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The modal's card: narrower than the dashboard's 640px, three short rows need no more. */
const ALT_CARD = 'relative flex max-h-[88vh] w-[520px] max-w-[90vw] flex-col overflow-auto rounded-2xl bg-paper p-7 shadow-2xl'

/** A value typed straight into a modal row: no box, no line of its own (the row's hairline is
 *  the line), as tour-add's rows are. */
const ROW_INPUT = 'min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint'

/** The little window the alt row opens (Sam, 2026-08-26: a modal, not more side panel).
 *  The modal kit's rows (LABEL  value), a bare × and no header (Sam, 2026-10-05: no "Close"
 *  word; the row that opened it already said what it is). Alt text and type save as they
 *  change, as the title does. */
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
  // The file name is a storage copy, so it saves on Save — not per keystroke, and not on ×.
  const done = () => {
    const next = name.trim() || slug?.preset || ''
    if (slug && next && next !== slug.value) slug.onSave(next)
    onClose()
  }
  return (
    <PortalModal ariaLabel={`Alt text for ${label}`} onClose={onClose} cardClass={ALT_CARD}>
      {/* mt-6 keeps the first row clear of the × in the corner. */}
      <div className="mt-6">
        <KvRow label="Alt text">
          <input
            autoFocus
            value={text}
            placeholder={alt.preset}
            aria-label={`Alt text for ${label}`}
            onChange={(e) => {
              setText(e.target.value)
              alt.onSave(e.target.value)
            }}
            className={ROW_INPUT}
          />
        </KvRow>
        <KvRow label="Type">
          <select
            value={kind.value ?? 'photo'}
            aria-label={`Type for ${label}`}
            onChange={(e) => kind.onSave(e.target.value as MediaKind)}
            className={`${ROW_INPUT} cursor-pointer`}
          >
            {MEDIA_KINDS.map((o) => (
              <option key={o} value={o}>
                {KIND_LABEL[o]}
              </option>
            ))}
          </select>
        </KvRow>
        {slug && (
          <KvRow label="File name">
            <input
              value={name}
              placeholder={slug.preset}
              aria-label={`File name for ${label}`}
              onChange={(e) => setName(e.target.value)}
              className={`${ROW_INPUT} font-space text-[13px]`}
            />
          </KvRow>
        )}
      </div>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={done} className={buttonClass('confirm', 'min-w-[88px] justify-center')}>
          Save
        </button>
      </div>
    </PortalModal>
  )
}

/**
 * The item's name, saved as it is typed (debounced), like the styles below it.
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
          className={FIELD}
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
   *  site reads one (a gallery photo's `media.label`). Saved on its own, as it is typed. */
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
  const [picking, setPicking] = useState(false)
  // The shared debounced style save: serialized per key, flushed when this editor
  // unmounts (every way out of it) or the page is hidden. No `onApply` here: the frame is
  // painted below with the plain tokens, not the stored (sentinel-wearing) form.
  const { status, save } = useStyleRegionSave(artistId)
  // A class string the server would refuse (the same cleanClassText gate) is never
  // queued; say so rather than showing a painted frame that will not be kept.
  const [refused, setRefused] = useState(false)
  // Built with the palette (the shell's EditorStyleOptions): in phone view the scale
  // control twins to `scalesm-[…]` and tags itself (Mobile).
  const defaultControls = useMemo(() => buildItemStyleControls(palette), [palette])
  const controls = controlsProp ?? defaultControls

  /** Paint the frame now; the draft write follows the debounce. */
  function change(next: string) {
    setClasses(next)
    onApplyStyle?.(styleKey, next)
    setRefused(!save(styleKey, toItemStored(palette, next)))
  }

  return (
    <>
      <EditorPanel label={label} thumb={preview} onBack={onBack}>
        {/* Glyphs, not words (Sam, 2026-10-02): ↻ swaps the item for another, the trash takes
            it off; each says its name on hover. */}
        <div className="flex items-center gap-4 px-5 pt-4">
          <RowIcon icon="refresh" label="Replace" variant="bare" labelAlign="start" glyphSize={16} onClick={() => setPicking(true)} />
          <RowIcon icon="trash" label="Remove" variant="bare" tone="danger" glyphSize={16} onClick={onRemove} />
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

        {/* Silent on success, like every panel: the line appears only on a failed or
            refused save, the one state where the frame and the draft disagree. */}
        <SaveLine status={refused ? 'error' : status} />
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
    </>
  )
}
