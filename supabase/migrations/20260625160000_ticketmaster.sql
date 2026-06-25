-- Phase 4: Ticketmaster as a second tour-date source (alongside Bandsintown).
-- Tour dates can come from multiple sources (unlike the one-source catalog).
alter table public.tour_dates add column ticketmaster_id text;

alter table public.tour_dates drop constraint if exists tour_dates_source_check;
alter table public.tour_dates
  add constraint tour_dates_source_check
  check (source in ('manual', 'spotify', 'bandsintown', 'shopify', 'ticketmaster'));

-- The artist's Ticketmaster attraction id, used to pull their events. Config.
alter table public.artists add column ticketmaster_attraction_id text;
