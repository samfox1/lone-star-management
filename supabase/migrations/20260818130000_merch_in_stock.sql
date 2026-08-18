-- Merch stock state (Sam, 2026-08-18: the editor's merch item editor gets an
-- "out of stock" toggle). Content-level fact, distinct from `on_site` (presence):
-- a sold-out item stays ON the site, rendered as sold out.
--
-- NOT NULL DEFAULT true: every existing item is in stock until someone says otherwise,
-- and the boolean write path (content-form BOOLEAN_FIELDS) never writes null.
alter table merch add column in_stock boolean not null default true;
