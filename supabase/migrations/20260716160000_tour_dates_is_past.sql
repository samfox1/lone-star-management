-- An explicit "this was an old show" flag on a tour date. Skeen is backfilling years
-- of past shows, many with no date on record, and a manager wants to mark them as
-- past directly rather than leaning on date math.
--
-- Classification on the public site becomes: a show is PAST if is_past is true OR its
-- date has already passed; otherwise upcoming. So this flag is how a DATELESS old show
-- lands in "Past Highlights" — with no date there's nothing to compare, and the toggle
-- decides. Rides PUBLISHABLE.tour_date.snapshot to the door.
alter table public.tour_dates add column if not exists is_past boolean not null default false;
