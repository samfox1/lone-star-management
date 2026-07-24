import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { componentLabelKey, componentSlotRole, type ManifestComponent } from '@/lib/site-editor/manifest'
import { type Orientation } from '@/lib/site-editor/gallery'
import { type GalleryPhoto } from '../inspector-types'
import { plural, GroupLabel, SlotGroupLabel, FIELD, CONTROL_LABEL } from '../inspector-shared'
import { PhotoThumb, EmptySlot, LibraryPicker, MediaGrid } from '../inspector-grid'
import { GallerySlotUploader } from '../../media-uploader'
import { saveEditorFieldAction } from '../../actions'

/* ── Image tools: the gallery grouped by orientation, each an assets grid ────────────
 * skeen's photo collage lays each photo out by shape, so the gallery is edited in two
 * orientation groups (Horizontal, Vertical). Add opens the asset picker — the manager's
 * ALREADY-UPLOADED photos, exactly like the video picker — and choosing one places it in
 * that group, which is when its orientation is set (photos upload as plain assets). The
 * WHOLE library shows in both pickers, so an untagged upload is never hidden. Replace /
 * Remove behave like the video slots (Remove takes a photo off the site, back to the
 * library — never deletes). Cards are 3-up. The picker footer can still upload a new
 * asset, but picking existing ones is the primary path. */
/* ── Component slots: repeated multi-image cards (skeen's polaroid wall) ─────────────
 * The site declares the component and how many it renders (manifest.components); the
 * manager fills each slot and may RENAME each instance. A name is ordinary editable site
 * text under `<key>_<n>_label`, so it saves and publishes through saveEditorFieldAction
 * like every other text field — no storage of its own.
 *
 * A placed photo carries `media.site_role = <key>_<n>_<slot>`, which is exactly the field
 * key skeen already declares, so the two can't drift (tests/component-slots.test.ts). */
