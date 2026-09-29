/**
 * Generate `packages/site-bridge/src/social-icons.ts` — the brand mark for each platform
 * in `SOCIAL_PLATFORMS`.
 *
 * WHY GENERATED (the same reasoning as generate-bridge-tokens.ts): a hand-typed SVG path
 * is a mirror of somebody else's artwork, and a brand mark that is subtly wrong looks
 * worse than no mark at all. These come from `simple-icons`, whose icon data is CC0 —
 * a DEV dependency only, so nothing extra ships to a site or the editor at runtime. A
 * platform simple-icons lacks gets either a PLACEHOLDER lettermark drawn here, or — when
 * an official source gives us the real vector, not a hand trace — an OFFICIAL_MARKS entry;
 * see the comments on each map below.
 *
 * The generated file is COMMITTED and the package depends on nothing: a site importing
 * `@samfox1/site-bridge/social-icons` gets plain strings.
 *
 * Run: `npm run social-icons`. tests/social-icons.test.ts regenerates in memory and
 * diffs the committed file, so a platform added to the registry without regenerating
 * fails the build rather than shipping a platform with no mark.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as si from 'simple-icons'
import { SOCIAL_PLATFORMS } from '../packages/site-bridge/src/social'

/** Registry slug → the simple-icons export name. Hand-mapped ONLY because the two
 *  vocabularies spell things differently ("apple music" vs `siApplemusic`); every entry
 *  is verified below, so a wrong name fails loudly instead of emitting an empty mark. */
const SI_EXPORT: Record<string, string> = {
  instagram: 'siInstagram',
  tiktok: 'siTiktok',
  youtube: 'siYoutube',
  spotify: 'siSpotify',
  'apple music': 'siApplemusic',
  soundcloud: 'siSoundcloud',
  bandcamp: 'siBandcamp',
  facebook: 'siFacebook',
  x: 'siX',
  threads: 'siThreads',
  substack: 'siSubstack',
  patreon: 'siPatreon',
  discord: 'siDiscord',
  twitch: 'siTwitch',
  deezer: 'siDeezer',
  tidal: 'siTidal',
  // 2026-09-28
  'youtube music': 'siYoutubemusic',
  audiomack: 'siAudiomack',
  mixcloud: 'siMixcloud',
  beatport: 'siBeatport',
  pandora: 'siPandora',
  bluesky: 'siBluesky',
  snapchat: 'siSnapchat',
  whatsapp: 'siWhatsapp',
  telegram: 'siTelegram',
  vimeo: 'siVimeo',
  songkick: 'siSongkick',
  'ko-fi': 'siKofi',
  'cash app': 'siCashapp',
  venmo: 'siVenmo',
  paypal: 'siPaypal',
  // 2026-09-28: the identity connections (never a site button; the dashboard draws them)
  musicbrainz: 'siMusicbrainz',
  discogs: 'siDiscogs',
  wikidata: 'siWikidata',
}

type Icon = { title: string; hex: string; path: string }

/**
 * PLACEHOLDER MARKS — Amazon Music and Resident Advisor, researched 2026-09-28, still no
 * official mark that fits this slot (Eventbrite was resolved the same day — see OFFICIAL_MARKS
 * below).
 *
 * simple-icons (16.28.0) has no mark for either, and a platform with no mark reads as a
 * styling bug. So each gets a plain monochrome lettermark, drawn HERE from straight lines.
 * Neither is the brand's artwork, and neither was copied from a brand site.
 *
 * Same format as the rest: one path in a `0 0 24 24` viewBox, filled. A hole winds the
 * other way from the shape around it, so it shows under nonzero AND evenodd (a site may use
 * either). Black, since neither brand offers a mark that would replace it (see below).
 *
 * Amazon Music — official source: https://artists.amazonmusic.com/brand-guidelines (fetched
 * 2026-09-28). The page's "Our branding" section offers only a wordmark lockup: "horizontal"
 * (primary) and "stacked" (still full "amazon music" lettering, captioned "use sparingly, only
 * when necessary" — a square-friendly variant, not an icon), each in four background-tied
 * colour builds (primary / white-or-light-bg / cyan-bg / dark-bg). There is no standalone
 * icon/symbol mark for a small or square space, and no generic single-colour build outside
 * those four backgrounds. Hand-tracing their wordmark into a 24px glyph would both distort a
 * lockup their own rules don't offer loose ("Do not distort the logo") and be illegible at the
 * ~20-24px this draws at. No fit — kept as a placeholder, reported instead of guessed.
 *
 * Resident Advisor — searched ra.co, pro.ra.co (RA's advertiser site) and the open web
 * (fetched 2026-09-28). RA publishes no brand, press or media-kit page and no logo-usage rules
 * anywhere on either of its own sites. Every result is a third-party logo aggregator
 * (Brandfetch, Brands of the World, seeklogo, vectorseek…), which the brief rules out as a
 * source. Nothing official to take — kept as a placeholder, reported instead of guessed.
 */
