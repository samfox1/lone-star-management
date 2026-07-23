'use client'

import { useState, useTransition } from 'react'
import { cx } from '@/lib/cx'
import { plural, GroupLabel, EYEBROW } from './inspector-shared'
import { reorderList, type Orientation } from '@/lib/site-editor/gallery'
import {
  type ManifestComponent,
  type ManifestLinkRegion,
  type ManifestStyleRegion,
} from '@/lib/site-editor/manifest'
import { type SiteStyleOptions } from '@/lib/site-editor/style-controls'
import { isContactLink } from '@/lib/url'
import { Icon, type IconName } from '@/components/ui/icons'
import {
  PhotoTools,
  TextTools,
  LinkTools,
  SiteLinkTools,
  SupportLinkTools,
  StyleTools,
  VideoTools,
  TourTools,
  MerchTools,
  MusicTools,
} from './panels'
import {
  assignComponentSlotAction,
  setSongsOnSiteAction,
  assignHeroSlotAction,
  deleteContentAction,
  placeGalleryPhotoAction,
  reorderContentAction,
  setOnSiteAction,
} from '../actions'

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
  EditorTextField,
  EditorLink,
  EditorSupportLink,
  SiteVideoRole,
  EditorVideo,
  EditorMerch,
  EditorSong,
  EditorProject,
  EditorTour,
} from './inspector-types'
export type {
  GalleryPhoto,
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
type Kind = 'images' | 'text' | 'links' | 'videos' | 'music' | 'tour' | 'merch' | 'style'
type Component = { kind: Kind; icon: IconName; label: string }

const COMPONENTS: Component[] = [
  { kind: 'images', icon: 'photo', label: 'Images' },
  { kind: 'text', icon: 'text', label: 'Text' },
  { kind: 'links', icon: 'links', label: 'Links' },
  { kind: 'videos', icon: 'videos', label: 'Videos' },
  { kind: 'music', icon: 'tracks', label: 'Music' },
  { kind: 'tour', icon: 'tour', label: 'Tour' },
  { kind: 'merch', icon: 'merch', label: 'Merch' },
  { kind: 'style', icon: 'bolt', label: 'Style' },
]

/** What a component counts. `onSite` is null for kinds that have no on-site concept
 *  (text fields, style regions); otherwise it's how many are actually ON THE SITE. */
export type KindCount = { total: number; onSite: number | null }

/** The noun each component counts. One table keyed by Kind, replacing a per-kind
 *  pluralizer plus the same 7-arm ternary written out in BOTH the browse list and the
 *  editing header — so an 8th Kind is one entry here, not four edits. `Record<Kind, …>`
 *  is the point: TypeScript refuses a new Kind without one. */
const COUNT_NOUN: Record<Kind, string> = {
  images: 'photo',
  text: 'field',
  links: 'link',
  videos: 'video',
  music: 'song',
  tour: 'date',
  merch: 'product',
  style: 'region',
}

/**
 * The subtitle under each component. For anything with an on-site concept this reads
 * "N of M on site" — NOT the library total.
 *
 * The library total alone actively lied: the editor's job is what's on the SITE
 * (ADR 0006), but Videos showed "83 videos" while the public site served ZERO of them
 * — every one imported off-site by the YouTube sync (`insertDefaults: on_site:false`).
 * It read as "83 videos are on your site". Songs and links looked right only by luck:
 * they happen to be 19/19 and 8/8.
 */
export function countLabel(kind: Kind, c: KindCount): string {
  const noun = COUNT_NOUN[kind]
  if (c.total === 0) return plural(0, noun) // "0 photos" beats "0 of 0 on site"
  if (c.onSite === null) return plural(c.total, noun) // no on-site concept
  return `${c.onSite} of ${c.total} on site`
}

/* A read-only OnSiteBadge lived here for the publish-reconciled kinds, because
 * `reconcileOnSite` would silently revert a toggle they didn't own. Videos were its
 * only caller, and ADR 0009 moved them to the live toggle — so it's an OnSiteToggle
 * now, and the badge had no callers left. Merch is the last reconciled type; its
 * panel never showed presence at all, only the header count. Giving merch a real
 * toggle means moving it to LIVE_TOGGLE (lib/content.ts) first. */

export function EditorInspector({
  artistId,
  photos: initial,
  textFields = [],
  links: initialLinks = [],
  supportLinks = [],
  videos: initialVideos = [],
  merch: initialMerch = [],
  releases: initialReleases = [],
  tours: initialTours = [],
  components = [],
  componentLabels = {},
  showGallery = false,
  styleRegions = [],
  styleValues = {},
  styleOptions,
  selectedStyle = null,
  linkRegions = [],
  linkValues = {},
  selectedLink = null,
  onApplyField,
  onApplyStyle,
  onApplyLink,
}: {
  artistId: string
  photos: GalleryPhoto[]
  textFields?: EditorTextField[]
  links?: EditorLink[]
  /** Support acts across the artist's tour dates, for the Links panel's "Tour support"
   *  group. Read-only structurally (acts come from the tour dates); only their URLs are
   *  edited here. */
  supportLinks?: EditorSupportLink[]
  videos?: EditorVideo[]
  merch?: EditorMerch[]
  releases?: EditorProject[]
  /** The date LIBRARY, on-site or not — the editor is where they're chosen (ADR 0009). */
  tours?: EditorTour[]
  /** Repeated multi-image components (the polaroid wall). Comes from the FRAME's
   *  edit-list at runtime; a site that declares none simply has no component section. */
  components?: ManifestComponent[]
  /** Current `<key>_<n>_label` values (the manager's rename per instance), from site text. */
  componentLabels?: Record<string, string>
  /** Does the site declare a photo collage (an image slot)? Defaults FALSE — a group is
   *  shown because the site asked for it, never just because the editor can render one. */
  showGallery?: boolean
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
  onApplyField?: (key: string, value: string) => void
  onApplyStyle?: (key: string, className: string) => void
  /** Optimistically set a link's href in the frame before the debounced save. */
  onApplyLink?: (key: string, url: string) => void
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
  if (selectedStyle && selectedStyle !== lastSelected) {
    setLastSelected(selectedStyle)
    setActive(COMPONENTS.find((c) => c.kind === 'style') ?? null)
  }

  // Same click-the-thing behaviour for a link-powered element: selecting skeen's USB
  // button in the frame opens the Links panel (its "Buttons" group) focused on it.
  const [lastSelectedLink, setLastSelectedLink] = useState<string | null>(null)
  if (selectedLink && selectedLink !== lastSelectedLink) {
    setLastSelectedLink(selectedLink)
    setActive(COMPONENTS.find((c) => c.kind === 'links') ?? null)
  }

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
  function placeInSlot(role: string, photo: GalleryPhoto | null) {
    if (isPending) return
    const prev = photos
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

  // One count per Kind, derived once and shared by both views — they used to each
  // reach into a different set of arrays through their own ternary chain. `onSite`
  // is what the site actually serves; null means the kind has no on-site concept.
  const onSite = <T,>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length
  const counts: Record<Kind, KindCount> = {
    // Gallery photos are edited as orientation SLOTS: a photo in a slot is on the site by
    // construction, so there's no separate on-site count to show — just the total.
    images: { total: photos.length, onSite: null },
    text: { total: textFields.length, onSite: null },
    links: { total: links.length, onSite: onSite(links, (l) => l.onSite) },
    videos: { total: videos.length, onSite: onSite(videos, (v) => v.onSite) },
    music: { total: releases.length, onSite: onSite(releases, (x) => x.onSite) },
    tour: { total: tours.length, onSite: onSite(tours, (t) => t.onSite) },
    merch: { total: merch.length, onSite: onSite(merch, (m) => m.onSite) },
    style: { total: styleRegions.length, onSite: null },
  }

  return (
    <aside className="flex w-[344px] flex-none flex-col overflow-hidden border-r border-hairline bg-paper font-space">
      {active ? (
        <EditingView
          component={active}
          photos={photos}
          textFields={textFields}
          links={links}
          supportLinks={supportLinks}
          videos={videos}
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
          componentLabels={componentLabels}
          showGallery={showGallery}
          onPlaceSlot={placeInSlot}
          onRemoveLink={removeLink}
          onReorderLink={reorderLinks}
          onRemoveMerch={removeMerch}
          styleRegions={styleRegions}
          styleValues={styleValues}
          styleOptions={styleOptions}
          selectedStyle={selectedStyle}
          linkRegions={linkRegions}
          linkValues={linkValues}
          selectedLink={selectedLink}
          onApplyField={onApplyField}
          onApplyStyle={onApplyStyle}
          onApplyLink={onApplyLink}
          onBack={() => setActive(null)}
          onSwitch={setActive}
        />
      ) : (
        <BrowseView counts={counts} onOpen={setActive} />
      )}
    </aside>
  )
}

/* ── Browse: the component-type list ─────────────────────────────────────────── */
function BrowseView({
  counts,
  onOpen,
}: {
  counts: Record<Kind, KindCount>
  onOpen: (c: Component) => void
}) {
  return (
    <>
      <div className="px-5 pb-3.5 pt-5">
        <div className={EYEBROW}>Editor</div>
        <h2 className="mt-2 text-[19px] font-semibold tracking-[-0.01em]">Edit your site</h2>
      </div>
      <div className="flex-1 overflow-y-auto border-t border-hairline-soft">
        {COMPONENTS.map((c) => (
          <button
            key={c.kind}
            type="button"
            onClick={() => onOpen(c)}
            className="group flex w-full items-center gap-3.5 border-b border-hairline-soft px-5 py-[15px] text-left hover:bg-surface"
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] bg-track text-ink-muted group-hover:text-ink">
              <Icon name={c.icon} size={19} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-medium">{c.label}</span>
              <span className="font-space text-[10px] tracking-[0.04em] text-ink-faint">
                {countLabel(c.kind, counts[c.kind])}
              </span>
            </span>
            <Icon name="chevronRight" size={16} className="flex-none text-hairline" />
          </button>
        ))}
      </div>
    </>
  )
}

/* ── Editing: tools for the selected component ───────────────────────────────── */
function EditingView({
  component,
  photos,
  textFields,
  links,
  supportLinks,
  videos,
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
  componentLabels,
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
  onApplyField,
  onApplyStyle,
  onApplyLink,
  onBack,
  onSwitch,
}: {
  component: Component
  photos: GalleryPhoto[]
  textFields: EditorTextField[]
  links: EditorLink[]
  supportLinks: EditorSupportLink[]
  videos: EditorVideo[]
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
  componentLabels: Record<string, string>
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
  onApplyField?: (key: string, value: string) => void
  onApplyStyle?: (key: string, className: string) => void
  onApplyLink?: (key: string, url: string) => void
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
  return (
    <>
      {/* Minimal header: back on the left, the component's icon on the right. */}
      <div className="flex items-center justify-between border-b border-hairline px-5 pb-2.5 pt-[15px]">
        <button
          type="button"
          onClick={onBack}
          className={cx('flex items-center gap-1.5 text-ink-muted hover:text-ink', EYEBROW)}
        >
          <Icon name="chevronLeft" size={15} />
          All components
        </button>
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-accent-soft text-accent">
          <Icon name={component.icon} size={18} />
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isImages ? (
          <PhotoTools
            photos={photos}
            components={components}
            componentLabels={componentLabels}
            showGallery={showGallery}
            artistId={artistId}
            onAdd={onAddPhoto}
            onPlace={onPlacePhoto}
            onUnplace={onUnplacePhoto}
            onPlaceSlot={onPlaceSlot}
            onApplyField={onApplyField}
          />
        ) : isText ? (
          <TextTools textFields={textFields} artistId={artistId} onApplyField={onApplyField} />
        ) : isLinks ? (
          // One Links panel, grouped by purpose: outbound social links, tour-support
          // links, then the site's declared link buttons (USB / Merch).
          <>
            <GroupLabel>Socials</GroupLabel>
            <LinkTools
              links={links.filter((l) => !isContactLink(l.url))}
              group="Social"
              artistId={artistId}
              onRemove={onRemoveLink}
              onReorder={onReorderLink}
              onToggleOnSite={onToggleLinkOnSite}
            />
            {/* A booking address is a contact route, not a profile to follow, so it gets
                its own group instead of sitting among the socials. Split by SCHEME
                (mailto:/tel:), not by label — the link says what it is. */}
            {links.some((l) => isContactLink(l.url)) && (
              <>
                <GroupLabel>Contact</GroupLabel>
                <LinkTools
                  links={links.filter((l) => isContactLink(l.url))}
                  group="Contact"
                  artistId={artistId}
                  onRemove={onRemoveLink}
                  onReorder={onReorderLink}
                  onToggleOnSite={onToggleLinkOnSite}
                  showAdd={false}
                />
              </>
            )}
            <GroupLabel>Tour support</GroupLabel>
            <SupportLinkTools supportLinks={supportLinks} artistId={artistId} />
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
          <VideoTools videos={videos} artistId={artistId} onToggleOnSite={onToggleVideoOnSite} onAssignHero={onAssignHero} />
        ) : isTour ? (
          <TourTools
            tours={tours}
            artistId={artistId}
            onRemove={onRemoveTour}
            onReorder={onReorderTour}
            onToggleOnSite={onToggleTourOnSite}
          />
        ) : isMerch ? (
          <MerchTools merch={merch} artistId={artistId} onRemove={onRemoveMerch} />
        ) : isMusic ? (
          <MusicTools releases={releases} artistId={artistId} onToggleOnSite={onToggleProjectOnSite} />
        ) : isStyle ? (
          <StyleTools
            regions={styleRegions}
            values={styleValues}
            options={styleOptions}
            selected={selectedStyle}
            artistId={artistId}
            onApplyStyle={onApplyStyle}
          />
        ) : (
          <p className="px-5 py-6 text-sm text-ink-muted">
            Editing tools for {component.label} are coming next.
          </p>
        )}
      </div>

      {/* the browse list, collapsed to a switcher strip */}
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

