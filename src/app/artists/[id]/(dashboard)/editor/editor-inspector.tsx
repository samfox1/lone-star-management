'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { cx } from '@/lib/cx'
import { mediaUrl } from '@/lib/site'
import { reorderList, type Orientation } from '@/lib/site-editor/gallery'
import { RELEASE_TYPE_LABEL, type ReleaseType } from '@/lib/releases'
import {
  componentLabelKey,
  componentSlotRole,
  groupStyleRegions,
  type ManifestComponent,
  type ManifestLinkRegion,
  type ManifestStyleRegion,
} from '@/lib/site-editor/manifest'
import { cleanClassText } from '@/lib/site-editor/save'
import {
  applyStyleValue,
  buildStyleControls,
  readStyleValue,
  type SiteStyleOptions,
  type StyleControl,
} from '@/lib/site-editor/style-controls'
import { isContactLink, safeHref } from '@/lib/url'
import { Icon, type IconName } from '@/components/ui/icons'
import { modalOverlayClass, modalCardClass } from '@/components/ui/ui'
import { GallerySlotUploader } from '../media-uploader'
import { useLockBodyScroll } from '../use-lock-body-scroll'
import {
  assignComponentSlotAction,
  setSongsOnSiteAction,
  assignHeroSlotAction,
  deleteContentAction,
  placeGalleryPhotoAction,
  renameVideoAction,
  reorderContentAction,
  saveEditorFieldAction,
  saveEditorLinkAction,
  saveEditorStyleAction,
  setOnSiteAction,
  setSupportUrlAction,
  updateContentAction,
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

export type GalleryPhoto = {
  id: string
  storage_path: string
  onSite: boolean
  /** Which slot group the photo fills. null for legacy photos uploaded before slots. */
  orientation: Orientation | null
  /** The component slot this photo is placed in (`polaroid_3_photo`), or null for an
   *  ordinary gallery photo. A photo with a role belongs to a COMPONENT and is excluded
   *  from the gallery groups, so a handwriting PNG never joins the collage. */
  siteRole: string | null
}
export type EditorTextField = {
  key: string
  label: string
  type: 'text' | 'email'
  value: string
  multiline: boolean
}
export type EditorLink = { id: string; label: string; url: string; onSite: boolean }
/**
 * One support act on a tour date, surfaced in the Links panel's "Tour support" group so
 * its outbound URL (`tour_dates.support_urls[name]`) can be edited where the manager
 * manages links — separately from the act NAME, which is edited on the Tour page.
 */
export type EditorSupportLink = {
  /** The tour date this act supports — the row `support_urls` is written to. */
  tourDateId: string
  /** The act's name (e.g. "Gudfella"): the key in support_urls AND the row label. */
  name: string
  /** The act's current outbound URL, '' if none. */
  url: string
  /** Which show this act is on (venue / city / date), for context under the name. */
  show: string
}
/** A named background slot an uploaded video can fill: the two hero backgrounds plus
 *  the bio-section background. null = a normal library/band video. */
export type SiteVideoRole = 'hero_landscape' | 'hero_portrait' | 'bio_background'
/** The label each background slot shows in the panel and the picker heading. */
const SLOT_LABELS: Record<SiteVideoRole, string> = {
  hero_landscape: 'Landscape · desktop',
  hero_portrait: 'Portrait · mobile',
  bio_background: 'Bio background',
}
export type EditorVideo = {
  id: string
  title: string
  /** 'youtube' | 'soundcloud' | 'uploaded'. The band is YouTube embeds only; uploaded
   *  videos are the pool the background slots pick from. */
  provider: string
  isShort: boolean
  /** Background slot this video is placed in, or null. */
  siteRole: SiteVideoRole | null
  /** YouTube thumbnail (embeds). Null for uploaded videos — they use `previewUrl`. */
  poster: string | null
  /** Playable URL for an uploaded video, seeked to its first frame for a thumbnail
   *  preview. Null for YouTube (which has a poster instead). */
  previewUrl: string | null
  onSite: boolean
}
export type EditorMerch = { id: string; title: string; price: string; url: string; image_url: string | null; onSite: boolean }
export type EditorSong = { id: string; title: string; cover_url: string | null; released: boolean; onSite: boolean }
/** One PROJECT in the Music panel — an album / EP / single, the unit the site renders.
 *  Songs are grouped into it by album art, NOT by a release id (skeen's catalog never
 *  populates one). A project is not an entity the manager edits; it is a view over its
 *  songs. Site visibility is the songs' `on_site`; ordering is by release date. */
export type EditorProject = {
  /** Stable React key. NOT used to gate or link anything — a song belongs to a project
   *  by sharing an album name, not by pointing at this. */
  key: string
  title: string
  cover_url: string | null
  /** 'album' | 'ep' | 'single' | 'remix' | 'featured' — shown as an at-a-glance tag. */
  kind: string
  /** The songs in this project (id + title), in order — for the tracklist an album card
   *  expands to show, and for the on/off toggle (which flips on_site on these ids). */
  songs: { id: string; title: string }[]
  /** On the site iff any of its songs is on-site. */
  onSite: boolean
}
export type EditorTour = {
  id: string
  date: string | null
  venue: string | null
  city: string | null
  /** Two-letter US state code (TX). null for out-of-country dates. */
  state: string | null
  country: string | null
  /** The other acts on the bill. Never null — the column is NOT NULL DEFAULT '{}'. */
  support: string[]
  onSite: boolean
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

/** `2 photos` / `1 photo`. Every noun the inspector counts pluralizes with +s. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

const EYEBROW = 'font-space text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint'
// Red ring for a field whose value the server would reject (a blank required field, a
// bad price) — gating the save so the panel can't claim "Saved" on a dropped write.
const INVALID_RING = 'border-accent-red focus:border-accent-red'
// The same signal for a BORDERLESS field (the restyled Style/Links/Text panels): those
// have no border to redden, so the invalid state is a ring instead. Kept separate from
// INVALID_RING so the still-bordered panels (Merch, Music, Tour) are untouched.
const INVALID_FIELD = 'ring-1 ring-accent-red focus:ring-accent-red'

/* ── Panel layout primitives (the "grid sheet" inspector) ────────────────────────────
 * The Style / Links / Text panels share one visual language: NO bordered containers.
 * Structure comes from grouping (a mono eyebrow + trailing rule), a leading icon per
 * row, and whitespace — not from boxes. Fields are tinted rather than outlined.
 *
 * TYPE RULE: the panel is Space Mono THROUGHOUT — labels, names, values, and the text
 * the manager types into a field (Sam, 2026-07-21). `font-space` sits on the <aside>
 * so everything inherits it; inputs/selects/textareas restate it because form controls
 * do not inherit font-family from an ancestor. Mono runs wider than Inter, so row text
 * is 13px where Inter was 14px, keeping the same line count per row.
 */

/** A borderless field on the panel's white ground: tinted at rest, paper on focus. */
const FIELD =
  'w-full rounded-md bg-surface px-2.5 py-2 font-space text-[13px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:bg-paper focus:ring-1 focus:ring-hairline'

/** The same field INSIDE an expanded body, which is itself tinted — so it inverts:
 *  paper on grey, or it would vanish into its own background. */
const FIELD_ON_TINT =
  'w-full rounded-md bg-paper px-2.5 py-2 font-space text-[13px] text-ink outline-none ring-1 ring-hairline placeholder:font-space placeholder:text-ink-faint focus:ring-ink-faint'

/** An expanded section's body. The grey ground is what separates a section from the
 *  controls it owns — the parent row stays on white and needs no extra weight. */
const PANEL_BODY = 'bg-surface px-5 pb-3 pt-2'

/** The mono micro-cap that names a control or field. */
const CONTROL_LABEL = 'font-space text-[10px] font-bold uppercase tracking-[0.1em] text-ink-muted'

/** A collapsible section header — label, optional tag, chevron. No border and no
 *  leading icon: the section list reads as a plain outline of the page (Sam,
 *  2026-07-21); the chevron rotating is the only open/closed signal. */
function SectionRow({
  label,
  tag,
  open,
  onClick,
}: {
  label: string
  tag?: React.ReactNode
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left hover:bg-surface-hover"
    >
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label}</span>
      {tag}
      <span className={cx('flex-none text-ink-faint transition-transform', open && 'rotate-90')} aria-hidden>
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  )
}

/** One control on the sheet grid: [icon] [mono label] [control]. */
function ControlRow({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_1fr_auto] items-center gap-x-2.5 py-1.5">
      <span className="justify-self-center text-ink-faint" aria-hidden>
        <Icon name={icon} size={14} />
      </span>
      <span className={CONTROL_LABEL}>{label}</span>
      {children}
    </div>
  )
}

