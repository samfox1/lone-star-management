-- Visibility parity for tracks + links — the same live "show on the site" toggle
-- that releases / videos / merch / tour_dates already carry
-- (20260706180000_release_visibility, 20260707120000_content_visibility).
--
-- Additive and NON-BREAKING: default true so everything already published stays
-- live, and unlike the video/merch/tour_date rollout we do NOT (yet) insert new
-- rows false or gate get_public_site on these columns — inserts and the public
-- door are unchanged, so current behavior is identical. This prepares the schema
-- ahead of the feature that consumes it (the pattern 20260707140000_tour_coords
-- used for the tour map), specifically:
--   * tracks: the Music restructure (tracks -> "music", split into released /
--     unreleased) will curate per-item visibility, especially for unreleased,
--     uploaded music that doesn't belong to a release.
--   * links: per-link on/off curation.
-- When that lands, add each to VISIBLE_ENTITIES + reconcileVisibility and gate the
-- matching get_public_site branch on the flag (mirror the merch/video join).
alter table public.tracks add column if not exists visible boolean not null default true;
alter table public.links  add column if not exists visible boolean not null default true;
