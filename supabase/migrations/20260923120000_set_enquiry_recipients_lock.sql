-- Two saves of one kind's list at once must end as ONE of the two lists (2026-09-23).
--
-- Found by review. The only per-kind lock was the cap trigger's, which runs on INSERT, i.e.
-- AFTER the DELETE. Save B's DELETE started on a snapshot that could not yet see save A's
-- inserts, waited on A's row locks, then found nothing left to delete and kept A's rows. Tab
-- A saving [Y] and tab B saving [X] ended as [Y, X], both removals lost.
--
-- Taking the same lock before the DELETE serialises the whole replace: B waits until A
-- commits, and its DELETE then sees A's rows. The test "two saves at once end as ONE of the
-- two lists" (enquiry-recipients.test.ts) was RED against 20260922130000 (a merged
-- [x7, y7] in 8 rounds) before this was pushed.
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

  -- The per-kind lock, taken BEFORE the delete. Same key as the cap trigger's, and
  -- advisory xact locks are re-entrant, so the trigger re-taking it is free.
  perform pg_advisory_xact_lock(hashtext('enquiry_recipients:' || p_kind_id::text));

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
