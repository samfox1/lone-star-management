-- Enquiry KINDS, each with its own recipient list (2026-09-21). Stage 1 of 3.
--
-- Until now the whole chain resolved exactly one address for every enquiry: three fixed
-- purposes ('booking','demo','other'), one booking address, `to: [row.to_email]` in the
-- Edge Function. Sam's ask is two things at once — forward to Skeen AND his manager, and
-- give each kind of enquiry its own list, with the kinds being the artist's to define.
--
-- WHAT THIS MIGRATION IS AND IS NOT. It is the data model and the routing: kinds, lists,
-- and a resolver that answers "who receives a `demo` for this artist?". It is NOT the
-- dashboard screens (stage 2) and NOT the bridge/site work that would let a visitor pick a
-- kind the artist invented (stage 3) — the contact form's options are baked into each
-- site's own code today, so a new kind cannot appear as a button until the bridge ships a
-- version and the sites redeploy. Stage 1 is useful on its own: the three kinds the sites
-- ALREADY send get separate lists immediately.
--
-- WHY THE LIST ADDS RATHER THAN REPLACES. `resolve_booking_recipient`'s four rungs are
-- untouched and still resolve the PRIMARY for every kind, exactly as before; a kind's list
-- is unioned on top, deduplicated case-insensitively. Replacing would mean that adding a
-- manager SILENTLY STOPS sending to the booking address published on the artist's own
-- site, which is the quiet loss this endpoint is built to avoid everywhere else (see the
-- header of 20260804230000 — an enquiry that cannot be addressed is stored, not discarded).
-- It also means a kind with an empty list still goes somewhere.
--
-- ONE MESSAGE, SEVERAL RECIPIENTS — not one message each. Resend takes an array in `to`,
-- so this stays a single send with a single provider id and `mark_enquiry_sent` needs no
-- change. The cost is that recipients see each other's addresses. For "the artist and
-- their manager" that is correct; people who must NOT see each other would need a send per
-- recipient and a per-recipient delivery table, and that is deliberately not built on spec.

-- ---------------------------------------------------------------------------
-- The kinds an artist accepts
-- ---------------------------------------------------------------------------
create table public.enquiry_kinds (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  -- What the SITE sends in `purpose` and what `enquiries.purpose` stores. Constrained to a
  -- url/json-safe slug because it crosses a public HTTP boundary in both directions and is
  -- compared by equality at the routing step.
  slug       text not null,
  -- What a human sees: the dashboard row, and the `[Booking]` prefix on the email subject.
  label      text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint ek_slug_fmt check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  -- CR/LF in a value that reaches a mail header is SMTP header injection, and `label` does
  -- exactly that via buildSubject. Refused at the STORAGE layer so the invariant outlives
  -- whoever writes the next sender — the same rule as artist_mail_settings.from_name.
  constraint ek_label_clean
    check (char_length(label) between 1 and 60 and label !~ '[\r\n]'),
  constraint ek_artist_slug_key unique (artist_id, slug),
  -- Not redundant: it is the target of the composite FK on enquiry_recipients below, which
  -- is what makes "a recipient on another artist's kind" unrepresentable rather than merely
  -- untested.
  constraint ek_id_artist_key unique (id, artist_id)
);

create index enquiry_kinds_artist_idx on public.enquiry_kinds (artist_id, sort_order);

alter table public.enquiry_kinds enable row level security;

-- Managers own their kinds outright: this is content, not infrastructure. The reason
-- artist_mail_settings is admin-write-only does not apply — that table also carries
-- `sending_domain`, where a manager's edit silently breaks delivery against a domain we
-- have not verified with Resend. Nothing here can do that.
create policy enquiry_kinds_read on public.enquiry_kinds
  for select using (public.is_admin() or public.is_manager_of(artist_id));
create policy enquiry_kinds_write on public.enquiry_kinds
  for all using (public.is_admin() or public.is_manager_of(artist_id))
  with check (public.is_admin() or public.is_manager_of(artist_id));

