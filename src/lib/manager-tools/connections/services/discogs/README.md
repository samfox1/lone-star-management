# Discogs
Connecting Discogs tells search engines and AI answers which artist this is: its link goes into the site's hidden fact card (`sameAs`). It is never a button on the site.

## Connection type
Identity only (added 2026-09-28, AI_VISIBILITY_AUDIT.md 1.3). A link-only connection whose bridge platform is `identityOnly`: the Connections page shows it like any other, but the site editor's **Add button** never offers it (`buttonChoices` in `src/lib/connections.ts`, and the editor's own Connect list in `add-button-modal.tsx`).

## What the manager enters
The artist's Discogs page link: `https://www.discogs.com/artist/<id>-<name>` (e.g. `https://www.discogs.com/artist/82730-The-Beatles`). The name after the id is optional, and a language path is fine (`/de/artist/…`, `/pt_BR/artist/…`). A query or fragment is dropped. Only an artist page is taken (`social.method.path` in `index.ts` here).

Errors, from `profileLink` / `connectInputError` (`src/lib/connections.ts`):
- Empty: "Paste the Discogs link."
- A release, a master, a label, a marketplace page, or an old name-only link (`/artist/The-Beatles`): "That isn't a Discogs artist link."
- Another platform's link: "That's an Instagram link, not Discogs."

## How it is stored
A `links` row: `label: 'Discogs'`, `url` = the artist link, `on_site: false` (and it stays off). No `artists` column. `social.idFromUrl` reads the numeric artist id out of the link (anchored on the host), for a future sync; nothing stores it yet.

## On the site
Bridge slug `discogs` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://www.discogs.com/artist/'`, `identityOnly: true`. Not drawn as a button. It reaches the fact card's `sameAs` through the identity links (bridge `seo.ts`, matched by host; built separately). It also goes into the MusicBrainz seed as a Discogs link (type 180) when the artist has one.

Mark: from simple-icons (`siDiscogs`, CC0), brand colour `#333333`; the dashboard draws it monochrome.

## Code map
- `src/lib/manager-tools/connections/services/discogs/index.ts` — `social`: the link method (artist path only) and the id reader.
- `src/lib/connections.ts` — `CONNECTIONS` copies `identityOnly` onto the def; `buttonChoices` refuses it.
- `.../editor/add-button-modal.tsx` — the editor's Connect list leaves identity connections out.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the slug, `identityOnly`, the mark.

## Integration (research)
Checked 2026-09-28: the public API answered `GET https://api.discogs.com/artists/1` with the artist's `name`, `profile`, `urls`, `aliases` and its page, `uri: https://www.discogs.com/artist/1-The-Persuader` (the id-then-name shape this connection takes). Without a key the response headers said `X-Discogs-Ratelimit: 25` (requests a minute); an authenticated app gets more. Discogs asks every client to send its own `User-Agent`. The developer docs page (discogs.com/developers) refused scripted reads (403), so the limits here are from the live headers, not the page. [Discogs support: Contributing](https://support.discogs.com/hc/en-us/articles/360004017654-Contributing-to-Discogs) and the [artist guidelines](https://support.discogs.com/hc/en-us/articles/360005054753-Database-Guidelines-2-Artist).

**How an artist gets listed:** you cannot add an artist to Discogs on their own. An artist page appears when someone submits one of their releases (a physical or digital release, through the submission form); the artist's name on that release creates the page, and it can be filled in afterwards. So an artist with nothing submitted has no Discogs page to connect.

**API verdict:** reading is easy (no key, 25 a minute) if a future feature wants to verify the id or read the artist's own links back; there is nothing to pull into the dashboard.

## Tests
Specific to Discogs:
- `tests/unit/manager-tools/connections/identity-only.test.ts` — "Discogs takes an artist page, and only that" (accepted shapes, refusals by name, the id), and "never a site button".
- `tests/components/site-editor/editor-social-buttons.test.tsx` — "never offers an identity connection".
- `tests/unit/manager-tools/connections/musicbrainz-seed.test.ts` — a Discogs link rides into the MusicBrainz seed as type 180.

Shared suites that cover it by looping over the registry: `services.test.ts` (pinned method and def), `connections.test.ts` (link-kind rules), `link-vocabulary.test.ts`, `social-icons.test.ts`.

## Known gaps
- An old name-only Discogs link (`/artist/The-Beatles`) is refused: it carries no id. Paste the current link from the artist page.
- No sync: the id is read out of the link but not stored or verified.
