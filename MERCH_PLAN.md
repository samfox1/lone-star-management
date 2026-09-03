# Merch: Shopify as the source, your site as the storefront

*Drafted 2026-09-02, decisions locked with Sam the same day. Status of record for the merch surface.*

## The shape, in one paragraph

The artist's management team owns a Shopify store and puts the products in it. Lone Star
pulls that catalogue into the Merch tab. The manager picks which products go on the site
and in what order, and publishes. The site renders a `/merch` grid and a `/merch/[handle]`
page per product, with a right-hand cart drawer; checkout is Shopify's, branded to match.
**Sam never touches an artist's Shopify account.**

## Decisions

| Question | Answer |
| --- | --- |
| Store owner | The artist's management team. Not Sam, ever, at any scale. |
| Connect flow | **Guided self-serve now, OAuth app long term.** |
| Nav button | Hidden entirely when no merch is published — same rule as `/about`. |
| Page shape | **Per-product routes**: `/merch` grid → `/merch/[handle]`. |
| Buy flow | **Local cart + right-hand drawer** → one multi-line Shopify cart permalink. |
| Editor control in v1 | **Layout tokens only** (grid, gap, width, card aspect). |
| Design | **Mocked before building.** |

## What already exists

Most of the dashboard pipe is built. The inventory, so nothing gets rebuilt by accident:

| Piece | Where | State |
| --- | --- | --- |
| Connect a store (domain + Storefront token → Vault) | `shopify-panel.tsx`, `connect_shopify` | done |
| Read products (Storefront GraphQL, paginated, throttle-safe) | `lib/shopify.ts` | done |
| Sync into `merch` (upsert by `shopify_product_id`, never clobbers manual edits) | `lib/sync.ts` `syncShopifyMerch` | done |
| Pick which products are on the site | `merch-browser.tsx` — `on_site` + PublishBar | done |
| Order, per-item edit, delete | `editor/merch-tools.tsx`, `merch-editor.tsx`, `sort_order` | done |
| Sold-out state | `merch.in_stock` (20260818130000) | done, but manual |
| Payload carries merch to sites | `SiteMerch` in `packages/site-bridge/src/payload.ts` | done |
| **The nav button** | `components/Hero.tsx:114` — **already written, commented out** | one-line uncomment |
| **Its editor declaration** | `lib/editList.ts:482` — also commented out | one-line uncomment |
| **`LINK.merch` key + `config.merch` mapping** | `editList.ts:207`, `mapSite.ts:131` | done |
| **Variants** | — | **missing, blocks everything** |
| **Product handle** (for `/merch/[handle]`) | — | **missing** |
| **`/merch` + `/merch/[handle]` pages** | — | **missing** |
| **Cart drawer** | — | **missing** |
| **Live price/stock (not frozen in the snapshot)** | — | **missing** |

The Hero comment says merch was "temporarily removed; will return once there's a store to
point at." That store is now the thing being built toward.

## The one architectural rule: two lanes

Every merch field currently rides the published revision snapshot
(`content.ts` → `snapshot: ['id','title','image_url','price','url','in_stock','sort_order','created_at']`).
That is right for what you own and wrong for what Shopify owns.

**Editorial lane — yours, published, in revisions.** Which products appear, their order,
display title, image override, section layout. A manager decides these and a publish
commits them. They must be snapshot-stable: the live site must not change because someone
opened Shopify.

**Live lane — Shopify's, resolved at render, never published.** Price, availability,
variants, per-variant stock. If these stay frozen in a revision, an artist who changes a
price in Shopify keeps showing the old one until somebody remembers to pull *and*
republish. A wrong price shown to a buyer is the one staleness that costs real money.

So: the snapshot stays the *selection and presentation* record. The site resolves
price/stock live off `shopify_product_id`, falling back to snapshot values for first
paint and for manually-added products with no Shopify row behind them.

## Where the Storefront token lives — settled, and it never goes public

The plan originally accepted publishing each store's storefront token in the public site
payload, because a cart drawer looked like it needed the token in the browser.

**It doesn't.** A cart drawer is local state: the lines live in `localStorage`, the
running total computes from prices the page already holds, and checkout is a single
multi-line cart permalink —
`https://{shop}.myshopify.com/cart/{variantA}:{qty},{variantB}:{qty}` — which Shopify
turns into a real cart and drops the buyer straight onto checkout. Zero Shopify calls
from the browser, zero token exposure, and the drawer from the jigitz reference intact.

