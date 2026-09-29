# Eventbrite
Connecting Eventbrite links the artist's organizer page on the site and, through **Connect with Eventbrite**, pulls their upcoming public events into Tour, each with its ticket link pointing at the event's own Eventbrite page (Sam, 2026-09-28: "by adding eventbrite, I will allow users to be redirected to the artist's event information via eventbrite").

## Connection type
**Link + sync, the sync by sign-in.** Two ways in:

- **Connect with Eventbrite** (when the app is set up): sign in to Eventbrite, press Allow; we find the organizer page, save its link, keep the artist's token in Vault and pull the shows.
- **Paste the organizer link** (always there, the fallback): the link only. A pasted link cannot pull, because Eventbrite has no public read (see Shows), so there is no Sync switch on this row.

Eventbrite issues two real, inconsistent organizer-profile shapes (a `/o/<slug>-<id>` path and a custom `<name>.eventbrite.com` subdomain), so, like Spotify and Tidal, there is no one clean handle to build from. A pasted link is taken as-is (`src/lib/connections.ts`).

## What the manager enters
Nothing, for Connect with Eventbrite. Or the organizer link (`https://www.eventbrite.com/o/skeenmusic-123456789`, or their custom `https://skeenmusic.eventbrite.com`). A link pasted BEFORE pressing Connect with Eventbrite also says which organizer page to connect, when the account has several (its numeric id rides along as a hint).

