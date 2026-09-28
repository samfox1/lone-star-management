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

## What the manager enters

Two required fields in the Connections modal (`ConnectField`, `connect-modal.tsx`): a
**store domain** (placeholder `store.myshopify.com`) and a **storefront access token**
(placeholder `Storefront access token`, a `type="password"` field so it isn't shown in
plain text while typing).

Error, from `connectInputError` (`src/lib/connections.ts`):
- `Enter the store domain and its storefront token.` — either field blank.

The domain is validated more strictly once it reaches the database (see How it is stored).
There is no separate "Test connection" button in the current UI — connecting, probing and
the first pull all happen in one action (see Sync / integration).

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

## Sync / integration

API: **Shopify Storefront GraphQL API**, `https://{domain}/api/2024-01/graphql.json`
(`src/lib/merch/shopify.ts`, `createShopifyClient`). `{domain}` must match
`^[a-z0-9][a-z0-9-]*\.myshopify\.com$`, checked both client-side (so a bad domain can't
redirect the token to an attacker host) and, authoritatively, inside `connect_shopify`.

Auth is **per-store**, not a global env var: a Storefront token sent as
`X-Shopify-Storefront-Access-Token`, read from Vault at pull time by the owner-gated
`shopify_credentials` RPC. No `SHOPIFY_...` env var is actually wired to any of this — see
Known gaps.

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

- `src/lib/merch/shopify.ts` — `createShopifyClient`: the Storefront client, paging,
  throttle handling, `ShopifyApiError`, `METAFIELDS`, `PAGE_SIZES`.
- `src/lib/merch/sync.ts`, `probe.ts`, `live.ts`, `index.ts` — `syncShopifyMerch` (products
  → `merch` rows via `syncExternal`); `probeShopify`/`classify`/`probeAdvice` (the "Test
  connection" failure taxonomy); `toLiveProducts`/`isPublicSlug`; the one export door.
- `src/lib/connections.ts` — `SHOPIFY_KEY` and its special-cased `CONNECTIONS` entry.
- `src/app/artists/[id]/(dashboard)/merch/actions.ts` — `connectShopifyAction`,
  `probeShopifyAction`, `disconnectShopifyAction`, `syncShopifyAction`.
- `src/app/artists/[id]/(dashboard)/merch/page.tsx`, `merch-browser.tsx`, `merch-card.tsx` —
  the Merch tab; `merch-card.tsx` makes a Shopify product's core fields read-only.
- `src/app/artists/[id]/(dashboard)/(manager-tools)/connections/actions.ts` —
  `connectOneAction` (the Shopify branch), `disconnectConnectionAction`,
  `pullConnectionAction`.
- `.../connections/connect-modal.tsx`, `connection-modal.tsx` — the domain/token fields;
  Shopify has no `idField`, so the edit modal shows no editable "ID" row (see Known gaps).
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
- `tests/unit/manager-tools/connections/connections.test.ts`,
  `integrations-registry.test.ts`, `service-icons.test.ts` — Shopify as a `CONNECTIONS`
  entry outside both registries, its two-field error and count-based row state,
  `connectedCount` adding it from outside the artist row, and its brand mark.

## Known gaps

- **Still blocked on real credentials.** Per `MERCH_PLAN.md` and project memory
  (2026-09-10): `integrations` has never held a real Shopify row and `merch` has never held
  a synced product — Sam is waiting on the artist's team for a domain + token and declined a
  throwaway dev store. Every test mocks the network.
- **`.env.example` lists `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`, but neither name appears
  anywhere in the application code.** Real auth is the per-store Storefront token in Vault,
  set via `connect_shopify`. These look like leftovers or placeholders for the "OAuth app
  long term" step `MERCH_PLAN.md` describes as future work, not anything wired up today.
- **No token-rotation UI once connected.** The per-connection edit modal only shows an
  editable "ID" row when `def.source.idField` is set, and Shopify has none — no domain/token
  field there at all. The Connect grid also disables an already-connected tile
  (`disabled={already}`). The only way to change a store's token is Remove then Connect
  again — which, per the point above, leaves the old store's `merch` rows in place.
- `MERCH_PLAN.md` itself is stale in one place: it still names `shopify-panel.tsx` as the
  connect UI. That file is gone; connecting now runs through the Connections tool.
- The live lane needs `NEXT_PUBLIC_LONE_STAR_URL` set on the connected site's deploy or it
  stays dormant and published (possibly stale) prices render instead (project memory).
- No webhook keeps titles/images fresh between manual pulls.
