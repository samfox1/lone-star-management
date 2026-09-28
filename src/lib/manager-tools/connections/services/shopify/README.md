# Shopify

Connecting Shopify pulls an artist's store catalog into the Merch tab as draft products, so
a manager can pick which ones go on the site, in what order, while price and stock stay
live off Shopify at every page view.

## Connection type

Service (no public link). Shopify has no social profile a site shows — `src/lib/connections.ts`
names it explicitly outside both the social and integration registries (a Vault token, not
an artist-id column) and marks it `kind: 'service'`. Sam, 2026-09-28: "I will use Shopify
differently" — it is never a site button; it feeds the site's merch pages and buy buttons
instead (see On the site).

Two ways in, one result. **Connect with Shopify** (OAuth, a Shopify app with custom
distribution; Sam, 2026-09-28: "If they have their own connect portal … lets just prompt
that") is used whenever the app's credentials are set. Without them, the manager pastes a
**storefront token** as before. Either way the same kind of Storefront token lands in Vault
through the same `connect_shopify` path, so everything below "How it is stored" is shared.

## What the manager enters

**With the app set up** (`SHOPIFY_API_KEY` + `SHOPIFY_API_SECRET` both set; the page passes
the boolean `shopifyApp`, never a credential): the **store address** alone, then **Connect
with Shopify** — a link to `/api/shopify/install`. In the Connect window it is the footer's
action (with other picks, Connect runs those first and the link comes after); in Shopify's
own edit window it replaces the token field and Change token. The address is tidied first
(case, `https://`, and the `admin.shopify.com/store/{store}/…` link people usually have open).

Error, from `ShopifyLink` (`connect-modal.tsx`), before anything leaves:
- `Use the store address that ends in .myshopify.com.` — not a `{store}.myshopify.com` host.

The manager approves on Shopify's screen and lands back on Connections with one line above
the list (`shopify-return.tsx`): `Shopify connected.`, or what went wrong in plain words.
The callback sends only a CODE (`?shopify=failed&reason=hmac`); the page picks the words
(`shopifyReturnNotice`, `shopify-oauth.ts`), so nobody can put text on the page by link.

**Without the app:** two required fields in the Connections modal (`ConnectField`,
`connect-modal.tsx`): a **store domain** (placeholder `store.myshopify.com`) and a
**storefront access token** (placeholder `Storefront access token`, a `type="password"`
field so it isn't shown in plain text while typing).

Error, from `connectInputError` (`src/lib/connections.ts`):
- `Enter the store domain and its storefront token.` — either field blank.

The domain is validated more strictly once it reaches the database (see How it is stored).
There is no separate "Test connection" button in the current UI — connecting, probing and
the first pull all happen in one action (see Sync / integration).

## Set up the Shopify app (one time)

Sam does this once, in Shopify's **Dev Dashboard** (dev.shopify.com — where Shopify moved
app creation; the old Partner Dashboard and store-admin "custom apps" no longer make new
ones). Until step 3 is done, nothing changes: the Connect window keeps the domain + token
fields. `<dashboard>` below is the production address of this app, e.g.
`https://lone-star-management.vercel.app`.

1. **Create the app.** Apps → Create app → Start from Dev Dashboard → name it `Lone Star`.
2. **Create a version** (Versions → Create version), then Release:
   - **App URL:** `<dashboard>/api/shopify/install` (opening the app from Shopify's admin
     lands on the Lone Star dashboard).
   - **Embed app in Shopify admin:** off, if the form offers it. This app runs on its own
     site, not inside Shopify's admin.
   - **Scopes:** `unauthenticated_read_product_listings` — only that (`SHOPIFY_SCOPES`).
   - **Redirect URLs:** both `<dashboard>/api/shopify/callback` and
     `http://localhost:3000/api/shopify/callback` (for local testing).
   - **Webhooks API version:** the newest offered.
   - **Webhooks,** if the form has them: `app/uninstalled` →
     `<dashboard>/api/shopify/webhooks`. (The callback also registers it for each store with
     the one-time Admin token, so this is a back-up.) **Compliance webhooks** (customer data
     request, customer data erasure, shop data erasure): the same URL for all three.
3. **Credentials.** Settings → copy the **Client ID** and **Client secret**. In Vercel →
   Project → Settings → Environment Variables add `SHOPIFY_API_KEY` = Client ID and
   `SHOPIFY_API_SECRET` = Client secret (Production, plus Preview if you test there), then
   redeploy. For local testing, the same two lines in `.env.local`.
4. **Distribution.** Home → Distribution → Select distribution method → **Custom
   distribution** (this cannot be changed later) → enter the store's `.myshopify.com`
   address → Generate link. **A custom-distribution app installs on ONE store** (or the
   stores of one Shopify Plus organization). This app is Skeen's store's.
5. **Connect.** In Lone Star: Connections → Connect → Shopify (or Shopify's own row) → type
   the store address → Connect with Shopify → sign in to the store if asked → approve. You
   land back on Connections with "Shopify connected." If the store owner opens the install
   link from step 4 instead, Shopify sends them to the Lone Star dashboard afterwards;
   finishing from the artist's Connections page then goes straight through.
6. **Products.** In the store's admin, make the products available to the `Lone Star` app
   (the product's sales channels and apps). A product that isn't is simply missing from the
   pull, with no error — the same rule the pasted token always had.

**A second artist's store** cannot install this app (custom distribution is one store). It
needs **public distribution** (Shopify's App Store review; the listing can be unlisted) —
the same code, just a different distribution choice on a new app — or the pasted-token path.
While these two env vars are set, though, the Connect window shows only Connect with Shopify
for every artist (see Known gaps).

## How it is stored

- `public.integrations` — one row per artist, `provider = 'shopify'`: `secret_ref` (the
  Vault secret id, as text) and `metadata jsonb` holding `{ store_domain }`. The raw token is
  never a column value here.
- The token lives in Supabase **Vault** (`vault.secrets` / `vault.decrypted_secrets`),
  reachable only through the `SECURITY DEFINER` RPCs below.
- `merch` rows synced from Shopify: `source = 'shopify'`, keyed by `shopify_product_id`,
  with `handle`, `description`, `images`, `variants` (jsonb — never a table, since a manager
  never edits a variant), plus metafield-backed `shipping_estimate`, `preorder_note`,
  `record_label`, `shipping_days`. A partial unique index, `merch_handle_uniq` on
  `(artist_id, handle) where handle is not null`, keeps `/merch/[handle]` unambiguous.
- No `links` row — Shopify is a service, never a profile.
- **Connect with Shopify stores nothing new.** The Admin API token Shopify hands the callback
  lives for that one request: it makes the Storefront token and registers the uninstall
  webhook, then it is dropped — never a column, never Vault, never logged. The trip's
  **state** is a cookie (`ls_shopify_oauth`, HttpOnly, SameSite=Lax, path
  `/api/shopify/callback`, ten minutes, signed with the app secret, spent on return), not a
  table.

## Sync / integration

API: **Shopify Storefront GraphQL API**, `https://{domain}/api/2024-01/graphql.json`
(`src/lib/merch/shopify.ts`, `createShopifyClient`). `{domain}` must match
`^[a-z0-9][a-z0-9-]*\.myshopify\.com$`, checked both client-side (so a bad domain can't
redirect the token to an attacker host) and, authoritatively, inside `connect_shopify`.

Auth is **per-store**, not a global env var: a Storefront token sent as
`X-Shopify-Storefront-Access-Token`, read from Vault at pull time by the owner-gated
`shopify_credentials` RPC. `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` are the APP's credentials
and are used only by the connect routes, never by a pull.

**Connect with Shopify** (`src/lib/merch/shopify-oauth.ts`, the three routes under
`src/app/api/shopify/`):
1. `/install?artist=&shop=` — a signed-in manager of that artist only (`callerOwns`; anyone
   else gets a 404; /api is outside the proxy's login gate, so the route checks). Signs the
   state cookie (artist + manager + store + nonce) and redirects to
   `https://{store}/admin/oauth/authorize` with the client id, the scope, the callback URL
   (built from THIS request's origin, since the cookie belongs to it; Shopify's redirect
   allow-list pins the origins) and the nonce.
2. `/callback` — every check before any call: the signed cookie, Shopify's `hmac` over the
   query (sorted `k=v`, HMAC-SHA256 hex, compared in constant time), the nonce, the store
   (a signed return from another store is refused), the same signed-in manager, still an
   owner. Then: trade the code for an Admin token (`POST /admin/oauth/access_token`, no
   redirects followed), refuse if the granted scopes fall short, make a Storefront token
   (Admin GraphQL `storefrontAccessTokenCreate`, API `2026-07`), register `APP_UNINSTALLED`
   (https origins only; best effort), and save the Storefront token through
   `connectOneAction` — exactly the steps below. Any refusal goes back with a code and saves
   nothing.
3. `/webhooks` — see Known gaps for what uninstall can and can't remove.

Connecting (`connectOneAction` → `connectShopify`, `connections/actions.ts`) does three
things in order, via `app/artists/[id]/(dashboard)/merch/actions.ts`:
1. `connectShopifyAction` → the `connect_shopify` RPC: validates the domain, creates or
   rotates the Vault secret, upserts `integrations` (a per-artist advisory lock serializes
   concurrent connects).
2. `probeShopifyAction` → reads the just-stored credential back out of Vault and requests
   **one page** of products (`getFirstPage`, not `getProducts`) — proving the *stored*
   token works, deliberately not the freshly typed one, so a green check can't hide a
   broken pull.
3. `syncShopifyAction` → pulls the whole catalog (paginated `getProducts`) and upserts it
   into `merch` (`syncShopifyMerch`).

What is pulled, per product: title, plain-text description (never `descriptionHtml`),
`handle`, featured + gallery images (requested as PNG — see Limits), price range, every
variant (`id` — a ProductVariant gid, what a cart line is built from —, title,
`availableForSale`, price/currency), and four **metafields** under the `custom` namespace
(`METAFIELDS`, `shopify.ts`). A metafield must be published to the Storefront API or it is
simply absent, with no error.

Where it lands: `merch`, via `syncShopifyMerch` → `syncExternal` (`@/lib/sync`, the shared
conflict policy every provider uses). New rows insert `on_site: false`. A sync never
overwrites a hand-edit on a *manual* product, and never writes `in_stock` at all — that
stays a manual override, since deriving it from `variants` would silently revert a
deliberate "sold out" toggle.

**How "connected/synced" is proven:** the Connections page counts `merch` rows with
`source = 'shopify'` (`sourceCounts`, `connections/page.tsx`) — a store that answers but has
nothing synced reads as "connected, failed," never a silent tick. `probeShopify` treats an
**empty product list as success** (`src/lib/merch/probe.ts`): Shopify answers `200` + `[]`
both for a genuinely empty store and for one whose products aren't published to this token's
sales channel, and the API can't tell them apart — so the probe reports both possibilities
rather than guessing.

**Two lanes** (`MERCH_PLAN.md`): the **editorial lane** — which products are on the site,
order, presentation — is the manager's, published into `revisions`, snapshot-stable. The
**live lane** — price, availability, variants — is Shopify's, resolved at **render**, never
frozen into a revision (`src/lib/merch/live.ts`, `toLiveProducts`), served via
`shopify_store_for_slug` (keyed by public slug, granted to `service_role` only, since a slug
identifies an artist rather than a caller and so can't check `is_manager_of`). A price frozen
until the next publish is a wrong price shown to a buyer — the staleness this design treats
as unacceptable.

**Security rules** (project memory, `merch-payment-security`): payment itself is Shopify's —
this stack never holds a card number or a live storefront token in the browser; the buy
button is a Shopify cart permalink built from a numeric variant id. Store links must be
HTTPS-only and fail closed. JSON-LD built from Shopify data must go through a proper
escaping helper, never raw `JSON.stringify` (a product title carrying `</script>` would
otherwise break an inline script tag). These rules live in the connected **site's** codebase
(e.g. skeen-website), not here — this repo's job is keeping the token in Vault and never
shipping it in a public payload.

Limits and quirks: Storefront rejects any query over 1000 cost points; `PAGE_SIZES`
(`products: 10, variants: 50, images: 10, metafields: 4`) is a deliberate budget, pinned by
a test that fails if the arithmetic crosses the cap. A product with over 50 variants gets a
follow-up query, capped at `MAX_VARIANTS_PER_PRODUCT = 250`. Storefront throttles with an
**HTTP 200** carrying `errors[].extensions.code === 'THROTTLED'`, not a 429 — handled with
its own fixed 1s backoff. Product images are requested as PNG so cut-out art keeps its alpha
channel on the site's near-black background; this can't *create* transparency — a flat JPG
still comes back as a flat JPG in a PNG wrapper. Reconnecting to a **different** store
doesn't clear old synced `merch` rows (disconnect keeps them, by design); if the new store
reuses an old handle, every colliding insert fails permanently against `merch_handle_uniq`,
reported in `SyncResult.errors` but not auto-recovered. `.myshopify.com` is the only accepted
host, even for a store with a custom public domain.

How a pull is triggered: **Connect** (first time) runs all three steps above. **Sync dialog
/ "Pull now" / a failed row's Retry** → `pullConnectionAction` →
`syncSectionAction(artistId, 'merch', ['shopify'])` → `syncShopifyAction` (probe is not
re-run, only the pull). Nothing is scheduled.

## On the site

Shopify is dashboard-only — never a social button. It feeds the **Merch** surface: published
`merch` rows (title, image, order — the editorial lane) render as a grid and per-product
pages, with buy buttons built from Shopify variant ids and checkout handled entirely by
Shopify (a cart permalink, per `MERCH_PLAN.md`). A connected site also calls Lone Star's own
`/api/merch/[slug]` at render to overlay live price/availability — the token itself never
reaches the site or the browser. The payload shape is `SiteMerch`
(`packages/site-bridge/src/payload.ts`).

## Code map

- `src/lib/manager-tools/connections/services/shopify/index.ts` — this service's own code:
  `SHOPIFY_KEY` and `service`: Shopify's whole `CONNECTIONS` def (neither registry has
  it).
- `src/lib/merch/shopify.ts` — `createShopifyClient`: the Storefront client, paging,
  throttle handling, `ShopifyApiError`, `METAFIELDS`, `PAGE_SIZES`.
- `src/lib/merch/shop-domain.ts` — the one `{store}.myshopify.com` rule (`SHOP_DOMAIN_RE`,
  `isShopDomain`), `normalizeShopDomain`, `shopifyInstallPath`. Client-safe.
- `src/lib/merch/shopify-oauth.ts` — the app: `SHOPIFY_SCOPES`, `shopifyAppConfig`,
  `verifyCallbackHmac`, `createState`/`readState`/`checkCallbackState`, `authorizeUrl`,
  `exchangeCode`, `createStorefrontToken`, `registerUninstallWebhook`, `verifyWebhookHmac`,
  and the return codes + words (`OAUTH_FAILURES`, `returnPath`, `shopifyReturnNotice`).
  Server-only (node:crypto).
- `src/app/api/shopify/install/route.ts`, `callback/route.ts`, `webhooks/route.ts` — the
  three routes.
- `src/lib/merch/sync.ts`, `probe.ts`, `live.ts`, `index.ts` — `syncShopifyMerch` (products
  → `merch` rows via `syncExternal`); `probeShopify`/`classify`/`probeAdvice` (the "Test
  connection" failure taxonomy); `toLiveProducts`/`isPublicSlug`; the one export door.
- `src/lib/connections.ts` — re-exports `SHOPIFY_KEY`; appends the def above to `CONNECTIONS`.
- `src/app/artists/[id]/(dashboard)/merch/actions.ts` — `connectShopifyAction`,
  `probeShopifyAction`, `disconnectShopifyAction`, `syncShopifyAction`.
- `src/app/artists/[id]/(dashboard)/merch/page.tsx`, `merch-browser.tsx`, `merch-card.tsx` —
  the Merch tab; `merch-card.tsx` makes a Shopify product's core fields read-only.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the Shopify branch), `disconnectConnectionAction`,
  `pullConnectionAction`.
- `.../connections/connect-modal.tsx`, `connection-modal.tsx` — the domain/token fields, or
  the store address + `ShopifyLink` ("Connect with Shopify") when `shopifyApp`; the edit
  window's Store row changes the store either way.
- `.../connections/page.tsx` — computes `shopifyApp` and the return notice;
  `connection-list.tsx` passes `shopifyApp` to both windows; `shopify-return.tsx` is the
  line shown on return.
- `src/app/artists/[id]/(dashboard)/sync-sections.ts` — resolves Shopify by name for the
  merch Sync dialog (it has no registry entry to be found by).
- `src/lib/service-icons.ts` — `SERVICE_ICONS.shopify`.
- `supabase/migrations/20260624110000(+_fixes)_shopify_integration_vault.sql` —
  `connect_shopify`, `shopify_credentials`, `disconnect_shopify`.
- `supabase/migrations/20260902130000_shopify_store_for_slug.sql` — the live lane's public
  door. `20260902120000`–`20260903140000` — the Shopify-owned `merch` columns (product
  detail, preorder fields, record label, shipping days).
- `packages/site-bridge/src/payload.ts` — `SiteMerch`, what a connected site receives.
- `MERCH_PLAN.md` (repo root) — the plan of record: the two-lane rule, build order, status.

## Tests

- `tests/unit/shopify/shopify.test.ts` — the Storefront client: mapping, pagination, HTTP +
  in-body throttle retry, error shaping, the missing-config guard.
- `tests/unit/shopify/shopify-probe.test.ts` / `shopify-probe-action.test.ts` — which
  failure maps to which `ProbeFailure`, an empty list as success, and that the probe reads
  the **stored** credential, not a typed one.
- `tests/unit/shopify/merch-actions.test.ts` — `syncShopifyAction` reports partial failure
  (counts + first diagnostic message), not a bare "pulled."
- `tests/unit/shopify/merch-live.test.ts`, `merch-live-route.test.ts` — the live-lane
  reduction, and that `/api/merch/[slug]` caches failures too and validates the slug first.
- `tests/integration/shopify/sync.shopify.test.ts`, `merch-live-door.test.ts` — the sync and
  the live-lane door against the real database: dedup by `shopify_product_id`, tenancy, and
  that only `service_role` can read a store's token.
- `tests/components/shopify/merch-card-shopify.test.tsx`, `merch-editor-shopify.test.tsx` —
  a Shopify product's title/price/link/image are read-only in the dashboard card and the
  site editor's Merch panel; a manual product's stay editable.
- `tests/components/manager-tools/connections/connect-modal.test.tsx` — the domain/token
  step and its connecting → connected/failed states.
- `tests/unit/shopify/shopify-oauth.test.ts` — the app's rules: the callback `hmac` (built
  from Shopify's recipe, not the code), constant-time compare, the state cookie (tampered
  artist, other secret, expiry, other nonce/store/manager), the store address, the
  authorize link, the scope list, the webhook signature, the Shopify calls (fetch mocked),
  and every return code having words.
- `tests/unit/shopify/shopify-oauth-routes.test.ts` — the three routes: install only for an
  owner; the callback saves the STOREFRONT token through `connectOneAction` and each
  refusal (hmac, state, other store, expiry, other manager, non-owner, no cookie) saves
  nothing and calls Shopify for nothing, each after a planted witness saves; the webhook
  deletes only the signed store's row.
- `tests/unit/manager-tools/connections/connect-shopify-reason.test.ts` — the step codes
  (`connect`, `probe-…`, `sync`) the callback reports.
- `tests/unit/manager-tools/connections/connections-page-shopify.test.ts` — `shopifyApp`
  follows the two env vars and no credential reaches a prop.
- `tests/components/manager-tools/connections/shopify-app-connect.test.tsx` — both windows
  in both modes, the bad-address stop, mixed picks, and the return line.
- `tests/unit/manager-tools/connections/connections.test.ts`,
  `integrations-registry.test.ts`, `service-icons.test.ts` — Shopify as a `CONNECTIONS`
  entry outside both registries, its two-field error and count-based row state,
  `connectedCount` adding it from outside the artist row, and its brand mark.

## Known gaps

- **Still blocked on real credentials.** Per `MERCH_PLAN.md` and project memory
  (2026-09-10): `integrations` has never held a real Shopify row and `merch` has never held
  a synced product — Sam is waiting on the artist's team for a domain + token and declined a
  throwaway dev store. Every test mocks the network.
- **The app has never met real Shopify.** The OAuth flow is built to Shopify's documented
  spec and tested with fetch mocked; the first real run is step 5 of the setup above.
- **One app = one store.** Custom distribution installs on a single store. With the two env
  vars set, the Connect window offers ONLY Connect with Shopify, for every artist — so a
  second artist on a different store is stuck (Shopify refuses the install, on Shopify's
  page, and the pasted-token fields are hidden). Before a second store: public distribution,
  or a "use a token instead" fallback in the UI.
- **Uninstall leaves the Vault secret behind.** `app/uninstalled` deletes the store's
  `integrations` row with the service role, because `disconnect_shopify` checks that the
  CALLER manages the artist and a webhook has no caller. The secret it pointed to stays in
  Vault, holding a token Shopify revoked at uninstall. Fixing it needs a service-role-only
  SQL door (secret first, then row, by store domain) — not added yet.
- **Uninstall matches by store, not by how it was connected.** If the same store was also
  connected to another artist with a pasted token (not through the app), uninstalling the
  app removes that connection too, though its token still works.
- **`shop/redact` keeps the synced merch rows.** The credential goes at uninstall; product
  titles/images/prices stay, since they are the artist's published catalogue. No Shopify
  customer or order data is ever held (the only scope reads published products), so the two
  `customers/*` webhooks have nothing to do.
- **Each Connect with Shopify makes a new Storefront token** (Shopify allows 100 per store);
  a failure after it is made (the save, the probe) leaves it unused on Shopify's side until
  the app is uninstalled.
- Changing the store (or its token) from Shopify's edit window keeps the old store's
  `merch` rows, as Remove does; a reused handle then collides (see Limits).
- `MERCH_PLAN.md` itself is stale in one place: it still names `shopify-panel.tsx` as the
  connect UI. That file is gone; connecting now runs through the Connections tool.
- The live lane needs `NEXT_PUBLIC_LONE_STAR_URL` set on the connected site's deploy or it
  stays dormant and published (possibly stale) prices render instead (project memory).
- No webhook keeps titles/images fresh between manual pulls.
