/**
 * Release classification — shared by the server actions (validation) and the
 * dashboard/public UI (labels, filter chips). Keep in sync with the DB CHECK in
 * 20260706160000_release_type.sql. Ordered smallest→largest, with "featured" last
 * (a release the artist appears on rather than headlines).
 */
export const RELEASE_TYPES = ['single', 'ep', 'album', 'featured'] as const
export type ReleaseType = (typeof RELEASE_TYPES)[number]

export const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = {
  single: 'Single',
  ep: 'EP',
  album: 'Album',
  featured: 'Featured',
}

/** Coerce arbitrary input to a valid release type (default 'single'). */
export function toReleaseType(raw: string | null | undefined): ReleaseType {
  return (RELEASE_TYPES as readonly string[]).includes(raw ?? '') ? (raw as ReleaseType) : 'single'
}
