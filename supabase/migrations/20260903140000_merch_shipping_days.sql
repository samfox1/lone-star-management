-- Shipping as a DURATION, not a date (Sam, 2026-09-03: "if its 60 days and today is
-- sep 3, it should show 60 days from now. It updates and stays automated").
--
-- A typed-in date rots. "october 2026" is right for a month and then quietly wrong
-- forever, and nobody goes back to fix it on a product still selling in December. A
-- duration is a fact about the fulfilment, not about the calendar, so it stays true and
-- the site does the arithmetic on every render.
--
-- `shipping_estimate` (20260903120000) STAYS, and the two are not redundant: some waits
-- genuinely cannot be counted ("when the vinyl is pressed"). Days win when both are set,
-- because a computed date is more useful than a phrase.
--
-- Nullable, no default — same reasoning as 20260902120000.
alter table merch add column shipping_days integer;
alter table merch add constraint merch_shipping_days_sane check (shipping_days is null or (shipping_days > 0 and shipping_days <= 3650));
