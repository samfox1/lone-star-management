-- The status says when a code that can still be typed went out (Sam, 2026-10-05).
--
-- Sam: clicking a blue address should send its code "and then the modal opens after", instead
-- of opening the window and waiting for the resend arrow. But a click must NOT send while an
-- earlier code is still live: a new send replaces the code (and the link), so the one Ross is
-- reading out over the phone would stop working mid-sentence. The dashboard can only tell
-- after a reload if the database says so: `live_code_sent_at` is the time of the last send
-- while that code still lives (unexpired, unconfirmed), and null otherwise. It is a time, not
-- a code: nothing here says what the code is.
--
-- A changed return type cannot be `create or replace`d, so the function is dropped and made
-- again, and its grants with it (manager-facing: AGENTS.md, by role).
--
-- Pinned by tests/integration/enquiries/email-confirmations.test.ts, "the live code, in the
-- status" (seen RED before this file).

drop function if exists public.email_confirmation_status(uuid);

create function public.email_confirmation_status(p_artist_id uuid)
returns table (email text, confirmed boolean, waiting boolean, live_code_sent_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not ((auth.jwt() ->> 'role') = 'service_role'
          or public.is_admin()
          or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
    select l.email,
           c.confirmed_at is not null,
           c.confirmed_at is null,
           case
             when c.confirmed_at is null and c.code_hash is not null and c.code_expires_at > now()
               then (select max(t) from unnest(c.sent_at) t)
           end
    from (select distinct lower(er.email) as email
            from public.enquiry_recipients er
           where er.artist_id = p_artist_id) l
    left join public.artist_email_confirmations c
      on c.artist_id = p_artist_id and c.email = l.email
    order by l.email;
end;
$$;

revoke all on function public.email_confirmation_status(uuid) from public, anon;
grant execute on function public.email_confirmation_status(uuid) to authenticated, service_role;
