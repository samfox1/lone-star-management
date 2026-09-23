-- Hardening after the four-reviewer pass on the enquiry feature (2026-09-22).
--
-- Four read-only reviews (security, test quality, conventions, bug hunt) over
-- 20260921120000 and the code around it. Everything here is a finding from that pass,
-- each traced to its line before being fixed. In order of what it protects:
--
--   1. A refused list save silently WIPED the list. `setEnquiryRecipientsAction` deleted a
--      kind's recipients and then inserted the new set as two PostgREST calls — two
--      transactions. An 11th address (cap), a malformed one (`er_email_fmt`) or a
--      case-variant duplicate (unique index) failed the INSERT after the DELETE had already
--      committed. The dashboard then "reverted" to the old chips, so the manager saw people
--      who were no longer copied, and every enquiry of that kind went to the primary alone
--      until someone reloaded. All four reviewers found it independently. The fix is
--      `set_enquiry_recipients`: both statements in ONE function body, so a trigger raise
--      rolls back the delete too.
--   2. The per-IP rate limit's advisory lock and the 30-day `contact_attempts` prune, both
--      present in 20260722130000, were dropped by the 20260804230000 rewrite and never
--      restored by the four rewrites since — including yesterday's. Count-then-insert under
--      READ COMMITTED lets N parallel requests all see count < cap. This is the exact "a
--      rewrite drops a rule that had no test" shape AGENTS.md warns about. Restored, plus a
--      per-artist lock the original never had, plus a platform-wide ceiling because the
--      sending domain is shared by every artist.
--   3. `log_contact_attempt` never accepted `'attachment'`. 20260804200000 widened the
--      table CHECK, but the function's own `where p_outcome in (…)` was never redefined, so
--      the "each upload ticket burns a rate-limit slot" defense inserted zero rows and
--      raised nothing. It also still folded `purpose` into the retired three-value enum.
--   4. A visitor could choose the email subject's `[Prefix]`: any well-formed slug that
--      matched no kind fell back to `initcap(slug)`, so `purpose: "urgent-invoice-overdue"`
--      produced `[Urgent Invoice Overdue] Skeen — enquiry from …` in mail the manager
--      trusts. The kinds table IS the registry now, so an unknown slug is filed under
--      `other` and wears that kind's label.
--   5. `contact_attempts.slug` had no length bound, and it is stored on every REJECTED
--      request — free storage for anyone probing the endpoint. Artist slugs are ≤ 15 chars
--      today (max stored: 9); 80 is generous.
--   6. The recipient-cap trigger counted without a lock; two concurrent writers could land
--      up to 20 rows on one kind.

-- ---------------------------------------------------------------------------
-- 1. Replace a kind's list atomically
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER, deliberately: RLS on both tables still applies to the caller, and the
-- composite FK still makes a foreign kind unrepresentable. The function adds one thing the
-- two-call version could not have — a single transaction — and one explicit ownership check
-- so a non-owner gets a sentence instead of a silent zero-row delete.
--
-- Returns the rows as STORED (ids, order), so the dashboard replaces its optimistic state
-- with the truth rather than keeping client-minted ids until a reload.
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

  -- One transaction from here. Any CHECK, unique-index or cap-trigger raise below unwinds
  -- this delete with it, which is the entire point of the function.
  delete from public.enquiry_recipients er where er.kind_id = p_kind_id;

  for r in select * from jsonb_array_elements(p_recipients) loop
    v_email := nullif(btrim(coalesce(r->>'email', '')), '');
    v_label := nullif(btrim(coalesce(r->>'label', '')), '');
    if v_email is null then continue; end if;
    insert into public.enquiry_recipients (artist_id, kind_id, email, label)
    values (p_artist_id, p_kind_id, v_email, v_label);
  end loop;

  return query
    select er.id, er.email, er.label, er.created_at
      from public.enquiry_recipients er
     where er.kind_id = p_kind_id
     order by er.created_at, er.id;
end;
$$;

-- Manager-facing: the body checks ownership, so signed-in callers may execute it; anon
-- may not (AGENTS.md: revoke from public AND anon, by role).
revoke all on function public.set_enquiry_recipients(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_enquiry_recipients(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The cap trigger takes a lock before it counts
-- ---------------------------------------------------------------------------
create or replace function public.enforce_enquiry_recipient_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cap constant int := 10;
  n int;
begin
  -- Serialise writers to ONE kind. Without this, two concurrent inserts both count 9 and
  -- both pass. Keyed on the kind so unrelated kinds never wait on each other.
  perform pg_advisory_xact_lock(hashtext('enquiry_recipients:' || new.kind_id::text));
  select count(*) into n
    from public.enquiry_recipients er
   where er.kind_id = new.kind_id
     and er.id is distinct from new.id;
  if n >= cap then
    raise exception 'enquiry recipient cap reached: at most % addresses per kind', cap
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Bound what a rejected request can store
-- ---------------------------------------------------------------------------
alter table public.contact_attempts drop constraint if exists contact_attempts_slug_len;
alter table public.contact_attempts add constraint contact_attempts_slug_len
  check (slug is null or char_length(slug) <= 80);

-- ---------------------------------------------------------------------------
-- 3. The ledger writer accepts every outcome the table does
-- ---------------------------------------------------------------------------
-- The outcome list is copied from the table CHECK (20260804200000) rather than left out:
-- this function is `security invoker` and its callers are service_role, so a raise here
-- would surface as a 500 to the visitor. Filtering keeps it never-raise; the cost is that
-- the two lists must be kept in step, and a door test now pins `'attachment'`.
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
    left(p_slug, 80),
    (select a.id from public.artists a where a.slug = p_slug),
    -- The same shape rule submit_enquiry applies: any well-formed slug, else 'other'.
    case when lower(btrim(coalesce(p_purpose, ''))) ~ '^[a-z0-9][a-z0-9-]{0,39}$'
         then lower(btrim(p_purpose)) else 'other' end,
    p_ip_hash,
    p_outcome
  where p_outcome in ('accepted','honeypot','invalid','rate_limited',
                      'unknown_artist','no_recipient','send_failed','attachment');
$$;

-- ---------------------------------------------------------------------------
-- 2 + 4. The door: locks and prune restored, unknown kinds filed under `other`
-- ---------------------------------------------------------------------------
-- `create or replace`, not drop: the signature and return table are exactly what
-- 20260921120000 left, so grants survive. Everything not named in the header above is
-- byte-for-byte what that migration wrote.
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

  select coalesce(nullif(btrim(ams.from_name), ''), v_aname || ' Site'),
         coalesce(nullif(btrim(ams.from_local_part), ''), ms.from_local_part),
         coalesce(nullif(btrim(ams.sending_domain), ''), ms.sending_domain)
    into v_from_name, v_from_local, v_from_domain
  from public.mail_settings ms
  left join public.artist_mail_settings ams on ams.artist_id = v_aid
  where ms.id;

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
