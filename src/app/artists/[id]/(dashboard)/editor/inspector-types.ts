import { type Orientation } from '@/lib/site-editor/gallery'

/**
 * The editor inspector's DATA vocabulary — the view-model each panel edits. One row of
 * the manager's library (a photo, link, video, song project, tour date) as the inspector
 * sees it: already narrowed to what a panel renders and toggles, not the raw DB shape.
 *
 * Lives apart from editor-inspector.tsx so a panel file imports the types it needs
 * without pulling in the whole inspector, and so page.tsx (which builds these) and the
 * panels (which render them) agree on one definition. Re-exported from editor-inspector
 * for callers that still import from there.
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
  /** True for a text AREA of the site the manager can restyle but not retype — a heading
   *  or a section written into the design rather than declared as editable copy. Most of a
   *  site's text is this kind, and leaving it out of the panel made the Text panel show
   *  five captions on an eleven-region site. */
  styleOnly?: boolean
  /** What the SITE renders when this field is unset, as declared in its manifest.
   *
   *  A field with no row is genuinely empty in the database, and the panel used to say so —
   *  which is accurate and useless: the manager is looking at a page full of words being
   *  told every one of them is "Empty". Custom sites keep their own fallbacks in code, so
   *  this is the only way we can know what is actually on screen. */
  defaultValue?: string
  /** The style region dressing this field's element, when the site declares one — the
   *  Text panel offers Font/Size/Boldness against it, so the words and how they look are
   *  edited in one place. Null when the site declares no region for this field, which is
   *  every field of a built-in template today (they declare no regions at all). */
  styleRegion?: { key: string; label: string; base?: string } | null
}
/** A single image/video opened for full-panel editing (Replace / Remove / styling). The
 *  inspector holds the live state + place handlers, so a tile passes only this descriptor. */
export type ItemEdit =
  | { type: 'imageSlot'; role: string; label: string }
  | { type: 'galleryPhoto'; id: string; orientation: Orientation; label: string }
  /** A background video slot (hero landscape/portrait, bio) — style key `slot:<role>`. */
  | { type: 'videoSlot'; role: SiteVideoRole; label: string }
  /** A YouTube video in the band — style key `video:<id>`. */
  | { type: 'bandVideo'; id: string; label: string }
/**
 * A single-occupancy IMAGE region the site declares as a manifest field (the hero image,
 * the profile photo) — one fixed image, not an open collection like the gallery. The
 * manager replaces or clears it. `previewUrl` is the current image (null = empty slot);
 * `target` is how it saves (an artist URL column, or a media row by purpose). The site
 * marks it `data-lse-field="<key>"`, so its highlight target is `{kind:'field', key}`.
 */
export type EditorImageField = {
  key: string
  label: string
  previewUrl: string | null
  target: { store: 'artist'; column: 'hero_image_url' } | { store: 'media'; purpose: 'profile_photo' }
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
 *  Songs are grouped into it by their parent `release_id` (see lib/music.ts). A project
 *  is not an entity the manager edits; it is a view over its songs. Site visibility is
 *  the songs' `on_site`; ordering is by release date. */
export type EditorProject = {
  /** Stable React key (`release:<id>` or `track:<id>`). NOT used to gate anything — a
   *  song belongs to a project by its parent release_id, not by pointing at this. */
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
  /** Where Tickets points — editable in the per-show editor (Sam, 2026-08-17). */
  ticketUrl: string | null
  /** The other acts on the bill. Never null — the column is NOT NULL DEFAULT '{}'. */
  support: string[]
  onSite: boolean
}
