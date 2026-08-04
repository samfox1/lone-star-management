-- Restore the per-artist flood cap (30 enquiries/hour) that the rewrites lost.
--
-- The original door (20260722130000) had three rate-limit lines: 5/hour per IP,
-- 20/day per IP, and 30/hour per ARTIST — the last one for a botnet of distinct
-- addresses, where the per-IP windows never trigger. The 20260804230000 rewrite
-- dropped the artist cap, and 240000 and 260000 each rebuilt the function from the
-- previous rewrite, carrying the omission forward. Nothing noticed for the same
-- reason the char_length rule DID survive those rewrites: one had a test, one
-- didn't. It has one now (tests/enquiry-door.test.ts), and this file is otherwise
-- byte-identical to 260000.
--
-- Also restores the 20/day check 260000 kept, unchanged. Every rejection is logged
-- and RETURNED, never raised — a raise would roll back the ledger insert and the
-- limiter would forget the rejection (see the door test's regression comment).
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
  -- `message` is no longer required: a demo can be a link and some audio. The rule that
  -- an enquiry must carry SOMETHING lives in the Edge Function (hasContent), because
  -- neither the demo link nor the attachments exist at this point. Length is still capped
  -- here, since that one IS knowable and its violation would raise.
  if btrim(coalesce(p_name, '')) = ''
     or btrim(coalesce(p_email, '')) !~ email_re
     or char_length(coalesce(p_message, '')) > 5000 then
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

  -- Per-artist second line, mirroring subscribe()'s 15/min and record_event()'s
  -- 120/min: caps how fast one artist's inbox can be flooded from a botnet of
  -- distinct IPs, where the per-IP limits above never trigger. Counts stored
  -- enquiries, not attempts — the harm being capped is inbox flooding, and rejected
  -- attempts never reach the inbox.
  select count(*) into v_count
    from public.enquiries
   where artist_id = v_aid and created_at > now() - interval '1 hour';
  if v_count >= 30 then
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
    values (v_aid, v_purpose, btrim(p_name), btrim(p_email), btrim(coalesce(p_message, '')),
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
  values (v_aid, v_purpose, btrim(p_name), btrim(p_email), btrim(coalesce(p_message, '')),
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
