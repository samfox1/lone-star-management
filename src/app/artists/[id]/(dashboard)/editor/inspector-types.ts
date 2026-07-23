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
  /** The other acts on the bill. Never null — the column is NOT NULL DEFAULT '{}'. */
  support: string[]
  onSite: boolean
}
