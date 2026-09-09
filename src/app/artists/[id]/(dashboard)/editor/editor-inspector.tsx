'use client'

import type { MediaKind } from '@samfox1/site-bridge/payload'
import type { ManifestAbout } from '@samfox1/site-bridge/seo'
import { EMPTY_FACTS, type ArtistFacts, type SiteTextField } from './panels/site-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx } from '@/lib/cx'
import { GroupLabel, SCROLL_BODY } from './inspector-shared'
import { reorderList, type Orientation } from '@/lib/site-editor/gallery'
import { type RegionMeasurements, type SelectTarget, selectTargetKey } from '@samfox1/site-bridge/protocol'
import {
  componentSlotRole,
  type ManifestComponent,
  type ManifestVideoSlot,
  type ManifestLinkRegion,
  type ManifestStyleRegion,
} from '@/lib/site-editor/manifest'
import type { DroppedRegion } from '@samfox1/site-bridge/manifest'
import { type EditorStyleOptions } from '@/lib/site-editor/style-controls'
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
import { ItemEditor } from './item-editor'
import { buildItemEditorConfig } from './item-editor-config'
import { budgetFor, type AssetBudgets } from '@/lib/site-editor/asset-budget'
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
  setMediaLabelAction,
  setMediaAltAction,
  setMediaKindAction,
  renameMediaAction,
  saveArtistFactAction,
  saveSeoFieldAction,
  setOnSiteAction,
} from '../actions'
import { useOptimisticRunner } from './use-optimistic'
import { useSessionRevert } from './use-session-revert'
import { useSignal } from './use-signal'
import { useTextFieldSave } from './use-text-save'
import { useDebouncedFieldSave } from './use-debounced-field-save'
import { useStyleRegionSave } from './use-style-save'
import { TextFieldEditor } from './text-field-editor'
import { TourDateEditor } from './tour-date-editor'
import { MerchEditor } from './merch-editor'

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
/** Stable empty default, for the same reason NO_STYLES is one: a fresh `[]` per render is
 *  a new identity in every dependency array that reads it. */
const NO_DROPPED: DroppedRegion[] = []

/** The SEO/GEO editor's debounce key: the store rides in the key because the hook keys
 *  its timers by one string and the write may run after the editor has closed. */
const siteFieldKey = (f: Pick<SiteTextField, 'store' | 'key'>) => `${f.store}:${f.key}`
const parseSiteFieldKey = (storeKey: string): Pick<SiteTextField, 'store' | 'key'> => {
  const i = storeKey.indexOf(':')
  return { store: storeKey.slice(0, i) as SiteTextField['store'], key: storeKey.slice(i + 1) }
}

/** Shown when the connected site was built against an OLDER bridge than the editor: a
 *  control here can write a token the site's applier can't lift yet, so a slider may do
 *  nothing on the live site until it is republished. A STATUS line, not an instruction —
 *  it names why an edit isn't showing so the manager isn't left guessing (Sam, 2026-08-13). */
/**
 * A region key the site declared twice — the SURFACE half of the duplicate-key guard
 * (SITE_PAGES_PLAN.md A6 / N3).
 *
 * Region keys are one flat namespace across every page (D3), so two pages naming the same
 * region share one stored row: restyle one and the other changes. The D4 merge has always
 * DETECTED this and resolved it first-wins; until now it told nobody, so the symptom
 * reached a manager with no explanation attached.
 *
 * A banner, not a block: the editor works, the region is still editable, and first-wins is
 * a defensible resolution. What was missing was anyone being told — and the editor is the
 * only place that sees every page of a live site at once.
 *
 * `role="status"`, not `alert`: it is a standing condition of the site, not an event.
 */
function DroppedRegionsBanner({ dropped }: { dropped: DroppedRegion[] }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-hairline bg-surface px-4 py-2.5 text-[11px] leading-snug text-ink-muted"
    >
      <span className="mt-px flex-none text-status-pending" aria-hidden>
        <Icon name="alert" size={13} />
      </span>
      <span>
        {dropped.map((d) => {
          // Named once when both sides are the same page — that is the copy-paste-in-the
          // registry case, and "on merch and on merch" reads as a bug in the message.
          const where =
            d.keptPage && d.page && d.keptPage !== d.page
              ? `${d.keptPage} and ${d.page}`
              : (d.keptPage ?? d.page ?? 'this site')
          return (
            <span key={`${d.kind}:${d.key}:${d.page ?? ''}`} className="block">
              “{d.key}” is declared twice ({where}). Both share one saved style — renaming
              one in the site’s code separates them.
            </span>
          )
        })}
      </span>
    </div>
  )
}

function BridgeOutdatedBanner() {
  return (
    <div className="flex items-start gap-2 border-b border-hairline bg-surface px-4 py-2.5 text-[11px] leading-snug text-ink-muted">
      <span className="mt-px flex-none text-status-pending" aria-hidden>
        <Icon name="alert" size={13} />
      </span>
      <span>Preview site is on an older version. Some controls won’t take effect until it’s republished.</span>
    </div>
  )
}

