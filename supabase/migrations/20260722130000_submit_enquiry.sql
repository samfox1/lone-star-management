-- The enquiry submit path: rate limit, resolve recipient, store, and report back.
--
-- READ 20260722120000 FIRST — it explains why the public door for this feature is an
-- Edge Function rather than an anon-granted SECURITY DEFINER function (ADR 0010).
-- Everything here is service_role-only; the ONE exception is
-- booking_recipient_preview, which is granted to `authenticated` and guards ownership
-- internally so the dashboard can show a manager where their enquiries are going.
--
-- ===========================================================================
-- TWO DELIBERATE BREAKS FROM HOUSE STYLE. Both are load-bearing. Please read.
-- ===========================================================================
--
-- 1. submit_enquiry RETURNS A STATUS. IT MUST NEVER `raise`.
--
--    subscribe() and submit_application() both `raise exception` to reject input, and
--    copying that here would silently destroy the rate limiter. This function logs the
--    rejected attempt into contact_attempts and THEN reports it. A `raise` would roll
--    back the whole transaction — INCLUDING that log row — so the limiter would forget
--    every rejection it ever made and an attacker over the cap would get infinite free
--    retries. The Edge Function maps `status` to an HTTP code instead.
--
--    If you are here to "clean this up" into a raise: that is the bug. Don't.
--
-- 2. submit_enquiry IS `security invoker`, NOT `security definer`.
--
--    Every other door in this schema is DEFINER because it is reachable by `anon` and
--    must escalate past RLS. This one is called by service_role, which already bypasses
--    RLS, so DEFINER would buy nothing — and INVOKER makes it FAIL CLOSED if someone
--    later widens the grant by mistake: an anon caller with invoker rights hits
--    `enquiries`, finds no insert policy, and is denied. Defence in depth behind the
--    grant, not instead of it.

