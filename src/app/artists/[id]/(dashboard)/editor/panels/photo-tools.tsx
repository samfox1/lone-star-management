import { useState } from 'react'
import { cx } from '@/lib/cx'
import { Icon } from '@/components/ui/icons'
import { PortalModal } from '@/components/ui/portal-modal'
import { mediaUrl } from '@/lib/site'
import { IMAGE_UPLOAD_RULES } from '@/lib/upload'
import { componentSlotRole, type ComponentSlot, type ManifestComponent } from '@/lib/site-editor/manifest'
import { type SelectTarget, selectTargetKey } from '@samfox1/site-bridge/protocol'
import { type Orientation } from '@/lib/site-editor/gallery'
import { type EditorImageField, type GalleryPhoto, type ItemEdit } from '../inspector-types'
import { GroupLabel, SlotGroupLabel, CONTROL_LABEL, EYEBROW } from '../inspector-shared'
import {
  PhotoThumb,
  EmptySlot,
  CoverEditMenu,
  LibraryPicker,
  MediaGrid,
  SelectableTile,
  TileEditButton,
  fileNameOf,
  useDismiss,
} from '../inspector-grid'
import { GallerySlotUploader } from '../../media-uploader'
import { budgetFor, budgetSlotKey, type AssetBudget, type AssetBudgets } from '@/lib/site-editor/asset-budget'
import { UploadField } from '../../upload-field'
import { toast } from '../../toast'
import { setImageFieldAction } from '../../actions'

/* ── The Images panel ────────────────────────────────────────────────────────────────
 * Every image the site shows, in ONE place, each an editable tile in a 3-up grid, and
 * clicking a tile highlights the matching element in the live preview (the frame outlines
 * `[data-lse-highlight]`). Three groups, top to bottom:
 *   • Set slots — the template's FIXED single positions (hero image, profile photo). Replace
 *     or remove; each saves to its manifest target (an artist URL column, or a media row).
 *   • Custom slots — the artist's own photo arrangement: the repeated multi-image wall
 *     (skeen's polaroids), numbered Slot 1…N.
 *   • Gallery — the orientation collages (Horizontal / Vertical), open collections.
 * Every tile reports its highlight TARGET via `onFocus`, and rings itself when its key
 * matches `focusedKey` — the two directions of the two-way selection sync. */

/** The highlight target for each image kind — the marker the frame outlines. */
const fieldTarget = (key: string): SelectTarget => ({ kind: 'field', key })
const galleryTarget = (id: string): SelectTarget => ({ kind: 'item', assetType: 'image', id })

/* ── Set slots: the template's fixed single positions ─────────────────────────────────
 * The hero image and profile photo are ONE fixed image apiece — positions the template
 * SETS, not an arrangement the artist builds (that's the custom slots below). Each tile is
 * the same size as the custom slots; Replace uploads a new file (portaled modal, so it
 * never resizes the grid), Remove clears the field. The write routes by the field's
 * manifest target (setImageFieldAction). */
function ImageFieldTools({
  fields,
  artistId,
  budget,
  focusedKey,
  onFocus,
  onApplyField,
}: {
  fields: EditorImageField[]
  artistId: string
  /** The site's image budget, passed down to each tile's upload modal. */
  budget?: AssetBudget | null
  focusedKey: string | null
  onFocus: (t: SelectTarget) => void
  onApplyField?: (key: string, value: string) => void
}) {
  return (
    <div>
      <GroupLabel>Set slots</GroupLabel>
      <div className="grid grid-cols-3 gap-2 px-5 pt-1">
        {fields.map((f) => (
          <ImageFieldTile
            key={f.key}
            field={f}
            artistId={artistId}
            budget={budget}
            focused={focusedKey === selectTargetKey(fieldTarget(f.key))}
            onFocus={() => onFocus(fieldTarget(f.key))}
            onApplyField={onApplyField}
          />
        ))}
      </div>
    </div>
  )
}

