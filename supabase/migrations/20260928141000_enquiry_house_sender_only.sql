-- The house mail row becomes a SENDER only, and tests stop touching it (2026-09-28).
--
-- TWO CHANGES, ONE FILE, because both rewrite the same three functions.
--
-- 1. NO GLOBAL FALLBACK INBOX (Sam, 2026-09-28): "my email shouldn't be involved here. It
--    should only use tapirwebsites. Otherwise, when the managers log in and put their email
--    it can be theirs." Rung 4 of resolve_booking_recipient — `mail_settings.default_to_email`,
--    which since 2026-09-22 was Sam's own inbox — is REMOVED. An enquiry is now emailed only
--    to addresses the artist's managers set: the booking address (rungs 1–3, unchanged) and
--    the kind's recipient list. With a list but no booking address, the list's first person
--    becomes the primary (source `recipient_list`), so a manager who only filled in
--    Settings → Email still receives mail. With neither, the enquiry is stored
--    `unroutable` and shown in the inbox, and nothing is sent — the status that already
--    meant "stored, not emailed". `default_to_email` becomes nullable and is read by
--    nothing; the orchestrator nulls the live value after this is pushed.
--
-- 2. TESTS NEVER WRITE THE HOUSE ROW. `mail_settings` is live config. Two integration suites
--    overwrote it for their whole run, one test deleted it, and afterAll "restored" it — so
--    while they ran a real enquiry went to `fallback-desk@example.com`, a crashed run left
--    that fake row behind, and two runs at once nested and restored each other's fake value.
--    Watched live on 2026-09-28 19:41–19:48 UTC: fake row, then no row, then another suite's
--    fake row, then no row. A snapshot-and-restore cannot be made safe; a test must simply
--    never write the row. So: `artist_mail_settings.use_house_mail`. True (the default, and
--    every real artist) changes NOTHING. False scopes ONE artist off the house SENDER: it
--    sends only from its own sending_domain + from_local_part, and with those missing its
--    enquiries are stored unroutable — the state tests used to create by deleting the global
--    row. A test sets it on its own THROWAWAY artist; cascade takes it away. It is also a
--    real ops control (an artist on its own verified domain that must never send from the
--    shared one), and writes stay admin-only: `ams_admin_write` covers every column, and
--    set_booking_email writes booking_email alone. A column on one artist's row can only
--    ever change that artist; a test-only parameter on the public door, or an env flag,
--    could change every real enquiry.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
-- Relaxing only. Nothing reads it after this file; it stays so the change is additive.
alter table public.mail_settings alter column default_to_email drop not null;

comment on column public.mail_settings.default_to_email is
  'UNUSED since 2026-09-28. Was rung 4 of resolve_booking_recipient (a global last-resort inbox). Removed: enquiries go only to addresses the artist''s managers set. Keep null.';

alter table public.artist_mail_settings
  add column if not exists use_house_mail boolean not null default true;

comment on column public.artist_mail_settings.use_house_mail is
  'false: this artist never uses the shared mail_settings SENDER. It sends only from its own sending_domain + from_local_part; with those missing, its enquiries are stored unroutable. Default true (every artist uses the house sender).';

