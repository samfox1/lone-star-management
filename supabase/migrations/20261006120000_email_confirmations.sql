-- An address receives enquiries only once its owner has proved it is theirs (2026-10-05).
--
-- Sam, 2026-09-30: "there should be a confirmation email sent with a code for us to make sure
-- the email is legit" … "this should be required before deploying". Plan of record:
-- EMAIL_CONFIRM_PLAN.md (piece 1). Mock approved 2026-10-05: prototypes/email_confirm_20261005.html.
--
-- WHY. A manager types an address onto a kind's list and Tapir starts mailing strangers'
-- enquiries to it from OUR shared sending domain. A typo hands someone else a promoter's name,
-- email and message; a hostile manager can point the public contact form at anyone. And a
-- recipient who never asked for the mail marks it spam, which lands on the domain every artist
-- sends from. Six digits sent to the address, typed back by the manager, prove a human there
-- wanted it.
--
-- THE ONE CHOKE POINT is `resolve_enquiry_recipients`: every enquiry email's To: comes from it
-- (submit_enquiry is its only caller). It now returns only addresses that are CONFIRMED for that
-- artist, or still inside their legacy grace. A missing confirmation row means NOT confirmed:
-- default deny, so an address added by any writer (the dashboard, service_role, an import)
-- receives nothing until someone with its inbox says yes. submit_enquiry is not redefined: an
-- artist whose every address is unconfirmed resolves nobody and the enquiry is stored
-- `unroutable`, the rule since 20260928141000.
--
-- LEGACY GRACE, 14 DAYS. The addresses already on a list when this ships (Ross, skeen@) keep
-- receiving for 14 days while unconfirmed, then stop. Sam: "Lets try the confirmation email for
-- Ross and Skeen"; the grace is so the switch-over never silently drops a real booking while
-- they get round to it. Seeded at the bottom of this file, in the same transaction as the new
-- resolver, so there is no moment when they route nowhere.
--
-- ONE CONFIRMATION PER (artist, lower(email)), not per list: skeen@ on three lists confirms
-- once. Per ARTIST, not global: proving an inbox wanted Skeen's enquiries says nothing about
-- another artist's. The row outlives the address leaving every list, so taking someone off and
-- putting them back does not ask them again.
--
-- THE TABLE IS SERVICE-ONLY: RLS on, no policy, every privilege revoked from anon and
-- authenticated. Everything goes through the functions below, which never hand back a hash:
--
--   email_confirmation_status(artist)   manager-facing  each listed address: confirmed or waiting
--   begin_email_confirmation(user, artist, email)
--                                       SERVICE-ONLY    the email-confirm Edge Function's call:
--                                                       checks the user, the list and the caps,
--                                                       then mints a code and a link token
--   confirm_email_code(artist, email, code)
--                                       manager-facing  the six digits typed in the window
--   confirm_email_token(token)          SERVICE-ONLY    the email's Confirm button (POST only:
--                                                       link scanners that pre-open URLs GET)
--
-- STORED: only SHA-256 hashes of the code and the token. The token's hash is what makes a
-- leaked table useless for its 7 days (32 random bytes cannot be guessed back). A 6-digit
-- code's hash CAN be guessed back by anyone holding the table, in milliseconds; what keeps the
-- code safe is that nobody but the service role can read the table, it dies in 15 minutes, and
-- the wrong-try limits below kill it. Hashed anyway, so no plaintext secret ever sits in a row
-- or a backup.
--
-- THE LIMITS, AND THE MANAGER THEY ARE FOR (review, 2026-10-05). The person typing the code is
-- the one who might be lying: a manager who wants enquiries sent to an address whose owner never
-- agreed. Hourly limits alone were not enough. Every send resets the 5-try count, so sending and
-- guessing around the clock gave ~100 guesses an hour per artist (about 7% a month to "confirm"
-- a stranger), and ~480 Tapir-branded emails a day into that stranger's inbox. So:
--
--   per code             5 wrong tries, then dead (a new send makes a new code)
--   per address, 24 h    10 wrong tries, whatever was resent in between; then every code is
--                        refused until the oldest try is a day old. 300 guesses a month at
--                        1 in 1,000,000 each: about 0.03%
--   per address          not within 60 s; at most 5 sends an hour and 10 a day
--   per artist           at most 20 sends an hour
--   whole platform       at most 200 sends an hour, so no number of artists or managers can
--                        turn this into a mailing list from our shared domain
--
-- The link is not limited by wrong tries: 32 random bytes cannot be guessed, and clicking it
-- proves the inbox, which is the point.
--
-- REFUSALS ARE STATUS WORDS, NOT ERRORS, in every function a stranger's input reaches. A wrong
-- code must COUNT, and an exception would roll the counter back with it: five wrong guesses
-- would cost nothing, forever. The two manager-facing functions do raise 42501 for a caller who
-- does not manage the artist, because that is a door, not an outcome.
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────────┐
-- │ AT PUSH TIME, IN THIS ORDER (each needs Sam's yes)                                       │
-- │ 1. Full suite green. `supabase db push --dry-run` lists ONLY this file. Then push        │
-- │    (the installed CLI, never npx).                                                       │
-- │ 2. `npm run audit:grants`: none of the four functions may be in the list.                │
-- │ 3. Flip EMAIL_CONFIRMATIONS_PUSHED in tests/helpers/email-confirmations.ts, then run     │
-- │    tests/integration/enquiries/ (this feature's file, and the routing files that now     │
-- │    confirm the addresses they add).                                                      │
-- │ 4. Deploy the email-confirm Edge Function SOON: from the push on, a NEW address receives │
-- │    nothing until confirmed, and only that function can send the code.                    │
-- │ 5. Send Ross and skeen@ their one email. Their grace ends 14 days after the push.        │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘
--
-- Pinned by tests/integration/enquiries/email-confirmations.test.ts. Every function was run by
-- hand against a throwaway local Postgres 18 (stubbed auth, artists, lists) on 2026-10-05.

-- pgcrypto lives in `extensions` on Supabase. A no-op there; it makes the file say what it needs.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.artist_email_confirmations (
  artist_id        uuid not null references public.artists (id) on delete cascade,
  -- Always lower case: the lists are unique per kind on lower(email), and this row must be the
  -- ONE answer for every spelling of the address on every list.
  email            text not null check (email = lower(email)),
  confirmed_at     timestamptz,
  -- Legacy addresses only (seeded below): unconfirmed but still routed until this moment.
  grace_until      timestamptz,
  code_hash        text,
  code_expires_at  timestamptz,
  code_attempts    int not null default 0 check (code_attempts >= 0),
  token_hash       text unique,
  token_expires_at timestamptz,
  -- Send times inside the last 24 h, for the caps. Pruned on every send, so it never grows past
  -- the daily cap.
  sent_at          timestamptz[] not null default '{}',
  -- Wrong-code times inside the last 24 h: the daily budget a resend does NOT reset (code_attempts
  -- is per code and does). Pruned on every wrong try, so it never grows past the budget.
  wrong_at         timestamptz[] not null default '{}',
  created_at       timestamptz not null default now(),
  primary key (artist_id, email)
);

comment on table public.artist_email_confirmations is
  'Which addresses have proved they want an artist''s enquiries. resolve_enquiry_recipients routes only to confirmed (or legacy-grace) rows. Hashes only, never a code or token. Service role only; managers go through email_confirmation_status / confirm_email_code.';

alter table public.artist_email_confirmations enable row level security;
revoke all on table public.artist_email_confirmations from public, anon, authenticated;
grant select, insert, update, delete on table public.artist_email_confirmations to service_role;

-- ---------------------------------------------------------------------------
-- 2. What a manager may see
-- ---------------------------------------------------------------------------
-- Every address on the artist's lists, once each, lower case. `waiting` is simply "not
-- confirmed", legacy-grace addresses included: they show blue with the key until confirmed,
-- whether or not they are still receiving. An address with no row at all is waiting too.
create or replace function public.email_confirmation_status(p_artist_id uuid)
returns table (email text, confirmed boolean, waiting boolean)
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
           c.confirmed_at is null
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

-- ---------------------------------------------------------------------------
-- 3. Send a code (the Edge Function's call)
-- ---------------------------------------------------------------------------
-- The Edge Function verifies the manager's JWT, then calls this with the SERVICE key and the
-- user id it verified, so WHO is checked here on rows (artist_managers, auth.users), not on a
-- JWT, the same as seo_test_runs. Statuses, in the order they are decided:
--
--   not_allowed  p_user_id does not manage the artist and is not an admin
--   not_listed   the address is on none of the artist's lists. Tapir mails only addresses a
--                manager put on a list, so this function cannot be used to mail anyone else
--   confirmed    already confirmed: nothing generated, nothing sent
--   too_many     this address: 5 sends in the last hour or 10 in the last 24 h; this artist:
--                20 in the last hour; the whole platform: 200 in the last hour
--   too_soon     the last send to this address was under 60 s ago
--   sent         a new code AND a new link token, returned in PLAINTEXT. This is the only
--                moment either exists; only their hashes are kept. A new send replaces both,
--                so only the latest email works, and resets the wrong-try count.
--
-- too_many before too_soon: when both are true, "wait a minute" would be a lie.
-- `kinds` is the LABELS of the kinds whose lists hold the address, for the email's sentence;
-- `site_host` the artist's custom site as a bare host, null without one.
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
     set code_hash        = encode(extensions.digest(v_code, 'sha256'), 'hex'),
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

-- ---------------------------------------------------------------------------
-- 4. The six digits
-- ---------------------------------------------------------------------------
-- The ROW LOCK is the wrong-try counter's whole guarantee. Without it, five guesses fired at
-- once all read "0 tries so far" and all get a verdict, and the limit is however many requests
-- fit in one round trip. With it they queue, and the sixth sees five.
--
--   locked     10 wrong tries for this address in the last 24 h, across every code sent. A new
--              send does not help: every code is refused until the oldest of the ten is a day
--              old. Checked before expiry, so nobody is told to resend when that cannot work
--   expired    no live code: never sent, past its 15 minutes, or already used
--   locked     5 wrong tries on THIS code: dead until a new send
--   wrong      counted, on the code and in the day (the answer that spends either budget says
--              `locked` instead)
-- Both lockouts are checked before the code, so the right code after them still fails.
--   confirmed  confirmed now, or already was. The code and the link both stop working.
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
    return 'locked';
  end if;
  if v_row.code_hash is null or v_row.code_expires_at is null or v_row.code_expires_at <= now() then
    return 'expired';
  end if;
  if v_row.code_attempts >= 5 then
    return 'locked';
  end if;

  -- Spaces dropped: the email prints the code as "482 913", and a paste keeps the gap.
  if encode(extensions.digest(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'), 'sha256'), 'hex')
     is distinct from v_row.code_hash then
    update public.artist_email_confirmations c
       set code_attempts = v_row.code_attempts + 1,
           wrong_at      = v_day || now()
     where c.artist_id = p_artist_id and c.email = v_email;
    return case when v_row.code_attempts + 1 >= 5 or cardinality(v_day) + 1 >= 10
                then 'locked' else 'wrong' end;
  end if;

  update public.artist_email_confirmations c
     set confirmed_at     = now(),
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

-- ---------------------------------------------------------------------------
-- 5. The link
-- ---------------------------------------------------------------------------
-- Single use: confirming clears the token's hash, so a second POST finds nothing. Unknown,
-- expired and used all answer 'invalid', with nothing else: the page says "This link has
-- expired" and must not reveal which address or artist a dead token belonged to. A locked CODE
-- does not kill the link: clicking it proves the inbox just as well.
--
-- The row is found by its token hash FOR UPDATE, so two clicks at once queue, and the second
-- re-reads a row whose token is gone.
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

-- ---------------------------------------------------------------------------
-- 6. Routing: confirmed, or still in grace
-- ---------------------------------------------------------------------------
-- Same signature and return table as 20261002210000, so submit_enquiry's call is unchanged.
-- The filter is INSIDE the numbering: the primary (`rn = 1`) is the first CONFIRMED address,
-- so a kind whose earliest-added address is still waiting is not left without a primary (and
-- stored `unroutable`) while a confirmed one sits behind it.
create or replace function public.resolve_enquiry_recipients(p_artist_id uuid, p_purpose text)
returns table (to_email text, recipient_source text, is_primary boolean, ordinal int)
language sql
security definer
set search_path = public
stable
as $$
  select l.email, 'recipient_list'::text, l.rn = 1, l.rn
  from (
    select er.email,
           row_number() over (order by er.created_at, er.id)::int as rn
    from public.enquiry_recipients er
    join public.enquiry_kinds k on k.id = er.kind_id
    join public.artist_email_confirmations c
      on c.artist_id = er.artist_id and c.email = lower(er.email)
    where er.artist_id = p_artist_id
      and k.slug = p_purpose
      and (c.confirmed_at is not null or c.grace_until > now())
  ) l;
$$;

-- Service-only (AGENTS.md: revoke from public, anon AND authenticated, by role).
revoke all on function public.resolve_enquiry_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_enquiry_recipients(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The legacy grace
-- ---------------------------------------------------------------------------
-- Every address already on a list, once per artist, receiving for 14 more days. Re-runnable:
-- an address that already has a row (confirmed or not) is left exactly as it is.
insert into public.artist_email_confirmations (artist_id, email, grace_until)
select distinct er.artist_id, lower(er.email), now() + interval '14 days'
  from public.enquiry_recipients er
on conflict (artist_id, email) do nothing;
