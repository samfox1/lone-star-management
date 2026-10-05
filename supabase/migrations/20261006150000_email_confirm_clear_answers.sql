-- Clearer answers when a code is refused (Sam, 2026-10-05: "Please provide clear error
-- messaging to help me understand why").
--
-- What happened: Ross was sent a code, then a second one, which replaced the first. He read out
-- the FIRST code; it was refused four times as "didn't match", and the right code was typed after
-- its 15 minutes, "expired". Nothing told anyone which email to use. Two answers are added:
--
--   'replaced'      the code from the email BEFORE the newest. Not counted as a wrong try:
--                   knowing it proves the inbox, it only is not current. The dashboard says
--                   "That's the code from an earlier email. Use the newest one."
--   'locked_today'  ten wrong tries in 24 hours on this address (it was 'locked', the same word
--                   as five on one code). A new code cannot help until the day passes, so the
--                   dashboard says so instead of pointing at the resend arrow.
--
-- `prev_code_hash` keeps the hash of the code a send replaced: a hash, like code_hash, and
-- cleared on confirmation. Only the one before the newest is told apart.
--
-- Both functions keep their signatures, so their grants stand; they are restated anyway, by role
-- (AGENTS.md). Pinned by tests/integration/enquiries/email-confirmations.test.ts (the replaced
-- test and the two day-lock tests, seen RED before this file).

alter table public.artist_email_confirmations add column if not exists prev_code_hash text;

comment on column public.artist_email_confirmations.prev_code_hash is
  'SHA-256 of the code the latest send replaced, so confirm_email_code can answer ''replaced'' (the code from the email before the newest). Cleared on confirmation.';

create or replace function public.begin_email_confirmation(
  p_user_id   uuid,
  p_artist_id uuid,
  p_email     text
)
returns table (status text, code text, token text, artist_name text, kinds text[], site_host text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_kinds  text[];
  v_name   text;
  v_host   text;
  v_row    public.artist_email_confirmations;
  v_day    timestamptz[];
  v_hour   int;
  v_artist_sends   int;
  v_platform_sends int;
  v_n      int;
  v_code   text;
  v_token  text;
begin
  if p_user_id is null or not (
       exists (select 1 from public.artist_managers m
                where m.artist_id = p_artist_id and m.user_id = p_user_id)
    or exists (select 1 from auth.users u
                where u.id = p_user_id and u.raw_app_meta_data ->> 'role' = 'admin')
  ) then
    return query select 'not_allowed'::text, null::text, null::text, null::text, null::text[], null::text;
    return;
  end if;

  v_kinds := array(
    select k.label
      from public.enquiry_kinds k
     where k.artist_id = p_artist_id
       and exists (select 1 from public.enquiry_recipients er
                    where er.kind_id = k.id and lower(er.email) = v_email)
     order by k.sort_order, k.label);
  if cardinality(v_kinds) = 0 then
    return query select 'not_listed'::text, null::text, null::text, null::text, null::text[], null::text;
    return;
  end if;

  select a.name,
         case when a.site_kind = 'custom'
              then nullif(substring(lower(btrim(coalesce(a.custom_site_url, '')))
                                    from '^(?:[a-z][a-z0-9+.-]*://)?([^/:?#@[:space:]]+)'), '')
         end
    into v_name, v_host
    from public.artists a
   where a.id = p_artist_id;

  -- ONE SEND AT A TIME, platform-wide. The artist and platform caps count across rows, and two
  -- sends at once would each count 199 and both go. Held to the end of this transaction (a few
  -- milliseconds), only past the who/what checks, and at most 200 times an hour: one global lock
  -- costs nothing here, and it is the only lock that covers both caps.
  perform pg_advisory_xact_lock(hashtext('artist_email_confirmations:send'));

  insert into public.artist_email_confirmations (artist_id, email)
  values (p_artist_id, v_email)
  on conflict (artist_id, email) do nothing;

  select * into v_row
    from public.artist_email_confirmations c
   where c.artist_id = p_artist_id and c.email = v_email
   for update;

  if v_row.confirmed_at is not null then
    return query select 'confirmed'::text, null::text, null::text, v_name, v_kinds, v_host;
    return;
  end if;

  v_day := array(select t from unnest(v_row.sent_at) as s(t)
                  where t > now() - interval '24 hours' order by t);
  select count(*) into v_hour from unnest(v_day) as s(t) where t > now() - interval '1 hour';
  -- Both read every row's send times: a scan, cheap while rows are counted in thousands (one per
  -- listed address). A counter table is the next step if that ever stops being true.
  select count(*) filter (where c.artist_id = p_artist_id),
         count(*)
    into v_artist_sends, v_platform_sends
    from public.artist_email_confirmations c
    cross join lateral unnest(c.sent_at) as s(t)
   where s.t > now() - interval '1 hour';

  if v_hour >= 5 or cardinality(v_day) >= 10 or v_artist_sends >= 20 or v_platform_sends >= 200 then
    return query select 'too_many'::text, null::text, null::text, v_name, v_kinds, v_host;
    return;
  end if;
  if cardinality(v_day) > 0 and v_day[cardinality(v_day)] > now() - interval '60 seconds' then
    return query select 'too_soon'::text, null::text, null::text, v_name, v_kinds, v_host;
    return;
  end if;

  -- Six digits, uniform: 3 random bytes, redrawn above 15,999,999 so `% 1000000` has no bias.
  loop
    v_n := ('x' || encode(extensions.gen_random_bytes(3), 'hex'))::bit(24)::int;
    exit when v_n < 16000000;
  end loop;
  v_code := lpad((v_n % 1000000)::text, 6, '0');
  -- 32 bytes, url-safe base64 without padding: 43 characters that survive a URL path as is.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  update public.artist_email_confirmations c
     set prev_code_hash   = c.code_hash,
         code_hash        = encode(extensions.digest(v_code, 'sha256'), 'hex'),
         code_expires_at  = now() + interval '15 minutes',
         code_attempts    = 0,
         token_hash       = encode(extensions.digest(v_token, 'sha256'), 'hex'),
         token_expires_at = now() + interval '7 days',
         sent_at          = v_day || now()
   where c.artist_id = p_artist_id and c.email = v_email;

  return query select 'sent'::text, v_code, v_token, v_name, v_kinds, v_host;
end;
$$;

revoke all on function public.begin_email_confirmation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.begin_email_confirmation(uuid, uuid, text) to service_role;

create or replace function public.confirm_email_code(p_artist_id uuid, p_email text, p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row   public.artist_email_confirmations;
  v_day   timestamptz[];
  v_hash  text;
begin
  if not ((auth.jwt() ->> 'role') = 'service_role'
          or public.is_admin()
          or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
    from public.artist_email_confirmations c
   where c.artist_id = p_artist_id and c.email = v_email
   for update;

  if not found then
    return 'expired';
  end if;
  if v_row.confirmed_at is not null then
    return 'confirmed';
  end if;
  v_day := array(select t from unnest(v_row.wrong_at) as s(t)
                  where t > now() - interval '24 hours' order by t);
  if cardinality(v_day) >= 10 then
    return 'locked_today';
  end if;
  if v_row.code_hash is null or v_row.code_expires_at is null or v_row.code_expires_at <= now() then
    return 'expired';
  end if;
  if v_row.code_attempts >= 5 then
    return 'locked';
  end if;

  -- Spaces dropped: the email prints the code as "482 913", and a paste keeps the gap.
  v_hash := encode(extensions.digest(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'), 'sha256'), 'hex');

  -- The code from the email before the newest: said so, and not counted. Knowing it proves
  -- the inbox; it is only not the current code.
  if v_hash is distinct from v_row.code_hash and v_hash = v_row.prev_code_hash then
    return 'replaced';
  end if;

  if v_hash is distinct from v_row.code_hash then
    update public.artist_email_confirmations c
       set code_attempts = v_row.code_attempts + 1,
           wrong_at      = v_day || now()
     where c.artist_id = p_artist_id and c.email = v_email;
    -- The day's lock is the longer one, so it is the one named when both land at once.
    return case when cardinality(v_day) + 1 >= 10 then 'locked_today'
                when v_row.code_attempts + 1 >= 5 then 'locked'
                else 'wrong' end;
  end if;

  update public.artist_email_confirmations c
     set confirmed_at     = now(),
         prev_code_hash   = null,
         code_hash        = null,
         code_expires_at  = null,
         code_attempts    = 0,
         token_hash       = null,
         token_expires_at = null
   where c.artist_id = p_artist_id and c.email = v_email;
  return 'confirmed';
end;
$$;

revoke all on function public.confirm_email_code(uuid, text, text) from public, anon;
grant execute on function public.confirm_email_code(uuid, text, text) to authenticated, service_role;

create or replace function public.confirm_email_token(p_token text)
returns table (status text, email text, artist_name text, kinds text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_token text := btrim(coalesce(p_token, ''));
  v_row   public.artist_email_confirmations;
begin
  if v_token = '' or char_length(v_token) > 128 then
    return query select 'invalid'::text, null::text, null::text, null::text[];
    return;
  end if;

  select * into v_row
    from public.artist_email_confirmations c
   where c.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
   for update;

  if not found or v_row.token_expires_at is null or v_row.token_expires_at <= now() then
    return query select 'invalid'::text, null::text, null::text, null::text[];
    return;
  end if;

  update public.artist_email_confirmations c
     set confirmed_at     = coalesce(c.confirmed_at, now()),
         prev_code_hash   = null,
         code_hash        = null,
         code_expires_at  = null,
         code_attempts    = 0,
         token_hash       = null,
         token_expires_at = null
   where c.artist_id = v_row.artist_id and c.email = v_row.email;

  return query
    select 'confirmed'::text,
           v_row.email,
           (select a.name from public.artists a where a.id = v_row.artist_id),
           array(select k.label
                   from public.enquiry_kinds k
                  where k.artist_id = v_row.artist_id
                    and exists (select 1 from public.enquiry_recipients er
                                 where er.kind_id = k.id and lower(er.email) = v_row.email)
                  order by k.sort_order, k.label);
end;
$$;

revoke all on function public.confirm_email_token(text) from public, anon, authenticated;
grant execute on function public.confirm_email_token(text) to service_role;
