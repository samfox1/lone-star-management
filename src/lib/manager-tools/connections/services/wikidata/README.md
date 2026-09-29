# Wikidata
Connecting Wikidata tells search engines and AI answers which artist this is: its item goes into the site's hidden fact card (`sameAs`). It is never a button on the site.

## Connection type
Identity only (added 2026-09-28, AI_VISIBILITY_AUDIT.md 1.3). A link-only connection whose bridge platform is `identityOnly`: the Connections page shows it like any other, but the site editor's **Add button** never offers it (`buttonChoices` in `src/lib/connections.ts`, and the editor's own Connect list in `add-button-modal.tsx`).

## What the manager enters
The item id alone, shown after its address in grey (`wikidata.org/wiki/` [Q1299]), or a pasted item link: the page (`https://www.wikidata.org/wiki/Q1299`, the mobile `m.` host too) or the concept URI (`http://www.wikidata.org/entity/Q1299`). Either way it is saved as `https://www.wikidata.org/wiki/Q1299`.

The rule: an ITEM id, `Q` and a number from 1 (`/^Q[1-9]\d*$/`, `social.method.rule` in `index.ts` here). A property (`P434`) or a lexeme is not an artist.

Errors, built in `parseHandle` (`src/lib/connect-methods.ts`):
- Blank: "Enter the Wikidata ID."
- Not an item id (a property, `Q0`, a search page): "That doesn't look like a Wikidata ID."
- A link from another site (a Wikipedia article): "That isn't a Wikidata link."

## How it is stored
A `links` row: `label: 'Wikidata'`, `url` = `https://www.wikidata.org/wiki/Q…`, `on_site: false` (and it stays off). No `artists` column. `social.idFromUrl` reads the Q-id out of the link (anchored on the host); nothing stores it yet.

## On the site
Bridge slug `wikidata` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://www.wikidata.org/wiki/'`, `identityOnly: true`. Not drawn as a button. It reaches the fact card's `sameAs` through the identity links (bridge `seo.ts`, matched by host; built separately). It also goes into the MusicBrainz seed as a Wikidata link (type 352) when the artist has one.

Mark: from simple-icons (`siWikidata`, CC0), brand colour `#006699`; the dashboard draws it monochrome.

## Code map
- `src/lib/manager-tools/connections/services/wikidata/index.ts` — `social`: the handle spec (noun "ID", the Q rule, `fromPath` for `/wiki/` and `/entity/`) and the Q-id reader.
- `src/lib/connect-methods.ts` — `parseHandle`/`handleFromUrl` (the noun union gained `'ID'`).
- `src/lib/connections.ts` — `CONNECTIONS` copies `identityOnly` onto the def; `buttonChoices` refuses it.
- `.../editor/add-button-modal.tsx` — the editor's Connect list leaves identity connections out.
- `packages/site-bridge/src/social.ts` / `social-icons.ts` — the slug, `identityOnly`, the mark.

## Integration (research)
Docs read (2026-09-28): [Wikidata:Notability](https://www.wikidata.org/wiki/Wikidata:Notability); the entity data endpoint, checked live: `GET https://www.wikidata.org/wiki/Special:EntityData/Q1299.json` returns the item with its claims, and The Beatles' item carries `P434` (MusicBrainz artist ID, its MBID) and `P1953` (Discogs artist ID). Queries across items go through the SPARQL endpoint (`query.wikidata.org`). Reads need no key; send a descriptive `User-Agent`.

**How an artist gets listed:** anyone can create an item, but it must meet the notability policy, at least one of: (1) a sitelink to a Wikipedia (or other Wikimedia) page; (2) a clearly identifiable entity "that can be described using serious and publicly available references"; (3) a structural need (other items need it). For a working artist that usually means independent press first (AI_VISIBILITY_AUDIT.md 4.6: "LATER"). Once a MusicBrainz entry exists, its MBID is the natural `P434` claim to add to the item.

**API verdict:** reading is free and simple. A future check could confirm the item links back (P434 = the artist's MBID); nothing to pull into the dashboard.

## Tests
Specific to Wikidata:
- `tests/unit/manager-tools/connections/identity-only.test.ts` — "Wikidata takes the item id, or its page" (every accepted shape becomes the one item page; a property, a search page and junk are refused), and "never a site button".
- `tests/components/site-editor/editor-social-buttons.test.tsx` — "never offers an identity connection".
- `tests/unit/manager-tools/connections/musicbrainz-seed.test.ts` — a Wikidata link rides into the MusicBrainz seed as type 352.

Shared suites that cover it by looping over the registry: `services.test.ts` (pinned method and def), `connect-methods.test.ts` (every handle builds a link the site reads as that platform), `connections.test.ts` (the handle round trip), `link-vocabulary.test.ts`, `social-icons.test.ts`.

## Known gaps
- A lowercase `q1299` is refused rather than fixed: the rule is the id as Wikidata writes it.
- Most artists won't meet Wikidata's notability bar yet; the connection is here for the ones who do.