const PLACEHOLDER_MARKS: Record<string, Icon> = {
  // PLACEHOLDER: an "A" knocked out of a circle. No official mark fits this slot — see comment above.
  'amazon music': {
    title: 'Amazon Music (placeholder)',
    hex: '000000',
    path: 'M12 2a10 10 0 0 1 0 20a10 10 0 0 1 0-20zM11.2 7L8.6 17H10.3L10.872 14.8H13.128L13.7 17H15.4L12.8 7zM12 10.46L12.738 13.3H11.262z',
  },
  // PLACEHOLDER: "RA" inside a square outline. RA's own mark is RA in a square; this one is
  // drawn here, not theirs. No official brand page exists — see comment above.
  'resident advisor': {
    title: 'Resident Advisor (placeholder)',
    hex: '000000',
    path: 'M2 2h20v20H2zM3.5 3.5v17h17v-17zM6 7.5H10.5L11.5 8.5V11L10.6 11.9L11.7 16.5H10.1L9.1 12.5H7.5V16.5H6zM7.5 9V11H10V9zM14.5 7.5H16L18.2 16.5H16.6L16.1 14.5H14.4L13.9 16.5H12.3zM15.25 11L14.75 13H15.75z',
  },
}

/**
 * OFFICIAL MARKS — sourced directly from the brand's own assets, not simple-icons and not a
 * hand-drawn placeholder. Each entry records where it came from and when it was fetched, the
 * same way a PLACEHOLDER records why it's still a guess.
 *
 * Eventbrite — official press kit linked from https://www.eventbrite.com/blog/press/
 * ("Download Press Kit" → 2025-Eventbrite-Press-Kit.zip, fetched 2026-09-28). Its `Logos/`
 * folder holds "Eventbrite Hero Logo.png" (horizontal) and "Eventbrite Stacked Logo.png"
 * (icon above wordmark, square-friendly) — both pair the brushstroke "E" ribbon mark from
 * Eventbrite's 2025 rebrand ("The Path") with the wordmark, in the brand orange (`#FF5E30`,
 * sampled from the PNG). The kit ships no standalone icon file and no written usage-rules
 * document, so the icon-only crop used below is taken from Eventbrite's own production site
 * instead (view-source on https://www.eventbrite.com/, fetched 2026-09-28): its header renders
 * this exact ribbon mark alone (`data-testid="icon-logo-e-brand"`, viewBox `0 0 1000 1213.9`)
 * at `height:24px;width:24px` for the compact nav slot — the same size and the same
 * small-square use case as this icon set. Its fill there is a CSS custom property
 * (`var(--svg-fill, #221d19)`) that a colour class overrides to brand orange, which is
 * Eventbrite's own pattern for recolouring the mark — not a distortion of its shape, and it
 * demonstrates the mark is meant to work as a single flat colour. The path below is that same
 * vector, rescaled from its native `0 0 1000 1213.9` box into ours (uniform scale to fit the
 * height, centred horizontally) — no hand-tracing, no third party.
 */
const OFFICIAL_MARKS: Record<string, Icon> = {
  eventbrite: {
    title: 'Eventbrite',
    hex: 'FF5E30',
    path: 'M20.24 16.11L12.3 9.92C12.17 9.82 12.31 9.61 12.45 9.7L15.55 11.43C16.96 12.22 18.74 11.77 19.59 10.4C20.49 8.95 20.01 7.05 18.54 6.2L13.99 3.57C13.84 3.49 13.95 3.27 14.1 3.33L16.2 4.17C16.2 4.17 16.25 4.19 16.27 4.19C16.49 4.27 16.73 4.31 16.98 4.31C18.11 4.31 19.04 3.41 19.13 2.35C19.23 0.97 18.17 0 16.91 0L7.24 0C6 0 4.96 1.01 4.97 2.25C4.98 2.91 5.27 3.5 5.74 3.9C6.08 4.2 7.26 5.14 7.81 5.59C7.91 5.67 7.86 5.83 7.73 5.83L5.79 5.83C3.76 5.84 2.11 7.49 2.11 9.53C2.11 10.56 2.54 11.49 3.21 12.16L14.42 22.81C15.21 23.55 16.27 24 17.44 24C19.9 24 21.89 22.01 21.89 19.56C21.89 18.17 21.24 16.93 20.24 16.11L20.24 16.11Z',
  },
}