function ComponentTools({
  components,
  photos,
  labels,
  artistId,
  onPlaceSlot,
  onApplyField,
}: {
  components: ManifestComponent[]
  photos: GalleryPhoto[]
  /** Current `<key>_<n>_label` values from published/draft site text. */
  labels: Record<string, string>
  artistId: string
  onPlaceSlot: (role: string, photo: GalleryPhoto | null) => void
  onApplyField?: (key: string, value: string) => void
}) {
  return (
    <div className="pb-2">
      {components.map((c) => (
        <div key={c.key}>
          {/* Counted in SLOTS, not components: what the manager needs to know is how
              many images this section wants of them (5 cards × 2 each = 10), not how
              many cards there happen to be (Sam, 2026-07-21). */}
          <GroupLabel>{plural(c.count * c.slots.length, 'image slot')}</GroupLabel>
          {/* Two compact cards per row (Sam, 2026-07-24): each instance is its own boxed
              container so the wall reads as an arrangeable grid, not one tall column. */}
          <div className="grid grid-cols-2 gap-2.5 px-5 pt-1">
            {Array.from({ length: c.count }, (_, i) => i + 1).map((n) => (
              <ComponentCard
                key={`${c.key}_${n}`}
                component={c}
                n={n}
                photos={photos}
                labelKey={componentLabelKey(c.key, n)}
                labelValue={labels[componentLabelKey(c.key, n)] ?? ''}
                artistId={artistId}
                onPlaceSlot={onPlaceSlot}
                onApplyField={onApplyField}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One instance: an editable name plus one drop target per declared slot. */
function ComponentCard({
  component,
  n,
  photos,
  labelKey,
  labelValue,
  artistId,
  onPlaceSlot,
  onApplyField,
}: {
  component: ManifestComponent
  n: number
  photos: GalleryPhoto[]
  labelKey: string
  labelValue: string
  artistId: string
  onPlaceSlot: (role: string, photo: GalleryPhoto | null) => void
  onApplyField?: (key: string, value: string) => void
}) {
  const [name, setName] = useState(labelValue)
  const [renaming, setRenaming] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)

  // Re-seed when the saved value lands after first render, without clobbering typing.
  const [seeded, setSeeded] = useState(labelValue)
  if (seeded !== labelValue) {
    setSeeded(labelValue)
    setName(labelValue)
  }

  /** Commit on an explicit finish (blur / Enter), not on every keystroke: the name is
   *  read as text until the pencil is clicked, so there is a clear start and end to the
   *  edit and no debounce guessing when typing stopped. */
  function commitName() {
    setRenaming(false)
    if (name === labelValue) return
    onApplyField?.(labelKey, name) // optimistic repaint in the frame
    void saveEditorFieldAction(artistId, labelKey, name)
  }

  // The library a slot can draw from: every photo NOT already holding a slot. A photo in
  // another slot is excluded so one image can't silently serve two cards.
  const library = photos.filter((p) => !p.siteRole)
  const fallbackName = `${component.label} ${n}`

  return (
    <div className="rounded-xl border border-hairline p-2">
      {/* The name READS as text; the pencil turns it into a field, so the cards read as a
          wall to arrange rather than a form to fill. */}
      {renaming ? (
        <input
          autoFocus
          aria-label={`${fallbackName} name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') {
              setName(labelValue) // abandon the edit, keep what was saved
              setRenaming(false)
            }
          }}
          placeholder={fallbackName}
          className={cx(FIELD, 'mb-1.5 px-2 py-1 text-[12px]')}
        />
      ) : (
        <div className="mb-1.5 flex items-center gap-1">
          <span className={cx('min-w-0 flex-1 truncate text-[12px]', name ? 'text-ink' : 'text-ink-faint')}>
            {name || fallbackName}
          </span>
          <button
            type="button"
            aria-label={`Rename ${fallbackName}`}
            onClick={() => setRenaming(true)}
            className="flex-none rounded p-0.5 text-ink-faint hover:bg-surface hover:text-ink"
          >
            <Icon name="edit" size={12} />
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {component.slots.map((slot) => {
          const role = componentSlotRole(component.key, n, slot.key)
          const placed = photos.find((p) => p.siteRole === role) ?? null
          const wrongFormat = !!placed && slot.prefersPng && !/\.png$/i.test(placed.storage_path)
          return (
            <div key={slot.key}>
              <span className={cx(CONTROL_LABEL, 'mb-0.5 block truncate text-[9px]')}>{slot.label}</span>
              {placed ? (
                <>
                  {/* The thumbnail IS the slot; Replace/Remove live in a hover overlay so it
                      stays small enough to fit two cards per row. */}
                  <div
                    className="group/slot relative overflow-hidden rounded-md border border-hairline"
                    title={placed.storage_path.split('/').pop()}
                  >
                    <PhotoThumb path={placed.storage_path} aspect="aspect-square" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/50 py-0.5 opacity-0 transition-opacity group-hover/slot:opacity-100">
                      <button
                        type="button"
                        aria-label={`Replace ${fallbackName} ${slot.label}`}
                        onClick={() => setPicking(role)}
                        className="rounded p-0.5 text-white/85 hover:text-white"
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${fallbackName} ${slot.label}`}
                        onClick={() => onPlaceSlot(role, null)}
                        className="rounded p-0.5 text-white/85 hover:text-accent-red"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  </div>
                  {/* Advisory, never blocking (Sam, 2026-07-21): a JPG in a PNG slot renders
                      as a solid box on the site, so flag it — fixable, not a dead end. */}
                  {wrongFormat && (
                    <span className="mt-0.5 flex items-start gap-1 text-[10px] leading-tight text-status-pending">
                      <Icon name="alert" size={11} />
                      Needs a transparent PNG.
                    </span>
                  )}
                </>
              ) : (
                <EmptySlot
                  label={`Add ${slot.label.toLowerCase()}`}
                  ariaLabel={`${fallbackName} ${slot.label}`}
                  title={slot.hint}
                  aspect="aspect-square"
                  onClick={() => setPicking(role)}
                />
              )}
            </div>
          )
        })}
      </div>

      {picking && (
        <LibraryPicker<GalleryPhoto>
          title="Choose an image"
          candidates={library}
          keyOf={(p) => p.id}
          labelOf={(p) => p.storage_path.split('/').pop() ?? ''}
          renderThumb={(p) => <PhotoThumb path={p.storage_path} aspect="aspect-square" />}
          empty={
            <p className="py-2 text-center text-xs text-ink-muted">
              No unused photos in your library. Upload one below.
            </p>
          }
          footer={
            <GallerySlotUploader
              artistId={artistId}
              orientation="horizontal"
              label="Drop an image or click to upload"
              onUploaded={(m) => onPlaceSlot(picking, { ...m, onSite: true, siteRole: picking })}
            />
          }
          onPick={(p) => {
            onPlaceSlot(picking, p)
            setPicking(null)
          }}
          onCancel={() => setPicking(null)}
        />
      )}
    </div>
  )
}

const PHOTO_GROUPS: { orientation: Orientation; label: string; aspect: string; cols: string }[] = [
  { orientation: 'horizontal', label: 'Horizontal', aspect: 'aspect-[3/2]', cols: 'grid-cols-2' },
  { orientation: 'vertical', label: 'Vertical', aspect: 'aspect-[2/3]', cols: 'grid-cols-3' },
]

export function PhotoTools({
  photos,
  components,
  componentLabels,
  showGallery,
  artistId,
  onAdd,
  onPlace,
  onUnplace,
  onPlaceSlot,
  onApplyField,
}: {
  photos: GalleryPhoto[]
  components: ManifestComponent[]
  componentLabels: Record<string, string>
  /** Whether the SITE renders a photo collage (it declares an image slot). When it does
   *  not, the orientation groups are hidden: an editor slot with nothing behind it on the
   *  site is a place to put work that never appears (Sam, 2026-07-21). */
  showGallery: boolean
  artistId: string
  onAdd: (m: { id: string; storage_path: string; orientation: Orientation }) => void
  onPlace: (p: GalleryPhoto, orientation: Orientation) => void
  onUnplace: (p: GalleryPhoto) => void
  onPlaceSlot: (role: string, photo: GalleryPhoto | null) => void
  onApplyField?: (key: string, value: string) => void
}) {
  // A photo is horizontal OR vertical by its real shape, so each group shows only its own
  // orientation — never the same photo in both. A null-orientation photo (a legacy row,
  // or a Drive import that was never measured) has no shape yet: it belongs to the
  // Horizontal group so it stays visible and manageable instead of vanishing from the
  // editor while still live on the site. Placing it there assigns a real orientation.
  // A photo holding a component slot is NOT a gallery photo — it belongs to a polaroid
  // card, and showing it in the collage groups would invite placing a handwriting PNG in
  // the photo wall (20260724120000).
  const belongs = (p: GalleryPhoto, group: Orientation) =>
    !p.siteRole && (p.orientation === group || (group === 'horizontal' && p.orientation == null))
  return (
    <div className="py-2">
      {components.length > 0 && (
        <ComponentTools
          components={components}
          photos={photos}
          labels={componentLabels}
          artistId={artistId}
          onPlaceSlot={onPlaceSlot}
          onApplyField={onApplyField}
        />
      )}
      {showGallery &&
        PHOTO_GROUPS.map(({ orientation, label, aspect, cols }) => (
        <div key={orientation}>
          <div className="px-5 pt-3">
            <SlotGroupLabel>{label}</SlotGroupLabel>
          </div>
          <MediaGrid
            onSiteItems={photos.filter((p) => p.onSite && belongs(p, orientation))}
            library={photos.filter((p) => !p.onSite && belongs(p, orientation))}
            noun={`${orientation} photo`}
            keyOf={(p) => p.id}
            labelOf={(_, i) => `${label} ${i + 1}`}
            renderThumb={(p) => <PhotoThumb path={p.storage_path} aspect={aspect} />}
            aspect={aspect}
            cols={cols}
            pickTitle={`Add a ${orientation} photo`}
            addLabel={`Add ${orientation} photo`}
            empty={
              <p className="py-2 text-center text-xs text-ink-muted">
                No {orientation} photos in your library yet. Upload one below.
              </p>
            }
            pickerFooter={<GallerySlotUploader artistId={artistId} orientation={orientation} onUploaded={onAdd} />}
            onSetOnSite={(p, next) => (next ? onPlace(p, orientation) : onUnplace(p))}
          />
          </div>
        ))}
      {!showGallery && components.length === 0 && (
        <p className="px-5 py-6 text-sm leading-relaxed text-ink-muted">
          This site has no image slots. Photos you upload live in Assets until the site
          declares somewhere to put them.
        </p>
      )}
    </div>
  )
}
