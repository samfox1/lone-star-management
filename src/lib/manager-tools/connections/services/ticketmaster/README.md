# Ticketmaster

Connecting Ticketmaster pulls the artist's public upcoming events (via their Ticketmaster
"attraction") into the Tour tab as draft tour dates, alongside Bandsintown.

## Connection type

Service (no public link). Ticketmaster has no social profile a site shows — it is a pure
data source. `src/lib/connections.ts` never gives it a `social`, so it can never become a
site button (Sam, 2026-09-28: services are not social buttons).

## What the manager enters

A Ticketmaster **attraction ID** (placeholder: "Ticketmaster attraction ID,"
`src/lib/integrations-registry.ts`) — Ticketmaster's own internal id for the artist, not a
name or a URL. There is no lookup-by-name flow in this codebase; the manager has to already
have the id. It's a single text field (`ConnectField` in `connect-modal.tsx`, the fallback
branch for a connection with no `social`).

Error seen, from `connectInputError` (`src/lib/connections.ts`):
- `Enter the Ticketmaster attraction ID.` — blank input

An invalid or unknown attraction id doesn't error at connect time — the Discovery API
simply returns zero events for it, so the row reads as "failed" (connected, nothing pulled).

## How it is stored

- `artists.ticketmaster_attraction_id` — the id column (`ArtistIdField`,
  `ticketmaster_attraction_id`).
- No `links` row, no site button — services never appear in the editor's Socials picker.
- Tour dates land in the shared `tour_dates` table (see Sync / integration).

## Sync / integration

API: **Ticketmaster Discovery API v2**,
`https://app.ticketmaster.com/discovery/v2/events.json` (`src/lib/ticketmaster.ts`,
`createTicketmasterClient`). Auth: an `apikey` query param, from env var
`TICKETMASTER_API_KEY`. Missing key throws `Ticketmaster API key not configured
(TICKETMASTER_API_KEY).`

