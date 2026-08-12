'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { cx } from '@/lib/cx'
import { GroupLabel, SCROLL_BODY, type SaveStatus } from './inspector-shared'
import { reorderList, type Orientation } from '@/lib/site-editor/gallery'
import { type SelectTarget, selectTargetKey } from '@samfox1/site-bridge/protocol'
import {
  componentSlotRole,
  type ManifestComponent,
  type ManifestVideoSlot,
  type ManifestLinkRegion,
  type ManifestStyleRegion,
} from '@/lib/site-editor/manifest'
import { buildVideoItemStyleControls, type SiteStyleOptions, type StyleControl } from '@/lib/site-editor/style-controls'
import { siteSwatches } from '@/lib/site-editor/style-apply'
import { mediaUrl } from '@/lib/storage-url'
import { isContactLink, looksLikeEmail } from '@/lib/url'

/** One row is a CONTACT — a booking address, not a social — whether it was typed with a
 *  scheme or as a bare address. The add rule (linkAddError) exempts the same pair, so a
 *  row it lets in always has a group that renders it; splitting the two predicates is
 *  how a bare-email row ended up filed under Socials, which no site draws
 *  (2026-08-10 review). */
const isContactish = (url: string) => isContactLink(url) || looksLikeEmail(url)
import { Icon, type IconName } from '@/components/ui/icons'
import { ItemEditor, type PickCandidate } from './item-editor'
import { AddFirstLink, CardThumb, PhotoThumb, fileNameOf } from './inspector-grid'
import { GallerySlotUploader } from '../media-uploader'
import { budgetFor, budgetSlotKey, type AssetBudgets } from '@/lib/site-editor/asset-budget'
import {
  PhotoTools,
  TextTools,
  LinkTools,
  SiteLinkTools,
  StyleTools,
  VideoTools,
  TourTools,
  MerchTools,
  MusicTools,
  SiteTools,
} from './panels'
import type { CursorSettings } from '@samfox1/site-bridge/cursor'
import {
  assignComponentSlotAction,
  setSongsOnSiteAction,
  assignHeroSlotAction,
  deleteContentAction,
  placeGalleryPhotoAction,
  reorderContentAction,
  saveEditorFieldAction,
  saveEditorLinkAction,
  saveEditorStyleAction,
  setOnSiteAction,
} from '../actions'
import { useSessionJournal, type JournalEntry } from './use-session-journal'
import { useTextFieldSave } from './use-text-save'
import { useStyleRegionSave } from './use-style-save'
import { TextFieldEditor } from './text-field-editor'
import { TourDateEditor } from './tour-date-editor'

/**
 * The visual editor's LEFT inspector (SITE_EDITOR_PLAN.md phase 2 — panel redesign).
 * Two states: BROWSE (a breathable list of the site's component types) and EDITING
 * (the tools for the selected component, with the browse list collapsed to an icon
 * strip at the bottom).
 *
 * Wiring status: the Images tools read the artist's real `gallery_image` media and
 * remove is wired to `deleteMediaAction`. Reorder + sizing (no schema yet) and the
 * other component types still render against placeholder affordances — next step.
 */

// The panel data view-models live in ./inspector-types; re-exported here so page.tsx,
// editor-shell.tsx, and the tests keep importing them from './editor-inspector'.
import type {
  GalleryPhoto,
  EditorImageField,
  EditorTextField,
  EditorLink,
  EditorSupportLink,
  SiteVideoRole,
  EditorVideo,
  EditorMerch,
  EditorSong,
  EditorProject,
  EditorTour,
  ItemEdit,
} from './inspector-types'
export type {
  GalleryPhoto,
  EditorImageField,
  EditorTextField,
  EditorLink,
  EditorSupportLink,
  SiteVideoRole,
  EditorVideo,
  EditorMerch,
  EditorSong,
  EditorProject,
  EditorTour,
}

// One Links panel holds every link kind as its own group: Socials + Tour support
// (outbound links) AND the manifest-declared link buttons (USB / Merch).
type Kind = 'images' | 'text' | 'links' | 'videos' | 'music' | 'tour' | 'merch' | 'style' | 'site'
type Component = { kind: Kind; icon: IconName; label: string }

const COMPONENTS: Component[] = [
  { kind: 'images', icon: 'photo', label: 'Images' },
  { kind: 'text', icon: 'text', label: 'Text' },
  { kind: 'links', icon: 'links', label: 'Links' },
  { kind: 'videos', icon: 'videos', label: 'Videos' },
  { kind: 'music', icon: 'tracks', label: 'Music' },
  { kind: 'tour', icon: 'tour', label: 'Tour' },
  { kind: 'merch', icon: 'merch', label: 'Merch' },
  { kind: 'style', icon: 'brush', label: 'Style' },
  // Site-WIDE settings (the cursor, and whatever joins it) — things that belong to no
  // single region, so no other panel could honestly hold them.
  { kind: 'site', icon: 'settings', label: 'Site' },
]

// The per-kind on-site count that used to head each browse row is GONE (Sam,
// 2026-08-12: "I don't need to see the x of x on site") — the grid tile is icon +
// label. countLabel / COUNT_NOUN / KindCount went with it.

/* A read-only OnSiteBadge lived here for the publish-reconciled kinds, because
 * `reconcileOnSite` would silently revert a toggle they didn't own. Videos were its
 * only caller, and ADR 0009 moved them to the live toggle — so it's an OnSiteToggle
 * now, and the badge had no callers left. Merch is the last reconciled type; its
 * panel never showed presence at all, only the header count. Giving merch a real
 * toggle means moving it to LIVE_TOGGLE (lib/content.ts) first. */

/** A STABLE empty default for `styleValues`. Written inline (`= {}`) it was a fresh
 *  object on every render, and the identity guard below (`seenStyleValues !== styleValues`)
 *  then fired forever — any caller that simply omitted the optional prop crashed the
 *  inspector with "Too many re-renders". Found while fixing the 2026-08-09 review. */
const NO_STYLES: Record<string, string> = {}

