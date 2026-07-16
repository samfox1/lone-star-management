-- US state on a tour date, entered as a two-letter code (TX, CA, NY…) from a
-- dropdown. For a US-touring artist "Austin, TX" is the natural show listing; the
-- pre-existing `country` column stays for the rare out-of-country date.
--
-- The CHECK is a safety net behind the dropdown: two uppercase letters, or null. It
-- does NOT verify the code is a real state — the form's list is the source of valid
-- codes; this just keeps junk (a full name, lowercase, three letters) out of the
-- public snapshot. Reaches the site by joining PUBLISHABLE.tour_date.snapshot.
alter table public.tour_dates
  add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$');