export function buildSocialIcons(): string {
  const rows = SOCIAL_PLATFORMS.map((p) => {
    const placeholder = PLACEHOLDER_MARKS[p.slug]
    const official = OFFICIAL_MARKS[p.slug]
    if (placeholder && SI_EXPORT[p.slug]) throw new Error(`"${p.slug}" has a simple-icons mark AND a placeholder — drop the placeholder.`)
    if (official && SI_EXPORT[p.slug]) throw new Error(`"${p.slug}" has a simple-icons mark AND an official override — drop the override.`)
    if (placeholder && official) throw new Error(`"${p.slug}" has both a placeholder AND an official mark — drop the placeholder.`)
    if (placeholder)
      return `  ${JSON.stringify(p.slug)}: { path: ${JSON.stringify(placeholder.path)}, hex: ${JSON.stringify('#' + placeholder.hex)} }, // PLACEHOLDER lettermark, pending the brand kit`
    if (official)
      return `  ${JSON.stringify(p.slug)}: { path: ${JSON.stringify(official.path)}, hex: ${JSON.stringify('#' + official.hex)} }, // OFFICIAL mark, not from simple-icons — see OFFICIAL_MARKS above`
    const exportName = SI_EXPORT[p.slug]
    if (!exportName) throw new Error(`No simple-icons mapping for "${p.slug}" — add one to SI_EXPORT (or, with none, a PLACEHOLDER_MARKS entry).`)
    const icon = (si as unknown as Record<string, Icon>)[exportName]
    if (!icon?.path) throw new Error(`simple-icons has no "${exportName}" (for "${p.slug}").`)
    return `  ${JSON.stringify(p.slug)}: { path: ${JSON.stringify(icon.path)}, hex: ${JSON.stringify('#' + icon.hex)} },`
  })

  return `/**
 * GENERATED by scripts/generate-social-icons.ts — do not edit by hand.
 * Run \`npm run social-icons\` after changing SOCIAL_PLATFORMS.
 *
 * One brand mark per platform: a 24x24 SVG path and the brand's own colour. Icon data
 * from simple-icons (CC0), inlined so neither the editor nor a connected site takes a
 * runtime dependency on it. A line marked PLACEHOLDER is a plain lettermark drawn in the
 * generator for a platform simple-icons lacks, pending the brand's own logo. A line marked
 * OFFICIAL is that brand's own mark, sourced directly (not simple-icons, not a placeholder) —
 * see OFFICIAL_MARKS in the generator for where it came from and when.
 *
 * A site is free to ignore all of this and draw its own glyphs — the standard names the
 * platform (./social), it does not dictate a pixel. This exists so that a site which has
 * no opinion still gets a mark the fan recognizes.
 */

export type SocialIcon = {
  /** SVG path data, drawn in a \`0 0 24 24\` viewBox. */
  path: string
  /** The brand's own colour, for a site that wants it. Monochrome is the safer default:
   *  a row of brand colours rarely suits a site's design. */
  hex: string
}

export const SOCIAL_ICONS: Record<string, SocialIcon> = {
${rows.join('\n')}
}

/** The mark for a platform slug, or null for one the registry does not know (the
 *  "Something else" path) — which renders as a plain labelled link. */
export function socialIcon(slug: string): SocialIcon | null {
  return SOCIAL_ICONS[slug] ?? null
}
`
}

if (process.argv[1]?.endsWith('generate-social-icons.ts')) {
  const out = join(process.cwd(), 'packages/site-bridge/src/social-icons.ts')
  writeFileSync(out, buildSocialIcons())
  console.log(`wrote ${out} (${SOCIAL_PLATFORMS.length} marks)`)
}
