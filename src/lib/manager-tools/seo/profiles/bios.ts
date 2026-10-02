/**
 * Outside bios: the profiles an artist edits THEMSELVES, on each platform, because no API lets
 * Tapir write (or even read) the text. When the artist's own facts change on Publish, each of
 * these may be out of date; the manager ticks "updated" per bio (OUTSIDE_PROFILES_PLAN.md,
 * build step 1, "the change nudge").
 *
 * Each tick is a row in `public.profile_marks` with item `bio_<key>` (bioItem). The table's
 * CHECK lists every one: widen it in a migration whenever a bio is added here
 * (tests/unit/manager-tools/seo/profile-marks.test.ts fails until both agree).
 *
 * `edit` is where the artist goes to edit that bio: a page that needs no per-user id. Checked
 * against each platform's own help pages, 2026-10-01 (source above each row).
 */

export const OUTSIDE_BIOS = [
  // Spotify for Artists: Profile > About > edit next to Bio (Admins/Editors; 1,500 chars).
  // https://support.spotify.com/us/artists/article/adding-a-bio-to-your-spotify-artist-profile/
  { key: 'spotify', label: 'Spotify', edit: 'https://artists.spotify.com/' },
  // Edit profile > Bio (150 chars) works on the web; the website field is app only.
  // https://help.instagram.com/728994388226960 · https://help.instagram.com/362497417173378
  { key: 'instagram', label: 'Instagram', edit: 'https://www.instagram.com/accounts/edit/' },
  // The bio is NOT in Settings: it is the Edit (pen) button on the profile, which SoundCloud's
  // help links as soundcloud.com/you. https://help.soundcloud.com/hc/en-us/articles/115003449407
  { key: 'soundcloud', label: 'SoundCloud', edit: 'https://soundcloud.com/you' },
  // YouTube Studio > Customization > Profile > Description > Publish (deeper links need the
  // channel id). https://support.google.com/youtube/answer/2657964
  { key: 'youtube', label: 'YouTube', edit: 'https://studio.youtube.com/' },
  // Desktop web: profile > Edit profile > Bio (80 chars); not on mobile web; the website link is
  // app only. No stable deeper URL. https://www.tiktok.com/support/faq_detail?id=7096681482017692162
  { key: 'tiktok', label: 'TikTok', edit: 'https://www.tiktok.com/' },
  // Opens the edit-profile dialog (seen in X's own login redirect; help.x.com refused fetches).
  { key: 'x', label: 'X', edit: 'https://x.com/settings/profile' },
  // Apple Music for Artists > Artist Content > Artist Page: the Q&A (first person, no URLs, read
  // by Apple's editors) and "where you are from" (hometown). Artists CANNOT edit the main bio;
  // it comes from Xperi/AllMusic, so that is the "allmusic_bio" email on the Profiles tab.
  // https://artists.apple.com/support/3391-artist-content-profile
  // https://artists.apple.com/support/5613-personalize-artist-page
  { key: 'apple_music', label: 'Apple Music', edit: 'https://artists.apple.com/' },
  // Bandsintown for Artists > artist page: name, photo, genres, bio, hometown, links (up to 24h).
  // https://help.artists.bandsintown.com/en/articles/7039373-update-your-artist-page
  { key: 'bandsintown', label: 'Bandsintown', edit: 'https://artists.bandsintown.com/artist/profile' },
] as const

export type OutsideBio = (typeof OUTSIDE_BIOS)[number]['key']

/** The profile_marks item for one outside bio. */
export const bioItem = <K extends OutsideBio>(k: K) => `bio_${k}` as const

/** Every outside bio's profile_marks item, in OUTSIDE_BIOS order. */
export const BIO_ITEMS = OUTSIDE_BIOS.map((b) => bioItem(b.key))