What that costs: no live stock re-check between "add to cart" and checkout (Shopify
catches it at checkout anyway), and no cart syncing across a buyer's devices.

With the browser out of the picture, the only remaining Shopify call is the live
price/stock lookup, and that runs **server-side on Lone Star** (`/api/merch/[slug]`),
where the token already sits in Vault. So the token is never published anywhere, and the
scope-guard requirement that made the old plan safe is no longer load-bearing — it is
still worth adding at connect time, but as defence in depth rather than a precondition.

## Variants, handles, and the fields the reference design needs

`lib/shopify.ts` reads `priceRange.minVariantPrice` and nothing else, so a t-shirt is one
row, one price, no sizes. The reference (jigitz) shows what's actually required:

- **Variants** — `s m l xl 2xl` as selectable boxes, each with its own price and stock.
  Cart lines need a **variant** id, so this blocks the buy flow entirely.
- **Handle** — `/merch/[handle]` needs Shopify's `handle` (`50-ballerinas-t-shirt`).
  We store `shopify_product_id` (a `gid://shopify/Product/…`), which is not URL-shaped.
- **Description** — "premium tee with a cropped fit", "limit to 4 per customer".
- **Multiple images** — the grid uses one, the product page wants a gallery.
- **Metafields** — `estimated shipping date`, `label`, and the **pre-order acknowledgment
  toggle that gates the add-to-cart button**. These are not standard product fields; they
  are Shopify metafields the artist's team fills in. Worth supporting, because a pre-order
  gate is a legal/expectations device, not decoration — and merch drops are usually
  pre-orders.

Store the Shopify-owned blob as `merch.variants jsonb` plus `merch.handle text`, refreshed
on every pull. jsonb rather than a table on purpose: variants are never edited by a
manager, never published independently, and never joined against. A table would imply an
editorial surface that should not exist.

This also makes `in_stock` derivable (`variants.some(availableForSale)`) instead of a
checkbox somebody forgets, keeping the manual flag only as the override for
manually-added products.

## The site side

Per **editor-shows-what-site-sets**, every control the editor offers must match something
the region actually declares or it reads blank; `npm run audit:regions` enforces it. Per
**site-connection-contract**, the editor supplies values, the site owns presentation, and
values arrive as CSS variables, not inline styles.

v1 declares **layout tokens only**: grid columns (desktop/mobile), gap, content width,
card image aspect ratio. The existing `maxw-`, `gap-`, `pady-` families already cover most
of it. Card text, buttons, and the cart drawer inherit the site's existing colour, font
and button tokens — so it looks like skeen without thirty new regions to audit. Extend
once there are real products on screen.

Aspect ratio earns its place: Shopify product photos arrive in wildly inconsistent crops,
so it's the single control that does the most visual work.

## Progress

**Steps 1, 2 and 4 — DONE. 2026-09-03: the merch site is built.**

Step 3 (the design round) was ABANDONED, and the reason is worth keeping: the
`/design-variations-html` skill briefed its generators with a prose *description* of the
design system and let them write fresh CSS from it. Eight variations came back as
competent imitations of skeen — near-enough colours, invented spacing, a fallback font
instead of Space Grotesk — and Sam rejected all eight. The skill has been fixed to LOAD
the project's real stylesheet and fonts and to forbid subagents from writing
`font-family` or hex colours at all. The pages were then built directly against
`app/about/page.tsx`'s actual spacing and type.

**Step 4 (the site), in `~/Desktop/skeen-website`:**

- `lib/merch.ts` — mapping, the live overlay, and `checkoutUrl`. A cart permalink needs
  the NUMERIC variant id, not the gid, or checkout 404s silently.
- `lib/merchLive.ts` — reads `/api/merch/[slug]`; every failure returns null and the page
  renders published values, one publish behind.
- `components/CartProvider.tsx` — localStorage via `useSyncExternalStore`, so the server
  and hydrating renders agree by construction rather than by an effect.
- `components/CartDrawer.tsx`, `MerchGrid.tsx`, `MerchProduct.tsx`, `MerchChrome.tsx`.
- `app/merch/page.tsx`, `app/merch/[handle]/page.tsx` — both 404 when nothing is
  published, and the Hero button is gated on the same condition so they cannot disagree.