function ImageFieldTile({
  field,
  artistId,
  budget,
  focused,
  onFocus,
  onApplyField,
}: {
  field: EditorImageField
  artistId: string
  budget?: AssetBudget | null
  focused: boolean
  onFocus: () => void
  onApplyField?: (key: string, value: string) => void
}) {
  // Local optimistic preview so the tile updates the instant a save returns, before the
  // router refresh re-fetches the field. Re-seed when the server value changes (same
  // pattern as ComponentCard's name), without clobbering an in-flight optimistic value.
  const [preview, setPreview] = useState(field.previewUrl)
  const [seeded, setSeeded] = useState(field.previewUrl)
  if (seeded !== field.previewUrl) {
    setSeeded(field.previewUrl)
    setPreview(field.previewUrl)
  }
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  useDismiss(editing, () => setEditing(false))

  async function remove() {
    setRemoving(true)
    const res = await setImageFieldAction(artistId, field.key, null)
    setRemoving(false)
    setEditing(false)
    if (!res.ok) return toast(res.error ?? 'Could not remove the image.', 'error')
    setPreview(null)
    onApplyField?.(field.key, '') // clear it in the frame too
  }

  return (
    <div>
      <span className={cx(CONTROL_LABEL, 'mb-0.5 block truncate text-[9px]')}>{field.label}</span>
      {preview ? (
        <SelectableTile
          label={field.label}
          focused={focused}
          onSelect={onFocus}
          thumb={<PhotoThumb url={preview} aspect="aspect-square" fit="cover" />}
        >
          {editing ? (
            <CoverEditMenu
              replaceAria={`Replace ${field.label}`}
              removeAria={`Remove ${field.label}`}
              onReplace={() => { setEditing(false); setUploadOpen(true) }}
              onRemove={remove}
            />
          ) : (
            <TileEditButton label={`Edit ${field.label}`} onClick={() => setEditing(true)} />
          )}
          {removing && <div className="absolute inset-0 grid place-items-center bg-paper/60 text-[10px] text-ink-muted">Removing…</div>}
        </SelectableTile>
      ) : (
        <EmptySlot label="Add" ariaLabel={field.label} aspect="aspect-square" onClick={() => setUploadOpen(true)} />
      )}

      {uploadOpen && (
        <ImageUploadModal
          field={field}
          hasCurrent={!!preview}
          artistId={artistId}
          budget={budget}
          onClose={() => setUploadOpen(false)}
          onSaved={(path) => {
            setUploadOpen(false)
            setPreview(mediaUrl(path))
            onApplyField?.(field.key, mediaUrl(path)) // repaint the frame's <img> immediately
          }}
        />
      )}
    </div>
  )
}

/** The shared small portaled modal around an upload-only drop zone for one image field.
 *  Owns the field write (`setImageFieldAction`) and derives its title and storage folder
 *  from the field, so call sites just say which field. The hero folder choice keeps the
 *  publish-GC invariant: `hero` sits outside MEDIA_FOLDERS so GC can't sweep the live
 *  hero object (save.ts). */
function ImageUploadModal({
  field,
  hasCurrent,
  artistId,
  budget,
  onClose,
  onSaved,
}: {
  field: EditorImageField
  /** Whether the field currently shows an image — titles the modal Replace vs Add. */
  hasCurrent: boolean
  artistId: string
  /** The site's image budget. This modal shipped without one on 2026-08-06 — an
   *  oversized hero image placed from the editor bypassed compression while the same
   *  file placed from the Images panel did not. */
  budget?: AssetBudget | null
  onClose: () => void
  onSaved: (path: string) => void
}) {
  const title = `${hasCurrent ? 'Replace' : 'Add'} ${field.label}`
  return (
    <PortalModal ariaLabel={title} onClose={onClose}>
      <div className={cx(EYEBROW, 'mb-2 pr-6')}>{title}</div>
      <UploadField
        accept="image/*"
        label="Drop an image or click to upload"
        kind="image"
        budget={budget}
        bucket="media"
        artistId={artistId}
        category={field.target.store === 'artist' ? 'hero' : 'profile'}
        noun="image"
        rules={IMAGE_UPLOAD_RULES}
        writeRow={async (path) => {
          const res = await setImageFieldAction(artistId, field.key, path)
          if (!res.ok) return res.error ?? 'Save failed'
          onSaved(path)
          return null
        }}
      />
    </PortalModal>
  )
}

/* ── Custom slots: the artist's own photo arrangement (skeen's polaroids) ─────────────
 * Where the artist arranges their own photos. The site declares the component and how many
 * images it renders (manifest.components: count × slots); the manager fills each one. NOT
 * boxed into named cards (Sam, 2026-07-28) — just a flat grid of "Slot 1 … Slot N", numbered
 * sequentially across every instance, so the wall reads as bare slots to fill.
 *
 * A placed photo carries `media.site_role = <key>_<n>_<slot>`, which is exactly the field
 * key skeen already declares, so the two can't drift (tests/component-slots.test.ts). The
 * per-slot format hint (a caption wants a transparent PNG) rides on the slot and still
 * warns, but the visible label is just its number. */
