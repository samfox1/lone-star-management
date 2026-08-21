import { budgetFor, budgetSlotKey, type AssetBudgets } from '@/lib/site-editor/asset-budget'
import {
  buildBackgroundItemStyleControls,
  buildVideoItemStyleControls,
  type SiteStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import type { Orientation } from '@/lib/site-editor/gallery'
import { AddFirstLink, CardThumb, PhotoThumb, fileNameOf } from './inspector-grid'
import { GallerySlotUploader } from '../media-uploader'
import type { PickCandidate } from './item-editor'
import type { EditorVideo, GalleryPhoto, ItemEdit, SiteVideoRole } from './inspector-types'

/**
 * WHAT CAN BE FULL-PANEL EDITED, in one place (2026-08-18 inspector split — this
 * 4-branch switch lived mid-hub). The interface is the seam where the next item kind is
 * added: `(item, deps) → config`, where only what genuinely differs per media kind —
 * the preview, the candidate list, the place/unplace semantics, the control set — is
 * computed per branch. The inspector renders ONE `<ItemEditor>` from the result.
 * (Merch went its own way — `MerchEditor` is field-shaped, not media-shaped.)
 */
export type ItemEditorConfig = {
  /** The item's editable name, where the site reads one. */
  title?: { value: string; onSave: (next: string) => void }
  key: string
  preview: React.ReactNode
  candidates: PickCandidate[]
  onPick: (id: string) => void
  onRemove: () => void
  uploader?: React.ReactNode
  empty?: React.ReactNode
  /** Overrides the default (image) visual control set — the video branches use it. */
  controls?: StyleControl[]
}

export type ItemEditorDeps = {
  artistId: string
  photos: GalleryPhoto[]
  videos: EditorVideo[]
  styleOptions?: SiteStyleOptions
  assetBudgets?: AssetBudgets
  /** The inspector's live place/toggle handlers — the config binds them per branch. */
  placeInSlot: (role: string, photo: GalleryPhoto | null) => void
  /** Omit the collection to keep the photo in whatever pool it is replacing. */
  placePhoto: (p: GalleryPhoto, orientation: Orientation, collection?: string) => void
  /** Rename one photo — debounced through the inspector, saved to `media.label`. */
  renamePhoto: (id: string, label: string) => void
  /** False on a site that locks its look: the panel opens with the title, Replace and
   *  Remove, and no style controls at all. Absent = true. */
  itemStyling?: boolean
  unplacePhoto: (p: GalleryPhoto) => void
  addPhoto: (m: { id: string; storage_path: string; orientation: Orientation }) => void
  assignHero: (role: SiteVideoRole, videoId: string | null) => void
  toggleVideoOnSite: (v: EditorVideo) => void
}

/** Null when the item vanished from the live lists (deleted under an open editor). */
export function buildItemEditorConfig(item: ItemEdit, deps: ItemEditorDeps): ItemEditorConfig | null {
  const { artistId, photos, videos, styleOptions, assetBudgets, itemStyling = true } = deps
  const photoCandidates = (list: GalleryPhoto[], aspect: string): PickCandidate[] =>
    list.map((p) => ({ id: p.id, label: fileNameOf(p.storage_path), thumb: <PhotoThumb path={p.storage_path} aspect={aspect} fit="cover" /> }))
  const videoCandidates = (list: EditorVideo[]): PickCandidate[] =>
    list.map((v) => ({ id: v.id, label: v.title || 'Untitled video', thumb: <CardThumb poster={v.poster} previewUrl={v.previewUrl} /> }))
  const videosPageLink = <AddFirstLink href={`/artists/${artistId}/videos`} label="Add a video first" />

  if (item.type === 'imageSlot') {
    const placed = photos.find((p) => p.siteRole === item.role)
    if (!placed) return null
    return {
      key: `slot:${item.role}`,
      // A BACKGROUND slot (manifest `background: true`) trims the controls: no
      // edges/border/corners/shadow on a frameless fill, and Zoom floors at 100%
      // so it can never uncover the page behind it (Sam, 2026-08-18).
      ...(item.background ? { controls: buildBackgroundItemStyleControls(styleOptions) } : {}),
      preview: <PhotoThumb path={placed.storage_path} aspect="aspect-square" fit="cover" />,
      candidates: photoCandidates(photos.filter((p) => !p.siteRole), 'aspect-square'),
      onPick: (id) => deps.placeInSlot(item.role, photos.find((p) => p.id === id) ?? null),
      onRemove: () => deps.placeInSlot(item.role, null),
      uploader: (
        <GallerySlotUploader
          artistId={artistId}
          orientation="horizontal"
          label="Drop an image or click to upload"
          // The SLOT's budget (`polaroid_1_photo` → `polaroid_photo`), not the general
          // image one: the site declared a tighter cap because the card renders small.
          budget={budgetFor(assetBudgets, 'image', budgetSlotKey(item.role))}
          onUploaded={(m) => deps.placeInSlot(item.role, { ...m, onSite: true, siteRole: item.role, collection: null, label: null })}
        />
      ),
    }
  }
  if (item.type === 'galleryPhoto') {
    const placed = photos.find((p) => p.id === item.id)
    if (!placed) return null
    const aspect = item.orientation === 'vertical' ? 'aspect-[2/3]' : 'aspect-[3/2]'
    return {
      key: `image:${item.id}`,
      preview: <PhotoThumb path={placed.storage_path} aspect={aspect} fit="cover" />,
      candidates: photoCandidates(
        photos.filter(
          (p) =>
            !p.onSite &&
            !p.siteRole &&
            (p.orientation === item.orientation || (item.orientation === 'horizontal' && p.orientation == null)),
        ),
        aspect,
      ),
      onPick: (id) => {
        const next = photos.find((p) => p.id === id)
        deps.unplacePhoto(placed)
        // Into the SAME pool the replaced photo filled (undefined = untagged, which is
        // the first declared collection).
        if (next) deps.placePhoto(next, item.orientation, placed.collection ?? undefined)
      },
      onRemove: () => deps.unplacePhoto(placed),
      // The piece's NAME — what ftbk's desktop prints under its icon. The only thing a
      // locked site lets the manager change about the art itself.
      title: { value: placed.label ?? '', onSave: (next: string) => deps.renamePhoto(placed.id, next) },
      // A locked site (manifest itemStyling:false) gets the SAME panel with no style
      // controls: Sam, 2026-08-21 — "these images should have their own editing panel,
      // but it should just be for the title of the image".
      ...(itemStyling ? {} : { controls: [] }),
      uploader: (
        <GallerySlotUploader
          artistId={artistId}
          orientation={item.orientation}
          budget={budgetFor(assetBudgets, 'image')}
          onUploaded={deps.addPhoto}
        />
      ),
    }
  }
  if (item.type === 'videoSlot') {
    const placed = videos.find((v) => v.siteRole === item.role)
    if (!placed) return null
    return {
      key: `slot:${item.role}`,
      preview: <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />,
      // Only uploaded videos, and not one already holding another background slot.
      candidates: videoCandidates(videos.filter((v) => v.provider === 'uploaded' && !v.siteRole)),
      onPick: (id) => deps.assignHero(item.role, id),
      onRemove: () => deps.assignHero(item.role, null),
      empty: videosPageLink,
      // An uploaded background clip: playback is ours to control, so Speed applies.
      controls: buildVideoItemStyleControls('file', styleOptions),
    }
  }
  const placed = videos.find((v) => v.id === item.id)
  if (!placed) return null
  return {
    key: `video:${item.id}`,
    preview: <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />,
    // The band is YouTube embeds only (no uploads, no Shorts), same as its picker.
    candidates: videoCandidates(videos.filter((v) => !v.onSite && v.provider === 'youtube' && !v.isShort)),
    onPick: (id) => {
      // Swap: the old video only leaves the site now that a replacement is chosen.
      const next = videos.find((v) => v.id === id)
      deps.toggleVideoOnSite(placed)
      if (next) deps.toggleVideoOnSite(next)
    },
    onRemove: () => deps.toggleVideoOnSite(placed),
    empty: videosPageLink,
    // A YouTube iframe: playback can't be touched from outside, so visual-only.
    controls: buildVideoItemStyleControls('embed', styleOptions),
  }
}