-- `recipient_source` records how the PRIMARY was found. It can now be the kind's list (see
-- 1 above). 'default' stays allowed: rows stored before this file carry it, and they are a
-- record, not something to rewrite. The inline CHECK from 20260722120000 has a generated
-- name, so it is found by its DEFINITION — a guessed name in `drop constraint if exists`
-- drops nothing and raises nothing (lesson of 20260921120000).
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where contype = 'c'
       and conrelid = 'public.enquiries'::regclass
       and pg_get_constraintdef(oid) ilike '%recipient_source%'
  loop
    execute format('alter table public.enquiries drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.enquiries add constraint enquiries_recipient_source_check
  check (recipient_source is null
         or recipient_source in ('mail_settings', 'link', 'site_content', 'default', 'recipient_list'));

-- ---------------------------------------------------------------------------
-- The booking address: rungs 1–3, no global last resort
-- ---------------------------------------------------------------------------
-- 20260722130000's body with rung 4 deleted. Same signature, so grants survive; restated
-- anyway so this file alone says who may call it.
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

  -- REMOVED 2026-09-28: rung 4, `mail_settings.default_to_email`. There is no global
  -- last-resort inbox; an artist nobody has given an address resolves nothing here.
  return;
end;
$$;

revoke all on function public.resolve_booking_recipient(uuid) from public, anon, authenticated;
grant execute on function public.resolve_booking_recipient(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Everyone addressed: the booking address, then the kind's list
-- ---------------------------------------------------------------------------
-- 20260921120000's body with ONE change, marked. The list still ADDS to the booking
-- address and never replaces it; lists still never cross kinds. What is new: with no
-- booking address at all, the list's FIRST person (earliest added) is the primary.
-- Before this file that branch was unreachable — rung 4 always produced a primary — and
-- was deliberately left unwritten. Without rung 4 it is the only way a manager who set a
-- list but no booking address receives anything.
create or replace function public.resolve_enquiry_recipients(p_artist_id uuid, p_purpose text)
returns table (to_email text, recipient_source text, is_primary boolean, ordinal int)
language sql
security definer
set search_path = public
stable
as $$
  with booking as (
    select r.to_email, r.recipient_source
    from public.resolve_booking_recipient(p_artist_id) r
    where r.to_email is not null
  ),
  extra as (
    -- `row_number()`, not a bare ORDER BY in this CTE. SQL does not promise that a subquery's
    -- ordering survives into the enclosing UNION, and the caller aggregates these into an
    -- array whose order decides who appears first in the To: header.
    select er.email as to_email,
           row_number() over (order by er.created_at, er.id)::int as rn
    from public.enquiry_recipients er
    join public.enquiry_kinds k on k.id = er.kind_id
    where er.artist_id = p_artist_id
      and k.slug = p_purpose
      and lower(er.email) not in (select lower(b.to_email) from booking b)
  )
  select b.to_email, b.recipient_source, true, 0 from booking b
  union all
  -- CHANGED 2026-09-28: the first list row is the primary when there is no booking address.
  select e.to_email, 'recipient_list'::text, (e.rn = 1 and not exists (select 1 from booking)), e.rn
  from extra e;
$$;

revoke all on function public.resolve_enquiry_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_enquiry_recipients(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The door: the SENDER honours use_house_mail
-- ---------------------------------------------------------------------------
-- Byte-for-byte 20260922120000 except the one sender SELECT, marked CHANGED below. The
-- validation, both per-IP windows, the platform ceiling, the per-artist flood cap, the three
-- advisory locks (ip → platform → artist), the unknown-kind → `other` rule, the ledger prune
-- and the never-raise invariant all stand exactly as that migration left them; every one has
-- a door test in tests/integration/enquiries/enquiry-door.test.ts. The primary is still the
-- one `is_primary` row of resolve_enquiry_recipients — which now never comes from a global
-- inbox, so "no primary" (stored `unroutable`, nothing sent) is the normal state of an
-- artist nobody has given an address. Same signature and return table, so `create or
-- replace` keeps the grants; restated below regardless.
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
  to_emails        text[],
  from_name        text,
  from_email       text,
  artist_name      text,
  recipient_source text,
  purpose_label    text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  slug_re  constant text := '^[a-z0-9][a-z0-9-]{0,39}$';
  -- Across EVERY artist, per hour. The sending domain is shared, so a flood against one
  -- artist's form is a reputation problem for all of them; this is the ceiling the
  -- per-artist cap (30/h) cannot provide on its own. 300 stored enquiries an hour is far
  -- beyond any real hour for this roster and far below what would get a domain listed.
  platform_cap constant int := 300;
  v_aid       uuid;
  v_aname     text;
  v_purpose   text;
  v_plabel    text;
  v_to        text;
  v_tos       text[];
  v_source    text;
  v_from_name text;
  v_from_local text;
  v_from_domain text;
  v_id        uuid;
  v_count     int;
begin
  v_purpose := lower(btrim(coalesce(p_purpose, '')));
  if v_purpose !~ slug_re then v_purpose := 'other'; end if;

  -- RESTORED (dropped 2026-08-04). Serialises requests from one address for the length of
  -- this transaction, so the count-then-insert below cannot be raced by N parallel
  -- submissions that all see count < cap. Taken FIRST and in a fixed order with the two
  -- locks below (ip → platform → artist) so no two requests can deadlock.
  perform pg_advisory_xact_lock(hashtext('contact:ip:' || coalesce(p_ip_hash, '')));

  select a.id, a.name into v_aid, v_aname from public.artists a where a.slug = p_slug;
  if v_aid is null then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (left(p_slug, 80), null, v_purpose, p_ip_hash, 'unknown_artist');
    return query select 'unknown_artist'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  if btrim(coalesce(p_name, '')) = ''
     or btrim(coalesce(p_email, '')) !~ email_re
     or char_length(coalesce(p_message, '')) > 5000 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'invalid');
    return query select 'invalid'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  select count(*) into v_count
    from public.contact_attempts
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_count >= 5 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  select count(*) into v_count
    from public.contact_attempts
   where ip_hash = p_ip_hash and created_at > now() - interval '1 day';
  if v_count >= 20 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- NEW: the platform-wide ceiling, under its own lock.
  perform pg_advisory_xact_lock(hashtext('contact:platform'));
  select count(*) into v_count
    from public.enquiries
   where created_at > now() - interval '1 hour';
  if v_count >= platform_cap then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Per-artist second line (30/h), now under a per-artist lock the original never had.
  perform pg_advisory_xact_lock(hashtext('contact:artist:' || v_aid::text));
  select count(*) into v_count
    from public.enquiries
   where artist_id = v_aid and created_at > now() - interval '1 hour';
  if v_count >= 30 then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'rate_limited');
    return query select 'rate_limited'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- CHANGED: an unknown slug is filed under `other`. Yesterday's version kept any
  -- well-formed slug on the reasoning that a site might ship a kind before the backend
  -- heard of it — but the backend hears of a kind the moment its row exists, no deploy
  -- involved, and keeping the slug let a VISITOR choose the `[Prefix]` on trusted mail
  -- via `initcap(slug)`. `other` always exists (seeded, undeletable) and carries a label
  -- the manager chose.
  if not exists (select 1 from public.enquiry_kinds k
                  where k.artist_id = v_aid and k.slug = v_purpose) then
    v_purpose := 'other';
  end if;
  select k.label into v_plabel
    from public.enquiry_kinds k
   where k.artist_id = v_aid and k.slug = v_purpose;
  v_plabel := coalesce(v_plabel, initcap(replace(v_purpose, '-', ' ')));

  select r.to_email, r.recipient_source into v_to, v_source
    from public.resolve_enquiry_recipients(v_aid, v_purpose) r
   where r.is_primary
   limit 1;

  select array_agg(r.to_email order by r.ordinal) into v_tos
    from public.resolve_enquiry_recipients(v_aid, v_purpose) r;

  -- CHANGED 2026-09-28: the house row is joined only for an artist that uses it. For
  -- use_house_mail = true (every real artist, and any artist with no settings row) this
  -- returns what the old `from mail_settings ms left join ams … where ms.id` returned: one
  -- row when the house row exists, NO row when it does not — so all three stay null and the
  -- enquiry is stored unroutable, as before. For use_house_mail = false it always returns
  -- one row carrying the artist's own settings only.
  select coalesce(nullif(btrim(ams.from_name), ''), v_aname || ' Site'),
         coalesce(nullif(btrim(ams.from_local_part), ''), house.from_local_part),
         coalesce(nullif(btrim(ams.sending_domain), ''), house.sending_domain)
    into v_from_name, v_from_local, v_from_domain
  from (select v_aid as artist_id) me
  left join public.artist_mail_settings ams on ams.artist_id = me.artist_id
  left join public.mail_settings house
         on house.id and ams.use_house_mail is distinct from false
  where house.id is not null or ams.use_house_mail is false;

  if v_to is null or v_from_domain is null or v_from_local is null then
    insert into public.enquiries (artist_id, purpose, name, email, message,
                                  to_email, to_emails, recipient_source, status)
    values (v_aid, v_purpose, btrim(p_name), btrim(p_email), btrim(coalesce(p_message, '')),
            v_to, v_tos, v_source, 'unroutable')
    returning id into v_id;

    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, v_aid, v_purpose, p_ip_hash, 'no_recipient');

    return query select 'no_recipient'::text, v_id, null::text, null::text[],
                        null::text, null::text, v_aname, null::text, v_plabel;
    return;
  end if;

  insert into public.enquiries (artist_id, purpose, name, email, message,
                                to_email, to_emails, recipient_source, status)
  values (v_aid, v_purpose, btrim(p_name), btrim(p_email), btrim(coalesce(p_message, '')),
          v_to, v_tos, v_source, 'queued')
  returning id into v_id;

  insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
  values (p_slug, v_aid, v_purpose, p_ip_hash, 'accepted');

  -- RESTORED (dropped 2026-08-04). Roughly one accepted request in a hundred prunes the
  -- ledger; there is no pg_cron here, and without this it grows forever. Best-effort: it
  -- runs after the row is stored and cannot affect this enquiry's outcome.
  if random() < 0.01 then
    delete from public.contact_attempts where created_at < now() - interval '30 days';
  end if;

  return query select 'ok'::text, v_id, v_to, v_tos,
                      v_from_name, v_from_local || '@' || v_from_domain, v_aname, v_source,
                      v_plabel;
end;
$$;

revoke all on function public.submit_enquiry(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text)
  to service_role;