What it pulls: every event for the given `attractionId`, paginated by page number (`size=100`
per page), up to `maxPages` (default 10 — Ticketmaster caps `size * page` under 1000, so this
is the deep-paging ceiling, not an arbitrary choice). Each event maps to a date, venue name,
city, country (passed through `canonicalCountry`, `src/lib/country.ts`), a ticket URL (the
event's own Ticketmaster URL), and lat/lng (via `coord`, `src/lib/geo.ts`).

Where it lands: the `tour_dates` table, via `syncTicketmasterTourDates` (`src/lib/sync.ts`).
Keyed by `ticketmaster_id`, `source: 'ticketmaster'`. New rows insert `on_site: false`.
Bandsintown writes the same table with its own id column (`bandsintown_id`) and
`source: 'bandsintown'`, so both can be connected at once without colliding — unlike the
music sources, tour dates are not merged into one union row per event.

`provenBy` (`src/lib/integrations-registry.ts`): proven by rows where `tour_dates.source =
'ticketmaster'` exist — connected with nothing pulled reads as "failed."

Limits/quirks:
- 429s back off using `Retry-After` via the shared `httpGetJson` (`src/lib/http.ts`), up to
  3 retries by default.
- `country` is canonicalized (`src/lib/country.ts`) specifically because Ticketmaster's
  Discovery v2 sends the long name "United States Of America" (plus a separate
  `countryCode`) while Bandsintown sends "United States" — without this, the same artist's
  dates would read three different ways in one list.
- The `.env.example` comment for this key notes: "Attribution is required on the public
  site when live" — this codebase does not document or implement what that attribution
  looks like; nothing in `src/components/artist-site.tsx` currently renders
  Ticketmaster-specific branding.

**Quirk found in code:** `syncTicketmasterAction` (`actions.ts`) calls
`syncTicketmasterTourDates`, which returns a `SyncResult` with per-row
`added`/`updated`/`failed`/`errors`, but the action discards the result entirely and always
returns bare `{ ok: true }` with no message. Compare Bandsintown, whose action reports the
same shape via `syncOutcome` ("3 added, 1 updated"). For Ticketmaster: a partial failure is
invisible, and a successful pull never says how many dates came in — the connection modal
falls back to the word "Pulled."

How a pull is triggered:
- **Connect**: typing the attraction ID and clicking Connect (no Sync toggle — a service
  either pulls or errors).
- **Sync / Pull now / Retry**: the connection modal's action, or a failed row's Retry
  (`pullConnectionAction` → `syncSectionAction` → `syncTicketmasterAction`).

## On the site

Not a site button — Ticketmaster is dashboard-only. The tour dates it pulls appear wherever
the artist's Tour section is placed on their site, the same as manually entered dates or
ones pulled from Bandsintown, once the manager publishes them on.

## Code map

- `src/lib/manager-tools/connections/services/ticketmaster/index.ts` — this service's own
  code: `source`: the registry entry (`idField: 'ticketmaster_attraction_id'`, `section:
  'tour'`).
- `src/lib/ticketmaster.ts` — the API client: `getArtistEvents`, page-number pagination,
  event → tour-date mapping.
- `src/lib/http.ts` — shared GET-with-429-retry used by the client.
- `src/lib/country.ts` — `canonicalCountry`, the shared spelling with Bandsintown.
- `src/lib/geo.ts` — `coord`, the shared lat/lng string parser.
- `src/lib/sync.ts` — `syncTicketmasterTourDates`: writes the `tour_dates` table,
  `on_site: false` on insert.
- `src/lib/connections.ts` — merges the Ticketmaster registry entry into `CONNECTIONS` as a
  standalone service (no matching social).
- `src/lib/integrations-registry.ts` — assembles the entry above into
  `INTEGRATION_REGISTRY` (in `INTEGRATION_KEYS` order).
- `src/lib/service-icons.ts` — `SERVICE_ICONS.ticketmaster`, the dashboard-only brand mark
  (generated from simple-icons by `scripts/generate-service-icons.ts`).
- `src/app/artists/[id]/(dashboard)/integrations.ts` — wires `saveTicketmasterIdAction` /
  `syncTicketmasterAction` to the registry entry.
- `src/app/artists/[id]/(dashboard)/actions.ts` — `saveTicketmasterIdAction`,
  `syncTicketmasterAction`.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction`, `pullConnectionAction` (shared across every connection).
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/connect-modal.tsx`,
  `connection-modal.tsx`, `connection-list.tsx`, `connection-mark.tsx` — the Connections UI.
- `.env.example` — documents `TICKETMASTER_API_KEY`.

## Tests

- `tests/unit/sync/ticketmaster.test.ts` — event mapping, page-number pagination, empty
  results, 429 backoff, shaped errors, missing-key handling.
- `tests/integration/sync/sync.ticketmaster.test.ts` — `syncTicketmasterTourDates` against
  the real database: inserts new, refreshes ticketmaster-owned rows, never clobbers a
  manual row, tenancy.
- `tests/unit/manager-tools/connections/connections.test.ts` — Ticketmaster as a
  `CONNECTIONS` service entry (no `social`), row state/sort behavior.
- `tests/unit/manager-tools/connections/integrations-registry.test.ts` — the registry
  shape for services like Ticketmaster (`provenBy` pattern shared with Bandsintown/YouTube).
- `tests/unit/sync/sync-section-action.test.ts` — the `tour` section offers
  `['bandsintown', 'ticketmaster']`.
- `tests/unit/manager-tools/connections/service-icons.test.ts` — Ticketmaster's brand mark
  exists and matches the committed generated file.

## Known gaps

- A successful pull reports no count and a partial failure is invisible — the action never
  surfaces the `SyncResult` it gets back (see the "Quirk found in code" note above).
- No lookup-by-artist-name: the manager must already know the numeric/alphanumeric
  Ticketmaster attraction id. Nothing in this codebase resolves a name to one.
- The env file calls out a public-site attribution requirement when Ticketmaster data is
  live, but no attribution UI exists in the codebase to satisfy it.
- No cleanup when an event disappears from Ticketmaster; `syncExternal` only
  inserts/refreshes, it never removes a row upstream no longer sends.
