-- Bind a link to a manifest link-region (USB / Merch button) by KEY — Phase 2.
--
-- A link row's `role` is the link-region key it powers ("usb", "merch"). skeen's
-- mapConfig binds a link to its element by `role` AUTHORITATIVELY, falling back to the
-- old label mapping when role is null — so ordinary social links (role null) keep
-- working untouched. The editor's new "Site links" panel writes this column
-- (saveEditorLink), and page.tsx routes roled rows out of the Socials list into it.
--
-- NOT wired into get_public_site: its `links` branch returns each link revision's `data`
-- WHOLESALE (unlike the media branch, which cherry-picks columns), so `role` reaches
-- skeen the moment it is listed in PUBLISHABLE.link.snapshot — no function change needed
-- here. Verified against the current definition (20260720120000).
--
-- The partial unique index keeps at most one link per (artist, role); social links
-- (role null) stay unconstrained. saveEditorLink does a read-modify-write rather than an
-- upsert, because PostgREST's on_conflict cannot target a partial index.
alter table public.links add column if not exists role text;

create unique index if not exists links_artist_role_uniq
  on public.links (artist_id, role)
  where role is not null;
