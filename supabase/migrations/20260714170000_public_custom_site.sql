-- FIX: the custom-site public redirect never fired for actual visitors.
--
-- `/[slug]` (the PUBLIC route) resolves an artist's custom site to decide whether
-- to redirect instead of rendering a built-in template. It did that by reading
-- `artists` directly with the anon client — but `artists_select` RLS is
-- `is_admin() OR is_manager_of(id)`, so a visitor gets ZERO rows. The lookup
-- returned null for everyone who wasn't a signed-in manager of that artist, and
-- the redirect silently did nothing. Its tests passed because they used a fake
-- client that always returned the row, so RLS was never in the picture.
--
-- A door, not a policy: a blanket anon SELECT on `artists` would expose the whole
-- row (shopify_domain, bandsintown_name, every integration id) since RLS is
-- row-level, not column-level. This SECURITY DEFINER function returns exactly one
-- value — the redirect target — and only when the artist really is a custom site.
-- That URL is inherently public: it's where we send visitors.
--
-- Deliberately NOT part of get_public_site: `site_kind` / `custom_site_url` are
-- config, not published content (they're not in ARTIST_SNAPSHOT), and this has to
-- answer BEFORE and independently of whether a site has ever been published.
create or replace function public.public_custom_site(p_slug text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select a.custom_site_url
  from public.artists a
  where a.slug = p_slug
    and a.site_kind = 'custom'
    and nullif(btrim(a.custom_site_url), '') is not null
$$;

revoke all on function public.public_custom_site(text) from public;
grant execute on function public.public_custom_site(text) to anon, authenticated;
