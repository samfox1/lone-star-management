-- Pre-order facts (MERCH_PLAN, Sam 2026-09-03: "is there any more details we should add
-- on these per product pages").
--
-- Shopify has no column for either, so both are custom METAFIELDS the artist's team
-- fills in (namespace `custom` — the keys live in src/lib/merch/shopify.ts METAFIELDS).
-- A metafield must be PUBLISHED to the Storefront API or it is simply absent from the
-- response with no error, which makes this an onboarding step, not just a schema change.
--
--   shipping_estimate  When a pre-order actually ships, in the team's own words
--                      ("october 2026"). Free text on purpose: "when the vinyl is
--                      pressed" is a more honest answer than a date nobody can commit to,
--                      and a date column would force a lie.
--   preorder_note      The sentence a buyer must acknowledge before ordering. NON-NULL
--                      MEANS PRE-ORDER — it is the flag and the text at once, so the two
--                      can never disagree the way a separate boolean and note could.
--
-- Nullable, no default, for the reason 20260902120000 spells out: a default would make
-- every merch row published before today read as EDITED in the unpublished-changes diff.
alter table merch add column shipping_estimate text;
alter table merch add column preorder_note text;
