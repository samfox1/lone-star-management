-- Restore the length + name validation 20260804230000 dropped by accident.
--
-- My rewrite of submit_enquiry kept the presence and email-format checks but lost
-- `char_length(p_message) > 5000` and the btrim/coalesce handling. The consequence was
-- exactly what that function's own header warns about in capitals: an over-long message
-- reached the INSERT, violated `enquiries_message_len`, and RAISED — which rolls back the
-- whole transaction INCLUDING the contact_attempts row, so the rate limiter forgets every
-- rejection and an attacker over the cap gets infinite free retries.
--
-- Caught by tests/enquiry-door.test.ts, which existed precisely because that failure is
-- silent from the outside: the caller sees a 500 either way.
--
-- Validation is now BYTE-FOR-BYTE the original block, ahead of the rate-limit counting, so
-- the only behavioural change from 20260804230000 remains the one that was intended:
-- an unroutable enquiry is stored rather than discarded.
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

  -- Re-validate server-side. The Edge Function validates too (so it can return a
  -- specific 400 fast), but this function must be correct on its own — it is the last
  -- thing standing between the request and the table.
  if btrim(coalesce(p_name, '')) = ''
     or btrim(coalesce(p_email, '')) !~ email_re
     or btrim(coalesce(p_message, '')) = ''
     or char_length(p_message) > 5000 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'invalid');
    return query select 'invalid'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

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
    values (v_aid, v_purpose, btrim(p_name), btrim(p_email), btrim(p_message),
            v_to, v_source, 'unroutable')
    returning id into v_id;

    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'no_recipient');

    return query select 'no_recipient'::text, v_id, null::text,
                        null::text, null::text, v_aname, null::text;
    return;
  end if;

  insert into public.enquiries (artist_id, purpose, name, email, message,
                                to_email, recipient_source, status)
  values (v_aid, v_purpose, btrim(p_name), btrim(p_email), btrim(p_message),
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
