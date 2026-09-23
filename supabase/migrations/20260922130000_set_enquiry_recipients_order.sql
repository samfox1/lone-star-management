-- The saved order of a recipient list must be the order it was saved in (2026-09-22).
--
-- Found by running the enquiries integration folder on its own, minutes after the
-- hardening push: "replaces the list, and returns it as stored" came back in the wrong
-- order once and the right order the next time. `set_enquiry_recipients` inserts every row
-- inside ONE function call, and Postgres's `now()` is frozen for the whole transaction — so
-- every row in a saved list carries the SAME `created_at`, and the resolver's `order by
-- created_at, id` falls through to `id`, a random uuid. The To: header, the dashboard chips
-- and the manager's arranged order would all disagree at random.
--
-- `clock_timestamp()` advances inside a transaction, and the loop index is added on top in
-- microseconds so two iterations can never tie even on a fast clock. `created_at` stays the
-- one ordering key every reader already uses (resolver, page, toKindRows), which is the
-- reason for an offset rather than a new `position` column.
create or replace function public.set_enquiry_recipients(
  p_artist_id  uuid,
  p_kind_id    uuid,
  p_recipients jsonb
)
returns table (id uuid, email text, label text, created_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_email text;
  v_label text;
  v_i int := 0;
  v_base timestamptz := clock_timestamp();
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.enquiry_kinds k
                  where k.id = p_kind_id and k.artist_id = p_artist_id) then
    raise exception 'that enquiry kind is not this artist''s' using errcode = 'insufficient_privilege';
  end if;
  if p_recipients is null or jsonb_typeof(p_recipients) <> 'array' then
    raise exception 'recipients must be a list' using errcode = 'invalid_parameter_value';
  end if;

  delete from public.enquiry_recipients er where er.kind_id = p_kind_id;

  for r in select * from jsonb_array_elements(p_recipients) loop
    v_email := nullif(btrim(coalesce(r->>'email', '')), '');
    v_label := nullif(btrim(coalesce(r->>'label', '')), '');
    if v_email is null then continue; end if;
    insert into public.enquiry_recipients (artist_id, kind_id, email, label, created_at)
    values (p_artist_id, p_kind_id, v_email, v_label, v_base + (v_i * interval '1 microsecond'));
    v_i := v_i + 1;
  end loop;

  return query
    select er.id, er.email, er.label, er.created_at
      from public.enquiry_recipients er
     where er.kind_id = p_kind_id
     order by er.created_at, er.id;
end;
$$;
-- Same signature: grants from 20260922120000 survive the replace.
