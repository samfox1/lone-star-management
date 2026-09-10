/**
 * Release classification — shared by the server actions (validation) and the
 * dashboard/public UI (labels, filter chips). Keep in sync with the DB CHECK, last
 * widened in 20260821140000_release_type_live.sql. Ordered smallest→largest, then the
 * two kinds that are about PROVENANCE rather than size: "live" (a recording of a
 * performance, Sam 2026-08-21) and "featured" (a release the artist appears on rather
 * than headlines).
 */
export const RELEASE_TYPES = ['single', 'ep', 'album', 'remix', 'live', 'featured'] as const
export type ReleaseType = (typeof RELEASE_TYPES)[number]

export const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = {
  single: 'Single',
  ep: 'EP',
  album: 'Album',
  remix: 'Remix',
  // 'Live set', not 'Live' (Sam, 2026-09-10): these are recordings of whole live sets
  // and performances, usually off SoundCloud, and "Live" alone read as a status.
  live: 'Live set',
  featured: 'Featured',
}

/** Coerce arbitrary input to a valid release type (default 'single'). */
export function toReleaseType(raw: string | null | undefined): ReleaseType {
  return (RELEASE_TYPES as readonly string[]).includes(raw ?? '') ? (raw as ReleaseType) : 'single'
}