Errors on the paste, quoted from `src/lib/connections.ts` (`profileLink` / `connectInputError`):
- Empty field: "Paste the Eventbrite link."
- Just the bare site address (nothing after the host): "Add the rest of the link — that's just the site's address."
- A link to a different known platform: "That's an Instagram link, not Eventbrite." (the wrong platform's name fills in)
- A link no platform owns (a personal site, a `javascript:` string): "That isn't an Eventbrite link." Its country sites (`eventbrite.co.uk`, `.com.au`…) and an organizer subdomain (`skeen.eventbrite.com`) are Eventbrite.

## Connect with Eventbrite
How it works (`src/lib/eventbrite-oauth.ts`, routes `src/app/api/eventbrite/{start,callback}`), the YouTube sign-in's pattern:

1. **Start** (`/api/eventbrite/start?artist=<id>`, `&organizer=<id>` when a link was pasted first) checks the signed-in manager owns the artist, sets a 10-minute HttpOnly state cookie signed with the client secret (the artist, the manager, a nonce, a PKCE verifier, the organizer hint), and sends the browser to `https://www.eventbrite.com/oauth/authorize` (`response_type=code`, the app key, the redirect, `state`, an S256 challenge).
2. **Callback** (`/api/eventbrite/callback`) checks the cookie, the nonce, the manager and ownership before anything else, then trades the code at `https://www.eventbrite.com/oauth/token` (form-encoded: `grant_type=authorization_code`, the code, the app key, the secret, the redirect, the verifier).
3. **Which organizer page.** `GET /v3/users/me/organizations/`, then `GET /v3/organizations/{id}/organizers/` for each, then `chooseOrganizer`:
   - none: "No organizer profile on that Eventbrite account." Nothing saved.
   - one: that one.
   - several: the one the pasted link names; otherwise the ONE whose name matches the artist's (case, spaces, accents aside); otherwise it **asks**: "That Eventbrite account has several organizer profiles. Paste this artist's organizer link in the Eventbrite field, then press Connect with Eventbrite." A pasted link whose organizer is not on the account is refused, never swapped for another.
4. Then, in order: the token into **Vault** (`connect_eventbrite`); the organizer page's link through the SAME door a paste uses (`connectOneAction` → the `links` row, off the site); the first pull (`syncEventbriteAction`). If the link save fails the token is forgotten again, so "Nothing was saved" stays true. If the pull fails, the connection stays and the notice says to press Pull now.
5. Back on Connections, one line: "Eventbrite connected.", or what went wrong. Only a CODE travels in the URL; the words are chosen on the server (`eventbriteReturnNotice`).

A pasted Eventbrite link is dimmed in the Connect grid once connected, so the connection's own window (click its row) carries **Connect with Eventbrite** too, with the linked organizer as the hint. It also renews a sign-in Eventbrite stopped accepting.

**PKCE.** Eventbrite does not document it. We send it anyway (RFC 7636 §5 says clients should; RFC 6749 §3.1/§3.2 make a server ignore parameters it does not know), so it protects the code if Eventbrite honours it and costs nothing if not. What certainly guards the code: the client secret on the exchange, and the signed, nonce-bound, manager-bound state. If a real sign-in ever fails at the exchange with `invalid_request`, dropping `code_verifier` is the first thing to try.

**Env vars** (server-only, `.env.local` / Vercel): `EVENTBRITE_CLIENT_ID` (what Eventbrite calls the **API key**) and `EVENTBRITE_CLIENT_SECRET`. Without both, the button is hidden, the row is a plain paste field, and a pasted link shows no Sync chip.

**Redirect URI:** `<origin>/api/eventbrite/callback`, built from the request's own origin: `http://localhost:3000/api/eventbrite/callback` today, the production one at launch (`LAUNCH_CHECKLIST.md`). Only https, or http on `localhost`.

## Shows
**Why the artist's token is kept.** Eventbrite's v3 API has no anonymous access ("every request to the OAuth API must be authenticated", tokens "are tied to user accounts") and no app-only token: the client id and secret alone cannot read anything. An organization's events are read with a member's token (`GET /v3/organizations/{organization_id}/events/`, "the events the current user has access to"). The public event search that once let anyone list events was deprecated in 2020. So "Pull now" later needs the artist's own token, and it is stored, ONLY in Vault (see How it is stored).

**The pull** (`syncEventbriteAction`, `src/app/artists/[id]/(dashboard)/tour/eventbrite-actions.ts`): reads the token back through `eventbrite_credentials`, lists `GET /v3/organizations/{org}/events/?organizer_filter={organizer}&status=live,started&time_filter=current_future&order_by=start_asc&expand=venue&page_size=50` (following `continuation` up to 20 pages), maps each event (`showFromEvent`, `src/lib/eventbrite.ts`) and writes them (`syncEventbriteTourDates`, `src/lib/sync.ts`). It runs from the callback, the connection's Pull now / Retry, and the Tour page's Sync dialog.

**Which events land:** only public, upcoming ones. `live` or `started` (on now); not `draft`, `canceled`, `ended` or `completed`. Not unlisted (`listed: false`), invite-only, or password-protected.

**How an event maps to a tour date:**

| tour_dates | from the event |
| --- | --- |
| `date` | the show's own LOCAL date (`start.local`; or `start.utc` seen from `start.timezone`). 9pm in Los Angeles is not "tomorrow". |
| `venue` | `venue.name`; `Online` for an online event; empty when no venue is set yet |
| `city` | `venue.address.city` |
| `state` | `venue.address.region`, only for a US address and only a real state code (the column's CHECK) |
| `country` | `venue.address.country`, written out (`canonicalCountry`: "United States") |
| `ticket_url` | the event's own page (`url`), only as an https link the site reads as Eventbrite's; an event without one is not used |
| `latitude`, `longitude` | the venue's coordinates (dashboard-only, never published) |

The table has no time or timezone column, so the start time is not stored.

**Drafts, dedupe, edits:**
- A new event is inserted **off the site** (`on_site: false`), `source: 'eventbrite'`, keyed by `eventbrite_id`: the library is where it arrives. The Tour page's tick puts it in the draft and Publish commits it (PRESENCE_PLAN: tour dates are DRAFT_PRESENCE). The pull writes no revision.
- **Never duplicated:** matched by `eventbrite_id`; a unique index `(artist_id, eventbrite_id)` also stops two racing pulls.
- **Never overwriting a manager's edits:** a three-way merge per column (`planTourPull`, `src/lib/tour-pull.ts`). Each pulled row remembers what the pull last wrote (`tour_dates.pulled`); a re-pull changes a column only while the row still holds that value. An edited (or emptied) column keeps the manager's value for good; an untouched one follows Eventbrite (the venue moved, it moves). A row another source owns is never written. (The older Bandsintown/Ticketmaster syncs still refresh every column; see Known gaps.)
- **Slotted by date:** in a list the manager has dragged, new shows go after the last show dated on or before them (`slotNewRows`, the Tour page's own Add rule); an undragged list orders itself by date.

## How it is stored
- A `links` row: `label: 'Eventbrite'`, `url` = the organizer page's link (from the sign-in) or the link as pasted, `on_site: false`.
- **The sign-in:** an `integrations` row (`provider: 'eventbrite'`) whose `secret_ref` points at a **Supabase Vault** secret holding the token, and whose `metadata` holds `{ organization_id, organizer_id }`. Written only by `connect_eventbrite`, read only by `eventbrite_credentials`, removed by `disconnect_eventbrite` (migration `20260929120500_eventbrite_integration.sql`, Shopify's pattern and grants: SECURITY DEFINER, owner-gated, `revoke … from public, anon`, `grant … to authenticated`). One addition over Shopify's: the Vault secret is **bound to its artist** (description `eventbrite:<artist_id>`) and every function checks the binding, because `integrations_rw` lets a manager repoint their own row's `secret_ref`. The token is never in a column, a cookie, a URL or a log.
- No `artists` column: connected = the integrations row exists (`getEventbriteSignedIn`, `_data.ts`). So nothing reads a new column before the migration is pushed.
- Tour dates: `tour_dates.eventbrite_id`, `tour_dates.pulled`, `source = 'eventbrite'` (the same migration).

**Remove** deletes the link, then `disconnect_eventbrite` deletes the Vault secret and the row. Eventbrite documents no revoke endpoint, so ending the grant at Eventbrite itself is the artist's own, from their Eventbrite account. Eventbrite's tokens carry no scopes (the whole account) and do not expire (only a password change ends one), which is why the token lives in Vault and nowhere else.

**After pushing the migration**, `npm run audit:grants` should report nothing new: the three functions are revoked from `anon`, so none of them is anon-executable and the allowlist does not change.

## On the site

Bridge slug `eventbrite` in `SOCIAL_PLATFORMS` (`packages/site-bridge/src/social.ts`, appended 2026-09-28), `urlHint: 'https://eventbrite.com/o/'`; its country sites (`eventbrite.co.uk`, `.com.au`, `.ca`…) as `aliasHosts`. The pulled shows reach the site as ordinary tour dates once ticked and published; their ticket buttons open the event's Eventbrite page.

Mark: **the brand's own icon** (2026-09-28). Source: the official press kit linked from [eventbrite.com/blog/press](https://www.eventbrite.com/blog/press/) ("Download Press Kit"), which pairs Eventbrite's 2025 rebrand mark (the brushstroke "E" ribbon, "The Path") with the wordmark in the brand orange (`#FF5E30`). The kit has no standalone icon file or written usage rules, so the icon-only shape came from Eventbrite's own production site instead — its header renders this same ribbon mark alone at 24x24px for its compact nav slot, the same size and use case as this icon set, and its fill there is a CSS variable a colour class overrides to brand orange — Eventbrite's own pattern for recolouring it as one flat colour, not a distortion. The rule we follow: use the icon-only mark (not the wordmark) for a small/square slot, as one flat colour. `scripts/generate-social-icons.ts` (`OFFICIAL_MARKS`) has the full source note; `social-icons.ts` marks the line `// OFFICIAL`.

## Code map
- `index.ts` (here): `social` (link method, the organizer-id regex as `idFromUrl`, now the sign-in's hint), `signInSource` (the tour source, no id column), `EVENTBRITE_KEY`, `eventbriteStartPath`.
- `src/lib/eventbrite-oauth.ts`: the sign-in's trusted rules (config, state cookie, PKCE, authorize link, code exchange, `chooseOrganizer` / `findOrganizer`, return codes and words).
- `src/lib/eventbrite.ts`: the API client (organizations, organizers, upcoming shows) and `showFromEvent`.
- `src/lib/tour-pull.ts`: `planTourPull` (dedupe + the three-way merge), `slotNewRows`.
- `src/lib/sync.ts`: `syncEventbriteTourDates`, the writer.
- `src/app/api/eventbrite/start/route.ts`, `src/app/api/eventbrite/callback/route.ts`: the two routes.
- `src/app/artists/[id]/(dashboard)/tour/eventbrite-actions.ts`: `syncEventbriteAction`, `disconnectEventbriteAction`.
- `src/lib/connections.ts`: attaches `signInSource` to the social; `buildConnectionRows({ signedIn })`.
- `.../(dashboard)/sync-sections.ts`, `sync-section-action.ts`: Eventbrite in the Tour page's Sync dialog and Pull now, resolved by name (it is not in `INTEGRATION_REGISTRY`: no id column).
- `.../connections/actions.ts`: Remove forgets the sign-in; a pasted link's Sync says to sign in.
- `.../connections/connect-modal.tsx` (`EventbriteTrip`), `connection-modal.tsx`, `connection-list.tsx`, `page.tsx`, `shopify-return.tsx` (`EventbriteReturnNotice`): the UI.
- `supabase/migrations/20260929120500_eventbrite_integration.sql`: the columns, the index, the Vault functions.

## Tests
Specific to Eventbrite:
- `tests/unit/manager-tools/connections/eventbrite-oauth.test.ts`: config, origin, state (round trip, tamper, other secret, domain separation, expiry), PKCE, the authorize link, the exchange, `chooseOrganizer` (none / one / several by name / ask / the pasted link's / not on the account), `findOrganizer`, the return words.
- `tests/unit/manager-tools/connections/eventbrite-oauth-routes.test.ts`: both routes; every refusal saves nothing and calls nothing (with a planted witness); the token only ever reaches `connect_eventbrite`; a failed link save forgets it again.
- `tests/unit/tour/eventbrite-events.test.ts`: which events land and how they map (local dates and timezones, online, no venue, cancelled/draft/private skipped, the ticket link), paging, ids checked before a URL, no token in any error.
- `tests/unit/tour/tour-pull.test.ts`: dedupe, the three-way merge, slotting.
- `tests/unit/tour/eventbrite-sync.test.ts`: the writer (drafts off the site, nothing published, one row per event, edits kept, update filtered to Eventbrite's rows, races, RLS fatal).
- `tests/unit/sync/eventbrite-actions.test.ts`, `tests/unit/sync/sync-section-eventbrite.test.ts`: the pull reads Vault only, Remove forgets, the Tour Sync runs it.
- `tests/unit/manager-tools/connections/connections-page-eventbrite.test.ts`, `tests/components/manager-tools/connections/eventbrite-connect.test.tsx`: the page seam and the buttons.
- **Pending the migration** (they skip themselves until it is pushed, then run): `tests/integration/sync/eventbrite-vault.test.ts` (grants, isolation, the artist binding, Remove destroys the secret) and `tests/integration/sync/sync.eventbrite.test.ts` (the pull on the real database).
- Earlier: `tests/unit/site-editor/social-hosts.test.ts` (country sites, subdomains, look-alikes), `connections.test.ts` ("the organizer id comes out of an /o/ link"), `social-icons.test.ts` (the official mark).

Shared suites that loop over the registry pin it too: `services.test.ts` (its `CONNECTIONS` def, now with the tour source), `connect-methods.test.ts`, `connections.test.ts`, `link-vocabulary.test.ts`, `social-icons.test.ts`, `editor-social-buttons.test.tsx`.

## Known gaps
- **The migration is written, not pushed.** Until `20260929120500_eventbrite_integration.sql` is pushed, Connect with Eventbrite ends at "Couldn't save the Eventbrite connection" (the Vault function does not exist yet); pasting keeps working.
- **Not tried against a real Eventbrite account yet** (Sam's first sign-in is the test). Two assumptions to watch there: Eventbrite echoes `state` (standard OAuth; every return reads as "expired or didn't match" if not), and it ignores the PKCE parameters it does not document.
- A show deleted in the dashboard comes back on the next pull (off the site); a show cancelled on Eventbrite after it was pulled stays until the manager removes it. Both need a record of removed event ids; not built.
- The same show from Eventbrite and from Ticketmaster/Bandsintown is two rows.
- Eventbrite app review: other people's accounts may need Eventbrite's approval of the app (`LAUNCH_CHECKLIST.md`).
- The Manager-tools "connected" count (`connectedCount`) does not count Eventbrite's sign-in yet.
