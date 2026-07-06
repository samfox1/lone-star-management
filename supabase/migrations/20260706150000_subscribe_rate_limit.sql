-- Add a coarse burst cap to the public `subscribe` door: no more than 15 new
-- signups per artist per minute. This blunts list-flooding through the anon
-- door. It is NOT a substitute for per-IP limiting at the edge (a DB function
-- can't see the client IP), but it caps how fast one artist's list can be
-- stuffed. Duplicate emails are already a no-op (unique index), so a repeated
-- address doesn't count against the window — only distinct new rows do.
create or replace function public.subscribe(p_slug text, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  aid uuid;
  recent int;
begin
  if btrim(coalesce(p_email, '')) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  select id into aid from public.artists where slug = p_slug;
  if aid is null then
    raise exception 'Unknown artist.';
  end if;

  select count(*) into recent
  from public.subscribers
  where artist_id = aid and created_at > now() - interval '1 minute';
  if recent >= 15 then
    raise exception 'Too many signups right now — please try again in a minute.';
  end if;

  insert into public.subscribers (artist_id, email)
  values (aid, left(btrim(p_email), 320))
  on conflict (artist_id, lower(email)) do nothing;
end;
$$;

-- Re-assert grants (create or replace keeps them, but be explicit).
revoke all on function public.subscribe(text, text) from public;
grant execute on function public.subscribe(text, text) to anon, authenticated;
