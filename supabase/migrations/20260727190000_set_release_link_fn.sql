-- Atomically set (or clear) one platform's link in a release's `links` jsonb array. Doing
-- the filter-and-append inside a single UPDATE (reading the row's CURRENT links) makes it
-- race-safe: two quick blurs on different platform slots serialize on the row lock instead
-- of the old read-modify-write in JS, which could drop one link. SECURITY INVOKER so the
-- caller's RLS on `releases` still scopes the write to the owner.
create or replace function set_release_link(p_release_id uuid, p_label text, p_url text)
returns void
language sql
security invoker
as $$
  update releases
  set links = (
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    from jsonb_array_elements(links) elem
    where elem->>'label' is distinct from p_label
  ) || case
         when p_url is null or p_url = '' then '[]'::jsonb
         else jsonb_build_array(jsonb_build_object('label', p_label, 'url', p_url))
       end
  where id = p_release_id;
$$;
