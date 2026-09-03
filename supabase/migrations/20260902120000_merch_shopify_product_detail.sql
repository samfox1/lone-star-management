-- Merch product detail (MERCH_PLAN step 1, Sam 2026-09-02: per-product routes at
-- /merch/[handle] with a variant picker and a cart drawer).
--
-- Four columns, all filled by the Shopify sync and all null/empty for a
-- manually-added product, which has no Shopify row behind it:
--
--   handle       Shopify's URL slug ("50-ballerinas-t-shirt"). REQUIRED for the
--                per-product route: we store shopify_product_id, which is a
--                gid://shopify/Product/… and is not URL-shaped.
--   variants     [{id,title,available,price,currency}]. `id` is a ProductVariant
--                gid — the thing a cart line is created from, so the buy flow is
--                blocked without it. jsonb rather than a table ON PURPOSE: a
--                manager never edits a variant, they are never published
--                independently and never joined against. A table would imply an
--                editorial surface that should not exist.
--   description  Plain text, not descriptionHtml — nothing here reaches the site
--                as markup, so it is not an XSS sink.
--   images       Gallery URLs for the product page; image_url stays the single
--                card image the grid uses.
--
-- All four are NULLABLE with no default, and that is deliberate rather than lazy.
-- An `'[]'::jsonb` default would make every merch row published BEFORE this
-- migration read as EDITED in the unpublished-changes diff: `sameSnapshot` compares
-- `a?.[k] ?? null`, so a working row's `[]` would not match an old revision's missing
-- key (JSON.stringify([]) !== JSON.stringify(null)), and every artist with published
-- merch would be told their merch changed when nothing had. Null on both sides
-- matches. Readers coalesce with `?? []`, which they must do regardless — revisions
-- published before today carry none of these keys at all.
--
-- NOT snapshotted here — src/lib/content.ts PUBLISHABLE.merch carries the
-- snapshot list, and the merch branch of get_public_site serves `data` wholesale
-- (the `role`-on-links precedent), so no SQL change is needed for these to reach
-- the site once they are added to that array.
alter table merch add column handle text;
alter table merch add column variants jsonb;
alter table merch add column description text;
alter table merch add column images jsonb;

-- The per-product route resolves an artist's product by handle, so two rows sharing
-- one handle would make a public URL ambiguous. Shopify guarantees handle uniqueness
-- only WITHIN a store, which is enough while an artist has one store. Partial: handle
-- is null for every manual product.
--
-- Known cost, accepted: a collision surfaces as a per-row insert failure in
-- SyncResult.errors rather than a bad URL. Two ways that can happen — a handle swap
-- between two products inside one pull (transient; the next pull sorts it), and an
-- artist reconnecting to a DIFFERENT store while the old store's rows still hold its
-- handles (permanent until the stale rows are cleared). See MERCH_PLAN "Known gaps".
create unique index merch_handle_uniq on merch (artist_id, handle) where handle is not null;
