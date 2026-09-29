# MusicBrainz
Connecting MusicBrainz tells search engines and AI answers which artist this is: its link goes into the site's hidden fact card (`sameAs`). It is never a button on the site. With no MusicBrainz page yet, the Connect window offers to create one, pre-filled.

## Connection type
Identity only (added 2026-09-28, AI_VISIBILITY_AUDIT.md 1.3 and 4.1). A link-only connection whose bridge platform is `identityOnly`: the Connections page shows it like any other, but the site editor's **Add button** never offers it (`buttonChoices` in `src/lib/connections.ts`, and the editor's own Connect list in `add-button-modal.tsx`). A MusicBrainz button on an artist's site makes no sense; the link is there to say who the artist is.

## What the manager enters
The artist's MusicBrainz page link: `https://musicbrainz.org/artist/<mbid>` (an MBID is a UUID, e.g. `b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d`). Pasted with or without `https://`; a query or fragment is dropped. Only an artist page is taken (`social.method.path` in `index.ts` here).

Errors, from `profileLink` / `connectInputError` (`src/lib/connections.ts`):
- Empty: "Paste the MusicBrainz link."
- A release, a search, `/artist/create`, a sub-page (`/artist/<mbid>/releases`) or a non-UUID: "That isn't a MusicBrainz artist link."
- Another platform's link: "That's an Instagram link, not MusicBrainz."

**Create the MusicBrainz page.** While the artist has no MusicBrainz connection, the MusicBrainz row in the Connect window's details step shows a "Create the MusicBrainz page" link (new tab) and one line: the artist signs in there and submits it themselves. The link is MusicBrainz's own artist editor, seeded with GET parameters (`seed.ts` here, built on the server by the Connections page):
- `edit-artist.name` — the artist's name;
- `edit-artist.type_id` — `1` (Person) only when the SEO facts say "Visual artist". The default "Musician" (MusicGroup) says nothing about person vs group, so the artist picks it there;
- `edit-artist.area.name` — the SEO facts' location (text for MusicBrainz's area search);
- `edit-artist.url.N.text` + `.link_type_id` — the site as the official homepage (183), then each profile link whose label and URL agree, https only, on a platform with a confirmed link type (below). Once each, numbered without gaps.

Example (Skeen): `https://musicbrainz.org/artist/create?edit-artist.name=Skeen&edit-artist.area.name=Chicago&edit-artist.url.0.text=https%3A%2F%2Fwww.skeenmusic.com&edit-artist.url.0.link_type_id=183&edit-artist.url.1.text=https%3A%2F%2Finstagram.com%2Fskeenmusic&edit-artist.url.1.link_type_id=192…`

## How it is stored
A `links` row: `label: 'MusicBrainz'`, `url` = the artist link, `on_site: false` (and it stays off: nothing offers it as a button). No `artists` column. `social.idFromUrl` reads the MBID out of the link (anchored on the host), for a future sync; nothing stores it yet.

## On the site
Bridge slug `musicbrainz` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://musicbrainz.org/artist/'`, `identityOnly: true`. Not drawn as a button. It reaches the fact card's `sameAs` through the identity links (bridge `seo.ts`, matched by host; built separately).

Mark: from simple-icons (`siMusicbrainz`, CC0), brand colour `#BA478F`; the dashboard draws it monochrome.

## Code map
- `src/lib/manager-tools/connections/services/musicbrainz/index.ts` — `social`: the link method (artist path only) and the MBID reader.
- `src/lib/manager-tools/connections/services/musicbrainz/seed.ts` — `musicBrainzCreateUrl`, the confirmed link-type ids (`MB_LINK_TYPE`) and each platform's type (`MB_LINK_TYPE_OF`).
- `src/lib/connections.ts` — `CONNECTIONS` copies `identityOnly` onto the def; `buttonChoices` refuses it.
- `.../connections/page.tsx` — builds the seed (name, SEO facts, site, profile links) while there is no MusicBrainz row; `connection-list.tsx` → `connect-modal.tsx` (`createPages`, `CreatePage`).
- `.../editor/add-button-modal.tsx` — the editor's Connect list leaves identity connections out.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the slug, `identityOnly`, the mark.