export function EditorInspector({
  artistId,
  bridgeOutdated = false,
  droppedRegions = NO_DROPPED,
  itemPages,
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
  imageCollections = [],
  itemStyling = true,
  assetBudgets,
  styleRegions = [],
  styleValues = NO_STYLES,
  styleOptions,
  hasUnpublished = false,
  selectedStyle = null,
  deselectedAt = 0,
  linkRegions = [],
  linkValues = {},
  selectedLink = null,
  selectedRegion = null,
  measuredRegion = null,
  onRequestMeasure,
  cursorValues = NO_STYLES,
  seoValues = NO_STYLES,
  artistFacts,
  manifestAbout = null,
  onApplyField,
  onApplyImage,
  onApplyStyle,
  onApplyLink,
  onApplyCursor,
  onHighlight,
  onClearHighlight,
}: {
  artistId: string
  /** The connected site was built against an OLDER bridge than the editor — a newly added
   *  control can emit a token its bundled applier can't lift yet, so show a "republish to
   *  apply" note instead of letting a slider silently do nothing. */
  bridgeOutdated?: boolean
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
  /** Region keys the frame declared twice, from the D4 merge (`useFrameBridge`). Surfaced
   *  as a banner — detected-and-silent is where this bug started (N3). */
  droppedRegions?: DroppedRegion[]
  /** Which page each library type's items live on (panel-inputs `itemPages`, P4). An
   *  item highlight names its page from this so the frame can travel first. */
  itemPages?: Partial<Record<string, string>>
  components?: ManifestComponent[]
  /** The open photo pools the site DECLARES (its image slots), in order — one grid each
   *  in the Images panel. Defaults EMPTY: a group is shown because the site asked for
   *  it, never just because the editor can render one. */
  imageCollections?: readonly { key: string; label: string }[]
  /** False when the site declares `itemStyling: false` (a fully locked look, ftbk):
   *  gallery tiles offer Replace, never the per-item style editor. */
  itemStyling?: boolean
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
  styleOptions?: EditorStyleOptions
  /** The draft differs from the last published edition (computed server-side). Keeps
   *  Revert changes visible across refreshes — the in-memory ledger dies with the tab,
   *  but the CHANGES don't (Sam, 2026-08-17: the divider stayed off after a refresh
   *  while the button vanished). */
  hasUnpublished?: boolean
  /** Region the frame reported a click on — jumps the panel to Style, focused there.
   *  Key + nonce so a repeat click on the same region re-fires (the Listen lesson). */
  selectedStyle?: { key: string; nonce: number; measured?: RegionMeasurements } | null
  /** Ticks when a preview click hit nothing editable — panels collapse whatever row is
   *  open (Sam, 2026-08-14). A counter, not a flag: consecutive clicks are separate
   *  events, and a boolean would only ever fire once. */
  deselectedAt?: number
  /** The frame's answer to the last `measure` request (bridge 0.25.2). */
  measuredRegion?: { key: string; measured: RegionMeasurements } | null
  /** Ask the frame to measure one region — item editors call it on open so their
   *  sliders park on what the element actually renders. */
  onRequestMeasure?: (key: string) => void
  /** Link-powered elements the site declared (USB/Merch buttons). From the FRAME's
   *  manifest at runtime for a custom site; [] for built-in templates. */
  linkRegions?: ManifestLinkRegion[]
  /** Current URL for each link region, keyed by its role (from the DB). */
  linkValues?: Record<string, string>
  /** Link region the frame reported a click on — jumps to the Site-links panel. */
  selectedLink?: { key: string; nonce: number } | null
  /** Image region (field / slot / gallery item) the frame reported a click on — opens the
   *  Images panel and focuses the matching tile. Bumped `nonce` re-fires on a repeat click. */
  selectedRegion?: { target: SelectTarget; nonce: number } | null
  /** Current cursor settings from the draft's site_content (Site panel). */
  cursorValues?: Record<string, string>
  /** SEO keys off the draft's site_content (Site panel, SEO_GEO_PLAN B6). */
  seoValues?: Record<string, string>
  artistFacts?: ArtistFacts
  manifestAbout?: ManifestAbout | null
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
  /** Outline a region in the preview. The second argument is the PAGE it lives on, for a
   *  region the frame is not currently showing: the hook asks the frame to travel there
   *  and fires the highlight when it arrives. Absent = wherever the frame already is. */
  onHighlight?: (target: SelectTarget, page?: string) => void
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
  // The optimistic apply→persist→rollback rule, ONE home (use-optimistic.ts). Guarded
  // ops share isPending; the on/off toggles pass guard:false (see the hook's docblock).
  const { isPending, run } = useOptimisticRunner()

  // Clicking a styled region in the site opens the Style tools on it. This is the
  // whole point of the embedded-frame model (SITE_EDITOR_PLAN.md): click the thing,
  // edit the thing — rather than hunting for it in a list.
  //
  // Adjusted DURING RENDER rather than in an effect: React re-runs this component
  // immediately without painting the stale panel, whereas a setState inside an
  // effect cascades an extra render (and the lint rule rightly rejects it). Same
  // sanctioned "reset state on prop change" pattern as use-on-site-selection.

  // The full-panel editors, declared ABOVE every select branch because each branch must
  // be able to dismiss them: they render over `active`, so a routed select that leaves
  // one open changes a panel the manager never sees (the 2026-08-09 editingTour lesson —
  // repeated on 2026-08-18 by the STYLE channel, which predated closeEditors).
  //
  // The one image/video handed the whole panel for editing (Replace / Remove / styling).
  const [editingItem, setEditingItem] = useState<ItemEdit | null>(null)
  // The one TEXT field handed the whole panel (the words + their type controls). Held
  // separately from editingItem because it carries no media and shares none of that
  // editor's Replace/Remove machinery.
  const [editingText, setEditingText] = useState<EditorTextField | null>(null)
  /** The SEO/GEO text field open full-panel, and what has been typed into these rows this
   *  session. The overrides exist because the Site panel is UNMOUNTED while the editor is
   *  open — without them, backing out would redraw the snippet from the draft the page was
   *  rendered with, and the edit would look like it did nothing until a refresh. */
  const [editingSite, setEditingSite] = useState<SiteTextField | null>(null)
  /** Keyed by STORE, then key — the descriptor says where a field lives, and nothing here
   *  re-derives that from the key's spelling (the review, 2026-09-09, found the first
   *  version guessing `seo_` prefixes, which is exactly what `store` exists to end). */
  const [siteEdits, setSiteEdits] = useState<Record<SiteTextField['store'], Record<string, string>>>({ seo: {}, fact: {} })
  // The one TOUR DATE handed the whole panel (its supporting acts and their links). A
  // third state rather than a branch of ItemEdit: that union is media-shaped —
  // preview, Replace, Remove — and a show has none of those.
  const [editingTour, setEditingTour] = useState<{ tour: EditorTour; label: string } | null>(null)
  // The one MERCH ITEM handed the whole panel (name / price / link / stock) — the grid's
  // Edit button opens it (Sam, 2026-08-18). Held by ID, not row: the row snapshot would
  // go stale the moment a debounced save refreshes the list under it.
  const [editingMerchId, setEditingMerchId] = useState<string | null>(null)
  // ONE dismissal for every routed select, so the next editor added here cannot be
  // missed by one of the branches.
  const closeEditors = () => {
    setEditingItem(null)
    setEditingText(null)
    setEditingTour(null)
    setEditingMerchId(null)
  }

  // The CLICK FOCUS: while set, the Style panel shows only this region's controls.
  // Cleared by any manual tab click (selectComponent) — visiting the Style tab by
  // hand is browsing, and browsing shows site-wide styles only, never a leftover
  // element (Sam, 2026-08-12).
  const [styleFocus, setStyleFocus] = useState<string | null>(null)
  // What the clicked element renders (bridge 0.25.0) — rides beside the focus so the
  // focused region's sliders park on measured reality, not a class-string guess.
  const [styleMeasured, setStyleMeasured] = useState<RegionMeasurements | null>(null)
  useSignal(selectedStyle, (s) => {
    closeEditors()
    setStyleFocus(s.key)
    setStyleMeasured(s.measured ?? null)
    setActive(COMPONENTS.find((c) => c.kind === 'style') ?? null)
  })

  // Same click-the-thing behaviour for a link-powered element: selecting skeen's USB
  // button in the frame opens the Links panel (its "Buttons" group) focused on it.
  useSignal(selectedLink, () => {
    closeEditors()
    setActive(COMPONENTS.find((c) => c.kind === 'links') ?? null)
  })

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

  /** Which page a declared region lives on, for the regions that say. Built from the
   *  panel inputs rather than held as state: the page is a property of the FIELD, and a
   *  second copy in the inspector is a second thing that can be stale. Only fields carry
   *  one today — the other categories join as their panels learn about pages. */
  const pageOfKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of textFields) if (f.page) m.set(f.key, f.page)
    return m
  }, [textFields])

  // Editor → frame: whenever the focused region changes, outline it in the preview (or
  // clear it). A real side effect (postMessage), so it lives in an effect, not in render.
  //
  // The PAGE rides along (Sam, 2026-09-09). There are no page tabs: opening a row for
  // copy that lives on /about IS how a manager gets to /about, so the highlight names the
  // page and the hook does the travelling. A region on the page already showing passes
  // none, which is every region on every single-page site.
  useEffect(() => {
    if (!focused) {
      onClearHighlight?.()
      return
    }
    // A field's page comes from the field; an ITEM's from the slot that holds its type
    // (P4) — the Merch panel's card is `item:merch:<id>`, and merch lives wherever the
    // merch slot said.
    const page =
      focused.kind === 'field'
        ? pageOfKey.get(focused.key)
        : focused.kind === 'item'
          ? itemPages?.[focused.assetType]
          : undefined
    // Called with ONE argument when there is no page, not with an explicit `undefined`:
    // every existing caller and its tests were written against the one-argument contract,
    // and a trailing undefined is a silent change to all of them.
    if (page) onHighlight?.(focused, page)
    else onHighlight?.(focused)
  }, [focused, onHighlight, onClearHighlight, pageOfKey, itemPages])

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
    setStyleMeasured(null)
  }

  /** The per-item style-region key an ItemEdit paints at — the same shapes
   *  buildItemEditor uses (`slot:<role>` / `image:<id>` / `video:<id>`). */
  const itemStyleKey = (it: ItemEdit): string =>
    it.type === 'imageSlot' || it.type === 'videoSlot'
      ? `slot:${it.role}`
      : it.type === 'galleryPhoto'
        ? `image:${it.id}`
        : `video:${it.id}`

  // MEASURE ON OPEN (bridge 0.25.2): the transparency slider on the hero backdrop
  // parked mid-scale because the item's real 40% opacity lives in site code, invisible
  // to any class-string reader — and a panel-opened editor has no frame click to carry
  // a measurement. So the editor ASKS: the frame measures the region's element and the
  // sliders park on the answer.
  const editingItemKey = editingItem ? itemStyleKey(editingItem) : null
  useEffect(() => {
    if (editingItemKey) onRequestMeasure?.(editingItemKey)
  }, [editingItemKey, onRequestMeasure])

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

  // Frame → editor: a click on a marked region opens ITS panel. Images focus their
  // tile; a TEXT field opens straight into its field editor (the panel list alone would
  // leave the manager hunting for the thing they just pointed at); an item lands on its
  // panel with `focused` carrying the outline. Style / link selects route via their own
  // signals above. Returning false leaves an UNROUTABLE select unconsumed, so a select
  // racing its data (a text-field click before the fields fetch lands) fires late
  // instead of vanishing.
  useSignal(selectedRegion, ({ target }) => {
    const textField =
      target.kind === 'field' ? textFields.find((f) => f.key === target.key) : undefined
    const itemPanel = target.kind === 'item' ? PANEL_BY_ASSET[target.assetType] : undefined
    // A routed select DISMISSES whatever full-panel editor is open (closeEditors above),
    // in every branch, before opening what it asked for.
    if (isImageRegion(target)) {
      closeEditors()
      setActive(COMPONENTS.find((c) => c.kind === 'images') ?? null)
      setFocused(target)
    } else if (textField) {
      closeEditors()
      setActive(COMPONENTS.find((c) => c.kind === 'text') ?? null)
      setEditingText(textField) // …then open the one this select asked for
      setFocused(target)
    } else if (itemPanel) {
      closeEditors()
      setActive(COMPONENTS.find((c) => c.kind === itemPanel) ?? null)
      setFocused(target)
    } else {
      return false // unroutable — leave the signal for a later render
    }
  })
  // Text values live HERE, above both the list and the editor, so the two windows onto
  // one field can never show different text or race each other's debounced save.
  const textSave = useTextFieldSave(artistId, textFields, onApplyField)
  /**
   * The SEO/GEO editor's save. Debounced like the text editor's, and routed by the
   * descriptor's `store` — `seo_*` through the SEO gate into site_content, `genre` and
   * `location` onto the artist row. Guessing that from the key would write a site_content
   * row nothing reads (the ftbk bug, 2026-08-20), which is why the row hands it up.
   */
  const siteTextSave = useDebouncedFieldSave<string>({
    // The debounce key is `<store>:<key>` (see `siteFieldKey`): the hook keys its timers
    // by one string, and the store has to survive the debounce — the editor may be closed
    // by the time the write runs, so it cannot be read off `editingSite` then.
    persist: (storeKey, value) => {
      const { store, key } = parseSiteFieldKey(storeKey)
      const run =
        store === 'seo'
          ? saveSeoFieldAction(artistId, key, value)
          : saveArtistFactAction(artistId, key as keyof ArtistFacts, value)
      return run.then((r) => ({ ok: r.ok, error: r.error }))
    },
  })
  // The SAME save path the Style panel uses, so a font set from a text field and one set
  // from the Style panel cannot disagree about what is stored or drift in debounce.
  const { save: saveTextStyle } = useStyleRegionSave(artistId, onApplyStyle)

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
  // Revert changes — journal + paint wrappers + the published-first walk, one module
  // (use-session-revert.ts). The paints RECORD, so every panel must apply through them.
  const { paintField, paintStyle, paintLink, recordSlot, revertSession, reverting, journalCount } =
    useSessionRevert({
      artistId,
      textFields,
      styleValues,
      linkValues,
      linkRegions,
      photos,
      applySlotOptimistic,
      onApplyField,
      onApplyStyle,
      onApplyLink,
    })

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


  // A picker upload already wrote the media row (orientation + on_site=false); append it
  // to the LIBRARY so it shows as a candidate in that orientation's picker right away.
  function addPhoto(m: { id: string; storage_path: string; orientation: Orientation }) {
    setPhotos((list) => (list.some((x) => x.id === m.id) ? list : [...list, { ...m, onSite: false, siteRole: null, collection: null, label: null, alt: null, kind: null }]))
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
    recordSlot(role, photos.find((p) => p.siteRole === role)?.id ?? null)
    const prev = photos
    run({
      apply: () => applySlotOptimistic(role, photo),
      persist: () => assignComponentSlotAction(artistId, role, photo?.id ?? null),
      rollback: () => setPhotos(prev),
    })
  }

  // Place a gallery photo into a COLLECTION: assign its orientation, tag which pool it
  // fills, and put it on the site (one write). This is how a plain uploaded asset gets
  // its orientation — the manager decides it by picking the photo into a grid.
  // Optimistic.
  function placePhoto(p: GalleryPhoto, orientation: Orientation, collection?: string) {
    // An omitted collection LEAVES the tag alone (the item editor's Replace: the new
    // photo takes the old one's place, in the pool that place belongs to).
    const tag = collection === undefined ? {} : { collection }
    run({
      guard: false,
      apply: () =>
        setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, orientation, ...tag, onSite: true } : x))),
      persist: () => placeGalleryPhotoAction(artistId, p.id, orientation, collection),
      rollback: () =>
        setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: p.onSite, collection: p.collection } : x))),
    })
  }
  /** Rename a photo — its TITLE on the site (`media.label`). Debounced like every other
   *  typed field, and optimistic in the panel so the input never lags the keystroke. */
  const photoRename = useDebouncedFieldSave<string>({
    persist: (id, value) => setMediaLabelAction(artistId, id, value).then((r) => ({ ok: !r.error, error: r.error })),
  })
  function renamePhoto(id: string, label: string) {
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, label } : p)))
    photoRename.save(id, label)
  }
  /** Alt text — same live, debounced, optimistic shape as the title (SEO_GEO_PLAN B6b). */
  const photoAlt = useDebouncedFieldSave<string>({
    persist: (id, value) => setMediaAltAction(artistId, id, value).then((r) => ({ ok: !r.error, error: r.error })),
  })
  function setPhotoAlt(id: string, alt: string) {
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, alt } : p)))
    photoAlt.save(id, alt)
  }
  /** File name — a copy in storage, so explicit (on Done), never debounced. The row's
   *  new storage_path comes back and the panel follows it. */
  function setPhotoSlug(id: string, slug: string) {
    void renameMediaAction(artistId, id, slug).then((r) => {
      if (r.storage_path) setPhotos((list) => list.map((p) => (p.id === id ? { ...p, storage_path: r.storage_path! } : p)))
    })
  }
  /** JSON-LD kind — a select, so no debounce; optimistic with rollback. */
  function setPhotoKind(id: string, kind: MediaKind) {
    const prev = photos.find((p) => p.id === id)?.kind ?? null
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, kind } : p)))
    void setMediaKindAction(artistId, id, kind).then((r) => {
      if (r.error) setPhotos((list) => list.map((p) => (p.id === id ? { ...p, kind: prev } : p)))
    })
  }

  // Take a placed photo OFF the site, back into the library (never deletes). Optimistic.
  function unplacePhoto(p: GalleryPhoto) {
    run({
      guard: false,
      apply: () => setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: false } : x))),
      persist: () => setOnSiteAction('photo', p.id, artistId, false),
      rollback: () => setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: true } : x))),
    })
  }
  /** Show/hide a PLACED slot image WITHOUT unplacing it (Sam, 2026-08-18: "the hero
   *  background should be a toggle"). `on_site` is the wire's media gate, so OFF removes
   *  it from the page while the slot stays filled — flip it back and the image returns,
   *  no re-upload, no re-pick. */
  function togglePhotoOnSite(p: GalleryPhoto) {
    const next = !p.onSite
    run({
      guard: false,
      apply: () => setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: next } : x))),
      persist: () => setOnSiteAction('photo', p.id, artistId, next),
      rollback: () => setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, onSite: !next } : x))),
    })
  }
  // Toggle a whole project on/off the site by flipping `on_site` on its songs — the
  // per-song flag is what the site actually gates on. `released` is untouched.
  function toggleProjectOnSite(r: EditorProject) {
    const next = !r.onSite
    run({
      guard: false,
      apply: () => setReleases((list) => list.map((x) => (x.key === r.key ? { ...x, onSite: next } : x))),
      persist: () => setSongsOnSiteAction(artistId, r.songs.map((x) => x.id), next),
      rollback: () => setReleases((list) => list.map((x) => (x.key === r.key ? { ...x, onSite: !next } : x))),
    })
  }
  function toggleLinkOnSite(l: EditorLink) {
    const next = !l.onSite
    run({
      guard: false,
      apply: () => setLinks((list) => list.map((x) => (x.id === l.id ? { ...x, onSite: next } : x))),
      persist: () => setOnSiteAction('link', l.id, artistId, next),
      rollback: () => setLinks((list) => list.map((x) => (x.id === l.id ? { ...x, onSite: !next } : x))),
    })
  }
  function toggleVideoOnSite(v: EditorVideo) {
    const next = !v.onSite
    run({
      guard: false,
      apply: () => setVideos((list) => list.map((x) => (x.id === v.id ? { ...x, onSite: next } : x))),
      persist: () => setOnSiteAction('video', v.id, artistId, next),
      rollback: () => setVideos((list) => list.map((x) => (x.id === v.id ? { ...x, onSite: !next } : x))),
    })
  }
  // Place (or clear) a video in a hero slot. Optimistic so the slot fills immediately —
  // vacate the role's current holder, then set the picked video. Mirrors assignHeroSlotAction.
  function assignHero(role: SiteVideoRole, videoId: string | null) {
    const prev = videos
    run({
      guard: false,
      apply: () =>
        setVideos((list) =>
          list.map((x) => {
            // Guard `x.id !== videoId`: re-picking the video ALREADY in this slot would
            // otherwise hit the clear branch first and blank the slot until revalidation.
            if (x.siteRole === role && x.id !== videoId) return { ...x, siteRole: null, onSite: false }
            if (x.id === videoId) return { ...x, siteRole: role, onSite: true }
            return x
          }),
        ),
      persist: () => assignHeroSlotAction(artistId, role, videoId),
      rollback: () => setVideos(prev),
    })
  }
  function toggleTourOnSite(t: EditorTour) {
    const next = !t.onSite
    run({
      guard: false,
      apply: () => setTours((list) => list.map((x) => (x.id === t.id ? { ...x, onSite: next } : x))),
      persist: () => setOnSiteAction('tour', t.id, artistId, next),
      rollback: () => setTours((list) => list.map((x) => (x.id === t.id ? { ...x, onSite: !next } : x))),
    })
  }

  function removeLink(l: EditorLink) {
    const prev = links
    run({
      apply: () => setLinks((list) => list.filter((x) => x.id !== l.id)),
      persist: () => deleteContentAction('link', l.id, artistId),
      rollback: () => setLinks(prev),
    })
  }

  /** The four drag-reorders share one shape: move the row by ID (never index — a panel
   *  may render one list as several groups), persist the full renumbered order, roll
   *  back the whole list on error. */
  function reorderBy<T>(
    list: T[],
    setList: (l: T[]) => void,
    idOf: (x: T) => string,
    fromId: string,
    toId: string,
    persist: (next: T[]) => Promise<{ error?: string } | void>,
  ) {
    const from = list.findIndex((x) => idOf(x) === fromId)
    const to = list.findIndex((x) => idOf(x) === toId)
    if (from < 0 || to < 0 || from === to) return
    const prev = list
    const next = reorderList(list, from, to)
    run({
      apply: () => setList(next),
      persist: () => persist(next),
      rollback: () => setList(prev),
    })
  }

  function reorderLinks(fromId: string, toId: string) {
    reorderBy(links, setLinks, (l) => l.id, fromId, toId, (next) =>
      reorderContentAction('link', artistId, next.map((l) => l.id)),
    )
  }

  // Videos are placed into slots from the library (VideoTools), not deleted/reordered
  // here — deleting a video for good is a Videos-page action, and the band orders by
  // sort_order — so the editor no longer needs removeVideo/reorderVideos.

  function reorderMerch(fromId: string, toId: string) {
    reorderBy(merch, setMerch, (m) => m.id, fromId, toId, (next) =>
      reorderContentAction('merch', artistId, next.map((m) => m.id)),
    )
  }

  function removeMerch(m: EditorMerch) {
    const prev = merch
    run({
      apply: () => setMerch((list) => list.filter((x) => x.id !== m.id)),
      persist: () => deleteContentAction('merch', m.id, artistId),
      rollback: () => setMerch(prev),
    })
  }

  function removeTour(t: EditorTour) {
    const prev = tours
    run({
      apply: () => setTours((list) => list.filter((x) => x.id !== t.id)),
      persist: () => deleteContentAction('tour_date', t.id, artistId),
      rollback: () => setTours(prev),
    })
  }

  /**
   * Reorder the UNDATED shows. Dated ones are left out of the persisted list entirely:
   * their sort_order is never consulted (date decides), and renumbering them here would
   * quietly overwrite values for no benefit. The optimistic update rebuilds the list
   * with the dragged row moved, keeping dated rows where the date sort put them.
   */
  function reorderTours(fromId: string, toId: string) {
    // EVERY row, dated included (Sam, 2026-08-17): a numbered dated row is what flips a
    // connected site into manual mode — dragged order rules, date breaks unnumbered ties.
    reorderBy(tours, setTours, (t) => t.id, fromId, toId, (next) =>
      reorderContentAction('tour_date', artistId, next.map((t) => t.id)),
    )
  }

  /**
   * Reorder PROJECTS by card drag (Sam, 2026-08-18: "drag the songs around in the music
   * panel to rearrange like the tour dates"). The persisted list is every TRACK, in the
   * new project order with each project's songs kept intact — the first drag numbers the
   * whole catalog, which is what flips groupTracksIntoProjects (and a connected site's
   * wire order) into manual mode.
   */
  function reorderProjects(fromKey: string, toKey: string) {
    // Persists every TRACK in the new project order — the numbering is what flips
    // groupTracksIntoProjects (and the wire) into manual mode.
    reorderBy(releases, setReleases, (r) => r.key, fromKey, toKey, (next) =>
      reorderContentAction('track', artistId, next.flatMap((r) => r.songs.map((s) => s.id))),
    )
  }

  // The 4-branch "what can be full-panel edited" switch lives in item-editor-config.tsx
  // now; the inspector renders ONE ItemEditor from the config it returns.
  const itemEditorFor = (item: ItemEdit) => {
    const cfg = buildItemEditorConfig(item, {
      artistId,
      photos,
      videos,
      styleOptions,
      assetBudgets,
      placeInSlot,
      placePhoto,
      unplacePhoto,
      renamePhoto,
      setPhotoAlt,
      setPhotoKind,
      setPhotoSlug,
      textFields,
      itemStyling,
      addPhoto,
      assignHero,
      toggleVideoOnSite,
    })
    if (!cfg) return null
    const back = () => setEditingItem(null)
    return (
      <ItemEditor
        title={cfg.title}
        alt={cfg.alt}
        kind={cfg.kind}
        slug={cfg.slug}
        key={cfg.key}
        artistId={artistId}
        styleKey={cfg.key}
        label={item.label}
        initialClasses={styleValues[cfg.key] ?? ''}
        measured={measuredRegion?.key === cfg.key ? measuredRegion.measured : undefined}
        palette={styleOptions}
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
  const itemEditor = editingItem ? itemEditorFor(editingItem) : null
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
  // By ID, resolved against the LIVE list each render — a debounced save's
  // router.refresh() replaces `merch`, and a captured row would show stale values.
  const editingMerch = editingMerchId ? merch.find((m) => m.id === editingMerchId) : undefined
  const merchEditor = editingMerch ? (
    <MerchEditor
      item={editingMerch}
      artistId={artistId}
      onBack={() => setEditingMerchId(null)}
      onRemove={() => {
        removeMerch(editingMerch)
        setEditingMerchId(null)
      }}
    />
  ) : null
  // Same panel slot as the item editor, and mutually exclusive with it: opening one
  // closes the other, so the panel is never showing two things at once.
  /** The SEO/GEO field open full-panel — the SAME editor the Text panel opens, so "Edit"
   *  is one gesture everywhere. No style controls: an SEO string renders in a search
   *  result, not on the page, so there is nothing to restyle. */
  const siteTextValue = editingSite ? (siteEdits[editingSite.store][editingSite.key] ?? editingSite.value) : ''
  const siteTextEditor = editingSite ? (
    <TextFieldEditor
      field={{
        key: editingSite.key,
        label: editingSite.label,
        type: 'text',
        value: siteTextValue,
        multiline: editingSite.multiline ?? false,
      }}
      value={siteTextValue}
      status={siteTextSave.status}
      styleValues={NO_STYLES}
      onEdit={(v) => {
        setSiteEdits((m) => ({ ...m, [editingSite.store]: { ...m[editingSite.store], [editingSite.key]: v } }))
        siteTextSave.save(siteFieldKey(editingSite), v)
      }}
      onStyle={() => {}}
      onBack={() => setEditingSite(null)}
    />
  ) : null

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

  /**
   * THE PANEL REGISTRY (2026-08-18 inspector split): one render thunk per Kind,
   * exhaustive by type — a new Kind that renders nothing is a COMPILE error, not a
   * "coming next" placeholder (the drift class panel-inputs.ts kills, enforced here
   * too). This replaced `EditingView`, a 53-prop pass-through layer whose interface
   * was as complex as its implementation; panels now render in the inspector's own
   * scope, where the state they need already lives.
   */
  const focusedKey = focused ? selectTargetKey(focused) : null
  const PANEL_RENDER: Record<Kind, () => React.ReactNode> = {
    images: () => (
      <PhotoTools
        photos={photos}
        imageFields={imageFields}
        focusedKey={focusedKey}
        onFocus={setFocused}
        onEditItem={setEditingItem}
        components={components}
        imageCollections={imageCollections}
        assetBudgets={assetBudgets}
        artistId={artistId}
        onAdd={addPhoto}
        onPlace={placePhoto}
        onUnplace={unplacePhoto}
        onToggleOnSite={togglePhotoOnSite}
        onPlaceSlot={placeInSlot}
        onApplyField={paintField}
      />
    ),
    text: () => (
      <TextTools
        textFields={textFields}
        values={textSave.values}
        status={textSave.status}
        onEditField={(f) => {
          closeEditors() // one editor in the panel at a time
          setEditingText(f)
          // Panel → preview: the outline follows the selection, so opening a field
          // from the list highlights (and scrolls to) the words it edits.
          setFocused({ kind: 'field', key: f.key })
        }}
      />
    ),
    // One Links panel, grouped by purpose: outbound social links, tour-support links
    // (moved into the per-date editor, Sam 2026-08-09), then the declared link buttons.
    links: () => (
      <>
        <GroupLabel>Socials</GroupLabel>
        <LinkTools
          links={links.filter((l) => !isContactish(l.url))}
          group="Social"
          collapseAt={deselectedAt}
          artistId={artistId}
          onRemove={removeLink}
          onReorder={reorderLinks}
          onToggleOnSite={toggleLinkOnSite}
          inferPlatform
          focusedKey={focusedKey}
        />
        {/* A booking address is a contact route, not a profile to follow — its own
            group, split by SCHEME (mailto:/tel:), never by label. */}
        {links.some((l) => isContactish(l.url)) && (
          <>
            <GroupLabel>Contact</GroupLabel>
            <LinkTools
              links={links.filter((l) => isContactish(l.url))}
              group="Contact"
              collapseAt={deselectedAt}
              artistId={artistId}
              onRemove={removeLink}
              onReorder={reorderLinks}
              onToggleOnSite={toggleLinkOnSite}
              showAdd={false}
            />
          </>
        )}
        <GroupLabel>Buttons</GroupLabel>
        <SiteLinkTools
          regions={linkRegions}
          values={linkValues}
          selected={selectedLink}
          collapseAt={deselectedAt}
          artistId={artistId}
          onApplyLink={paintLink}
        />
      </>
    ),
    videos: () => (
      <VideoTools
        focusedKey={focusedKey}
        videos={videos}
        videoSlots={videoSlots}
        artistId={artistId}
        onToggleOnSite={toggleVideoOnSite}
        onAssignHero={assignHero}
        onEditItem={setEditingItem}
      />
    ),
    music: () => (
      <MusicTools
        releases={releases}
        artistId={artistId}
        onToggleOnSite={toggleProjectOnSite}
        onReorder={reorderProjects}
        focusedKey={focusedKey}
        onFocus={setFocused}
      />
    ),
    tour: () => (
      <TourTools
        tours={tours}
        artistId={artistId}
        onRemove={removeTour}
        onReorder={reorderTours}
        onToggleOnSite={toggleTourOnSite}
        onEditTour={(t, label) => {
          closeEditors() // one editor in the panel at a time
          setEditingTour({ tour: t, label })
        }}
        focusedKey={focusedKey}
        onFocus={setFocused}
      />
    ),
    merch: () => (
      <MerchTools
        merch={merch}
        artistId={artistId}
        onEdit={(m) => {
          closeEditors()
          setEditingMerchId(m.id)
        }}
        onReorder={reorderMerch}
        focusedKey={focusedKey}
        onFocus={setFocused}
      />
    ),
    style: () => (
      <StyleTools
        regions={styleRegions}
        values={styleValues}
        options={styleOptions}
        selected={styleFocus}
        measured={styleMeasured ?? undefined}
        collapseAt={deselectedAt}
        artistId={artistId}
        onApplyStyle={paintStyle}
      />
    ),
    site: () => (
      <SiteTools
        artistId={artistId}
        photos={photos}
        values={cursorValues}
        seo={{ ...seoValues, ...siteEdits.seo }}
        facts={{ ...(artistFacts ?? EMPTY_FACTS), ...siteEdits.fact }}
        about={manifestAbout}
        onEditText={(f) => {
          closeEditors() // one editor in the panel at a time
          setEditingSite(f)
        }}
        onEditBio={() => {
          const bio = textFields.find((f) => f.key === 'artist_bio')
          if (!bio) return
          closeEditors()
          setEditingText(bio)
          setFocused({ kind: 'field', key: bio.key })
        }}
        swatches={siteSwatches(styleOptions, styleValues)}
        budget={budgetFor(assetBudgets, 'image')}
        onApplyCursor={onApplyCursor}
      />
    ),
  }

  return (
    <aside className="flex w-[344px] flex-none flex-col overflow-hidden border-r border-hairline bg-paper font-space">
      {bridgeOutdated && <BridgeOutdatedBanner />}
      {droppedRegions.length > 0 && <DroppedRegionsBanner dropped={droppedRegions} />}
      {itemEditor ? (
        itemEditor
      ) : siteTextEditor ? (
        siteTextEditor
      ) : textEditor ? (
        textEditor
      ) : tourEditor ? (
        tourEditor
      ) : merchEditor ? (
        merchEditor
      ) : active ? (
        <PanelChrome component={active} onBack={() => selectComponent(null)} onSwitch={selectComponent}>
          {PANEL_RENDER[active.kind]()}
        </PanelChrome>
      ) : (
        <BrowseView onOpen={selectComponent} />
      )}
      {/* Revert changes: back to the last PUBLISHED edition (session walk only for a
          never-published artist). Shows while anything is unpublished OR touched this
          session; hidden while the ITEM editor is open (its own revert owns that
          surface). */}
      {!itemEditor && !textEditor && !siteTextEditor && !tourEditor && (journalCount > 0 || hasUnpublished) && (
        <SessionActions busy={reverting} onRemove={revertSession} />
      )}
    </aside>
  )
}

/* ── The session's Revert button ─────────────────────────────────────────────────
 * ONE button, because there is only one thing left to do here (Sam, 2026-08-14).
 * Every edit already autosaves to the DRAFT, so the old "Save" wrote nothing — it only
 * dismissed this bar — and a second word for "save" next to Publish was the whole
 * confusion. What remains is the escape hatch: put everything back the way it was.
 *
 * Revert is anchored to the LAST PUBLISH (Sam, 2026-08-17): it restores the published
 * edition via restorePublishedAction and survives a refresh (`hasUnpublished` is
 * computed server-side). The in-memory session-ledger walk remains only as the
 * fallback for an artist who has never published.
 */
function SessionActions({
  busy,
  onRemove,
}: {
  busy: boolean
  onRemove: () => void
}) {
  return (
    <div className="border-t border-hairline px-4 py-2.5">
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="w-full rounded-lg border border-hairline px-3 py-2 font-space text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted transition-colors enabled:hover:border-ink enabled:hover:text-ink disabled:opacity-40"
      >
        {busy ? 'Reverting…' : 'Revert changes'}
      </button>
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

/* ── Panel chrome: the top bar, scroll body and switcher strip around ONE panel ──
 * The presentational remainder of `EditingView` (deleted 2026-08-18): that layer
 * threaded 53 props to reach these ~40 lines — the panels themselves render in the
 * inspector's scope now (PANEL_RENDER), and this keeps only what it draws. */
function PanelChrome({
  component,
  onBack,
  onSwitch,
  children,
}: {
  component: Component
  onBack: () => void
  onSwitch: (c: Component) => void
  children: React.ReactNode
}) {
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

      <div className={SCROLL_BODY}>{children}</div>

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

