-- Artist FACTS for the JSON-LD fact sheet (SEO_GEO_PLAN, Sam 2026-08-26): genre and
-- location are facts about the artist (like the bio), so they live on `artists` and
-- publish with the profile via ARTIST_SNAPSHOT — the EPK and the copilot read the same
-- columns. `schema_type` picks the root @type: MusicGroup (musicians, the default) or
-- Person (visual artists). get_public_site passes the artist blob through, so no door
-- change is needed.
alter table artists add column if not exists genre text;
alter table artists add column if not exists location text;
alter table artists add column if not exists schema_type text not null default 'MusicGroup'
  check (schema_type in ('MusicGroup', 'Person'));