export function EditorInspector({
  artistId,
  photos: initial,
  imageFields = [],
  textFields = [],
  links: initialLinks = [],
  supportLinks = [],
  videos: initialVideos = [],
  videoSlots = [],
  merch: initialMerch = [],
  releases: initialReleases = [],
  tours: initialTours = [],
  components = [],
  showGallery = false,
  assetBudgets,
  styleRegions = [],
  styleValues = NO_STYLES,
  styleOptions,
  selectedStyle = null,
  linkRegions = [],
  linkValues = {},
  selectedLink = null,
  selectedRegion = null,
  cursorValues = NO_STYLES,
  onApplyField,
  onApplyImage,
  onApplyStyle,
  onApplyLink,
  onApplyCursor,
  onHighlight,
  onClearHighlight,
}: {
  artistId: string
  photos: GalleryPhoto[]
  /** Single-occupancy image regions (hero image, profile photo) — the "Set slots" group. */
  imageFields?: EditorImageField[]
  textFields?: EditorTextField[]
  links?: EditorLink[]
  /** Support acts across the artist's tour dates, for the Links panel's "Tour support"
   *  group. Read-only structurally (acts come from the tour dates); only their URLs are
   *  edited here. */
  supportLinks?: EditorSupportLink[]
  videos?: EditorVideo[]
  /** The video slots this site declares — the Videos panel renders from THESE. */
  videoSlots?: ManifestVideoSlot[]
  merch?: EditorMerch[]
  releases?: EditorProject[]
  /** The date LIBRARY, on-site or not — the editor is where they're chosen (ADR 0009). */
  tours?: EditorTour[]
  /** Repeated multi-image components (the polaroid wall). Comes from the FRAME's
   *  edit-list at runtime; a site that declares none simply has no component section. */
  components?: ManifestComponent[]
  /** Does the site declare a photo collage (an image slot)? Defaults FALSE — a group is
   *  shown because the site asked for it, never just because the editor can render one. */
  showGallery?: boolean
  /** The site's upload budgets (manifest.assetBudgets) — drives the compression gate on
   *  every image uploader below. Absent = no gate, the pre-budget behaviour. */
  assetBudgets?: AssetBudgets
  /** Re-styleable regions. Comes from the FRAME's edit-list at runtime for a custom
   *  site (D-D); the built-in manifests declare none yet, so this is [] for them. */
  styleRegions?: ManifestStyleRegion[]
  /** Saved class overrides (region_key → class string) from the draft. Absent means
   *  the region is still on its base classes. */
  styleValues?: Record<string, string>
  /** The site's declared colour + font palette, for the Style panel's dropdowns. */
  styleOptions?: SiteStyleOptions
  /** Region the frame reported a click on — jumps the panel to Style, focused there. */
  selectedStyle?: string | null
  /** Link-powered elements the site declared (USB/Merch buttons). From the FRAME's
   *  manifest at runtime for a custom site; [] for built-in templates. */
  linkRegions?: ManifestLinkRegion[]
  /** Current URL for each link region, keyed by its role (from the DB). */
  linkValues?: Record<string, string>
  /** Link region the frame reported a click on — jumps to the Site-links panel. */
  selectedLink?: string | null
  /** Image region (field / slot / gallery item) the frame reported a click on — opens the
   *  Images panel and focuses the matching tile. Bumped `nonce` re-fires on a repeat click. */
  selectedRegion?: { target: SelectTarget; nonce: number } | null
  /** Current cursor settings from the draft's site_content (Site panel). */
  cursorValues?: Record<string, string>
  onApplyField?: (key: string, value: string) => void
  /** Optimistically repaint ONE image region in the frame (a slot placement) — the
   *  init-data refresh stays as the consistency backstop, not the only path. */
  onApplyImage?: (key: string, url: string) => void
  onApplyStyle?: (key: string, className: string) => void
  /** Optimistically set a link's href in the frame before the debounced save. */
  onApplyLink?: (key: string, url: string) => void
  /** Repaint the frame's site-wide cursor live (Site panel). */
  onApplyCursor?: (settings: CursorSettings) => void
  /** Outline + scroll a region into view in the frame (a tile click). */
  onHighlight?: (target: SelectTarget) => void
  /** Drop the frame's highlight (left the Images panel). */
  onClearHighlight?: () => void
}) {
  const [active, setActive] = useState<Component | null>(null)
  const [photos, setPhotos] = useState<GalleryPhoto[]>(initial)
  const [links, setLinks] = useState<EditorLink[]>(initialLinks)
  const [videos, setVideos] = useState<EditorVideo[]>(initialVideos)
  const [merch, setMerch] = useState<EditorMerch[]>(initialMerch)
  const [releases, setReleases] = useState<EditorProject[]>(initialReleases)
  const [tours, setTours] = useState<EditorTour[]>(initialTours)
  // One in-flight list mutation at a time: overlapping optimistic ops would each
  // capture a whole-array `prev`, and a later failure would revert to a snapshot that
  // predates a concurrent success — resurrecting a removed row / dropping a good change.
  const [isPending, startTransition] = useTransition()

  // Clicking a styled region in the site opens the Style tools on it. This is the
  // whole point of the embedded-frame model (SITE_EDITOR_PLAN.md): click the thing,
  // edit the thing — rather than hunting for it in a list.
  //
  // Adjusted DURING RENDER rather than in an effect: React re-runs this component
  // immediately without painting the stale panel, whereas a setState inside an
  // effect cascades an extra render (and the lint rule rightly rejects it). Same
  // sanctioned "reset state on prop change" pattern as use-on-site-selection.
  // Starts null, NOT at `selectedStyle`: seeding it from the prop would make the
  // first render already "match" and the panel would never open for a selection
  // that was present on mount.
  const [lastSelected, setLastSelected] = useState<string | null>(null)
  // The CLICK FOCUS: while set, the Style panel shows only this region's controls.
  // Cleared by any manual tab click (selectComponent) — visiting the Style tab by
  // hand is browsing, and browsing shows site-wide styles only, never a leftover
  // element (Sam, 2026-08-12).
  const [styleFocus, setStyleFocus] = useState<string | null>(null)
  if (selectedStyle && selectedStyle !== lastSelected) {
    setLastSelected(selectedStyle)
    setStyleFocus(selectedStyle)
    setActive(COMPONENTS.find((c) => c.kind === 'style') ?? null)
  }

  // Same click-the-thing behaviour for a link-powered element: selecting skeen's USB
  // button in the frame opens the Links panel (its "Buttons" group) focused on it.
  const [lastSelectedLink, setLastSelectedLink] = useState<string | null>(null)
  if (selectedLink && selectedLink !== lastSelectedLink) {
    setLastSelectedLink(selectedLink)
    setActive(COMPONENTS.find((c) => c.kind === 'links') ?? null)
  }

  // Two-way image selection. `focused` is the ONE image region highlighted right now — a
  // tile the manager clicked, OR an image they clicked in the live frame. It drives the
  // ring on the tile (below) and, via the effect, the outline in the frame.
  const [focused, setFocused] = useState<SelectTarget | null>(null)

  // The image regions THIS panel owns, so a frame click on a non-image (a text heading,
  // a video) doesn't wrongly yank the panel to Images. Field-backed images (hero/profile)
  // + every component slot role + any gallery item. Memoized: it's consulted only when a
  // frame select lands, but building it walks components × count × slots.
  const imageRegionKeys = useMemo(() => {
    const keys = new Set(imageFields.map((f) => f.key))
    for (const c of components)
      for (let n = 1; n <= c.count; n++) for (const s of c.slots) keys.add(componentSlotRole(c.key, n, s.key))
    return keys
  }, [imageFields, components])
  const isImageRegion = (t: SelectTarget): boolean =>
    t.kind === 'field' ? imageRegionKeys.has(t.key) : t.kind === 'item' && t.assetType === 'image'

  // Editor → frame: whenever the focused region changes, outline it in the preview (or
  // clear it). A real side effect (postMessage), so it lives in an effect, not in render.
  useEffect(() => {
    if (focused) onHighlight?.(focused)
    else onClearHighlight?.()
  }, [focused, onHighlight, onClearHighlight])

  // Manually switching components (or backing out) drops the highlight — the outline
  // follows the SELECTION, and a panel change is a deselection of whatever held it.
  function selectComponent(c: Component | null) {
    setActive(c)
    setFocused(null)
    // A manual panel change is a deselection for the Style focus too. `lastSelected`
    // deliberately KEEPS the processed key: clearing it would let the still-set prop
    // re-focus on the very next render. (Cost: re-clicking the SAME element after
    // browsing away doesn't re-focus until the prop changes — the prop carries no
    // nonce; the image channel's nonce pattern is the fix if this ever bites.)
    setStyleFocus(null)
  }

  // The one image/video handed the whole panel for editing (Replace / Remove / styling).
  const [editingItem, setEditingItem] = useState<ItemEdit | null>(null)
  // The one TEXT field handed the whole panel (the words + their type controls). Held
  // separately from editingItem because it carries no media and shares none of that
  // editor's Replace/Remove machinery.
  const [editingText, setEditingText] = useState<EditorTextField | null>(null)
  // The one TOUR DATE handed the whole panel (its supporting acts and their links). A
  // third state rather than a branch of ItemEdit: that union is media-shaped —
  // preview, Replace, Remove — and a show has none of those.
  const [editingTour, setEditingTour] = useState<{ tour: EditorTour; label: string } | null>(null)

  // Which panel owns an ITEM select, by the asset type skeen stamps on the element
  // (`data-lse-item="track:<id>"`). Images route through isImageRegion instead — they
  // need the tile-focus machinery, not just a panel. Types with no entry (an asset a
  // future site marks that this build has no panel for) drop, exactly as before.
  const PANEL_BY_ASSET: Partial<Record<string, Kind>> = {
    track: 'music',
    video: 'videos',
    tour_date: 'tour',
    merch: 'merch',
    // A social icon. Its id is the link's LABEL, lowercased — the row id never reaches
    // the deployed site (socials arrive there as label-mapped config), and the label is
    // the join key that pipeline already runs on. LinkTools re-joins by it.
    link: 'links',
  }

  // Frame → editor: a click on a marked region opens ITS panel — the same render-time
  // "reset state on prop change" pattern as selectedStyle; the nonce lets a repeat click
  // on the same region re-fire. Images focus their tile; a TEXT field opens straight
  // into its field editor (the panel list alone would leave the manager hunting for the
  // thing they just pointed at); an item lands on its panel with `focused` carrying the
  // outline. Style / link selects route via their own state above.
  const [lastRegionNonce, setLastRegionNonce] = useState(0)
  if (selectedRegion && selectedRegion.nonce !== lastRegionNonce) {
    const target = selectedRegion.target
    const textField =
      target.kind === 'field' ? textFields.find((f) => f.key === target.key) : undefined
    const itemPanel = target.kind === 'item' ? PANEL_BY_ASSET[target.assetType] : undefined
    // A routed select DISMISSES whatever full-panel editor is open, in every branch,
    // before opening what it asked for. Clearing them per-branch is how editingTour got
    // missed when it was added (2026-08-09 review): the tour editor renders ABOVE
    // `active`, so a stale one made every preview click look dead — the panel behind it
    // changed and the manager saw none of it. One place to close them all, so the next
    // editor added here cannot repeat it.
    const closeEditors = () => {
      setEditingItem(null)
      setEditingText(null)
      setEditingTour(null)
    }
    if (isImageRegion(target)) {
      setLastRegionNonce(selectedRegion.nonce)
      closeEditors()
      setActive(COMPONENTS.find((c) => c.kind === 'images') ?? null)
      setFocused(target)
    } else if (textField) {
      setLastRegionNonce(selectedRegion.nonce)
      closeEditors()
      setActive(COMPONENTS.find((c) => c.kind === 'text') ?? null)
      setEditingText(textField) // …then open the one this select asked for
      setFocused(target)
    } else if (itemPanel) {
      setLastRegionNonce(selectedRegion.nonce)
      closeEditors()
      setActive(COMPONENTS.find((c) => c.kind === itemPanel) ?? null)
      setFocused(target)
    }
    // else: unroutable — consume nothing, exactly the old behaviour for non-image kinds.
  }
  // Text values live HERE, above both the list and the editor, so the two windows onto
  // one field can never show different text or race each other's debounced save.
  const textSave = useTextFieldSave(artistId, textFields, onApplyField)
  // The SAME save path the Style panel uses, so a font set from a text field and one set
  // from the Style panel cannot disagree about what is stored or drift in debounce.
  const { save: saveTextStyle } = useStyleRegionSave(artistId, onApplyStyle)
  const filename = (p: GalleryPhoto) => fileNameOf(p.storage_path)

  // Every colour the site already uses, for the palette's quick-pick row. Held in state and
  // updated as items are styled, so a colour chosen on one photo is offerable on the next
  // WITHOUT a reload — matching two images is the whole reason the row exists.
  const [styleMap, setStyleMap] = useState(styleValues)
  const [seenStyleValues, setSeenStyleValues] = useState(styleValues)
  if (seenStyleValues !== styleValues) {
    setSeenStyleValues(styleValues)
    setStyleMap(styleValues)
  }
  const siteColors = useMemo(() => siteSwatches(styleOptions, styleMap), [styleOptions, styleMap])
  /** Paint the frame immediately, and record the colour DEBOUNCED — the swatch row only
   *  needs to be current by the time the palette next opens, and recording per emitted
   *  drag frame re-rendered the whole inspector (and re-scanned every stored style) at
   *  pointer rate. */
  const recordTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (recordTimer.current) clearTimeout(recordTimer.current)
  }, [])
  /* ── Session journal: what every key was BEFORE this session first touched it ─────
   * Autosave persists ~500ms behind each edit, so "Revert changes" needs its own memory
   * of the session-start values. Every optimistic paint is the choke point all edits
   * pass through BEFORE their save — the wrappers below record there. Reverting walks
   * the ledger in reverse through the same actions + paints. */
  const journal = useSessionJournal()
  const [reverting, setReverting] = useState(false)

  const paintStyle = useCallback(
    (key: string, className: string) => {
      journal.record({ kind: 'style', key, before: styleValues[key] ?? null })
      onApplyStyle?.(key, className)
    },
    [journal, styleValues, onApplyStyle],
  )
  const paintField = useCallback(
    (key: string, value: string) => {
      // Image fields also repaint via apply-field (their value is a URL, saved as a
      // storage path elsewhere) — those aren't journal-revertable v1, so skip them.
      const field = textFields.find((f) => f.key === key)
      if (field) journal.record({ kind: 'field', key, before: field.value })
      onApplyField?.(key, value)
    },
    [journal, textFields, onApplyField],
  )
  const paintLink = useCallback(
    (key: string, url: string) => {
      journal.record({ kind: 'link', key, before: linkValues[key] ?? '' })
      onApplyLink?.(key, url)
    },
    [journal, linkValues, onApplyLink],
  )

  async function revertSession() {
    if (reverting) return
    setReverting(true)
    try {
      for (const e of [...journal.entries].reverse()) {
        if (e.kind === 'style') {
          // before=null → save '' → the override row is DELETED, not written empty.
          onApplyStyle?.(e.key, e.before ?? '')
          await saveEditorStyleAction(artistId, e.key, e.before ?? '')
        } else if (e.kind === 'field') {
          onApplyField?.(e.key, e.before)
          await saveEditorFieldAction(artistId, e.key, e.before)
        } else if (e.kind === 'link') {
          onApplyLink?.(e.key, e.before)
          await saveEditorLinkAction(artistId, e.key, e.before, linkRegions.find((r) => r.key === e.key)?.label ?? e.key)
        } else {
          // Re-place the previous holder: the shared optimistic half, then an AWAITED
          // persist (not startTransition — a revert must not skip mid-transition).
          const next = e.before ? (photos.find((p) => p.id === e.before) ?? null) : null
          applySlotOptimistic(e.role, next)
          await assignComponentSlotAction(artistId, e.role, next?.id ?? null)
        }
      }
    } finally {
      journal.clear()
      setReverting(false)
    }
  }

  const applyItemStyle = useCallback(
    (key: string, className: string) => {
      paintStyle(key, className)
      if (recordTimer.current) clearTimeout(recordTimer.current)
      recordTimer.current = setTimeout(() => {
        recordTimer.current = null
        setStyleMap((m) => (m[key] === className ? m : { ...m, [key]: className }))
      }, 500)
    },
    [paintStyle],
  )

  /** Build the full-panel editor for the item being edited, from the inspector's LIVE state
   *  (so Replace candidates stay fresh) and its place handlers. Null if the item vanished.
   *  Only what genuinely differs per media kind — the preview, the candidate list, and the
   *  place/unplace semantics — is computed per branch; the ItemEditor call itself exists
   *  once. Videos get the same visual controls as images (size, transparency, border,
   *  corners, shadow); their overlay rides site_styles under the same colon-key contract. */
  function buildItemEditor(item: ItemEdit) {
    const back = () => setEditingItem(null)
    const photoCandidates = (list: GalleryPhoto[], aspect: string): PickCandidate[] =>
      list.map((p) => ({ id: p.id, label: filename(p), thumb: <PhotoThumb path={p.storage_path} aspect={aspect} fit="cover" /> }))
    const videoCandidates = (list: EditorVideo[]): PickCandidate[] =>
      list.map((v) => ({ id: v.id, label: v.title || 'Untitled video', thumb: <CardThumb poster={v.poster} previewUrl={v.previewUrl} /> }))
    const videosPageLink = <AddFirstLink href={`/artists/${artistId}/videos`} label="Add a video first" />

    let cfg: {
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
    if (item.type === 'imageSlot') {
      const placed = photos.find((p) => p.siteRole === item.role)
      if (!placed) return null
      cfg = {
        key: `slot:${item.role}`,
        preview: <PhotoThumb path={placed.storage_path} aspect="aspect-square" fit="cover" />,
        candidates: photoCandidates(photos.filter((p) => !p.siteRole), 'aspect-square'),
        onPick: (id) => placeInSlot(item.role, photos.find((p) => p.id === id) ?? null),
        onRemove: () => placeInSlot(item.role, null),
        uploader: (
          <GallerySlotUploader
            artistId={artistId}
            orientation="horizontal"
            label="Drop an image or click to upload"
            // The SLOT's budget (`polaroid_1_photo` → `polaroid_photo`), not the general
            // image one: the site declared a tighter cap because the card renders small.
            budget={budgetFor(assetBudgets, 'image', budgetSlotKey(item.role))}
            onUploaded={(m) => placeInSlot(item.role, { ...m, onSite: true, siteRole: item.role })}
          />
        ),
      }
    } else if (item.type === 'galleryPhoto') {
      const placed = photos.find((p) => p.id === item.id)
      if (!placed) return null
      const aspect = item.orientation === 'vertical' ? 'aspect-[2/3]' : 'aspect-[3/2]'
      cfg = {
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
          unplacePhoto(placed)
          if (next) placePhoto(next, item.orientation)
        },
        onRemove: () => unplacePhoto(placed),
        uploader: (
          <GallerySlotUploader
            artistId={artistId}
            orientation={item.orientation}
            budget={budgetFor(assetBudgets, 'image')}
            onUploaded={addPhoto}
          />
        ),
      }
    } else if (item.type === 'videoSlot') {
      const placed = videos.find((v) => v.siteRole === item.role)
      if (!placed) return null
      cfg = {
        key: `slot:${item.role}`,
        preview: <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />,
        // Only uploaded videos, and not one already holding another background slot.
        candidates: videoCandidates(videos.filter((v) => v.provider === 'uploaded' && !v.siteRole)),
        onPick: (id) => assignHero(item.role, id),
        onRemove: () => assignHero(item.role, null),
        empty: videosPageLink,
        // An uploaded background clip: playback is ours to control, so Speed applies.
        controls: buildVideoItemStyleControls('file'),
      }
    } else {
      const placed = videos.find((v) => v.id === item.id)
      if (!placed) return null
      cfg = {
        key: `video:${item.id}`,
        preview: <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />,
        // The band is YouTube embeds only (no uploads, no Shorts), same as its picker.
        candidates: videoCandidates(videos.filter((v) => !v.onSite && v.provider === 'youtube' && !v.isShort)),
        onPick: (id) => {
          // Swap: the old video only leaves the site now that a replacement is chosen.
          const next = videos.find((v) => v.id === id)
          toggleVideoOnSite(placed)
          if (next) toggleVideoOnSite(next)
        },
        onRemove: () => toggleVideoOnSite(placed),
        empty: videosPageLink,
        // A YouTube iframe: playback can't be touched from outside, so visual-only.
        controls: buildVideoItemStyleControls('embed'),
      }
    }
    return (
      <ItemEditor
        key={cfg.key}
        artistId={artistId}
        styleKey={cfg.key}
        label={item.label}
        initialClasses={styleValues[cfg.key] ?? ''}
        preview={cfg.preview}
        replace={{
          title: `Replace ${item.label}`,
          candidates: cfg.candidates,
          onPick: cfg.onPick,
          uploader: cfg.uploader,
          empty: cfg.empty,
        }}
        controls={cfg.controls}
        onRemove={() => {
          cfg.onRemove()
          back()
        }}
        swatches={siteColors}
        onApplyStyle={applyItemStyle}
        onBack={back}
      />
    )
  }
  const itemEditor = editingItem ? buildItemEditor(editingItem) : null
  // Same panel slot as the other two, and mutually exclusive with them. Seeded with THIS
  // date's act URLs only — the flat cross-date list is exactly what this replaced.
  const tourEditor = editingTour ? (
    <TourDateEditor
      tour={editingTour.tour}
      label={editingTour.label}
      urls={Object.fromEntries(
        supportLinks.filter((l) => l.tourDateId === editingTour.tour.id).map((l) => [l.name, l.url]),
      )}
      artistId={artistId}
      onBack={() => setEditingTour(null)}
    />
  ) : null
  // Same panel slot as the item editor, and mutually exclusive with it: opening one
  // closes the other, so the panel is never showing two things at once.
  const textEditor = editingText ? (
    <TextFieldEditor
      field={editingText}
      value={textSave.values[editingText.key] ?? ''}
      status={textSave.status}
      styleValues={styleMap}
      styleOptions={styleOptions}
      onEdit={(v) => textSave.edit(editingText.key, v)}
      // Paint AND persist. Unlike the item editor there is no Save button here: a
      // sentence's font is a small, obvious change, and making the manager confirm it
      // would sit oddly beside the words above it, which save as they type.
      onStyle={(regionKey, className) => {
        applyItemStyle(regionKey, className)
        saveTextStyle(regionKey, className)
      }}
      onBack={() => {
        setEditingText(null)
        setFocused(null) // closing the editor deselects — the preview outline goes too
      }}
    />
  ) : null

  // A picker upload already wrote the media row (orientation + on_site=false); append it
  // to the LIBRARY so it shows as a candidate in that orientation's picker right away.
  function addPhoto(m: { id: string; storage_path: string; orientation: Orientation }) {
    setPhotos((list) => (list.some((x) => x.id === m.id) ? list : [...list, { ...m, onSite: false, siteRole: null }]))
  }

  /**
   * Put a photo in a component slot, or clear the slot when `photo` is null. Optimistic:
   * whoever held the role is released first (so the UI can never show one image in two
   * slots), then the new one takes it — mirroring what the action does server-side.
   */
  /** The optimistic half of a slot placement: local state + the frame repaint. Shared
   *  by the normal flow and the session revert (which persists on its own, without the
   *  isPending gate — a revert must not silently skip entries mid-transition). */
  function applySlotOptimistic(role: string, photo: GalleryPhoto | null) {
    setPhotos((list) =>
      list.map((p) => {
        if (p.siteRole === role) return { ...p, siteRole: null, onSite: false }
        if (photo && p.id === photo.id) return { ...p, siteRole: role, onSite: true }
        return p
      }),
    )
    // A just-uploaded photo isn't in the list yet — add it already holding the slot.
    if (photo && !photos.some((p) => p.id === photo.id)) {
      setPhotos((list) => [...list, { ...photo, siteRole: role, onSite: true }])
    }
    // Repaint the frame's slot immediately (`apply-image`) — the persisted write and the
    // revalidate → init-data refresh land behind it. Clearing is left to the refresh:
    // what an EMPTY slot looks like is the template's call, not ours.
    if (photo) onApplyImage?.(role, mediaUrl(photo.storage_path))
  }

  function placeInSlot(role: string, photo: GalleryPhoto | null) {
    if (isPending) return
    journal.record({ kind: 'slot', role, before: photos.find((p) => p.siteRole === role)?.id ?? null })
    const prev = photos
    applySlotOptimistic(role, photo)
    startTransition(async () => {
      const res = await assignComponentSlotAction(artistId, role, photo?.id ?? null)
      if (res?.error) setPhotos(prev)
    })
  }

  // Place a gallery photo into an orientation group: assign its orientation AND put it on
  // the site (one write). This is how a plain uploaded asset gets its orientation — the
  // manager decides it by picking the photo into Horizontal or Vertical. Optimistic.
  function placePhoto(p: GalleryPhoto, orientation: Orientation) {
    setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, orientation, onSite: true } : x)))
    startTransition(async () => {
      const res = await placeGalleryPhotoAction(artistId, p.id, orientation)
      if (res?.error) setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: p.onSite } : x)))
    })
  }
  // Take a placed photo OFF the site, back into the library (never deletes). Optimistic.
  function unplacePhoto(p: GalleryPhoto) {
    setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: false } : x)))
    startTransition(async () => {
      const res = await setOnSiteAction('photo', p.id, artistId, false)
      if (res?.error) setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: true } : x)))
    })
  }
  // Toggle a whole project on/off the site by flipping `on_site` on its songs — the
  // per-song flag is what the site actually gates on. `released` is untouched.
  function toggleProjectOnSite(r: EditorProject) {
    const next = !r.onSite
    setReleases((list) => list.map((x) => (x.key === r.key ? { ...x, onSite: next } : x)))
    startTransition(async () => {
      const res = await setSongsOnSiteAction(artistId, r.songs.map((x) => x.id), next)
      if (res?.error) setReleases((list) => list.map((x) => (x.key === r.key ? { ...x, onSite: !next } : x)))
    })
  }
  function toggleLinkOnSite(l: EditorLink) {
    const next = !l.onSite
    setLinks((list) => list.map((x) => (x.id === l.id ? { ...x, onSite: next } : x)))
    startTransition(async () => {
      const res = await setOnSiteAction('link', l.id, artistId, next)
      if (res?.error) setLinks((list) => list.map((x) => (x.id === l.id ? { ...x, onSite: !next } : x)))
    })
  }
  function toggleVideoOnSite(v: EditorVideo) {
    const next = !v.onSite
    setVideos((list) => list.map((x) => (x.id === v.id ? { ...x, onSite: next } : x)))
    startTransition(async () => {
      const res = await setOnSiteAction('video', v.id, artistId, next)
      if (res?.error) setVideos((list) => list.map((x) => (x.id === v.id ? { ...x, onSite: !next } : x)))
    })
  }
  // Place (or clear) a video in a hero slot. Optimistic so the slot fills immediately —
  // vacate the role's current holder, then set the picked video. Mirrors assignHeroSlotAction.
  function assignHero(role: SiteVideoRole, videoId: string | null) {
    const prev = videos
    setVideos((list) =>
      list.map((x) => {
        // Guard `x.id !== videoId`: re-picking the video ALREADY in this slot would
        // otherwise hit the clear branch first and blank the slot until revalidation.
        if (x.siteRole === role && x.id !== videoId) return { ...x, siteRole: null, onSite: false }
        if (x.id === videoId) return { ...x, siteRole: role, onSite: true }
        return x
      }),
    )
    startTransition(async () => {
      const res = await assignHeroSlotAction(artistId, role, videoId)
      if (res?.error) setVideos(prev)
    })
  }
  function toggleTourOnSite(t: EditorTour) {
    const next = !t.onSite
    setTours((list) => list.map((x) => (x.id === t.id ? { ...x, onSite: next } : x)))
    startTransition(async () => {
      const res = await setOnSiteAction('tour', t.id, artistId, next)
      if (res?.error) setTours((list) => list.map((x) => (x.id === t.id ? { ...x, onSite: !next } : x)))
    })
  }

  function removeLink(l: EditorLink) {
    if (isPending) return
    const prev = links
    setLinks((list) => list.filter((x) => x.id !== l.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('link', l.id, artistId)
      if (res?.error) setLinks(prev)
    })
  }

  /** Reorder by ID, not by index: the panel renders links in TWO lists (Socials and
   *  Contact), so a row's index within its own list is not its index in `links`. */
  function reorderLinks(fromId: string, toId: string) {
    if (isPending) return
    const from = links.findIndex((l) => l.id === fromId)
    const to = links.findIndex((l) => l.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const prev = links
    const next = reorderList(links, from, to)
    setLinks(next) // optimistic
    startTransition(async () => {
      const res = await reorderContentAction('link', artistId, next.map((l) => l.id))
      if (res?.error) setLinks(prev)
    })
  }

  // Videos are placed into slots from the library (VideoTools), not deleted/reordered
  // here — deleting a video for good is a Videos-page action, and the band orders by
  // sort_order — so the editor no longer needs removeVideo/reorderVideos.

  function removeMerch(m: EditorMerch) {
    if (isPending) return
    const prev = merch
    setMerch((list) => list.filter((x) => x.id !== m.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('merch', m.id, artistId)
      if (res?.error) setMerch(prev)
    })
  }

  function removeTour(t: EditorTour) {
    if (isPending) return
    const prev = tours
    setTours((list) => list.filter((x) => x.id !== t.id)) // optimistic
    startTransition(async () => {
      const res = await deleteContentAction('tour_date', t.id, artistId)
      if (res?.error) setTours(prev)
    })
  }

  /**
   * Reorder the UNDATED shows. Dated ones are left out of the persisted list entirely:
   * their sort_order is never consulted (date decides), and renumbering them here would
   * quietly overwrite values for no benefit. The optimistic update rebuilds the list
   * with the dragged row moved, keeping dated rows where the date sort put them.
   */
  function reorderTours(fromId: string, toId: string) {
    if (isPending) return
    const undated = tours.filter((t) => !t.date)
    const from = undated.findIndex((t) => t.id === fromId)
    const to = undated.findIndex((t) => t.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const moved = reorderList(undated, from, to)
    const prev = tours
    // Splice the new undated order back into the full list, in place.
    let next = 0
    setTours(tours.map((t) => (t.date ? t : moved[next++])))
    startTransition(async () => {
      const res = await reorderContentAction('tour_date', artistId, moved.map((t) => t.id))
      if (res?.error) setTours(prev)
    })
  }

  return (
    <aside className="flex w-[344px] flex-none flex-col overflow-hidden border-r border-hairline bg-paper font-space">
      {itemEditor ? (
        itemEditor
      ) : textEditor ? (
        textEditor
      ) : tourEditor ? (
        tourEditor
      ) : active ? (
        <EditingView
          component={active}
          photos={photos}
          assetBudgets={assetBudgets}
          imageFields={imageFields}
          focusedKey={focused ? selectTargetKey(focused) : null}
          onFocus={setFocused}
          onEditItem={setEditingItem}
          textFields={textFields}
          textValues={textSave.values}
          textStatus={textSave.status}
          onEditTextField={(f) => {
            setEditingItem(null) // one editor in the panel at a time
            setEditingTour(null)
            setEditingText(f)
            // Panel → preview: the outline follows the selection, so opening a field
            // from the list highlights (and scrolls to) the words it edits.
            setFocused({ kind: 'field', key: f.key })
          }}
          onEditTour={(t) => {
            setEditingItem(null) // one editor in the panel at a time
            setEditingText(null)
            setEditingTour(t)
          }}
          links={links}
          videos={videos}
          videoSlots={videoSlots}
          merch={merch}
          releases={releases}
          tours={tours}
          artistId={artistId}
          onAddPhoto={addPhoto}
          onPlacePhoto={placePhoto}
          onUnplacePhoto={unplacePhoto}
          onToggleProjectOnSite={toggleProjectOnSite}
          onToggleLinkOnSite={toggleLinkOnSite}
          onToggleVideoOnSite={toggleVideoOnSite}
          onAssignHero={assignHero}
          onToggleTourOnSite={toggleTourOnSite}
          onRemoveTour={removeTour}
          onReorderTour={reorderTours}
          components={components}
          showGallery={showGallery}
          onPlaceSlot={placeInSlot}
          onRemoveLink={removeLink}
          onReorderLink={reorderLinks}
          onRemoveMerch={removeMerch}
          styleRegions={styleRegions}
          styleValues={styleValues}
          styleOptions={styleOptions}
          selectedStyle={styleFocus}
          linkRegions={linkRegions}
          linkValues={linkValues}
          selectedLink={selectedLink}
          cursorValues={cursorValues}
          onApplyField={paintField}
          onApplyStyle={paintStyle}
          onApplyLink={paintLink}
          onApplyCursor={onApplyCursor}
          onBack={() => selectComponent(null)}
          onSwitch={selectComponent}
        />
      ) : (
        <BrowseView onOpen={selectComponent} />
      )}
      {/* The session's Save / Cancel pair: Cancel walks every touched key back to its
          session-start value; Save accepts the session (edits already autosaved to the
          DRAFT, so Save clears the ledger — nothing is pushed live until Publish).
          Hidden at zero, and while the ITEM editor is open (its own pair owns that
          surface). */}
      {!itemEditor && !textEditor && !tourEditor && journal.count > 0 && (
        <SessionActions
          entries={journal.entries}
          busy={reverting}
          onCancel={revertSession}
          onSave={() => journal.clear()}
        />
      )}
    </aside>
  )
}

/** A friendly label for one journal entry, for the confirm list. */
function entryLabel(e: JournalEntry): string {
  const noun: Record<JournalEntry['kind'], string> = {
    style: 'Style', field: 'Text', link: 'Link', slot: 'Image',
  }
  const key = 'key' in e ? e.key : e.role
  return `${noun[e.kind]} · ${key.replace(/_/g, ' ')}`
}

const SKIP_SAVE_CONFIRM = 'lse:skip-save-confirm'

/* ── Session Save / Cancel, with a Confirm-changes dialog ────────────────────── */
function SessionActions({
  entries,
  busy,
  onCancel,
  onSave,
}: {
  entries: JournalEntry[]
  busy: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  // Deduplicate: several edits to one key are one line in the list.
  const changes = Array.from(new Map(entries.map((e) => [entryLabel(e), e])).values())

  const commit = () => {
    setConfirming(false)
    onSave()
  }
  const requestSave = () => {
    const skip = typeof window !== 'undefined' && window.localStorage.getItem(SKIP_SAVE_CONFIRM) === '1'
    if (skip) commit()
    else setConfirming(true)
  }

  return (
    <>
      <div className="flex gap-2 border-t border-hairline px-4 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted transition-colors enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
        >
          {busy ? 'Cancelling…' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={requestSave}
          disabled={busy}
          className="flex-1 rounded-lg border border-ink bg-ink px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          Save
        </button>
      </div>

      {confirming && (
        <SaveConfirm
          changes={changes}
          onConfirm={commit}
          onDismiss={() => setConfirming(false)}
        />
      )}
    </>
  )
}

function SaveConfirm({
  changes,
  onConfirm,
  onDismiss,
}: {
  changes: JournalEntry[]
  onConfirm: () => void
  onDismiss: () => void
}) {
  const [dontAsk, setDontAsk] = useState(false)
  const confirm = () => {
    if (dontAsk && typeof window !== 'undefined') window.localStorage.setItem(SKIP_SAVE_CONFIRM, '1')
    onConfirm()
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm changes"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-hairline bg-paper p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Confirm changes</h2>
        <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
          {changes.map((e, i) => (
            <li key={i} className="flex items-center gap-2 font-space text-[12px] text-ink-muted">
              <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-hidden />
              {entryLabel(e)}
            </li>
          ))}
        </ul>
        <label className="mt-4 flex items-center gap-2 font-space text-[11px] text-ink-faint">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} className="accent-ink" />
          Don&apos;t ask me to confirm again
        </label>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:border-ink hover:text-ink"
          >
            Back
          </button>
          <button
            type="button"
            onClick={confirm}
            className="flex-1 rounded-lg border border-ink bg-ink px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-paper hover:opacity-85"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Browse: the component-type list ─────────────────────────────────────────── */
function BrowseView({ onOpen }: { onOpen: (c: Component) => void }) {
  return (
    // A GRID of the editable options — no header (Sam, 2026-08-12): the icons are the
    // whole home screen. Icon + label turn accent on hover, together.
    <div className={cx(SCROLL_BODY, 'p-3')}>
      <div className="grid grid-cols-3 gap-2">
        {COMPONENTS.map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => onOpen(c)}
            aria-label={c.label}
            className="group flex flex-col items-center gap-2 rounded-xl border border-hairline-soft px-2 py-4 text-ink-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Icon name={c.icon} size={22} />
            <span className="text-[12px] font-medium leading-none text-ink group-hover:text-accent">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Editing: tools for the selected component ───────────────────────────────── */
function EditingView({
  component,
  photos,
  assetBudgets,
  imageFields,
  focusedKey,
  onFocus,
  onEditItem,
  textFields,
  textValues,
  textStatus,
  onEditTextField,
  links,
  onEditTour,
  videos,
  videoSlots,
  merch,
  releases,
  tours,
  artistId,
  onAddPhoto,
  onPlacePhoto,
  onUnplacePhoto,
  onToggleProjectOnSite,
  onToggleLinkOnSite,
  onToggleVideoOnSite,
  onAssignHero,
  onToggleTourOnSite,
  onRemoveTour,
  onReorderTour,
  components,
  showGallery,
  onPlaceSlot,
  onRemoveLink,
  onReorderLink,
  onRemoveMerch,
  styleRegions,
  styleValues,
  styleOptions,
  selectedStyle,
  linkRegions,
  linkValues,
  selectedLink,
  cursorValues,
  onApplyField,
  onApplyStyle,
  onApplyLink,
  onApplyCursor,
  onBack,
  onSwitch,
}: {
  component: Component
  photos: GalleryPhoto[]
  imageFields: EditorImageField[]
  /** selectTargetKey of the focused image region, so a tile can ring itself. */
  focusedKey: string | null
  /** Focus a region (a tile click) — highlights it in the frame via the parent's effect. */
  onFocus: (target: SelectTarget) => void
  /** Open one image/video in the full-panel editor (its Edit button). */
  onEditItem: (item: ItemEdit) => void
  textFields: EditorTextField[]
  /** Text state is owned by the inspector (one source for the list AND the full-panel
   *  editor), so this view renders it rather than holding it. */
  textValues: Record<string, string>
  textStatus: SaveStatus
  onEditTextField: (field: EditorTextField) => void
  links: EditorLink[]
  /** Open one show full-panel (its supporting acts and their links). */
  onEditTour: (t: { tour: EditorTour; label: string }) => void
  videos: EditorVideo[]
  videoSlots: ManifestVideoSlot[]
  merch: EditorMerch[]
  releases: EditorProject[]
  tours: EditorTour[]
  artistId: string
  onAddPhoto: (m: { id: string; storage_path: string; orientation: Orientation }) => void
  onPlacePhoto: (p: GalleryPhoto, orientation: Orientation) => void
  onUnplacePhoto: (p: GalleryPhoto) => void
  onToggleProjectOnSite: (r: EditorProject) => void
  onToggleLinkOnSite: (l: EditorLink) => void
  onToggleVideoOnSite: (v: EditorVideo) => void
  onAssignHero: (role: SiteVideoRole, videoId: string | null) => void
  onToggleTourOnSite: (t: EditorTour) => void
  onRemoveTour: (t: EditorTour) => void
  onReorderTour: (fromId: string, toId: string) => void
  components: ManifestComponent[]
  assetBudgets?: AssetBudgets
  showGallery: boolean
  onPlaceSlot: (role: string, photo: GalleryPhoto | null) => void
  onRemoveLink: (l: EditorLink) => void
  onReorderLink: (fromId: string, toId: string) => void
  onRemoveMerch: (m: EditorMerch) => void
  styleRegions: ManifestStyleRegion[]
  styleValues: Record<string, string>
  styleOptions?: SiteStyleOptions
  selectedStyle: string | null
  linkRegions: ManifestLinkRegion[]
  linkValues: Record<string, string>
  selectedLink: string | null
  cursorValues: Record<string, string>
  onApplyField?: (key: string, value: string) => void
  onApplyStyle?: (key: string, className: string) => void
  onApplyLink?: (key: string, url: string) => void
  onApplyCursor?: (settings: CursorSettings) => void
  onBack: () => void
  onSwitch: (c: Component) => void
}) {
  const isImages = component.kind === 'images'
  const isText = component.kind === 'text'
  const isLinks = component.kind === 'links'
  const isVideos = component.kind === 'videos'
  const isMerch = component.kind === 'merch'
  const isMusic = component.kind === 'music'
  const isTour = component.kind === 'tour'
  const isStyle = component.kind === 'style'
  const isSite = component.kind === 'site'
  return (
    <>
      {/* A compact top bar (Sam, 2026-08-12, "bar B"): a black X back to the grid, plus
          the panel's name so the row earns its space instead of the X floating alone. */}
      <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Close"
          className="flex h-6 w-6 flex-none items-center justify-center rounded-md text-ink hover:bg-surface"
        >
          <Icon name="close" size={16} />
        </button>
        <span className="font-space text-[11px] font-bold uppercase tracking-[0.08em] text-ink">
          {component.label}
        </span>
      </div>

      <div className={SCROLL_BODY}>
        {isImages ? (
          <PhotoTools
            photos={photos}
            imageFields={imageFields}
            focusedKey={focusedKey}
            onFocus={onFocus}
            onEditItem={onEditItem}
            components={components}
            showGallery={showGallery}
            assetBudgets={assetBudgets}
            artistId={artistId}
            onAdd={onAddPhoto}
            onPlace={onPlacePhoto}
            onUnplace={onUnplacePhoto}
            onPlaceSlot={onPlaceSlot}
            onApplyField={onApplyField}
          />
        ) : isText ? (
          <TextTools
            textFields={textFields}
            values={textValues}
            status={textStatus}
            onEditField={onEditTextField}
          />
        ) : isLinks ? (
          // One Links panel, grouped by purpose: outbound social links, tour-support
          // links, then the site's declared link buttons (USB / Merch).
          <>
            <GroupLabel>Socials</GroupLabel>
            <LinkTools
              links={links.filter((l) => !isContactish(l.url))}
              group="Social"
              artistId={artistId}
              onRemove={onRemoveLink}
              onReorder={onReorderLink}
              onToggleOnSite={onToggleLinkOnSite}
              inferPlatform
              focusedKey={focusedKey}
            />
            {/* A booking address is a contact route, not a profile to follow, so it gets
                its own group instead of sitting among the socials. Split by SCHEME
                (mailto:/tel:), not by label — the link says what it is. */}
            {links.some((l) => isContactish(l.url)) && (
              <>
                <GroupLabel>Contact</GroupLabel>
                <LinkTools
                  links={links.filter((l) => isContactish(l.url))}
                  group="Contact"
                  artistId={artistId}
                  onRemove={onRemoveLink}
                  onReorder={onReorderLink}
                  onToggleOnSite={onToggleLinkOnSite}
                  showAdd={false}
                />
              </>
            )}
            {/* "Tour support" lived here as a flat list of every act across every date,
                each row captioned with which show it belonged to — a fact about a show,
                filed away from the show. It moved into the Tour panel's per-date editor
                (Sam, 2026-08-09), where the act names already are. */}
            <GroupLabel>Buttons</GroupLabel>
            <SiteLinkTools
              regions={linkRegions}
              values={linkValues}
              selected={selectedLink}
              artistId={artistId}
              onApplyLink={onApplyLink}
            />
          </>
        ) : isVideos ? (
          <VideoTools
            focusedKey={focusedKey}
            videos={videos}
            videoSlots={videoSlots}
            artistId={artistId}
            onToggleOnSite={onToggleVideoOnSite}
            onAssignHero={onAssignHero}
            onEditItem={onEditItem}
          />
        ) : isTour ? (
          <TourTools
            tours={tours}
            artistId={artistId}
            onRemove={onRemoveTour}
            onReorder={onReorderTour}
            onToggleOnSite={onToggleTourOnSite}
            onEditTour={(t, label) => onEditTour({ tour: t, label })}
            focusedKey={focusedKey}
            onFocus={onFocus}
          />
        ) : isMerch ? (
          <MerchTools merch={merch} artistId={artistId} onRemove={onRemoveMerch} />
        ) : isMusic ? (
          <MusicTools
            releases={releases}
            artistId={artistId}
            onToggleOnSite={onToggleProjectOnSite}
            focusedKey={focusedKey}
            onFocus={onFocus}
          />
        ) : isStyle ? (
          <StyleTools
            regions={styleRegions}
            values={styleValues}
            options={styleOptions}
            selected={selectedStyle}
            artistId={artistId}
            onApplyStyle={onApplyStyle}
          />
        ) : isSite ? (
          <SiteTools
            artistId={artistId}
            photos={photos}
            values={cursorValues}
            swatches={siteSwatches(styleOptions, styleValues)}
            budget={budgetFor(assetBudgets, 'image')}
            onApplyCursor={onApplyCursor}
          />
        ) : (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Editing tools for {component.label} are coming next.
          </p>
        )}
      </div>

      {/* The component switcher strip stays on a specific tab (Sam, 2026-08-12: only
          the LANDING view became a grid) — jump straight between panels without
          returning to the grid. */}
      <div className="flex items-center justify-between gap-0.5 border-t border-hairline bg-surface px-4 py-2.5">
        {COMPONENTS.map((c) => (
          <button
            key={c.kind}
            type="button"
            aria-label={c.label}
            aria-current={c.kind === component.kind ? 'true' : undefined}
            onClick={() => onSwitch(c)}
            className={cx(
              'flex h-8 w-9 items-center justify-center rounded-lg transition-colors',
              c.kind === component.kind
                ? 'bg-accent-soft text-accent'
                : 'text-ink-faint hover:bg-paper hover:text-ink',
            )}
          >
            <Icon name={c.icon} size={17} />
          </button>
        ))}
      </div>
    </>
  )
}