function ComponentTools({
  components,
  photos,
  assetBudgets,
  artistId,
  focusedKey,
  onFocus,
  onEditItem,
  onPlaceSlot,
}: {
  components: ManifestComponent[]
  photos: GalleryPhoto[]
  assetBudgets?: AssetBudgets
  artistId: string
  focusedKey: string | null
  onFocus: (t: SelectTarget) => void
  onEditItem: (item: ItemEdit) => void
  onPlaceSlot: (role: string, photo: GalleryPhoto | null) => void
}) {
  // One pass over the photo list for the whole wall, instead of every tile scanning it
  // twice: who holds which role, and the shared library of unplaced photos (a photo NOT
  // already holding a slot, so one image can't silently serve two slots).
  const placedByRole = new Map<string, GalleryPhoto>()
  for (const p of photos) if (p.siteRole) placedByRole.set(p.siteRole, p)
  const library = photos.filter((p) => !p.siteRole)
  return (
    <div className="pb-2">
      {components.map((c) => {
        // Flatten every instance's slots into one sequential list: instance 1's slots,
        // then instance 2's, … so numbering runs Slot 1 … Slot (count × slots).
        const slots = Array.from({ length: c.count }, (_, i) => i + 1).flatMap((n) =>
          c.slots.map((slot) => ({ slot, role: componentSlotRole(c.key, n, slot.key) })),
        )
        return (
          <div key={c.key}>
            <GroupLabel>Custom slots</GroupLabel>
            <div className="grid grid-cols-3 gap-2 px-5 pt-1">
              {slots.map(({ slot, role }, i) => (
                <SlotTile
                  key={role}
                  index={i + 1}
                  slot={slot}
                  role={role}
                  placed={placedByRole.get(role) ?? null}
                  library={library}
                  budget={budgetFor(assetBudgets, 'image', budgetSlotKey(role))}
                  artistId={artistId}
                  focused={focusedKey === selectTargetKey(fieldTarget(role))}
                  onFocus={() => onFocus(fieldTarget(role))}
                  onEdit={() => onEditItem({ type: 'imageSlot', role, label: `Slot ${i + 1}` })}
                  onPlaceSlot={onPlaceSlot}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** One numbered slot: a drop target, or a placed thumbnail with Select / Replace / Remove
 *  and the two-way highlight ring. Owns its own picker. */
function SlotTile({
  index,
  slot,
  role,
  placed,
  library,
  budget,
  artistId,
  focused,
  onFocus,
  onEdit,
  onPlaceSlot,
}: {
  index: number
  slot: ComponentSlot
  role: string
  /** The photo holding this slot, or null when it's empty. */
  placed: GalleryPhoto | null
  /** The unplaced photos every slot's picker draws from. */
  library: GalleryPhoto[]
  /** This slot's upload budget (already resolved for its role). */
  budget?: import('@/lib/site-editor/asset-budget').AssetBudget | null
  artistId: string
  focused: boolean
  onFocus: () => void
  /** Open this slot in the full-panel editor (its Edit button). */
  onEdit: () => void
  onPlaceSlot: (role: string, photo: GalleryPhoto | null) => void
}) {
  const [picking, setPicking] = useState(false)
  const label = `Slot ${index}`
  const wrongFormat = !!placed && slot.prefersPng && !/\.png$/i.test(placed.storage_path)

  return (
    <div>
      <span className={cx(CONTROL_LABEL, 'mb-0.5 block truncate text-[9px]')}>{label}</span>
      {placed ? (
        <>
          {/* The thumbnail IS the slot; clicking it SELECTS (highlights in the frame). The
              Edit button (a hover corner) opens this slot in the full-panel editor. */}
          <SelectableTile
            label={label}
            focused={focused}
            onSelect={onFocus}
            title={fileNameOf(placed.storage_path)}
            thumb={<PhotoThumb path={placed.storage_path} aspect="aspect-square" fit="cover" />}
          >
            <TileEditButton label={`Edit ${label}`} title="Customize this image" onClick={onEdit} />
          </SelectableTile>
          {/* Advisory, never blocking (Sam, 2026-07-21): a JPG in a PNG slot renders as a
              solid box on the site, so flag it — fixable, not a dead end. */}
          {wrongFormat && (
            <span className="mt-0.5 flex items-start gap-1 text-[10px] leading-tight text-status-pending">
              <Icon name="alert" size={11} />
              Needs a transparent PNG.
            </span>
          )}
        </>
      ) : (
        <EmptySlot
          label="Add"
          ariaLabel={label}
          title={slot.hint ?? slot.label}
          aspect="aspect-square"
          onClick={() => setPicking(true)}
        />
      )}

      {picking && (
        <LibraryPicker<GalleryPhoto>
          title={`Choose an image for ${label}`}
          candidates={library}
          keyOf={(p) => p.id}
          labelOf={(p) => fileNameOf(p.storage_path)}
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
              budget={budget}
              onUploaded={(m) => {
                onPlaceSlot(role, { ...m, onSite: true, siteRole: role })
                setPicking(false)
              }}
            />
          }
          onPick={(p) => {
            onPlaceSlot(role, p)
            setPicking(false)
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/* ── Gallery: the orientation collages, uniformly 3-up ───────────────────────────── */
const PHOTO_GROUPS: { orientation: Orientation; label: string; aspect: string }[] = [
  { orientation: 'horizontal', label: 'Horizontal', aspect: 'aspect-[3/2]' },
  { orientation: 'vertical', label: 'Vertical', aspect: 'aspect-[2/3]' },
]

export function PhotoTools({
  photos,
  imageFields,
  focusedKey,
  onFocus,
  onEditItem,
  components,
  showGallery,
  assetBudgets,
  artistId,
  onAdd,
  onPlace,
  onUnplace,
  onPlaceSlot,
  onApplyField,
}: {
  photos: GalleryPhoto[]
  /** Single-occupancy image fields (hero image, profile photo) — the "Set slots" group. */
  imageFields: EditorImageField[]
  /** selectTargetKey of the focused image region (rings that tile). */
  focusedKey: string | null
  /** Focus a region (a tile click) — highlights it in the frame. */
  onFocus: (t: SelectTarget) => void
  /** Open one image in the full-panel editor (a tile's Edit button). */
  onEditItem: (item: ItemEdit) => void
  components: ManifestComponent[]
  /** Whether the SITE renders a photo collage (it declares an image slot). When it does
   *  not, the orientation groups are hidden: an editor slot with nothing behind it on the
   *  site is a place to put work that never appears (Sam, 2026-07-21). */
  showGallery: boolean
  /** The site's upload budgets — the compression gate on each uploader below. */
  assetBudgets?: AssetBudgets
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
  const nothing = imageFields.length === 0 && components.length === 0 && !showGallery
  return (
    <div className="py-2">
      {imageFields.length > 0 && (
        <ImageFieldTools
          fields={imageFields}
          artistId={artistId}
          budget={budgetFor(assetBudgets, 'image')}
          focusedKey={focusedKey}
          onFocus={onFocus}
          onApplyField={onApplyField}
        />
      )}
      {components.length > 0 && (
        <ComponentTools
          components={components}
          photos={photos}
          assetBudgets={assetBudgets}
          artistId={artistId}
          focusedKey={focusedKey}
          onFocus={onFocus}
          onEditItem={onEditItem}
          onPlaceSlot={onPlaceSlot}
        />
      )}
      {showGallery &&
        PHOTO_GROUPS.map(({ orientation, label, aspect }) => (
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
              renderThumb={(p) => <PhotoThumb path={p.storage_path} aspect={aspect} fit="cover" />}
              aspect={aspect}
              cols="grid-cols-3"
              pickTitle={`Add a ${orientation} photo`}
              addLabel={`Add ${orientation} photo`}
              empty={
                <p className="py-2 text-center text-xs text-ink-muted">
                  No {orientation} photos in your library yet. Upload one below.
                </p>
              }
              pickerFooter={
                <GallerySlotUploader
                  artistId={artistId}
                  orientation={orientation}
                  budget={budgetFor(assetBudgets, 'image')}
                  onUploaded={onAdd}
                />
              }
              onSetOnSite={(p, next) => (next ? onPlace(p, orientation) : onUnplace(p))}
              select={{
                onSelect: (p) => onFocus(galleryTarget(p.id)),
                isFocused: (p) => focusedKey === selectTargetKey(galleryTarget(p.id)),
                onEdit: (p, i) => onEditItem({ type: 'galleryPhoto', id: p.id, orientation, label: `${label} ${i + 1}` }),
              }}
            />
          </div>
        ))}
      {nothing && (
        <p className="px-5 py-6 text-sm leading-relaxed text-ink-muted">
          This site has no image slots. Photos you upload live in Assets until the site
          declares somewhere to put them.
        </p>
      )}
    </div>
  )
}