-- ---------------------------------------------------------------------------
-- Every artist starts with the three the sites already send
-- ---------------------------------------------------------------------------
-- A TRIGGER rather than app code. Every live site posts one of these three slugs today, so
-- an artist without them would route their enquiries to nobody the moment stage 3 starts
-- reading this table — and "the app remembers to seed it" is the kind of rule that holds
-- until the second place that creates an artist (a seed script, a test helper, an admin
-- screen) forgets. `on conflict do nothing` keeps it safe to re-run.
create or replace function public.seed_default_enquiry_kinds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.enquiry_kinds (artist_id, slug, label, sort_order)
  values (new.id, 'booking', 'Booking', 0),
         (new.id, 'demo',    'Demo',    1),
         -- Slug 'other', LABEL 'Contact'. The slug is machine-facing and cannot change: it
         -- is what every live site already posts, and what coercePurpose falls back to. The
         -- label is the only part anyone reads, and both places that already render this
         -- kind — the inbox's PURPOSE_LABEL map and the old email-subject map — have always
         -- said "Contact". Seeding it as "Other" would have quietly renamed it for everyone.
         (new.id, 'other',   'Contact', 2)
  on conflict (artist_id, slug) do nothing;
  return new;
end;
$$;

create trigger artists_seed_enquiry_kinds
  after insert on public.artists
  for each row execute function public.seed_default_enquiry_kinds();

-- Backfill everyone who already exists.
insert into public.enquiry_kinds (artist_id, slug, label, sort_order)
select a.id, k.slug, k.label, k.sort_order
from public.artists a
cross join (values ('booking','Booking',0), ('demo','Demo',1), ('other','Contact',2))
  as k(slug, label, sort_order)
