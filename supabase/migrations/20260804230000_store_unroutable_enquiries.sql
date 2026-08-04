-- Store the enquiry even when it cannot be emailed.
--
-- 20260722130000 says, above its own INSERT: "Store BEFORE sending. If Resend is down the
-- enquiry is still in the dashboard, which is the whole justification for keeping this
-- table." But the no_recipient branch returns BEFORE that insert — so if mail is not
-- configured, the message is discarded entirely. The principle was applied to a send that
-- FAILS and not to one that cannot be ADDRESSED, and those are the same thing from the
-- visitor's side: they typed a message and it vanished.
--
-- It matters immediately: Resend is not being set up yet, and the dashboard table IS the
-- delivery mechanism for now. Under the old behaviour every submission would be thrown
-- away and the table would stay empty forever.
--
-- Changes:
--   1. to_email / recipient_source become NULLABLE — "we never resolved one" is a real
--      state and deserves a real representation, not a sentinel address that looks like
--      somewhere mail went.
--   2. status gains 'unroutable': distinct from 'failed' (we tried and Resend refused)
--      because the fix is different — configure mail, versus investigate a send.
--   3. submit_enquiry stores the row and returns status 'no_recipient' WITH the
--      enquiry_id, so the Edge Function can tell the visitor it arrived.

alter table public.enquiries alter column to_email drop not null;
alter table public.enquiries alter column recipient_source drop not null;

alter table public.enquiries drop constraint if exists enquiries_to_len;
alter table public.enquiries add constraint enquiries_to_len
  check (to_email is null or char_length(to_email) between 3 and 320);

alter table public.enquiries drop constraint if exists enquiries_status_check;
alter table public.enquiries add constraint enquiries_status_check
  check (status in ('queued','sent','failed','unroutable'));

-- Recreate the no_recipient branch so it STORES first. Same signature and return type, so
-- this is a genuine replace — no drop, no re-grant, and the Edge Function's DoorRow is
-- unchanged.
create or replace function public.submit_enquiry(
  p_slug    text,
  p_purpose text,
  p_name    text,
  p_email   text,
  p_message text,
  p_ip_hash text
)
returns table (
  status           text,
  enquiry_id       uuid,
  to_email         text,
  from_name        text,
  from_email       text,
  artist_name      text,
  recipient_source text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_aid       uuid;
  v_aname     text;
  v_purpose   text;
  v_to        text;
  v_source    text;
  v_from_name text;
  v_from_local text;
  v_from_domain text;
  v_id        uuid;
  v_count     int;
begin
  v_purpose := case when p_purpose in ('booking','demo','other') then p_purpose else 'other' end;

  select a.id, a.name into v_aid, v_aname from public.artists a where a.slug = p_slug;
  if v_aid is null then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, null, v_purpose, p_ip_hash, 'unknown_artist');
    return query select 'unknown_artist'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  if p_name is null or btrim(p_name) = '' or p_message is null or btrim(p_message) = ''
     or p_email is null or p_email !~ email_re then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'invalid');
    return query select 'invalid'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Per-IP limits: 5/hour, 20/day. Counted from contact_attempts, which is why every
  -- rejection above logs rather than raising.
  select count(*) into v_count
    from public.contact_attempts
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_count >= 5 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;
  select count(*) into v_count
    from public.contact_attempts
   where ip_hash = p_ip_hash and created_at > now() - interval '1 day';
  if v_count >= 20 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  select r.to_email, r.recipient_source into v_to, v_source
  from public.resolve_booking_recipient(v_aid) r;

  select coalesce(nullif(btrim(ams.from_name), ''), v_aname || ' Site'),
         coalesce(nullif(btrim(ams.from_local_part), ''), ms.from_local_part),
         coalesce(nullif(btrim(ams.sending_domain), ''), ms.sending_domain)
    into v_from_name, v_from_local, v_from_domain
  from public.mail_settings ms
  left join public.artist_mail_settings ams on ams.artist_id = v_aid
  where ms.id;

  -- UNROUTABLE: no recipient, or no verified sender. The message is STILL STORED — it is
  -- the manager's record and, until mail is configured, the only copy that exists.
  if v_to is null or v_from_domain is null or v_from_local is null then
    insert into public.enquiries (artist_id, purpose, name, email, message,
                                  to_email, recipient_source, status)
    values (v_aid, v_purpose, btrim(p_name), p_email, btrim(p_message),
            v_to, v_source, 'unroutable')
    returning id into v_id;

    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'no_recipient');

    -- enquiry_id IS returned now, so the caller knows there is something to point at.
    return query select 'no_recipient'::text, v_id, null::text,
                        null::text, null::text, v_aname, null::text;
    return;
  end if;

  insert into public.enquiries (artist_id, purpose, name, email, message,
                                to_email, recipient_source, status)
  values (v_aid, v_purpose, btrim(p_name), p_email, btrim(p_message),
          v_to, v_source, 'queued')
  returning id into v_id;

  insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
  values (p_slug, v_aid, v_purpose, p_ip_hash, 'accepted');

  return query select 'ok'::text, v_id, v_to,
                      v_from_name, v_from_local || '@' || v_from_domain, v_aname, v_source;
end;
$$;

revoke all on function public.submit_enquiry(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text) to service_role;
