/**
 * THE SOCIAL PLATFORM VOCABULARY — one list, shared by the editor's picker and every
 * connected site's renderer.
 *
 * Sam, 2026-08-09: "I want the user to be able to choose from a selector where we have a
 * preexisting list of social links that they can add, that way we have the icon preset."
 *
 * It lives in the package because BOTH halves need the same names: lone-star draws the
 * picker, the site draws the icon in its own style. Contract, like `LIBRARY_ASSETS` and
 * `FONT_SLOTS` — a site reads `slug` and maps it to its OWN glyph, so the standard names
 * the platform and never dictates a pixel (decision #4).
 *
 * `slug` is the join key and is derived from the label by the same lowercasing the item
 * markers already use (`item:link:instagram`), so a link row labelled "Apple Music" and a
 * site marker of `apple music` meet without a second mapping.
 */

export type SocialPlatform = {
  /** Stable join key. Lowercase, spaces kept — `label.toLowerCase()`. */
  slug: string
  /** What the manager sees, and what the `links` row is labelled. */
  label: string
  /** Prefilled when the manager picks this platform, so they paste a handle rather than
   *  reconstruct a URL. Not validation — an artist's page may live anywhere. */
  urlHint: string
}

/**
 * The platforms offered in the picker, in the order they appear.
 *
 * Additive only: removing an entry orphans every link row already labelled with it. A
 * platform NOT on this list is still reachable — the picker keeps a "Something else"
 * path — because an artist will always have somewhere we have not heard of.
 */
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  { slug: 'instagram', label: 'Instagram', urlHint: 'https://instagram.com/' },
  { slug: 'tiktok', label: 'TikTok', urlHint: 'https://tiktok.com/@' },
  { slug: 'youtube', label: 'YouTube', urlHint: 'https://youtube.com/@' },
  { slug: 'spotify', label: 'Spotify', urlHint: 'https://open.spotify.com/artist/' },
  { slug: 'apple music', label: 'Apple Music', urlHint: 'https://music.apple.com/artist/' },
  { slug: 'soundcloud', label: 'SoundCloud', urlHint: 'https://soundcloud.com/' },
  { slug: 'bandcamp', label: 'Bandcamp', urlHint: 'https://bandcamp.com/' },
  { slug: 'facebook', label: 'Facebook', urlHint: 'https://facebook.com/' },
  { slug: 'x', label: 'X', urlHint: 'https://x.com/' },
  { slug: 'threads', label: 'Threads', urlHint: 'https://threads.net/@' },
  { slug: 'substack', label: 'Substack', urlHint: 'https://substack.com/@' },
  { slug: 'patreon', label: 'Patreon', urlHint: 'https://patreon.com/' },
  { slug: 'discord', label: 'Discord', urlHint: 'https://discord.gg/' },
  { slug: 'twitch', label: 'Twitch', urlHint: 'https://twitch.tv/' },
  { slug: 'deezer', label: 'Deezer', urlHint: 'https://deezer.com/artist/' },
  { slug: 'tidal', label: 'Tidal', urlHint: 'https://tidal.com/artist/' },
] as const

/** The slug a link row's label joins on. The ONE normalization, so the editor, the
 *  markers and any site all fold "Apple Music" to the same string. */
export function socialSlug(label: string): string {
  return label.trim().toLowerCase()
}

/** The registry entry for a label, or null when the artist has added something we do not
 *  know — which is allowed, and must render as a plain link rather than nothing. */
export function socialPlatform(label: string): SocialPlatform | null {
  const slug = socialSlug(label)
  return SOCIAL_PLATFORMS.find((p) => p.slug === slug) ?? null
}

/** The registrable domain of a URL — its last two host labels (`instagram.com` from
 *  `www.instagram.com`, `spotify.com` from `open.spotify.com`), lowercased. Null when
 *  the string will not parse as a URL. */
function registrableHost(url: string): string | null {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, '')
    const parts = host.split('.')
    return parts.length >= 2 ? parts.slice(-2).join('.') : host || null
  } catch {
    return null
  }
}

/**
 * Infer the platform from a link's URL — so the editor can drop the manual label and
 * pick the icon from what the manager pasted (Sam, 2026-08-12: "the tool should be able
 * to pick up the type of button based on the url"). Matches on the registrable domain of
 * each platform's `urlHint`, so subdomains and `www.` don't matter. Null for a host we
 * don't know (a personal site) — the caller keeps the URL as a plain link with no icon.
 */
export function platformFromUrl(url: string): SocialPlatform | null {
  const host = registrableHost(url)
  if (!host) return null
  return SOCIAL_PLATFORMS.find((p) => registrableHost(p.urlHint) === host) ?? null
}