on conflict (artist_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Rename it freely; you cannot re-slug it, and you cannot remove the fallback
-- ---------------------------------------------------------------------------
-- TWO RULES, both guarding the same silent failure: routing that stops working while
-- everything still looks fine.
--
--   1. THE SLUG IS IMMUTABLE. It is not a name, it is the word the artist's website posts
--      in `purpose`. Renaming 'booking' to 'bookings' does not move anything — the site
--      keeps sending the old word, it matches no kind, and every booking enquiry quietly
--      falls back to the primary with its list skipped. Nobody sees an error; the wrong
--      people simply stop being copied. The label is what humans read and stays editable.
--
--   2. 'other' CANNOT BE DELETED. It is the fallback coercePurpose and submit_enquiry both
--      name literally, so it receives every malformed and every unrecognised purpose.
--      Deleting it cascades its recipients away and sends all of that to the primary alone.
--      Renaming its LABEL — to "Contact", "General", anything — is fine and expected.
--
-- Deleting a kind the artist actually invented is allowed: they made it, its slug is not
-- hardcoded anywhere, and its recipients cascade as they should.
create or replace function public.guard_enquiry_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    raise exception 'an enquiry kind''s slug cannot change (% → %); rename the label instead',
      old.slug, new.slug
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and old.slug = 'other' then
    raise exception 'the fallback enquiry kind cannot be deleted; rename its label instead'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Not fired on DELETE when the ARTIST is going: the cascade from artists deletes these rows
-- as a child of that statement, and a BEFORE DELETE trigger would refuse it and strand the
-- artist. `pg_trigger_depth() = 0` is true only for a delete aimed at this table directly.
create trigger enquiry_kinds_guard
  before update or delete on public.enquiry_kinds
  for each row when (pg_trigger_depth() = 0)
  execute function public.guard_enquiry_kind();

revoke all on function public.guard_enquiry_kind() from public, anon;

-- ---------------------------------------------------------------------------
-- Who receives each kind
-- ---------------------------------------------------------------------------
create table public.enquiry_recipients (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references public.artists (id) on delete cascade,
  kind_id    uuid not null,
  email      text not null,
  -- Who this is, for the dashboard row ("Skeen", "Tour manager"). Optional: the address
  -- alone is a complete answer, and requiring a label just gets it typed twice.
  label      text,
  created_at timestamptz not null default now(),
  constraint er_email_fmt
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint er_email_len check (char_length(email) between 3 and 320),
  constraint er_label_clean
    check (label is null or (char_length(label) between 1 and 100 and label !~ '[\r\n]')),
  -- COMPOSITE, deliberately. A plain `kind_id references enquiry_kinds(id)` would happily
  -- accept another artist's kind while `artist_id` said otherwise, and the RLS policy reads
  -- artist_id — so a manager could attach a recipient to a rival's routing and the row
  -- would still look like their own. Pointing both columns at the same parent row makes
  -- that unrepresentable instead of relying on a test to catch it.
  constraint er_kind_fk foreign key (kind_id, artist_id)
    references public.enquiry_kinds (id, artist_id) on delete cascade
);

-- Case-insensitive, and scoped to the KIND: the same person may legitimately be on the
-- booking list and the demo list. Without lower(), "Booking@x.com" beside "booking@x.com"
-- puts one inbox in `to` twice, which is a duplicate email to a human and a malformed
-- request to some providers.
create unique index enquiry_recipients_kind_email_key
  on public.enquiry_recipients (kind_id, lower(email));

create index enquiry_recipients_artist_idx on public.enquiry_recipients (artist_id);

alter table public.enquiry_recipients enable row level security;

create policy enquiry_recipients_read on public.enquiry_recipients
  for select using (public.is_admin() or public.is_manager_of(artist_id));
create policy enquiry_recipients_write on public.enquiry_recipients
  for all using (public.is_admin() or public.is_manager_of(artist_id))
  with check (public.is_admin() or public.is_manager_of(artist_id));

-- ---------------------------------------------------------------------------
-- A cap on the list, because the SENDER is shared
-- ---------------------------------------------------------------------------
-- MAIL AMPLIFICATION. Submitting an enquiry is public and anonymous: anyone on the internet
-- can cause a send. What they cannot choose is how many messages that send becomes — until
-- now, because that is the length of this list. The per-artist flood cap already allows 30
-- enquiries an hour, so a list of 200 turns a public form into 6,000 messages an hour
-- leaving OUR verified domain. The damage is not the mail bill: the sending domain is
-- shared by every artist, and getting it onto a blocklist breaks delivery for all of them
-- at once. Resend also rejects the whole request over its own `to` limit, so an oversized
-- list would silently turn every enquiry of that kind into a send failure.
--
-- Enforced in the DATABASE rather than the dashboard because the dashboard is not the only
-- writer — service_role, a future import, and the next screen someone builds all reach this
-- table, and a rule that lives in one form is a rule the second writer never hears about.
--
-- Ten is well above a real answer (artist, manager, agent, label) and well under anything
-- that would matter. A CHECK cannot count rows, so this is a trigger.
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

-- BEFORE INSERT OR UPDATE: an UPDATE that moves a row onto an already-full kind is the same
-- overflow by a different route, and excluding `new.id` above is what keeps an ordinary
-- edit-in-place (changing the label on an existing row) from counting itself.
create trigger enquiry_recipients_cap
  before insert or update on public.enquiry_recipients
  for each row execute function public.enforce_enquiry_recipient_cap();

revoke all on function public.enforce_enquiry_recipient_cap() from public, anon;

-- ---------------------------------------------------------------------------
-- `purpose` stops being an enum
-- ---------------------------------------------------------------------------
-- It was `check (purpose in ('booking','demo','other'))` on both tables, which is precisely
-- the rule custom kinds removes. Replaced by the SHAPE check rather than dropped: `purpose`
-- still crosses a public HTTP boundary and is still compared by equality, so an arbitrary
-- string here would be a new sink. Same slug format enquiry_kinds enforces.
--
-- NOT a foreign key to enquiry_kinds, on purpose. The enquiry records what the visitor
-- actually chose and has to survive the manager later renaming or deleting that kind — the
-- same freeze-at-submit-time reasoning as `to_email`. contact_attempts logs a purpose
-- before the artist is even resolved (the unknown_artist path), so it could not have one.
-- FOUND, not guessed. `drop constraint if exists enquiries_purpose_check` relies on
-- Postgres having auto-named the inline CHECK exactly that — and IF EXISTS means a wrong
-- guess DROPS NOTHING AND RAISES NOTHING. The old three-value rule would survive next to
-- the new one, both would be enforced, and every artist-invented kind would be rejected at
-- insert time by a constraint this migration believes it removed. That failure would first
-- appear as "adding a Press kind works but no press enquiry ever arrives".
do $$
declare c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.enquiries'::regclass, 'public.contact_attempts'::regclass)
       and pg_get_constraintdef(oid) ilike '%purpose%'
       and pg_get_constraintdef(oid) ilike '%booking%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

alter table public.enquiries add constraint enquiries_purpose_check
  check (purpose ~ '^[a-z0-9][a-z0-9-]{0,39}$');

-- `is null` is not dead here the way it would be on `enquiries`: contact_attempts.purpose
-- is nullable, and the unknown_artist path logs an attempt before anything is resolved.
alter table public.contact_attempts add constraint contact_attempts_purpose_check
  check (purpose is null or purpose ~ '^[a-z0-9][a-z0-9-]{0,39}$');

-- ---------------------------------------------------------------------------
-- The frozen record on the enquiry
-- ---------------------------------------------------------------------------
-- `to_email` keeps its exact meaning: the PRIMARY recipient, frozen at submit time so a
-- manager can still answer "where did that one actually go?" after changing the address.
-- `to_emails` is the full set that was addressed — with several recipients the primary
-- alone stopped answering that question.
alter table public.enquiries add column if not exists to_emails text[];

-- `recipient_source` is deliberately NOT widened. It records how the PRIMARY was found, and
-- the primary always comes from resolve_booking_recipient's four rungs. Adding a value
-- nothing can ever store would read like a state the table supports.

-- ---------------------------------------------------------------------------
-- Resolution
-- ---------------------------------------------------------------------------
-- The booking rungs FIRST (unchanged, still the primary, still the recorded source), then
-- the list for THIS KIND. Order is load-bearing: the caller takes the single is_primary row
-- as `enquiries.to_email`, and resolve_booking_recipient's precedence is a tested contract
-- this function must not quietly reorder.
--
-- An unknown `p_purpose` (a kind since deleted, or a site sending something we never had)
-- simply matches no kind and yields the primary alone. It does not raise, and it does not
-- fall back to another kind's list — routing a press enquiry to the demo pile because a
-- slug went missing is worse than routing it to the booking address, which at least is a
-- person who was always going to receive everything.
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
    -- array whose order decides who appears first in the To: header. Postgres happens to
    -- preserve it for a plan this simple, which is worse than not preserving it: the test
    -- would pass here and the order could change under a different plan in production.
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
  select e.to_email, 'recipient_list'::text, false, e.rn from extra e;
$$;

-- Service-only, the same door as resolve_booking_recipient: it reads recipient routing,
-- which is resolved server-side precisely so it never has to leave. AGENTS.md — revoke from
-- the three ROLES, not just the PUBLIC pseudo-role, or Supabase's default privileges leave
-- it executable by anon.
revoke all on function public.resolve_enquiry_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_enquiry_recipients(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The door
-- ---------------------------------------------------------------------------
-- DROPPED, not replaced: the return table gains `to_emails` and `purpose_label`, and
-- Postgres will not widen a return type in place. Everything else is what 20260804270000
-- left — the validation, the two per-IP windows, the per-artist flood cap and the hard
-- never-raise invariant all stand exactly as they were.
drop function if exists public.submit_enquiry(text, text, text, text, text, text);

create function public.submit_enquiry(
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
  -- Any WELL-FORMED slug is kept, because the artist defines their own kinds and this
  -- function must not need redeploying when they add one. Only a malformed value coerces,
  -- and it coerces rather than raising for the reason validate.ts gives: a site that ships
  -- a new purpose before the backend hears about it should still deliver its enquiries.
  v_purpose := lower(btrim(coalesce(p_purpose, '')));
  if v_purpose !~ slug_re then v_purpose := 'other'; end if;

  select a.id, a.name into v_aid, v_aname from public.artists a where a.slug = p_slug;
  if v_aid is null then
    insert into public.contact_attempts (slug, artist_id, purpose, ip_hash, outcome)
    values (p_slug, null, v_purpose, p_ip_hash, 'unknown_artist');
    return query select 'unknown_artist'::text, null::uuid, null::text, null::text[],
                        null::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- Re-validate server-side. The Edge Function validates too (so it can return a specific
  -- 400 fast), but this function must be correct on its own — it is the last thing standing
  -- between the request and the table.
  -- `message` is no longer required: a demo can be a link and some audio. The rule that an
  -- enquiry must carry SOMETHING lives in the Edge Function (hasContent), because neither
  -- the demo link nor the attachments exist at this point. Length is still capped here,
  -- since that one IS knowable and its violation would raise.
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

  -- Per-artist second line, mirroring subscribe()'s 15/min and record_event()'s 120/min:
  -- caps how fast one artist's inbox can be flooded from a botnet of distinct IPs, where
  -- the per-IP limits above never trigger. Counts stored enquiries, not attempts — the harm
  -- being capped is inbox flooding, and rejected attempts never reach the inbox.
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

  -- The subject line's `[Booking]` prefix used to come from a hardcoded map in validate.ts,
  -- which cannot know a kind the artist invented. Falls back to the slug made readable, so
  -- a kind deleted between submit and send still produces a sensible subject rather than an
  -- empty bracket.
  select k.label into v_plabel
    from public.enquiry_kinds k
   where k.artist_id = v_aid and k.slug = v_purpose;
  v_plabel := coalesce(v_plabel, initcap(replace(v_purpose, '-', ' ')));

  -- The one changed step. `v_to` / `v_source` mean exactly what they always did (the
  -- primary and how it was found); `v_tos` is everyone addressed for THIS kind.
  --
  -- NO "promote the first configured recipient when no rung resolved" branch, though it
  -- looks like the obvious next line. It would be dead code: rung 4 of
  -- resolve_booking_recipient is mail_settings.default_to_email, which is NOT NULL and
  -- carries the same address-shape CHECK the rung tests for — so whenever the singleton row
  -- exists a primary always resolves. And when it does not exist, `v_from_domain` below is
  -- null too (it reads the same row), so the enquiry is unroutable for want of a SENDER no
  -- matter how many recipients are configured. A branch that cannot execute is a branch no
  -- test can bite, which is how a rule quietly stops being true.
  select r.to_email, r.recipient_source into v_to, v_source
    from public.resolve_enquiry_recipients(v_aid, v_purpose) r
   where r.is_primary
   limit 1;

  -- BY THE ORDINAL. `order by is_primary desc` would put the primary first and then leave
  -- every configured recipient in whatever order the plan produced — a tie on a boolean is
  -- not an ordering. The primary carries ordinal 0 and the list counts up from 1.
  select array_agg(r.to_email order by r.ordinal) into v_tos
    from public.resolve_enquiry_recipients(v_aid, v_purpose) r;

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

  return query select 'ok'::text, v_id, v_to, v_tos,
                      v_from_name, v_from_local || '@' || v_from_domain, v_aname, v_source,
                      v_plabel;
end;
$$;

-- Re-granted because the DROP above took the old grants with it. Service-only: this is the
-- privileged door the Edge Function calls, and it writes `enquiries` and `contact_attempts`
-- with no ownership check of its own.
revoke all on function public.submit_enquiry(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, text, text, text, text, text)
  to service_role;

-- `public, anon` ONLY — deliberately NOT `authenticated`, which every other revoke in this
-- file includes. `artists` is admin-insert, an admin holds the `authenticated` role, and
-- this function is reached by the trigger firing on THEIR insert. Revoking EXECUTE from
-- `authenticated` would, if Postgres checks that privilege when a trigger fires, break
-- artist creation entirely — a risk with no matching benefit, because PostgREST does not
-- expose functions returning `trigger`, so there is no door here for anon to knock on. The
-- anon revoke stays so `npm run audit:grants` has nothing to report.
revoke all on function public.seed_default_enquiry_kinds() from public, anon;
