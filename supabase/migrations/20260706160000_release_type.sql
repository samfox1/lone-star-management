-- Release classification: album / single / EP / featured. Lets managers (and the
-- public smart-link) label a release and lets the dashboard filter the catalog by
-- type. Defaults to 'single' so existing rows get a sane value; re-classify in the
-- editor. Additive; published via the release snapshot (see PUBLISHABLE.release).

alter table public.releases
  add column if not exists release_type text not null default 'single';

alter table public.releases
  drop constraint if exists releases_release_type_check;
alter table public.releases
  add constraint releases_release_type_check
  check (release_type in ('album', 'single', 'ep', 'featured'));
