/**
 * THE OVERVIEW'S WORDS AND MARKS (Sam, 2026-10-05: "Looks great, lets do it", the mock in
 * prototypes/overview_20261002.html). Pure: the page reads, these decide what each row says.
 *
 *   the Site row     the address, and how many sections wait (or Live)
 *   a tool row       its count where it has one, and its unpublished dot
 *   the Publish bar  what is waiting, in a few words
 *
 * Every number here is one the page already read (counts of real rows, the unpublished diff).
 * Nothing is estimated: a tool with no count shows none.
 */
import { siteUnpublished, type SectionDiff, type UnpublishedDiff } from '@/lib/content'
import { publicSiteOrigin } from '@/lib/custom-site'
import { displayAddress } from '@/lib/settings'
import { plural } from '../format'
import { PROFILE_SEG } from '../profile/route'

/** null: the count could not be read. The row then shows none, never a 0 it did not see. */
export type OverviewCounts = {
  /** connectedCount(): sources with an id saved, plus a connected Shopify store. */
  connected: number
  subscribers: number | null
  /** Enquiries with no read_at. */
  unread: number | null
}

/** A tool row's value on the right. `strong`: ink instead of faint (unread enquiries). */
export type ToolValue = { text: string; strong: boolean }

/** The count a tool row shows, or null for a tool that has none. "connected", not "synced":
 *  connectedCount() counts saved ids, and the Connections page calls a source synced only once
 *  its rows exist, so "synced" here could claim a pull that never landed. */
export function toolValue(seg: string, c: OverviewCounts): ToolValue | null {
  if (seg === 'connections') return { text: `${c.connected} connected`, strong: false }
  if (seg === 'subscribers' && c.subscribers !== null) return { text: String(c.subscribers), strong: false }
  if (seg === 'enquiries' && c.unread !== null) return { text: `${c.unread} unread`, strong: c.unread > 0 }
  return null
}

/**
 * Whether a tool row wears the unpublished dot. A tool's own route segment, as the nav reads
 * it (dirtyBySeg), except PROFILE: it has no segment of its own in the diff, and its Publish
 * bar ships the profile, the site text and the site's photos (siteUnpublished). That dot sat on
 * "Site & profile", which a custom site no longer lists, so it moved here.
 */
export function toolDot(seg: string, diff: UnpublishedDiff, dirtyBySeg: Record<string, boolean>): boolean {
  if (seg === PROFILE_SEG) return siteUnpublished(diff)
  return dirtyBySeg[seg] ?? false
}

/** The site's address as a person says it: "skeenmusic.com", or the platform page. */
export function siteAddress(artist: { slug: string; site_kind?: string | null; custom_site_url?: string | null }): string {
  return displayAddress(publicSiteOrigin(artist)) || `/${artist.slug}`
}

const changes = (d: SectionDiff) => d.added + d.edited + d.deleted

/** One word per section, in DIFF_SECTIONS' order. A Record over the diff's keys, so a new
 *  section is a compile error here until it has its word. Media is said by halves (below). */
const WORD: { [K in keyof UnpublishedDiff]: (d: UnpublishedDiff[K]) => string[] } = {
  profile: () => ['profile'],
  track: () => ['songs'],
  video: () => ['videos'],
  tour_date: () => ['tour dates'],
  merch: () => ['merch'],
  release: () => ['releases'],
  link: (d) => [plural(changes(d), 'link', 'links')],
  // The site's photos ship from Profile's bar, the logos and icons from Brand's: two words. A
  // diff without the halves (an older cache) says the whole as photos.
  media: (d) => {
    const halves = [...(d.site?.dirty ? ['photos'] : []), ...(d.brand?.dirty ? ['logos'] : [])]
    return halves.length ? halves : ['photos']
  },
  site_content: () => ['site text'],
  site_styles: () => ['site styles'],
  artist_font: () => ['fonts'],
  brand_color: () => ['colors'],
  theme_color: () => ['browser bar'],
}

/** What the Publish bar says is waiting: "Profile, site text and 1 link changed". '' when
 *  nothing is, which keeps the bar down. The bar adds " · not on the site yet" itself. */
export function waitingMessage(diff: UnpublishedDiff): string {
  const parts: string[] = []
  for (const key of Object.keys(WORD) as (keyof UnpublishedDiff)[]) {
    const d = diff[key]
    if (!d?.dirty) continue
    for (const w of (WORD[key] as (d: SectionDiff) => string[])(d)) if (!parts.includes(w)) parts.push(w)
  }
  if (!parts.length) return ''
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} changed`
}