- `components/Hero.tsx` — the Merch button is back, between Contact and About. It is an
  internal route now, so the old `config.merch` / `LINK.merch` binding is deleted rather
  than uncommented; there is no external URL for the editor to point.

**PNG images (Sam, 2026-09-03).** Merch renders cut-out on the near-black ground with no
card or frame, so the images need an alpha channel. The Storefront query now asks for
`preferredContentType: PNG` — Shopify serves WEBP/JPG by default and a JPG has no alpha
at all, so a product shot would arrive with a white box baked around it. This cannot
CREATE transparency: a flat JPG uploaded by the artist comes back as a flat JPG in a PNG
wrapper. **Cut-out PNGs are an onboarding rule for the store**, and belong in the
guided-connect walkthrough (step 7).

**Not done:** the bridge still has to be published and skeen bumped off `^0.33.5` before
`handle`/`variants` are typed on `SiteMerch` — the site reads them defensively today.
`NEXT_PUBLIC_LONE_STAR_URL` is unset, so the live lane is dormant and published prices
render.

**Step 2 (live lane).**

- `shopify_store_for_slug` (20260902130000) + `/api/merch/[slug]` serve current price,
  availability and variants. The token is read server-side and never appears in the
  response. `unstable_cache` at 60s per slug, because the route is public and Shopify is
  rate-limited per store.
- The door cannot check `is_manager_of` (a slug identifies an artist, not a caller), so
  it is revoked from `authenticated` too and granted to `service_role` alone. Its denial
  tests plant a real store and prove `service_role` reads the token back FIRST — without
  that witness they would pass against an artist with no store and prove nothing.
- `toLiveProducts` deliberately drops title/images/description: serving them would let a
  Shopify edit overwrite the editorial layer through a path that never goes near a
  publish. A product with no variants is reported NOT buyable.
- `shopify_product_id` is the join key, not `handle` — a handle changes on rename and
  would break the join silently until the next publish.

**Step 1 (variants + handle in the sync).**

- `src/lib/merch/` now owns the whole Shopify pipeline (Sam, 2026-09-02):
  `shopify.ts` (Storefront client), `sync.ts` (products → merch rows), `index.ts`
  (the one door). `syncExternal` stays in `@/lib/sync` — the conflict policy is one
  rule for every provider (ADR-0005). Dashboard half lives beside it in
  `app/artists/[id]/(dashboard)/merch/`: `actions.ts` (connect/pull/disconnect) and
  `shopify-panel.tsx`.
- Query now pulls `handle`, `description`, `images`, `variants` (id, title,
  availability, price, currency). Migration `20260902120000` adds the four columns
  plus a partial unique index on `(artist_id, handle)`.
- Page size dropped 50 → 10 products. Storefront rejects a query over 1000 cost
  points and nested connections multiply: 50 × 100 variants ≈ 5000 would have failed
  every sync for every store. No fixture test could catch that (a mock answers
  whatever it is asked), so `PAGE_SIZES` is exported and a test asserts the
  arithmetic.
- `src/lib/merch/shopify.ts` added to `stryker.config.json` `mutate` — it had 30
  DB-free tests and was never on the list, so nothing had ever checked they can fail.
- **Two stale docs corrected.** `lib/sync.ts` and ADR-0005 both claimed a row's
  `source` flips to `manual` when a human edits it. Nothing implements that: a
  provider-imported row stays that provider's forever and every pull refreshes it,
  hand edits included. Consequence, now written down in both places: **a sync must
  not write any column a manager can edit.** That is why `in_stock` is deliberately
  not derived from `variants` here — it would revert a deliberate "sold out" toggle.
  Pinned by a test that plants `in_stock:false` and syncs over it.
- Review before the push caught one real bug: the columns were originally
  `not null default '[]'`, which would have made every merch row published BEFORE the
  migration read as EDITED in the unpublished-changes diff (`sameSnapshot` compares
  `a?.[k] ?? null`, and `"[]" !== "null"`). Every artist would have been told their
  merch changed when nothing had, and no test would have caught it —
  `diff-unpublished.test.ts` creates and publishes inside the test, so both sides get
  `[]`. All four columns are nullable with no default instead.
- Green: `tsc` clean, lint clean, 3954 DB-free tests, and 7/7 in `sync.shopify` against
  the migrated database.
- Both new sync guards were mutation-checked by hand, not just observed passing:
  deriving `in_stock` from `variants` turns the override test red; dropping `variants`
  from the synced values turns the other two red. Restored, green again.

