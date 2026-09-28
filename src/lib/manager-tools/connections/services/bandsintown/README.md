# Bandsintown

Connecting Bandsintown pulls the artist's public upcoming events into the Tour tab as
draft tour dates.

## Connection type

Service (no public link). Bandsintown has no social profile a site shows — it is a pure
data source. `src/lib/connections.ts` never gives it a `social`, so it can never become a
site button (Sam, 2026-09-28: services are not social buttons).

## What the manager enters

The Bandsintown artist name, exactly as Bandsintown lists it (placeholder: "Bandsintown
artist name," `src/lib/integrations-registry.ts`). There is no link to paste and no handle
parsing — it's a single text field (`ConnectField` in `connect-modal.tsx`, the fallback
branch for a connection with no `social`).

Error seen, from `connectInputError` (`src/lib/connections.ts`):
- `Enter the Bandsintown artist name.` — blank input

Once connected, a wrong or unknown name doesn't error at save time — Bandsintown's events
endpoint returns a non-array body for an unknown artist, which the client treats as "no
events" (see Sync / integration below), so the row reads as "failed" (connected, zero rows).

## How it is stored

- `artists.bandsintown_name` — the id column (`ArtistIdField`, `bandsintown_name`).
- No `links` row, no site button — services never appear in the editor's Socials picker.
- Tour dates land in the shared `tour_dates` table (see Sync / integration).

## Sync / integration

API: **Bandsintown's public events endpoint**, `https://rest.bandsintown.com/artists/<name>/events`
(`src/lib/bandsintown.ts`, `createBandsintownClient`). Auth: an `app_id` query param, from
env var `BANDSINTOWN_APP_ID`. Missing app id throws `Bandsintown app id not configured
(BANDSINTOWN_APP_ID).`

What it pulls: every upcoming event for the artist name — date, venue name, city, country
(passed through `canonicalCountry`, `src/lib/country.ts`), a ticket URL (the "Tickets" offer
if present, else the event's own URL), and lat/lng (via `coord`, `src/lib/geo.ts`, which
guards against a blank string silently becoming `0,0`).

Where it lands: the `tour_dates` table, via `syncBandsintownTourDates` (`src/lib/sync.ts`).
Keyed by `bandsintown_id`, `source: 'bandsintown'`. New rows insert `on_site: false`.
Ticketmaster writes the same table with its own id column (`ticketmaster_id`) and
`source: 'ticketmaster'`, so both can be connected at once without colliding — unlike the
music sources, tour dates are not merged into one union row per event.

`provenBy` (`src/lib/integrations-registry.ts`): proven by rows where `tour_dates.source =
'bandsintown'` exist — connected with nothing pulled reads as "failed."

Limits/quirks:
- An unknown artist name returns a non-array response body; the client reads that as `[]`
  (no events), not an error (`src/lib/bandsintown.ts`: "Unknown artist returns a non-array
  body").
- 429s back off using `Retry-After` via the shared `httpGetJson` (`src/lib/http.ts`), up to
  3 retries by default.
- `country` is canonicalized (`src/lib/country.ts`) specifically because Bandsintown sends
  "United States" while Ticketmaster sends "United States Of America" — without this, the
  same artist's dates would read three different ways in one list.
- **Compliance is not enforced in code.** Per `TODO.md` and the `bandsintown-compliance-blocked`
  project note: Bandsintown's API is not self-serve — an `app_id` is granted only by emailing
  `support@bandsintown.com`, which is acceptance of their terms. Those terms require showing
  Bandsintown's own Track/RSVP/Notify-Me buttons and branding as the primary ticket links on
  the public tour page (the current public site renders a plain "Tickets →" link only), allow
  only session-based caching with upstream-removal cleanup (this app persists events in
  `tour_dates` indefinitely, with no removal-on-delist cleanup), and require written approval
  for commercial use. None of this is a code gate — `syncBandsintownAction` runs exactly like
  any other pull the moment `BANDSINTOWN_APP_ID` is set. Do not treat Bandsintown as "ready"
  in production until these are resolved.

How a pull is triggered:
- **Connect**: typing the artist name and clicking Connect (Sync has no on/off toggle for a
  service — a service either pulls or errors).
- **Sync / Pull now / Retry**: the connection modal's action, or a failed row's Retry
  (`pullConnectionAction` → `syncSectionAction` → `syncBandsintownAction`).

## On the site

Not a site button — Bandsintown is dashboard-only. The tour dates it pulls appear wherever
the artist's Tour section is placed on their site, the same as manually entered dates,
once the manager publishes them on.

## Code map

- `src/lib/bandsintown.ts` — the API client: `getArtistEvents`, event → tour-date mapping.
- `src/lib/http.ts` — shared GET-with-429-retry used by the client.
- `src/lib/country.ts` — `canonicalCountry`, the shared spelling with Ticketmaster.
- `src/lib/geo.ts` — `coord`, the shared lat/lng string parser.
- `src/lib/sync.ts` — `syncBandsintownTourDates`: writes the `tour_dates` table,
  `on_site: false` on insert.
- `src/lib/connections.ts` — merges the Bandsintown registry entry into `CONNECTIONS` as a
  standalone service (no matching social).
- `src/lib/integrations-registry.ts` — registry entry: `idField: 'bandsintown_name'`,
  `section: 'tour'`, placeholder, pull label "Pull tour dates."
- `src/lib/service-icons.ts` — `SERVICE_ICONS.bandsintown`, the dashboard-only brand mark
  (generated from simple-icons by `scripts/generate-service-icons.ts`).
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires `saveBandsintownNameAction` /
  `syncBandsintownAction` to the registry entry.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `saveBandsintownNameAction`,
  `syncBandsintownAction`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `pullConnectionAction` (shared across every connection).
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx`,
  `connection-modal.tsx`, `connection-list.tsx`, `connection-mark.tsx` — the Connections UI.
- `.env.example` — documents `BANDSINTOWN_APP_ID`.

## Tests

- `tests/unit/sync/bandsintown.test.ts` — event mapping, 429 retry, error shaping,
  unknown-artist → `[]`, missing-app-id guard.
- `tests/integration/sync/sync.bandsintown.test.ts` — `syncBandsintownTourDates` against
  the real database: inserts new, refreshes bandsintown-owned rows, never clobbers a
  manual row, tenancy.
- `tests/unit/manager-tools/connections/connections.test.ts` — Bandsintown as a
  `CONNECTIONS` service entry (no `social`), row state/sort behavior.
- `tests/unit/manager-tools/connections/integrations-registry.test.ts` — `provenBy` for
  the `bandsintown` key (`source = 'bandsintown'`).
- `tests/unit/sync/sync-section-action.test.ts` — the `tour` section offers
  `['bandsintown', 'ticketmaster']`.
- `tests/unit/manager-tools/connections/service-icons.test.ts` — Bandsintown's brand mark
  exists and matches the committed generated file.
- `tests/components/manager-tools/connections/connect-modal.test.tsx`,
  `connection-list.test.tsx` — use Bandsintown as a representative service in the
  Connect flow and row UI.

## Known gaps

- **Not compliant for production** per `TODO.md` and project memory: no Bandsintown
  branding/Track-RSVP-Notify buttons on the public tour page, no upstream-removal cleanup
  for delisted events, no written approval for commercial use. This is a process gate,
  not a code one — nothing stops `BANDSINTOWN_APP_ID` from being set and the sync running.
- No cleanup when an event disappears from Bandsintown (their terms call for removing it);
  `syncExternal` only inserts/refreshes, it never deletes a row upstream no longer sends.