-- ---------------------------------------------------------------------------
-- Recipient resolution
-- ---------------------------------------------------------------------------
-- Factored out of submit_enquiry so the dashboard's "your enquiries go to X" readout
-- runs the EXACT same chain the sender does. Two copies of this logic would drift, and
-- the failure mode of drift is telling a manager the wrong address with total
-- confidence.
--
-- WORKING ROWS, NOT PUBLISHED REVISIONS. The consistency argument for reading published
-- data only bites when the value is observable by the visitor, and the recipient never
-- leaves the server — that is the entire point of the feature. What the other choice
-- would cost is real: a manager fixes a dead booking address and enquiries keep going
-- to the old one until they publish, and publishing ships every other half-finished
-- edit as a side effect. That couples the safe action to an unsafe one. Precedent
-- agrees — everything read live rather than published here is operational
-- (artists.slug, artist_managers, integration config, storage paths). Routing config
-- belongs in that set, not with publishable content.
--
-- EVERY RUNG IS VALIDATED AND FALLS THROUGH IF IT DOESN'T LOOK LIKE AN ADDRESS.
-- That matters most at the `links` rung: links.url is a free-text URL field and
-- safeHref happily accepts https there, so a manager who puts a booking *page* URL in
-- the booking link region must fall through to site_content, not have us try to email
-- an https URL.
create or replace function public.resolve_booking_recipient(p_artist_id uuid)
returns table (to_email text, recipient_source text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  cand text;
begin
  -- 1. Ops override on artist_mail_settings.
  select nullif(btrim(ams.booking_email), '') into cand
  from public.artist_mail_settings ams
  where ams.artist_id = p_artist_id;
  if cand ~ email_re then
    return query select cand, 'mail_settings'::text;
    return;
  end if;

  -- 2. The booking link region (links.role = 'booking'), which is how CUSTOM sites
  --    (skeen) carry it — they have no TEMPLATE_FIELDS entry, so this rung sits above
  --    site_content on purpose. Strip a leading `mailto:` and any `?subject=` tail.
  select nullif(btrim(regexp_replace(split_part(l.url, '?', 1), '^\s*mailto:', '', 'i')), '')
    into cand
  from public.links l
  where l.artist_id = p_artist_id and l.role = 'booking';
  if cand ~ email_re then
    return query select cand, 'link'::text;
    return;
  end if;

  -- 3. The editable site-text field (site_content.booking_email), which is how the
  --    BUILT-IN templates carry it.
  select nullif(btrim(sc.value), '') into cand
  from public.site_content sc
  where sc.artist_id = p_artist_id and sc.key = 'booking_email';
  if cand ~ email_re then
    return query select cand, 'site_content'::text;
    return;
  end if;

  -- 4. The configured last resort.
  select nullif(btrim(ms.default_to_email), '') into cand
  from public.mail_settings ms where ms.id;
  if cand ~ email_re then
    return query select cand, 'default'::text;
    return;
  end if;

  -- No rung produced an address. Caller decides what that means.
  return;
end;
$$;

revoke all on function public.resolve_booking_recipient(uuid) from public, anon, authenticated;
grant execute on function public.resolve_booking_recipient(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The ledger writer, for paths that never reach submit_enquiry
-- ---------------------------------------------------------------------------
-- The Edge Function calls this on the honeypot and malformed-body paths so a dropped
-- request still BURNS A RATE-LIMIT SLOT. Without it, probing the endpoint with garbage
-- is free and an attacker can map our validation rules at no cost.
create or replace function public.log_contact_attempt(
  p_slug    text,
  p_purpose text,
  p_ip_hash text,
  p_outcome text
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
  select
    p_slug,
    (select a.id from public.artists a where a.slug = p_slug),
    case when p_purpose in ('booking','demo','other') then p_purpose else 'other' end,
    p_ip_hash,
    p_outcome
  where p_outcome in ('accepted','honeypot','invalid','rate_limited',
                      'unknown_artist','no_recipient','send_failed');
$$;

revoke all on function public.log_contact_attempt(text, text, text, text) from public, anon, authenticated;
grant execute on function public.log_contact_attempt(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The door
-- ---------------------------------------------------------------------------
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
security invoker   -- see the header: fails closed if the grant is ever widened
set search_path = public
as $$
declare
  email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_aid       uuid;
  v_aname     text;
  v_purpose   text;
  v_to        text;
  v_src       text;
  v_from_name text;
  v_from_local  text;
  v_from_domain text;
  v_id        uuid;
  n_hour   int;
  n_day    int;
  n_artist int;
begin
  -- Serialize count-then-insert per IP. Read-committed otherwise lets two concurrent
  -- requests BOTH observe a count under the cap and both insert, so the limit leaks
  -- under exactly the concurrency an attacker would use. subscribe() has this same
  -- race; this is the improved version. Transaction-scoped, so it releases on commit.
  perform pg_advisory_xact_lock(hashtext(coalesce(p_ip_hash, '')));

  -- An unrecognized purpose is COERCED, never rejected, so a future site change that
  -- adds a purpose value doesn't hard-fail live submissions before we deploy for it.
  v_purpose := case when p_purpose in ('booking','demo','other') then p_purpose else 'other' end;

  select a.id, a.name into v_aid, v_aname
  from public.artists a where a.slug = p_slug;

  if v_aid is null then
    insert into public.contact_attempts (slug, purpose, ip_hash, outcome)
    values (p_slug, v_purpose, p_ip_hash, 'unknown_artist');
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

  -- Per-IP window: 5/hour, 20/day, counted over EVERY outcome.
  select count(*) filter (where ca.created_at > now() - interval '1 hour'),
         count(*) filter (where ca.created_at > now() - interval '1 day')
    into n_hour, n_day
  from public.contact_attempts ca
  where ca.ip_hash = p_ip_hash and ca.created_at > now() - interval '1 day';

  -- Per-artist second line, mirroring subscribe()'s 15/min and record_event()'s
  -- 120/min: caps how fast one artist's inbox can be flooded from a botnet of
  -- distinct IPs, where the per-IP limit alone would never trigger.
  select count(*) into n_artist
  from public.enquiries e
  where e.artist_id = v_aid and e.created_at > now() - interval '1 hour';

  if n_hour >= 5 or n_day >= 20 or n_artist >= 30 then
    -- Log, then RETURN. Never raise — see the header. The raise would roll back this
    -- very insert and the limiter would forget the rejection.
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  select r.to_email, r.recipient_source into v_to, v_src
  from public.resolve_booking_recipient(v_aid) r;

  -- Sender identity: per-artist override, else the shared verified domain.
  select coalesce(nullif(btrim(ams.from_name), ''), v_aname || ' Site'),
         coalesce(nullif(btrim(ams.from_local_part), ''), ms.from_local_part),
         coalesce(nullif(btrim(ams.sending_domain), ''), ms.sending_domain)
    into v_from_name, v_from_local, v_from_domain
  from public.mail_settings ms
  left join public.artist_mail_settings ams on ams.artist_id = v_aid
  where ms.id;

  -- If we have no recipient OR no verified sender, the enquiry is unroutable. Both
  -- collapse to 'no_recipient': from the caller's side they are the same failure —
  -- we cannot deliver this — and the Edge Function reports send_failed either way.
  -- The distinction that matters for ops is visible in mail_settings being unseeded.
  if v_to is null or v_from_domain is null or v_from_local is null then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'no_recipient');
    return query select 'no_recipient'::text, null::uuid, null::text,
                        null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Store BEFORE sending. If Resend is down the enquiry is still in the dashboard,
  -- which is the whole justification for keeping this table.
  insert into public.enquiries (artist_id, purpose, name, email, message, to_email, recipient_source)
  values (v_aid, v_purpose,
          left(btrim(p_name), 200),
          left(btrim(p_email), 320),
          left(btrim(p_message), 5000),
          v_to, v_src)
  returning id into v_id;

  insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
  values (p_slug, v_aid, v_purpose, p_ip_hash, 'accepted');

  -- contact_attempts grows forever and there is no pg_cron in this project, so prune
  -- opportunistically: ~1 call in 100 pays for a 30-day sweep. Ugly, but it is
  -- self-maintaining and needs no new infrastructure to forget to set up.
  if random() < 0.01 then
    delete from public.contact_attempts where created_at < now() - interval '30 days';
  end if;

  -- from_name is stripped of CR/LF a second time here. The storage CHECK already
  -- rejects it, but this value goes straight into an SMTP header and belt-and-braces
  -- on header injection is cheap.
  return query select 'ok'::text, v_id, v_to,
                      translate(v_from_name, E'\r\n', '  '),
                      v_from_local || '@' || v_from_domain,
                      v_aname, v_src;
end;
$$;

revoke all on function public.submit_enquiry(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Delivery outcome
-- ---------------------------------------------------------------------------
create or replace function public.mark_enquiry_sent(
  p_id          uuid,
  p_ok          boolean,
  p_provider_id text default null,
  p_error       text default null
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.enquiries
     set status              = case when p_ok then 'sent' else 'failed' end,
         sent_at             = case when p_ok then now() else sent_at end,
         provider_message_id = coalesce(p_provider_id, provider_message_id),
         send_error          = case when p_ok then null else left(p_error, 2000) end
   where id = p_id;
$$;

revoke all on function public.mark_enquiry_sent(uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_enquiry_sent(uuid, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Dashboard readout
-- ---------------------------------------------------------------------------
-- The ONLY path by which a resolved booking address reaches a client — and only a
-- client that already owns the artist. SECURITY DEFINER (it must read
-- artist_mail_settings and mail_settings, which managers cannot fully see) with the
-- ownership check INSIDE the body rather than relying on the caller to have done it.
create or replace function public.booking_recipient_preview(p_artist_id uuid)
returns table (to_email text, recipient_source text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    return;  -- not yours: no rows, no error, nothing to probe
  end if;
  return query select r.to_email, r.recipient_source
               from public.resolve_booking_recipient(p_artist_id) r;
end;
$$;

revoke all on function public.booking_recipient_preview(uuid) from public, anon;
grant execute on function public.booking_recipient_preview(uuid) to authenticated;