## Build order

Each step ships and leaves the system working.

1. **Variants + handle in the sync.** Extend the Storefront query (`variants(first: 100)`,
   `handle`, `description`, `images`), store `merch.variants jsonb` + `merch.handle`,
   derive `in_stock`. Nothing user-visible; unblocks all of the below. Test-first against a
   fixture store with a multi-size product, asserting the blob and the derived flag.
2. **Live lane on the read path.** Site resolves price/availability from Shopify at render
   (ISR ~60s, same as `get_public_site`), snapshot as fallback. Proof: change a price in
   Shopify, reload, see it — without publishing.
3. **Design round.** ← NEXT. `/design-variations-html` for the grid, product page and cart drawer
   in skeen's real tokens (black, cream, `flash-1` red, `font-alt`, lowercase), against the
   jigitz reference. Sam picks, then build.
4. **`/merch` + `/merch/[handle]` + cart drawer** on skeen. Declared layout regions,
   variant picker, quantity steppers, running total, and a multi-line cart permalink on
   checkout. Cart lines in `localStorage` so a reload doesn't empty it. The page overlays
   `/api/merch/[slug]` onto its published rows by `shopify_product_id`, falling back to
   published values when that call fails. Contract check and `audit:regions` green.
5. **Uncomment the nav button** (`Hero.tsx:114`, `editList.ts:482`), pointed at `/merch`,
   hidden when nothing is published — mirroring `aboutPlacement === "page"`. Sam asked for
   it between Contact and About; the old commented line sat before Contact, so it moves.
6. **Editor controls** for the tokens step 4 declares. No new architecture — the existing
   panel, filtered by the new declarations.
7. **Guided self-serve connect.** Rewrite the Integrations Shopify panel into a real
   walkthrough: the exact Shopify admin path, the scope to tick
   (`unauthenticated_read_product_listings`), and a "test connection" that pulls one
   product back so they know it worked. Plus the scope guard from the token section above.
8. **Checkout branding** in Shopify admin — logo, colours, fonts. Fifteen minutes of
   settings, and it does more for "consistent" than any code here. It has to be an artist
   onboarding task, since you can't do it for them.

**Later:** the Shopify OAuth app (Partner app, callbacks, install/uninstall, review) to
replace token pasting — agreed as the right long-term answer, deliberately not now.
A `products/update` webhook to keep dashboard titles/images fresh. Mirroring product images
into your own bucket, which should be decided before the first site ships merch, because
migrating live image URLs later quietly breaks published revisions.

## Known gaps

Found in review before the migration was applied, accepted rather than fixed now:

- **Reconnecting to a different Shopify store leaves stale rows.** Disconnect keeps the
  old store's merch (by design — "your synced merch stays"). Those rows still hold the
  old store's `handle`s, so if the new store sells a product with the same handle, its
  insert fails the `merch_handle_uniq` index on every pull, permanently, and the product
  silently never appears. Fix when it becomes real: disconnect should offer to clear
  synced rows, or null their handles.
- **A handle swap between two products inside one pull fails one row.** Product A renames
  to `tee-2` and B takes `tee`; if B is processed before A's update, B collides. It is
  reported in `SyncResult.errors` and the next pull succeeds.
- **`SyncResult.errors` is not surfaced anywhere.** `syncShopifyAction` throws away the
  result, so a partial failure looks like a clean pull to the manager. Both gaps above
  are invisible because of this. Worth fixing when the guided-connect walkthrough lands
  (step 7), since that is where a "pulled 12, 1 failed" line belongs.
- **The teardown in `tests/sync.shopify.test.ts` deletes all merch for the seed artists**
  rather than only the rows it created, which AGENTS.md rule 6 forbids. Pre-existing, and
  the blast radius is the `lone-pine` / `gulf-static` fixtures, not real artist data.

## Open questions

- **Multi-currency?** Storefront returns a currency code per variant. Ignorable if every
  artist sells in one currency; has to be in the payload from day one if not.
- **Can a manager override a Shopify price?** Assumed no — Shopify wins, the editorial
  lane never touches price. It's the only thing that would put price back in the snapshot.
- **Pre-order gate: metafield or Lone Star field?** Reading it from a Shopify metafield
  keeps one source of truth but makes the artist's team responsible for setting it. A
  Lone Star field is easier to control but drifts from the store.