/** A labelled field on the sheet grid: [icon] [label over field]. */
function FieldRow({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[20px_1fr] items-start gap-x-2.5 py-1.5">
      <span className="mt-2 justify-self-center text-ink-faint" aria-hidden>
        <Icon name={icon} size={14} />
      </span>
      <label className="block">
        <span className={cx(CONTROL_LABEL, 'mb-1 block')}>{label}</span>
        {children}
      </label>
    </div>
  )
}

/** The mono status line every panel ends with. */
function SaveLine({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  return (
    <p className={cx('px-5 pt-3', EYEBROW, status === 'error' && 'text-accent-red')}>
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed'}
    </p>
  )
}

/** Which icon leads a TEXT field row — matched on the field key so the panel doesn't
 *  repeat one glyph down the whole column. */
function textFieldIcon(key: string, type: string): IconName {
  if (type === 'email' || key.includes('email')) return 'external'
  const k = key.toLowerCase()
  if (k.includes('button') || k.includes('cta')) return 'bolt'
  if (k.includes('show') || k.includes('tour')) return 'tour'
  if (k.includes('work') || k.includes('music') || k.includes('track')) return 'tracks'
  if (k.includes('video')) return 'videos'
  if (k.includes('merch')) return 'merch'
  if (k.includes('booking') || k.includes('contact')) return 'links'
  if (k.includes('name')) return 'roster'
  return 'text'
}

/** Which icon leads each style control row (ids come from buildStyleControls). */
const STYLE_CONTROL_ICON: Record<string, IconName> = {
  font: 'text',
  size: 'fontSize',
  weight: 'bold',
  textColor: 'palette',
  bgColor: 'fill',
  align: 'align',
  uppercase: 'uppercase',
  italic: 'italic',
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
/**
 * Run a field's save SERIALIZED per id (chained onto that field's previous save, so an
 * older keystroke's write can't land after a newer one — review #6), and reflect the
 * result honestly across concurrent fields via an `errored` set, so one field's failure
 * isn't masked by another field's later success (review #8).
 */
export function runSerialized(
  saving: { current: Map<string, Promise<unknown>> },
  errored: { current: Set<string> },
  setStatus: (s: SaveStatus) => void,
  id: string,
  action: () => Promise<{ error?: string } | void>,
): void {
  // Fire immediately when this field has no save in flight; only CHAIN behind a prior
  // one (so overlapping saves of the same field can't land out of order).
  const prev = saving.current.get(id)
  const settled = Promise.resolve(prev ? prev.then(() => action()) : action())
  saving.current.set(id, settled.catch(() => {}))
  void settled.then((res) => {
    if (res && (res as { error?: string }).error) errored.current.add(id)
    else errored.current.delete(id)
    setStatus(errored.current.size ? 'error' : 'saved')
  })
}

/** Per-item "on the site" toggle (writes the `on_site` flag). Being in the library never
 *  implies on-site — the manager selects each item on. */
function OnSiteToggle({ on, onToggle, className }: { on: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? 'On the site — click to take off' : 'Off the site — click to add'}
      className={cx(
        'inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-space text-[9px] font-bold uppercase tracking-[0.08em] transition-colors',
        on ? 'bg-accent text-white' : 'border border-hairline bg-paper text-ink-faint hover:text-ink',
        className,
      )}
    >
      <Icon name="check" size={11} className={on ? undefined : 'opacity-40'} />
      {on ? 'On site' : 'Off'}
    </button>
  )
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

/** A 4:3 photo thumbnail box for a gallery card / picker tile. */
/** A gallery thumbnail at its orientation's aspect (3:2 horizontal, 2:3 vertical). */
function PhotoThumb({ path, aspect }: { path: string; aspect: string }) {
  return (
    <div className={cx('w-full overflow-hidden bg-track', aspect)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={mediaUrl(path)} alt="" className="h-full w-full object-cover" />
    </div>
  )
}

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
    <div className="px-5 pb-4 pt-1">
      {/* The name READS as text; the pencil turns it into a field. An always-live input
          made five cards look like a form to fill in rather than a wall to arrange. */}
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
          className={cx(FIELD, 'mb-2')}
        />
      ) : (
        <div className="mb-2 flex items-center gap-1.5">
          <span className={cx('min-w-0 flex-1 truncate text-[13px]', name ? 'text-ink' : 'text-ink-faint')}>
            {name || fallbackName}
          </span>
          <button
            type="button"
            aria-label={`Rename ${fallbackName}`}
            onClick={() => setRenaming(true)}
            className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
          >
            <Icon name="edit" size={13} />
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {component.slots.map((slot) => {
          const role = componentSlotRole(component.key, n, slot.key)
          const placed = photos.find((p) => p.siteRole === role) ?? null
          const wrongFormat = !!placed && slot.prefersPng && !/\.png$/i.test(placed.storage_path)
          return (
            <div key={slot.key}>
              <span className={cx(CONTROL_LABEL, 'mb-1 block')}>{slot.label}</span>
              {placed ? (
                <div className="overflow-hidden rounded-lg border border-hairline">
                  <PhotoThumb path={placed.storage_path} aspect="aspect-square" />
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
                      {placed.storage_path.split('/').pop()}
                    </span>
                    <button
                      type="button"
                      aria-label={`Replace ${fallbackName} ${slot.label}`}
                      onClick={() => setPicking(role)}
                      className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${fallbackName} ${slot.label}`}
                      onClick={() => onPlaceSlot(role, null)}
                      className="flex-none rounded-md p-1 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <EmptySlot
                  label={`Add ${slot.label.toLowerCase()}`}
                  ariaLabel={`${fallbackName} ${slot.label}`}
                  title={slot.hint}
                  aspect="aspect-square"
                  onClick={() => setPicking(role)}
                />
              )}
              {/* Advisory, never blocking (Sam, 2026-07-21): a JPG here renders as a white
                  box over the card, so say so — but a wrong-format image is fixable and a
                  blocked upload is a dead end mid-task. */}
              {wrongFormat && (
                <span className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-status-pending">
                  <Icon name="alert" size={12} />
                  Should be a transparent PNG — this one will show a solid background.
                </span>
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

function PhotoTools({
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

/* ── Site-link tools: set the href for each manifest-declared link button ────────────
 * Mirrors StyleTools (manifest-driven, Phase 2): the site declares its link-powered
 * elements (USB / Merch buttons) in its manifest; here the manager sets each one's URL
 * BY KEY. An unset link shows as an EMPTY, labelled row, so a missing one (e.g. USB) is
 * visible rather than invisible. Saving writes a `links` row keyed by role and posts
 * `apply-link` so the frame updates live. Selecting the element in the frame focuses its
 * row. Socials are a SEPARATE panel — these are only the declared buttons. */
function SiteLinkTools({
  regions,
  values,
  selected,
  artistId,
  onApplyLink,
}: {
  regions: ManifestLinkRegion[]
  values: Record<string, string>
  selected: string | null
  artistId: string
  onApplyLink?: (key: string, url: string) => void
}) {
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? ''])),
  )
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())
  const fieldRefs = useRef<Map<string, HTMLInputElement | null>>(new Map())
  // Manifest labels, so the unmount flush can name each row without the region list
  // being an effect dependency (same trick as SupportLinkTools' linksRef).
  const labelsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    labelsRef.current = Object.fromEntries(regions.map((r) => [r.key, r.label]))
  }, [regions])

  // The frame's manifest arrives on `ready`, so regions/values can land after first
  // render — re-seed when they do, without clobbering typing.
  const seedKey = regions.map((r) => r.key).join(',')
  const [seeded, setSeeded] = useState(seedKey)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setText(Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? ''])))
  }

  // Scroll the clicked link's row into view + focus it (frame → editor `select`).
  useEffect(() => {
    if (!selected) return
    const el = fieldRefs.current.get(selected)
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }, [selected])

  const persist = useCallback(
    (key: string, url: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () =>
        saveEditorLinkAction(artistId, key, url, labelsRef.current[key] ?? key),
      )
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((url, key) => {
        void saveEditorLinkAction(artistId, key, url, labelsRef.current[key] ?? key)
      })
    }
  }, [artistId])

  function edit(key: string, raw: string) {
    setText((t) => ({ ...t, [key]: raw }))
    const trimmed = raw.trim()
    // Blank clears the link (valid). A non-blank value must be a safe http(s)/relative
    // URL — validated with the SAME safeHref the action uses, so the panel can't claim
    // "Saved" on a write the server will reject.
    const ok = trimmed === '' || safeHref(trimmed) !== undefined
    setInvalid((s) => {
      const next = new Set(s)
      if (ok) next.delete(key)
      else next.add(key)
      return next
    })
    if (!ok) return

    onApplyLink?.(key, trimmed) // optimistic href in the frame
    pending.current.set(key, trimmed)
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        persist(key, trimmed)
      }, 500),
    )
  }

  if (!regions.length) {
    return (
      <p className="px-5 py-6 text-sm leading-relaxed text-ink-muted">
        This site hasn&apos;t declared any link buttons. A custom site sends them when the
        preview loads; the built-in templates declare none yet.
      </p>
    )
  }

  return (
    <div className="pb-2 pt-1">
      {regions.map((r) => (
        <div key={r.key} className="px-5">
          <FieldRow icon="bolt" label={r.label}>
            {r.description && (
              <span className="mb-1.5 block text-[11px] leading-snug text-ink-faint">Powers: {r.description}</span>
            )}
            <input
              ref={(el) => {
                fieldRefs.current.set(r.key, el)
              }}
              aria-label={`${r.label} URL`}
              aria-invalid={invalid.has(r.key) || undefined}
              type="url"
              value={text[r.key] ?? ''}
              onChange={(e) => edit(r.key, e.target.value)}
              placeholder="https://…  (blank = no link)"
              className={cx(FIELD, invalid.has(r.key) && INVALID_FIELD)}
            />
          </FieldRow>
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}

/** One friendly control row (a labelled dropdown or a toggle) for a style region. */
function StyleControlRow({
  region,
  control,
  cls,
  onChange,
}: {
  region: ManifestStyleRegion
  control: StyleControl
  cls: string
  onChange: (value: string) => void
}) {
  const current = readStyleValue(control, cls)
  const aria = `${region.label} ${control.label}`
  const icon = STYLE_CONTROL_ICON[control.id] ?? 'tools'
  if (control.kind === 'toggle') {
    return (
      <ControlRow icon={icon} label={control.label}>
        {/* A switch, not a checkbox: it reads as on/off at a glance in a panel where
            every other control is a value, and it matches OnSiteToggle elsewhere. */}
        <button
          type="button"
          role="switch"
          aria-checked={current === 'on'}
          aria-label={aria}
          onClick={() => onChange(current === 'on' ? '' : 'on')}
          className={cx(
            'relative h-5 w-9 flex-none rounded-full transition-colors',
            current === 'on' ? 'bg-ink' : 'bg-hairline',
          )}
        >
          <span
            className={cx(
              'absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow-sm transition-[left]',
              current === 'on' ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </button>
      </ControlRow>
    )
  }
  // Show the current value even when it's a class the site declared no option for (e.g. a
  // base class), so nothing is silently dropped or mislabelled as Default.
  const options =
    current && !control.options.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...control.options]
      : control.options
  const currentLabel = options.find((o) => o.value === current)?.label ?? options[0]?.label ?? ''
  return (
    <ControlRow icon={icon} label={control.label}>
      {/* The <select> stays for BEHAVIOUR (native menu, keyboard, a11y, and the `.value`
          every test drives) but is transparent and stretched over the row; the value is
          painted beside it as ordinary DOM text. macOS Chrome renders a control's own
          text in the system font no matter what `font-family` computes to, so the only
          way to get Inter here is to not let the control draw it. */}
      <span className="relative inline-flex flex-none items-center">
        <select
          aria-label={aria}
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 outline-none"
        >
          {options.map((o) => (
            <option key={o.value || 'default'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none inline-flex items-center gap-1 rounded-md px-1.5 py-1 peer-hover:bg-paper peer-focus:bg-paper peer-focus-visible:ring-1 peer-focus-visible:ring-ink-faint">
          <span className="font-space text-[13px] text-ink">{currentLabel}</span>
          <span className="rotate-90 text-ink-faint" aria-hidden>
            <Icon name="chevronRight" size={13} />
          </span>
        </span>
      </span>
    </ControlRow>
  )
}

/* ── Style tools: NO-CODE styling (SITE_STYLING_PLAN.md) ─────────────────────────────
 * Each region is an accordion row; open one to get friendly controls (size, boldness,
 * font, colour, alignment, uppercase, italic) instead of a raw class string. A control
 * OWNS a slice of the region's Tailwind class string (lib/style-controls) — changing it
 * swaps that utility and PRESERVES the rest. The raw string is still reachable under
 * "Advanced" for anything the controls don't cover. Same debounced save + optimistic
 * frame repaint as before; the underlying store (site_styles.class_names) is unchanged. */
function StyleTools({
  regions,
  values,
  options,
  selected,
  artistId,
  onApplyStyle,
}: {
  regions: ManifestStyleRegion[]
  values: Record<string, string>
  options?: SiteStyleOptions
  selected: string | null
  artistId: string
  onApplyStyle?: (key: string, className: string) => void
}) {
  // Seed each region with its saved override if there is one, else its BASE classes — so
  // the controls read what's actually on the element. A stored string REPLACES the base.
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? r.base ?? ''])),
  )
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [open, setOpen] = useState<string | null>(null)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())
  const rowRefs = useRef<Map<string, HTMLElement | null>>(new Map())

  const controls = useMemo(() => buildStyleControls(options), [options])
  const groupedRegions = useMemo(() => groupStyleRegions(regions), [regions])

  // The frame's edit-list arrives asynchronously (on `ready`), so regions/values can
  // land after first render — re-seed when they do, without clobbering typing.
  const seedKey = regions.map((r) => r.key).join(',')
  const [seeded, setSeeded] = useState(seedKey)
  if (seeded !== seedKey) {
    setSeeded(seedKey)
    setText(Object.fromEntries(regions.map((r) => [r.key, values[r.key] ?? r.base ?? ''])))
  }

  // Clicking a styled region in the frame opens its accordion row (during-render reset,
  // same sanctioned pattern as the panel switch above).
  const [lastSel, setLastSel] = useState<string | null>(null)
  if (selected && selected !== lastSel) {
    setLastSel(selected)
    setOpen(selected)
  }
  useEffect(() => {
    if (!open) return
    rowRefs.current.get(open)?.scrollIntoView?.({ block: 'center' })
  }, [open])

  const persist = useCallback(
    (key: string, className: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorStyleAction(artistId, key, className))
    },
    [artistId],
  )

  // Flush pending edits on unmount so tabbing away can't drop the last change.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((className, key) => {
        void saveEditorStyleAction(artistId, key, className)
      })
    }
  }, [artistId])

  function edit(key: string, raw: string) {
    setText((t) => ({ ...t, [key]: raw }))
    // Validate with the SAME function the server uses, so the panel can't claim "Saved"
    // on a rejected write. Controls always emit clean utilities; only the Advanced raw
    // box can produce something invalid.
    const clean = cleanClassText(raw)
    setInvalid((s) => {
      const next = new Set(s)
      if (clean === null) next.add(key)
      else next.delete(key)
      return next
    })
    if (clean === null) return

    onApplyStyle?.(key, clean) // optimistic repaint in the frame
    pending.current.set(key, clean)
    const existing = timers.current.get(key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        persist(key, clean)
      }, 500),
    )
  }

  if (!regions.length) {
    return (
      <p className="px-5 py-6 text-sm leading-relaxed text-ink-muted">
        This site hasn&apos;t declared any styleable sections. A custom site sends its own
        edit-list when the preview loads; the built-in templates don&apos;t tag sections yet.
      </p>
    )
  }

  return (
    <div className="py-2">
      {/* Regions are grouped by their manifest `group` ("Hero", "Sections", …) so the
          panel reads as a short outline of the page rather than one long list. Regions
          with no group fall under a single unlabelled run, preserving manifest order. */}
      {groupedRegions.map(([group, rows]) => (
        <div key={group || '_'}>
          {group && <GroupLabel>{group}</GroupLabel>}
          {rows.map((r) => {
            const cls = text[r.key] ?? ''
            const isOpen = open === r.key
            return (
              <div
                key={r.key}
                ref={(el) => {
                  rowRefs.current.set(r.key, el)
                }}
              >
                <SectionRow
                  label={r.label}
                  open={isOpen}
                  onClick={() => setOpen(isOpen ? null : r.key)}
                />
                {isOpen && (
                  <div className={PANEL_BODY}>
                    {controls.map((control) => (
                      <StyleControlRow
                        key={control.id}
                        region={r}
                        control={control}
                        cls={cls}
                        onChange={(v) => edit(r.key, applyStyleValue(cls, control, v))}
                      />
                    ))}
                    {/* No raw-class escape hatch: this panel is for a MANAGER, and a
                        Tailwind class string is not something they can reason about
                        (Sam, 2026-07-21). The controls above own every utility they
                        understand; anything else in the region's base classes is
                        preserved untouched by applyStyleValue, just not editable here.
                        The validation below stays as a backstop so a bad value can
                        never be reported as "Saved". */}
                    {invalid.has(r.key) && (
                      <p className="pt-1 text-[11px] text-accent-red">
                        Not saved — that setting produced something the site can&apos;t use.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}

/* ── Text tools: edit the site's headings, taglines, bio, booking copy ───────── */
function TextTools({
  textFields,
  artistId,
  onApplyField,
}: {
  textFields: EditorTextField[]
  artistId: string
  onApplyField?: (key: string, value: string) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(textFields.map((f) => [f.key, f.value])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (key: string, value: string) => {
      pending.current.delete(key)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, key, () => saveEditorFieldAction(artistId, key, value))
    },
    [artistId],
  )

  // Flush any still-pending edits on unmount so a fast tab-away can't drop one.
  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((value, key) => {
        void saveEditorFieldAction(artistId, key, value)
      })
    }
  }, [artistId])

  function edit(field: EditorTextField, value: string) {
    setValues((v) => ({ ...v, [field.key]: value }))
    onApplyField?.(field.key, value) // optimistic live-preview paint
    pending.current.set(field.key, value)
    const existing = timers.current.get(field.key)
    if (existing) clearTimeout(existing)
    timers.current.set(
      field.key,
      setTimeout(() => {
        timers.current.delete(field.key)
        persist(field.key, value)
      }, 500),
    )
  }

  return (
    <div className="py-2">
      {textFields.map((f) => (
        <div key={f.key} className="px-5">
          <FieldRow icon={textFieldIcon(f.key, f.type)} label={f.label}>
            {f.multiline ? (
              <textarea
                value={values[f.key] ?? ''}
                onChange={(e) => edit(f, e.target.value)}
                className={cx(FIELD, 'min-h-20 resize-y leading-relaxed')}
              />
            ) : (
              <input
                type={f.type === 'email' ? 'email' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => edit(f, e.target.value)}
                className={FIELD}
              />
            )}
          </FieldRow>
        </div>
      ))}
      <SaveLine status={status} />
    </div>
  )
}

/* ── Link tools: edit / reorder / remove the site's outbound links ───────────── */
function LinkTools({
  links,
  artistId,
  onRemove,
  onReorder,
  onToggleOnSite,
  group,
  showAdd = true,
}: {
  links: EditorLink[]
  artistId: string
  onRemove: (l: EditorLink) => void
  onReorder: (fromId: string, toId: string) => void
  /** Names this list in the accessible labels. The panel renders LinkTools TWICE
   *  (Socials and Contact) and row labels used to be numbered per-list, so
   *  "Link 1 label" existed twice in the DOM — ambiguous to a screen reader and to
   *  getByLabelText. The group disambiguates them. */
  group: string
  /** The "Add link" footer. Off for the Contact group, which is a slice of the same
   *  list — one add affordance per panel, not one per group. */
  showAdd?: boolean
  onToggleOnSite: (l: EditorLink) => void
}) {
  const [values, setValues] = useState<Record<string, { label: string; url: string }>>(() =>
    Object.fromEntries(links.map((l) => [l.id, { label: l.label, url: l.url }])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  // Which row is expanded. Rows collapse to just their label; clicking one opens the
  // edit/remove controls below it (single-open accordion — keeps the list short).
  const [open, setOpen] = useState<string | null>(null)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // Latest values, so the unmount flush reads current text (synced off-render).
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  const persist = useCallback(
    (id: string, v: { label: string; url: string }) => {
      pending.current.delete(id)
      const fd = new FormData()
      fd.set('label', v.label)
      fd.set('url', v.url)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => updateContentAction('link', id, artistId, fd))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((id) => {
        const v = valuesRef.current[id]
        if (!v) return
        const fd = new FormData()
        fd.set('label', v.label)
        fd.set('url', v.url)
        void updateContentAction('link', id, artistId, fd)
      })
    }
  }, [artistId])

  function edit(id: string, patch: Partial<{ label: string; url: string }>) {
    const row = { ...(values[id] ?? { label: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const ok = row.label.trim() !== '' && row.url.trim() !== '' // both required — a blank one is dropped
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.delete(id)
    if (!ok) {
      pending.current.delete(id)
      return
    }
    pending.current.add(id)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, row)
      }, 500),
    )
  }

  function drop(to: number) {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from !== null && from !== to) onReorder(links[from].id, links[to].id)
  }

  return (
    <div className="pb-2 pt-1">
      {links.map((l, i) => {
        const v = values[l.id] ?? { label: l.label, url: l.url }
        const isOpen = open === l.id
        const labelBlank = !v.label.trim()
        const urlBlank = !v.url.trim()
        const rowInvalid = invalid.has(l.id)
        return (
          <div
            key={l.id}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragEnter={() => setDragOver(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(i)}
            onDragEnd={() => {
              dragFrom.current = null
              setDragOver(null)
            }}
            className={cx(dragOver === i && 'ring-2 ring-accent', rowInvalid && 'ring-1 ring-accent-red')}
          >
            {/* Collapsed header — the whole row is a button that opens the editor below
                it. Only the label shows (what the manager named it); an at-a-glance
                "Off" tag flags a link that isn't on the site. The grip sits INSIDE the
                row (no border to hang it off), so drag-to-reorder stays discoverable. */}
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : l.id)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 px-5 py-2.5 text-left hover:bg-surface-hover"
            >
              <span className="flex-none cursor-grab text-ink-faint" aria-hidden>
                <Icon name="grip" size={16} />
              </span>
              <span className={cx('min-w-0 flex-1 truncate text-[13px]', labelBlank ? 'text-ink-faint' : 'text-ink')}>
                {v.label.trim() || 'Untitled link'}
              </span>
              {!l.onSite && <span className={cx(EYEBROW, 'flex-none')}>Off</span>}
              <span
                className={cx('flex-none text-ink-faint transition-transform', isOpen && 'rotate-90')}
                aria-hidden
              >
                <Icon name="chevronRight" size={16} />
              </span>
            </button>

            {isOpen && (
              <div className={PANEL_BODY}>
                <FieldRow icon="text" label="Label">
                  <input
                    aria-label={`${group} link ${i + 1} label`}
                    aria-invalid={(rowInvalid && labelBlank) || undefined}
                    value={v.label}
                    onChange={(e) => edit(l.id, { label: e.target.value })}
                    placeholder="Label"
                    className={cx(FIELD_ON_TINT, rowInvalid && labelBlank && INVALID_FIELD)}
                  />
                </FieldRow>
                <FieldRow icon="links" label="URL">
                  <input
                    aria-label={`${group} link ${i + 1} URL`}
                    aria-invalid={(rowInvalid && urlBlank) || undefined}
                    type="url"
                    value={v.url}
                    onChange={(e) => edit(l.id, { url: e.target.value })}
                    placeholder="https://…"
                    className={cx(FIELD_ON_TINT, rowInvalid && urlBlank && INVALID_FIELD)}
                  />
                </FieldRow>
                <div className="grid grid-cols-[20px_1fr_auto] items-center gap-x-2.5 pt-2">
                  <span className="justify-self-center text-ink-faint" aria-hidden>
                    <Icon name="site" size={14} />
                  </span>
                  {/* justify-self-start: the grid's 1fr column would otherwise stretch
                      the pill across the whole row. */}
                  <OnSiteToggle on={l.onSite} onToggle={() => onToggleOnSite(l)} className="justify-self-start" />
                  <button
                    type="button"
                    aria-label={`Remove ${group.toLowerCase()} link ${i + 1}`}
                    onClick={() => onRemove(l)}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
                  >
                    <Icon name="trash" size={15} />
                    <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Remove</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {showAdd && (
        <Link
          href={`/artists/${artistId}/links`}
          className="flex items-center gap-2.5 px-5 py-2.5 text-accent hover:bg-surface-hover"
        >
          <Icon name="plus" size={16} />
          <span className="text-[13px]">Add link</span>
        </Link>
      )}

      <SaveLine status={status} />
    </div>
  )
}

/** A panel-level group heading for the Links panel ("Socials" / "Tour support"): the
 *  mono eyebrow padded to the gutter, with a hairline rule trailing it. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-4">
      <span className={EYEBROW}>{children}</span>
      <span className="h-px flex-1 bg-hairline-soft" />
    </div>
  )
}

/** Row identity for a support act = the two columns that key `support_urls`. A name can
 *  repeat across dates, so the tour date is part of the key. Module-level so it never
 *  enters an effect's dependency set. */
const supportKey = (l: EditorSupportLink) => `${l.tourDateId}::${l.name}`

/* ── Tour-support links: an outbound URL for each "+ act" across the tour dates ──────
 * The act NAMES are edited on the Tour page (tour_dates.support); here the manager only
 * sets each act's link (tour_dates.support_urls[name]), where they manage every other
 * link. Debounced autosave per row, mirroring LinkTools; no add/remove/reorder — the
 * acts come from the tour dates. */
function SupportLinkTools({
  supportLinks,
  artistId,
}: {
  supportLinks: EditorSupportLink[]
  artistId: string
}) {
  const [urls, setUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(supportLinks.map((l) => [supportKey(l), l.url])),
  )
  const [open, setOpen] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  // Latest urls + acts, so the unmount flush reads current values without either being
  // an effect dependency (same pattern as LinkTools' valuesRef).
  const urlsRef = useRef(urls)
  useEffect(() => {
    urlsRef.current = urls
  }, [urls])
  const linksRef = useRef(supportLinks)
  useEffect(() => {
    linksRef.current = supportLinks
  }, [supportLinks])

  const persist = useCallback(
    (l: EditorSupportLink, url: string) => {
      pending.current.delete(supportKey(l))
      setStatus('saving')
      runSerialized(saving, errored, setStatus, supportKey(l), () =>
        setSupportUrlAction(artistId, l.tourDateId, l.name, url),
      )
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((id) => {
        const l = linksRef.current.find((x) => supportKey(x) === id)
        if (l) void setSupportUrlAction(artistId, l.tourDateId, l.name, urlsRef.current[id] ?? '')
      })
    }
  }, [artistId])

  function edit(l: EditorSupportLink, url: string) {
    const id = supportKey(l)
    setUrls((u) => ({ ...u, [id]: url }))
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    pending.current.add(id)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(l, url)
      }, 500),
    )
  }

  if (supportLinks.length === 0) {
    return (
      <p className="px-5 pb-4 pt-1 text-xs leading-relaxed text-ink-faint">
        Add supporting acts to your tour dates on the{' '}
        <Link href={`/artists/${artistId}/tour`} className="text-accent hover:underline">
          Tour page
        </Link>{' '}
        to give each one an outbound link here.
      </p>
    )
  }

  return (
    <div className="pb-2 pt-1">
      {supportLinks.map((l) => {
        const id = supportKey(l)
        const url = urls[id] ?? ''
        const isOpen = open === id
        return (
          <div key={id}>
            {/* Collapsed: the act name (the "+ Gudfella" text) + whether it links out. */}
            <SectionRow
              label={l.name}
              open={isOpen}
              tag={<span className={cx(EYEBROW, 'flex-none')}>{url.trim() ? 'Linked' : 'No link'}</span>}
              onClick={() => setOpen(isOpen ? null : id)}
            />
            {isOpen && (
              <div className={PANEL_BODY}>
                {/* Names the exact credit this link attaches to, and which show. */}
                <p className="pb-1 text-[11px] leading-relaxed text-ink-muted">
                  Links the <span className="font-medium text-ink">“{l.name}”</span> credit on {l.show}.
                </p>
                <FieldRow icon="links" label="URL">
                  <input
                    aria-label={`Link for ${l.name} at ${l.show}`}
                    type="url"
                    value={url}
                    onChange={(e) => edit(l, e.target.value)}
                    placeholder="https://…  (blank = no link)"
                    className={FIELD_ON_TINT}
                  />
                </FieldRow>
              </div>
            )}
          </div>
        )
      })}

      <SaveLine status={status} />
    </div>
  )
}

/** A 16:9 card thumbnail — a YouTube poster, an uploaded video's first frame, or a
 *  fallback icon. Used by the 2-up slot grid and the picker modal. */
function CardThumb({ poster, previewUrl }: { poster: string | null; previewUrl?: string | null }) {
  return (
    <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-track text-ink-faint">
      {previewUrl ? (
        <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="videos" size={20} />
      )}
    </div>
  )
}

/** A mono section heading with a hairline rule, for grouping the video slots. */
function SlotGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className={EYEBROW}>{children}</span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  )
}

/** Library picker as a MODAL — a large grid of candidate items to place on the site.
 *  Opening it (an empty slot / Add tile, or a filled item's Replace) covers the site
 *  with an overlay so the choices get real room, rather than cramming a list into the
 *  left panel. Generic over the item type: videos, photos, and songs all reuse it via
 *  the `renderThumb` / `labelOf` callbacks. `empty` renders when there are no
 *  candidates (an "add first" link); `footer` sits under the grid (an uploader). */
function LibraryPicker<T>({
  title,
  candidates,
  keyOf,
  labelOf,
  renderThumb,
  empty,
  footer,
  onPick,
  onCancel,
}: {
  /** What the manager is filling, e.g. "Landscape · desktop" — shown as the heading. */
  title: string
  candidates: T[]
  keyOf: (v: T) => string
  labelOf: (v: T, i: number) => string
  renderThumb: (v: T) => React.ReactNode
  empty: React.ReactNode
  footer?: React.ReactNode
  onPick: (v: T) => void
  onCancel: () => void
}) {
  useLockBodyScroll(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pick from your library: ${title}`}
      className={modalOverlayClass}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className={cx(modalCardClass, 'no-scrollbar w-[720px] gap-4')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={EYEBROW}>Pick from your library</div>
            <h2 className="mt-1 text-lg font-bold leading-tight tracking-[-0.01em]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex-none rounded-md px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint hover:text-ink"
          >
            Close
          </button>
        </div>
        {candidates.length === 0 ? (
          empty
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {candidates.map((v, i) => (
              <button
                key={keyOf(v)}
                type="button"
                onClick={() => onPick(v)}
                className="group overflow-hidden rounded-lg border border-hairline text-left transition-colors hover:border-accent"
              >
                {renderThumb(v)}
                <span className="block truncate px-2 py-1.5 text-xs group-hover:text-accent">{labelOf(v, i)}</span>
              </button>
            ))}
          </div>
        )}
        {footer}
      </div>
    </div>
  )
}

/** The dashed "add / pick" tile that opens a picker. `aspect` matches the cards it
 *  sits beside (16:9 videos, 4:3 photos, square songs). */
function EmptySlot({
  label,
  onClick,
  aspect = 'aspect-video',
  ariaLabel,
  title,
  stretch = false,
}: {
  label: string
  onClick: () => void
  aspect?: string
  /** Grow to the grid row's height (the gallery grid, where a placed card is taller than
   *  its thumbnail). OFF by default: where a cell also holds a caption or hint below the
   *  slot, stretching fights that text for the row and it overflows into the next card. */
  stretch?: boolean
  /** Accessible name, when the visible label repeats across cards. Two polaroids both
   *  showing "Add photo" would be ambiguous to a screen reader and to getByRole. */
  ariaLabel?: string
  /** Hover text — the site's description of the slot, kept off the card face. */
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={title}
      className={cx(
        'flex w-full flex-col items-center justify-center gap-1 rounded-lg border-[1.5px] border-dashed border-hairline px-2 text-center text-ink-muted hover:border-accent hover:text-accent',
        stretch && 'h-full',
        aspect,
      )}
    >
      <Icon name="plus" size={18} />
      <span className="font-space text-[10px] font-bold uppercase leading-tight tracking-[0.08em]">{label}</span>
    </button>
  )
}

/** The little Replace / Remove menu a filled slot's edit button opens. Replace opens
 *  the picker; Remove empties the slot. */
function EditMenu({ onReplace, onRemove }: { onReplace: () => void; onRemove: () => void }) {
  return (
    <div data-edit-menu className="flex w-full gap-1">
      <button
        type="button"
        onClick={onReplace}
        className="flex-1 rounded-md border border-hairline px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.06em] text-ink-muted hover:border-accent hover:text-accent"
      >
        Replace
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="flex-1 rounded-md border border-hairline px-2 py-1 font-space text-[10px] font-bold uppercase tracking-[0.06em] text-accent-red hover:bg-danger-soft"
      >
        Remove
      </button>
    </div>
  )
}

/** The dashed "add your first item" link shown in a picker with no candidates left —
 *  points at the collection's own page (Videos / Music) to add one. */
function AddFirstLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-6 text-ink-muted hover:border-accent hover:text-accent"
    >
      <Icon name="plus" size={16} />
      <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">{label}</span>
    </Link>
  )
}

/* ── MediaGrid: an open-ended collection as on-site cards + an Add tile ───────────
 *
 * Images and Music aren't fixed slots like the video hero/band — they're open
 * collections. This shows what's ON the site as a 2-up card grid (each card carries
 * the same edit → Replace/Remove menu as the video slots), plus a trailing Add tile
 * that opens the LibraryPicker over the rest of the library. Remove takes an item OFF
 * the site (never deletes); Replace swaps it for another, and — like the video band —
 * the old item only leaves once a replacement is actually chosen (closing the picker
 * keeps it). `onSetOnSite(item, next)` is the single write both paths funnel through. */
function MediaGrid<T>({
  onSiteItems,
  library,
  noun,
  keyOf,
  labelOf,
  renderThumb,
  aspect,
  cols = 'grid-cols-2',
  pickTitle,
  addLabel,
  empty,
  pickerFooter,
  onSetOnSite,
}: {
  onSiteItems: T[]
  /** Off-site items — the picker's candidates. */
  library: T[]
  /** Singular noun for aria labels, e.g. "photo" → "Edit photo 1". */
  noun: string
  keyOf: (v: T) => string
  labelOf: (v: T, i: number) => string
  renderThumb: (v: T) => React.ReactNode
  /** Aspect of the Add tile — matches the cards' thumbnails. */
  aspect: string
  /** Column count for the on-site card grid (Tailwind class). Photos are 3-up; the
   *  default 2-up suits the wider video/song cards. */
  cols?: string
  pickTitle: string
  addLabel: string
  /** Shown in the picker when the library is empty. */
  empty: React.ReactNode
  pickerFooter?: React.ReactNode
  onSetOnSite: (v: T, next: boolean) => void
}) {
  const [picking, setPicking] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<T | null>(null)

  // A click anywhere outside an open Replace/Remove menu closes it (same pattern as
  // the video slots; the edit button fires on click, after this mousedown).
  useEffect(() => {
    if (!editingKey) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-edit-menu]')) setEditingKey(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editingKey])

  return (
    <div className="space-y-3 px-5 py-4">
      <div className={cx('grid gap-2', cols)}>
        {onSiteItems.map((item, i) => {
          const k = keyOf(item)
          return (
            <div key={k} className="overflow-hidden rounded-lg border border-hairline">
              {renderThumb(item)}
              <div className="px-2 py-1.5">
                {editingKey === k ? (
                  <EditMenu
                    onReplace={() => {
                      setEditingKey(null)
                      setReplacing(item)
                      setPicking(true)
                    }}
                    onRemove={() => {
                      setEditingKey(null)
                      onSetOnSite(item, false)
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs">{labelOf(item, i)}</span>
                    <button
                      type="button"
                      aria-label={`Edit ${noun} ${i + 1}`}
                      title="Replace or remove"
                      onClick={() => setEditingKey(k)}
                      className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <EmptySlot
          label={addLabel}
          aspect={aspect}
          stretch
          onClick={() => {
            setReplacing(null)
            setPicking(true)
          }}
        />
      </div>

      {picking && (
        <LibraryPicker
          title={pickTitle}
          candidates={library}
          keyOf={keyOf}
          labelOf={labelOf}
          renderThumb={renderThumb}
          empty={empty}
          footer={pickerFooter}
          onPick={(v) => {
            setPicking(false)
            // Replacing: take the old one off only now that a replacement is chosen.
            if (replacing) onSetOnSite(replacing, false)
            setReplacing(null)
            onSetOnSite(v, true)
          }}
          onCancel={() => {
            setPicking(false)
            setReplacing(null) // closing without picking keeps the current items
          }}
        />
      )}
    </div>
  )
}

const BAND_SLOTS = 2 // skeen's band is designed 2-up; show at least two slots.

/* ── Video tools: the site's video slots ─────────────────────────────────────────
 *
 * EVERY slot is filled by PICKING from the video library (added on the Videos/Assets
 * page). Grouped by where they live on the site:
 *  • Landing page — the hero background: a Landscape slot + a Portrait slot, each picks
 *    an UPLOADED video (assignHeroSlotAction sets its site_role; skeen reads it).
 *  • Videos band — the two YouTube embeds below the disco ball. Picking marks a YouTube
 *    video on-site; the picker offers only real YouTube videos (uploads are hero-only,
 *    Shorts aren't used). Removing a band video marks it off-site (stays in the library). */
function VideoTools({
  videos,
  artistId,
  onToggleOnSite,
  onAssignHero,
}: {
  videos: EditorVideo[]
  artistId: string
  onToggleOnSite: (v: EditorVideo) => void
  onAssignHero: (role: SiteVideoRole, videoId: string | null) => void
}) {
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(videos.map((v) => [v.id, v.title])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // Which slot's picker is open: a background role, the band, or none.
  const [picking, setPicking] = useState<SiteVideoRole | 'band' | null>(null)
  // Which filled slot's Replace/Remove menu is open.
  const [editing, setEditing] = useState<{ type: 'slot'; role: SiteVideoRole } | { type: 'band'; video: EditorVideo } | null>(
    null,
  )
  // The band video being REPLACED, if any. It stays on the site until a replacement is
  // actually picked — so closing the picker without choosing leaves it in place.
  const [replacingBand, setReplacingBand] = useState<EditorVideo | null>(null)
  // A click anywhere outside an open Replace/Remove menu closes it (the menus tag
  // themselves with data-edit-menu; the edit button that opens one fires on click,
  // after this mousedown, so it never self-closes).
  useEffect(() => {
    if (!editing) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-edit-menu]')) setEditing(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editing])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Map<string, string>>(new Map())

  const persist = useCallback(
    (id: string, title: string) => {
      pending.current.delete(id)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => renameVideoAction(id, artistId, title))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingMap = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingMap.forEach((title, id) => {
        void renameVideoAction(id, artistId, title)
      })
    }
  }, [artistId])

  function edit(id: string, title: string) {
    setTitles((t) => ({ ...t, [id]: title }))
    pending.current.set(id, title)
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, title)
      }, 500),
    )
  }

  const isYouTube = (v: EditorVideo) => v.provider === 'youtube' && !v.isShort
  const uploaded = videos.filter((v) => v.provider === 'uploaded')
  const bandSlots = videos.filter((v) => v.onSite && isYouTube(v))
  const bandLibrary = videos.filter((v) => !v.onSite && isYouTube(v))
  const addHref = `/artists/${artistId}/videos`

  function assignHero(role: SiteVideoRole, videoId: string | null) {
    setPicking(null)
    onAssignHero(role, videoId)
  }

  // A background slot as a card (preview on top, title + edit below). Clicking opens
  // the picker modal — see the render. Reused by both hero slots and the bio slot.
  function slotCard(role: SiteVideoRole) {
    const label = SLOT_LABELS[role]
    const placed = uploaded.find((v) => v.siteRole === role)
    return (
      <div key={role} className="space-y-1">
        <span className="font-space text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">{label}</span>
        {placed ? (
          <div className="overflow-hidden rounded-lg border border-hairline">
            <CardThumb poster={placed.poster} previewUrl={placed.previewUrl} />
            <div className="px-2 py-1.5">
              {editing?.type === 'slot' && editing.role === role ? (
                <EditMenu
                  onReplace={() => {
                    setEditing(null)
                    setPicking(role)
                  }}
                  onRemove={() => {
                    setEditing(null)
                    assignHero(role, null)
                  }}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-xs">{placed.title || 'Untitled video'}</span>
                  <button
                    type="button"
                    aria-label={`Edit the ${label} slot`}
                    title="Replace or remove"
                    onClick={() => setEditing({ type: 'slot', role })}
                    className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                  >
                    <Icon name="edit" size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <EmptySlot label="Pick a video" onClick={() => setPicking(role)} />
        )}
      </div>
    )
  }

  // The open background-slot picker (any role but 'band'), and whatever video sits in it.
  const slotRole = picking && picking !== 'band' ? picking : null
  const slotPlaced = slotRole ? uploaded.find((v) => v.siteRole === slotRole) : undefined

  return (
    <div className="space-y-3 px-5 py-4">
      {/* Landing page — the hero background, two slots side by side */}
      <SlotGroupLabel>Landing page</SlotGroupLabel>
      <div className="grid grid-cols-2 gap-2">
        {slotCard('hero_landscape')}
        {slotCard('hero_portrait')}
      </div>

      {/* Bio background — the clip that plays behind the bio section */}
      <SlotGroupLabel>Bio background</SlotGroupLabel>
      <div className="grid grid-cols-2 gap-2">{slotCard('bio_background')}</div>

      {slotRole && (
        <LibraryPicker
          title={SLOT_LABELS[slotRole]}
          // Only uploaded videos, and not one already in ANOTHER background slot.
          candidates={uploaded.filter((v) => !v.siteRole || v.id === slotPlaced?.id)}
          keyOf={(v) => v.id}
          labelOf={(v) => v.title || 'Untitled video'}
          renderThumb={(v) => <CardThumb poster={v.poster} previewUrl={v.previewUrl} />}
          empty={<AddFirstLink href={addHref} label="Add a video first" />}
          onPick={(v) => assignHero(slotRole, v.id)}
          onCancel={() => setPicking(null)}
        />
      )}

      {/* Videos band — two YouTube slots below the disco ball */}
      <SlotGroupLabel>Videos band</SlotGroupLabel>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: Math.max(BAND_SLOTS, bandSlots.length) }).map((_, i) => {
          const v = bandSlots[i]
          if (!v) return <EmptySlot key={`band-empty-${i}`} label="Pick a YouTube video" onClick={() => setPicking('band')} />
          return (
            <div key={v.id} className="overflow-hidden rounded-lg border border-hairline">
              <CardThumb poster={v.poster} previewUrl={v.previewUrl} />
              <div className="px-1.5 py-1">
                {editing?.type === 'band' && editing.video.id === v.id ? (
                  <EditMenu
                    onReplace={() => {
                      setEditing(null)
                      // Don't vacate yet — mark it as the one to swap out, and only take
                      // it off when a replacement is actually picked (see the picker).
                      setReplacingBand(v)
                      setPicking('band')
                    }}
                    onRemove={() => {
                      setEditing(null)
                      onToggleOnSite(v)
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-0.5">
                    <input
                      aria-label={`Slot ${i + 1} title`}
                      value={titles[v.id] ?? ''}
                      onChange={(e) => edit(v.id, e.target.value)}
                      placeholder="Title"
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 font-space text-xs text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:border-hairline"
                    />
                    <button
                      type="button"
                      aria-label={`Edit video slot ${i + 1}`}
                      title="Replace or remove"
                      onClick={() => setEditing({ type: 'band', video: v })}
                      className="flex-none rounded-md p-1 text-ink-faint hover:bg-surface hover:text-ink"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {picking === 'band' && (
        <LibraryPicker
          title={replacingBand ? 'Replace with' : 'YouTube video'}
          candidates={bandLibrary}
          keyOf={(v) => v.id}
          labelOf={(v) => v.title || 'Untitled video'}
          renderThumb={(v) => <CardThumb poster={v.poster} previewUrl={v.previewUrl} />}
          empty={<AddFirstLink href={addHref} label="Add a video first" />}
          onPick={(v) => {
            setPicking(null)
            // Replacing: take the old one off only now that a new one is chosen.
            if (replacingBand) onToggleOnSite(replacingBand)
            setReplacingBand(null)
            onToggleOnSite(v)
          }}
          onCancel={() => {
            setPicking(null)
            setReplacingBand(null) // closing without picking keeps the old video
          }}
        />
      )}

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/* ── Tour tools: pick which dates are on the site (no reorder — dates sort by date) ─ */

/** "12 SEP 26" — compact and unambiguous, from a YYYY-MM-DD column. */
function tourDateLabel(date: string | null): string {
  if (!date) return 'No date'
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return 'No date'
  return `${d} ${MONTHS_SHORT[m - 1] ?? ''} ${String(y).slice(-2)}`
}

const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * The tour-date library, each with a LIVE on-site toggle (ADR 0009): this is where a
 * manager picks which dates the site shows, and the toggle takes effect without a
 * publish. Dates are ENTERED on the Tour page — venue, city, country, supporting acts
 * — so there are no fields here; the editor's job is placement, not data entry.
 *
 * No drag handles, unlike every other list: tour dates have no `sort_order` and the
 * public door orders them by `date`, so a manual order would be a lie.
 *
 * A date must be PUBLISHED once before its toggle reaches the site — the door serves
 * the published snapshot and gates it on this flag, so an unpublished date isn't there
 * to gate, and toggling it is a no-op on the live site until it's published from the
 * Tour page. The empty-state copy points there; the toggle itself carries no
 * per-row published-state indicator (the editor loads working rows, which don't know
 * publish status), so this is a known gap, not a guardrail.
 */
function TourTools({
  tours,
  artistId,
  onRemove,
  onReorder,
  onToggleOnSite,
}: {
  tours: EditorTour[]
  artistId: string
  onRemove: (t: EditorTour) => void
  /** Reorder by ID. Only undated shows participate — see `draggable` below. */
  onReorder: (fromId: string, toId: string) => void
  onToggleOnSite: (t: EditorTour) => void
}) {
  const dragFrom = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function drop(toId: string) {
    const fromId = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (fromId && fromId !== toId) onReorder(fromId, toId)
  }

  return (
    <div className="space-y-2.5 px-5 py-4">
      {tours.length === 0 && (
        <p className="py-2 font-space text-[11px] leading-relaxed text-ink-faint">
          No dates yet. Add them on the Tour page, publish, then pick them here.
        </p>
      )}

      {tours.map((t) => {
        // A DATED show sorts itself by date on the site forever, so dragging it would be
        // a lie — the order wouldn't survive. Only undated shows, which the site can't
        // sequence on its own, get a handle (20260723120000).
        const canDrag = !t.date
        return (
        <div
          key={t.id}
          draggable={canDrag}
          onDragStart={() => canDrag && (dragFrom.current = t.id)}
          onDragEnter={() => canDrag && setDragOver(t.id)}
          onDragOver={(e) => canDrag && e.preventDefault()}
          onDrop={() => canDrag && drop(t.id)}
          onDragEnd={() => {
            dragFrom.current = null
            setDragOver(null)
          }}
          className={cx(
            'flex items-start gap-2.5 rounded-lg border border-hairline p-2.5',
            dragOver === t.id && 'ring-2 ring-accent',
          )}
        >
          {canDrag ? (
            <span className="mt-0.5 flex-none cursor-grab text-ink-faint" aria-hidden>
              <Icon name="grip" size={14} />
            </span>
          ) : null}
          <span className="mt-0.5 w-[4.5rem] flex-none font-space text-[11px] font-bold uppercase tracking-[0.04em] text-ink">
            {tourDateLabel(t.date)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[13px] font-medium">{t.venue || 'Untitled venue'}</span>
            {[t.city, t.state ?? t.country].filter(Boolean).length > 0 && (
              <span className="truncate font-space text-[11px] text-ink-muted">
                {[t.city, t.state ?? t.country].filter(Boolean).join(', ')}
              </span>
            )}
            {t.support.length > 0 && (
              <span className="truncate font-space text-[11px] text-ink-faint">+ {t.support.join(', ')}</span>
            )}
            <OnSiteToggle on={t.onSite} onToggle={() => onToggleOnSite(t)} />
          </div>
          <button
            type="button"
            aria-label={`Remove ${t.venue || 'date'}`}
            onClick={() => onRemove(t)}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
        )
      })}

      <Link
        href={`/artists/${artistId}/tour`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add date</span>
      </Link>
    </div>
  )
}

/* ── Merch tools: edit title / price / url, remove (no reorder — no sort_order) ─ */
function MerchTools({
  merch,
  artistId,
  onRemove,
}: {
  merch: EditorMerch[]
  artistId: string
  onRemove: (m: EditorMerch) => void
}) {
  type Fields = { title: string; price: string; url: string }
  const [values, setValues] = useState<Record<string, Fields>>(() =>
    Object.fromEntries(merch.map((m) => [m.id, { title: m.title, price: m.price, url: m.url }])),
  )
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saving = useRef<Map<string, Promise<unknown>>>(new Map())
  const errored = useRef<Set<string>>(new Set())
  const pending = useRef<Set<string>>(new Set())
  const valuesRef = useRef(values)
  useEffect(() => {
    valuesRef.current = values
  }, [values])

  // Title is required; price must be blank or a number — else the write is dropped server-side.
  const badFields = (v: Fields) => ({
    title: v.title.trim() === '',
    price: v.price.trim() !== '' && Number.isNaN(Number(v.price)),
  })

  const persist = useCallback(
    (id: string, v: Fields) => {
      pending.current.delete(id)
      const fd = new FormData()
      fd.set('title', v.title)
      fd.set('price', v.price)
      fd.set('url', v.url)
      setStatus('saving')
      runSerialized(saving, errored, setStatus, id, () => updateContentAction('merch', id, artistId, fd))
    },
    [artistId],
  )

  useEffect(() => {
    const timersMap = timers.current
    const pendingSet = pending.current
    return () => {
      timersMap.forEach((t) => clearTimeout(t))
      pendingSet.forEach((id) => {
        const v = valuesRef.current[id]
        if (!v) return
        const fd = new FormData()
        fd.set('title', v.title)
        fd.set('price', v.price)
        fd.set('url', v.url)
        void updateContentAction('merch', id, artistId, fd)
      })
    }
  }, [artistId])

  function edit(id: string, patch: Partial<Fields>) {
    const row: Fields = { ...(values[id] ?? { title: '', price: '', url: '' }), ...patch }
    setValues((v) => ({ ...v, [id]: { ...v[id], ...patch } }))
    const bad = badFields(row)
    const ok = !bad.title && !bad.price
    setInvalid((s) => {
      const n = new Set(s)
      if (ok) n.delete(id)
      else n.add(id)
      return n
    })
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    timers.current.delete(id)
    if (!ok) {
      pending.current.delete(id)
      return
    }
    pending.current.add(id)
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id)
        persist(id, row)
      }, 500),
    )
  }

  const control =
    'w-full rounded-md border border-hairline px-2.5 py-1.5 font-space text-[13px] text-ink outline-none placeholder:font-space placeholder:text-ink-faint focus:border-ink-faint'

  return (
    <div className="space-y-2.5 px-5 py-4">
      {merch.map((m, i) => (
        <div key={m.id} className="flex items-start gap-2.5 rounded-lg border border-hairline p-2.5">
          <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-md bg-track text-ink-faint">
            {m.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <Icon name="merch" size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              aria-label={`Product ${i + 1} name`}
              aria-invalid={(invalid.has(m.id) && !values[m.id]?.title.trim()) || undefined}
              value={values[m.id]?.title ?? ''}
              onChange={(e) => edit(m.id, { title: e.target.value })}
              placeholder="Item name"
              className={cx(control, invalid.has(m.id) && !values[m.id]?.title.trim() && INVALID_RING)}
            />
            <div className="flex gap-1.5">
              <input
                aria-label={`Product ${i + 1} price`}
                aria-invalid={
                  (invalid.has(m.id) && badFields(values[m.id] ?? { title: '', price: '', url: '' }).price) ||
                  undefined
                }
                value={values[m.id]?.price ?? ''}
                onChange={(e) => edit(m.id, { price: e.target.value })}
                placeholder="Price"
                inputMode="decimal"
                className={cx(
                  control,
                  'w-20 flex-none',
                  invalid.has(m.id) &&
                    badFields(values[m.id] ?? { title: '', price: '', url: '' }).price &&
                    INVALID_RING,
                )}
              />
              <input
                aria-label={`Product ${i + 1} URL`}
                type="url"
                value={values[m.id]?.url ?? ''}
                onChange={(e) => edit(m.id, { url: e.target.value })}
                placeholder="https://…"
                className={cx(control, 'min-w-0 flex-1 font-space text-xs text-ink-muted')}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label={`Remove product ${i + 1}`}
            onClick={() => onRemove(m)}
            className="mt-0.5 flex-none rounded-md p-1.5 text-ink-faint hover:bg-danger-soft hover:text-accent-red"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      ))}

      <Link
        href={`/artists/${artistId}/merch`}
        className="flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-hairline px-3 py-2.5 text-ink-muted hover:border-accent hover:text-accent"
      >
        <Icon name="plus" size={16} />
        <span className="font-space text-[10px] font-bold uppercase tracking-[0.08em]">Add product</span>
      </Link>

      {status !== 'idle' && (
        <div
          className={cx(
            'font-space text-[10px] uppercase tracking-[0.08em]',
            status === 'error' ? 'text-accent-red' : 'text-ink-faint',
          )}
        >
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Failed'}
        </div>
      )}
    </div>
  )
}

/** A square song-cover thumbnail for a music card / picker tile. */
function SongThumb({ coverUrl }: { coverUrl: string | null }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden bg-track text-ink-faint">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name="tracks" size={22} />
      )}
    </div>
  )
}

/* ── Music tools: the setlist as on-site cover cards + an Add tile (mirrors Videos).
 * Songs are entered/renamed on the Music page; here the manager just picks which are on
 * the site. Remove takes a song off (never deletes); Replace swaps it for another from
 * the catalog — the old one only leaves once a replacement is chosen. */
/** Album/EP/single, shown as a short mono tag on each project cover. */
/**
 * The Music panel lists PROJECTS, not songs (Sam, 2026-07-21): the site renders one
 * cover per album/EP/single, so listing every track inside an album is noise. Projects
 * are a 3-up cover grid ordered newest-first (by release date, in page.tsx) with a
 * per-project on/off toggle. A project's on/off flips `on_site` on its songs — the flag
 * the site gates on — leaving `released` (the library label) alone. Songs are managed on
 * the Music page; here the manager only chooses which projects show.
 */
function MusicTools({
  releases,
  artistId,
  onToggleOnSite,
}: {
  releases: EditorProject[]
  artistId: string
  onToggleOnSite: (r: EditorProject) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (releases.length === 0) {
    return (
      <div className="px-5 py-4">
        <AddFirstLink href={`/artists/${artistId}/music`} label="Add music first" />
      </div>
    )
  }

  // Cards are 3-up. Clicking one opens its tracklist FULL-WIDTH under its row (not just
  // under the card), so it reads as "these songs belong to this album" — which needs the
  // grid chunked into rows of 3, with the open list injected after the owning row.
  const rows: EditorProject[][] = []
  for (let i = 0; i < releases.length; i += 3) rows.push(releases.slice(i, i + 3))

  return (
    <div className="space-y-2.5 px-5 py-4">
      {rows.map((row, ri) => {
        const openInRow = row.find((r) => r.key === open)
        return (
          <div key={ri} className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {row.map((r) => {
                const isOpen = r.key === open
                // An off-site card dims — but the toggle must NOT, or the one control that
                // turns it back on reads as disabled. CSS opacity composites the whole
                // subtree, so the dim lives on the thumbnail/tag/text, never on the card,
                // and the toggle button sits outside it at full strength.
                const dim = !r.onSite && 'opacity-55'
                return (
                  <div
                    key={r.key}
                    className={cx(
                      'relative overflow-hidden rounded-lg border',
                      isOpen ? 'border-accent ring-1 ring-accent' : 'border-hairline',
                    )}
                  >
                    {/* The card face expands the tracklist; the on/off toggle is a SIBLING
                        overlaid on top (valid HTML — no button inside a button — and it
                        receives its own clicks without needing stopPropagation). */}
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${r.title || 'Untitled'} — ${plural(r.songs.length, 'song')}`}
                      onClick={() => setOpen(isOpen ? null : r.key)}
                      className="block w-full text-left"
                    >
                      <div className={cx('relative', dim)}>
                        <SongThumb coverUrl={r.cover_url} />
                        <span className="absolute left-1 top-1 rounded bg-ink/70 px-1 py-0.5 font-space text-[8px] font-bold uppercase tracking-[0.06em] text-paper">
                          {RELEASE_TYPE_LABEL[r.kind as ReleaseType] ?? r.kind}
                        </span>
                      </div>
                      <div className={cx('px-1.5 py-1', dim)}>
                        <span className="block truncate text-[11px] text-ink">{r.title || 'Untitled'}</span>
                        <span className="block font-space text-[9px] text-ink-faint">{plural(r.songs.length, 'song')}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={r.onSite ? `Take ${r.title || 'project'} off the site` : `Put ${r.title || 'project'} on the site`}
                      aria-pressed={r.onSite}
                      onClick={() => onToggleOnSite(r)}
                      className={cx(
                        'absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition-colors',
                        r.onSite ? 'bg-accent text-white' : 'bg-paper text-ink shadow-sm hover:bg-accent hover:text-white',
                      )}
                    >
                      <Icon name={r.onSite ? 'check' : 'plus'} size={12} />
                    </button>
                  </div>
                )
              })}
            </div>

            {openInRow && (
              <div className="rounded-lg bg-surface px-3 py-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className={cx(EYEBROW, 'flex-1 truncate')}>{openInRow.title || 'Untitled'}</span>
                  <span className="font-space text-[9px] text-ink-faint">{plural(openInRow.songs.length, 'song')}</span>
                </div>
                <ol className="space-y-0.5">
                  {openInRow.songs.map((song, i) => (
                    <li key={song.id} className="flex items-baseline gap-2 text-[12px] text-ink">
                      <span className="w-4 flex-none text-right font-space text-[10px] text-ink-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{song.title}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

