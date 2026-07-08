-- Tour date coordinates — prep for the manager tour MAP (left = list, right = an
-- interactive Leaflet map of the shows). Bandsintown and Ticketmaster both return
-- the venue's lat/lng, so synced dates get pins for free; manual dates are geocoded
-- later. Dashboard-only: these are NOT added to the public tour_date snapshot, so
-- coordinates never reach the public read path.
alter table public.tour_dates add column if not exists latitude  double precision;
alter table public.tour_dates add column if not exists longitude double precision;