## Integration (research)
Docs read (2026-09-28): [Seeding the artist editor](https://wiki.musicbrainz.org/Development/Seeding/Artist_Editor) and [Seeding](https://wiki.musicbrainz.org/Development/Seeding) (GET params; a field seeds by its input's `name`, e.g. `edit-artist.name`); [How to Add an Artist](https://wiki.musicbrainz.org/How_to_Add_an_Artist); [MusicBrainz API](https://wiki.musicbrainz.org/MusicBrainz_API) and [Rate Limiting](https://wiki.musicbrainz.org/MusicBrainz_API/Rate_Limiting); musicbrainz-server's `URLCleanup.js` (`LINK_TYPES`) and `Constants.pm` (artist types); each link type's page on musicbrainz.org.

**Link type ids** (artist → URL), each read off `musicbrainz.org/relationship/<uuid>`: official homepage 183, social network 192, free streaming 194, streaming (paid) 978, YouTube 193, YouTube Music 1080, SoundCloud 291, Bandcamp 718, Songkick 785, patronage 897, video channel 303, Discogs 180, Wikidata 352, other databases 188, purchase for download 176. Our platforms map onto them the way MusicBrainz's own URLCleanup files them for an artist (Instagram/TikTok/Facebook/X/Threads/Bluesky/Mixcloud → 192; Spotify/Deezer/Audiomack → 194; Apple Music/Tidal/Amazon Music → 978; Twitch/Vimeo → 303; Patreon → 897; Resident Advisor → 188; Beatport → 176). Left out: platforms URLCleanup has no rule for (Snapchat, Telegram, Discord, Substack, Pandora, Eventbrite, WhatsApp) and the tip/payment pages (PayPal, Cash App, Venmo, Ko-fi). Artist types: Person 1, Group 2.

**Read API:** `GET https://musicbrainz.org/ws/2/artist/<mbid>?inc=url-rels&fmt=json` (no key for reads). Every request needs a meaningful `User-Agent` (app name, version, contact), and the limit is about **1 request per second per IP**; over it, every request gets a 503 until the rate drops. A future sync (verify the MBID, read the artist's own links back) would need a server-side client that honours both.

**How an artist gets listed:** anyone with a MusicBrainz account can add an artist (Editing → Add artist). If an artist with the same name exists, MusicBrainz asks for a disambiguation comment ("Chicago house DJ and producer"). The artist, or Sam for them, does it; Tapir only pre-fills the form.

## Tests
Specific to MusicBrainz:
- `tests/unit/manager-tools/connections/identity-only.test.ts` — "MusicBrainz takes an artist page, and only that" (accepted shapes, refusals by name, the MBID), and "never a site button".
- `tests/unit/manager-tools/connections/musicbrainz-seed.test.ts` — the seed: encoding, type, area, the link list (https only, label and link agree, confirmed types, no gaps), and the ids pinned as MusicBrainz's own.
- `tests/unit/manager-tools/connections/connections-page-musicbrainz.test.ts` — the page offers the seed from the artist's facts and links, and stops once MusicBrainz is connected.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — "MusicBrainz with no page yet: its row also links to MusicBrainz's own editor".
- `tests/components/site-editor/editor-social-buttons.test.tsx` — "never offers an identity connection", and the editor's Connect list leaves them out.

Shared suites that cover it by looping over the registry: `services.test.ts` (pinned method and def), `connections.test.ts` (link-kind rules), `link-vocabulary.test.ts`, `social-icons.test.ts`.

## Known gaps
- Signed out, `musicbrainz.org/artist/create` redirects to the MetaBrainz sign-in (checked 2026-09-28). Whether the pre-filled values survive that trip is not confirmed; if they don't, sign in first and press the link again.
- No disambiguation comment is seeded: the artist editor's seeding page does not list that field, so it is left for the artist.
- No sync: the MBID is read out of the link but not stored or verified.
