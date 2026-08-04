-- Contact/booking enquiries from artist sites, and the abuse ledger behind them.
--
-- WHY THIS ISN'T AN ANON DOOR. Every other public entry point in this system is a
-- SECURITY DEFINER function granted to `anon` (ADR 0001). This one can't be. The submit
-- path must (a) see the caller's IP to rate-limit per-IP, which a DB function cannot do
-- — the caveat 20260706150000_subscribe_rate_limit.sql already carries in its header —
-- and (b) hand the RESOLVED recipient address back to whatever actually sends the mail.
-- Granting that to `anon` would leak every artist's booking address over PostgREST and
-- turn the IP hash into a caller-supplied, forgeable parameter, i.e. no rate limit at
-- all. So the public door moves OUT of Postgres and into an Edge Function (ADR 0010);
-- the RPC behind it (20260722130000) is service_role-only.
--
-- STORAGE IS SPLIT IN TWO on purpose:
--   `enquiries`        — the manager-facing inbox. Real messages only. No network
--                        identifiers; a visitor's IP has no manager use.
--   `contact_attempts` — the ops ledger. EVERY attempt, including honeypot hits,
--                        malformed bodies and rejections, keyed by a SALTED ip hash.
-- The rate limiter counts the LEDGER, not the inbox, because a dropped attempt must
-- cost the attacker a slot without ever reaching a manager's screen. One table cannot
-- do both without a status column the UI has to filter on forever.

-- ---------------------------------------------------------------------------
-- Global mail config
-- ---------------------------------------------------------------------------
-- The shared Lone Star verified sending domain plus the last-resort recipient.
-- Singleton, enforced by a boolean primary key with a CHECK that pins it to true —
-- the cheapest single-row table in Postgres. Per-artist overrides live in
-- artist_mail_settings and win over these.
create table public.mail_settings (
  id               boolean primary key default true check (id),
  default_to_email text not null,
  sending_domain   text not null,
  from_local_part  text not null default 'noreply',
  updated_at       timestamptz not null default now(),
  constraint mail_settings_to_fmt
    check (default_to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint mail_settings_domain_fmt
    check (sending_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'),
  constraint mail_settings_local_fmt
    check (from_local_part ~ '^[a-z0-9._-]{1,64}$')
);

create trigger mail_settings_updated_at before update on public.mail_settings
  for each row execute function public.set_updated_at();

alter table public.mail_settings enable row level security;

-- Admin-only, read and write. This is infrastructure config (which domain we have
-- verified with Resend), not per-tenant content.
create policy mail_settings_admin_all on public.mail_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Per-artist mail config
-- ---------------------------------------------------------------------------
-- EXISTS FROM DAY ONE even though v1 sends everything from the shared domain, so that
-- per-artist Resend domain verification is an additive change (fill in sending_domain
-- + resend_domain_id + domain_verified_at) rather than a schema rewrite. Every column
-- is nullable and falls back to mail_settings; an artist with no row here sends from
-- the shared domain with a from-name derived from their display name.
--
-- A SEPARATE TABLE, not columns on `artists`, deliberately: `artists` is the most
-- security-sensitive table in the public payload (ADR 0001 — the artist snapshot is an
-- explicit allowlist, never select *). Keeping mail config out of it means no publish,
-- snapshot, or EPK path can ever accidentally carry an internal routing address.
create table public.artist_mail_settings (
  artist_id          uuid primary key references public.artists (id) on delete cascade,
  -- Display name in the From header ("Skeen Site"). null → '<artist name> Site'.
  from_name          text,
  -- Per-artist verified sending domain. null → mail_settings.sending_domain.
  sending_domain     text,
  from_local_part    text,
  -- Resend's domain object id + verification stamp, for the later per-artist upgrade.
  resend_domain_id   text,
  domain_verified_at timestamptz,
  -- Highest-priority recipient override: an ops escape hatch that beats both the
  -- booking link and site_content, so a bouncing address can be rerouted without
  -- touching the manager's editor content.
  booking_email      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- CR/LF in a header value is SMTP header injection. Reject it at the STORAGE layer,
  -- not only at send time, so the invariant survives whoever writes the next sender.
  constraint ams_from_name_clean
    check (from_name is null or (char_length(from_name) between 1 and 100 and from_name !~ '[\r\n]')),
  constraint ams_domain_fmt
    check (sending_domain is null or sending_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'),
  constraint ams_local_fmt
    check (from_local_part is null or from_local_part ~ '^[a-z0-9._-]{1,64}$'),
  constraint ams_booking_fmt
    check (booking_email is null or booking_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

create trigger artist_mail_settings_updated_at before update on public.artist_mail_settings
  for each row execute function public.set_updated_at();

alter table public.artist_mail_settings enable row level security;

-- Managers READ their own artist's config, because the dashboard shows the resolved
-- sender and recipient. WRITES are admin-only: a manager who could set `sending_domain`
-- could point their sends at a domain Lone Star has NOT verified with Resend, which
-- silently breaks delivery for that artist with no error anyone would notice. Domain
-- ownership is an ops concern, not a content one.
create policy ams_read on public.artist_mail_settings
  for select using (public.is_admin() or public.is_manager_of(artist_id));
create policy ams_admin_write on public.artist_mail_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- The manager-facing inbox
-- ---------------------------------------------------------------------------
-- Same tenancy model as `subscribers` (20260706120000): keyed by artist_id resolved
-- server-side from the public slug, owner-read-only, and NO insert policy at all, so
-- the privileged RPC is the sole ingest path.
create table public.enquiries (
  id                  uuid primary key default gen_random_uuid(),
  artist_id           uuid not null references public.artists (id) on delete cascade,
  purpose             text not null default 'other'
                        check (purpose in ('booking','demo','other')),
  name                text not null,
  -- The VISITOR's address. Becomes the message's reply_to. NEVER the From: spoofing
  -- the visitor in From fails DMARC and lands the mail in spam.
  email               text not null,
  message             text not null,
  -- The recipient AS RESOLVED AT SUBMIT TIME, frozen. Recipient resolution reads
  -- WORKING rows (see 20260722130000), so this column is what lets a manager answer
  -- "where did that one actually go?" after they have since changed the address.
  to_email            text not null,
  recipient_source    text not null
                        check (recipient_source in ('mail_settings','link','site_content','default')),
  status              text not null default 'queued'
                        check (status in ('queued','sent','failed')),
  send_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  constraint enquiries_name_len    check (char_length(name) between 1 and 200),
  constraint enquiries_email_len   check (char_length(email) between 3 and 320),
  constraint enquiries_message_len check (char_length(message) between 1 and 5000),
  constraint enquiries_to_len      check (char_length(to_email) between 3 and 320)
);

-- NOTE on `on delete cascade`: deleting an artist destroys their enquiry history.
-- That is deliberate — the same call the rest of the schema makes for subscribers and
-- analytics_events — but it does mean enquiries are not an audit log that outlives the
-- tenant. If that ever needs to change, it changes here.

create index enquiries_artist_created_idx on public.enquiries (artist_id, created_at desc);
-- Partial: the only scan we ever run over the whole table is "what failed to send?".
create index enquiries_unsent_idx on public.enquiries (created_at) where status <> 'sent';

alter table public.enquiries enable row level security;

create policy enquiries_read on public.enquiries
  for select using (public.is_admin() or public.is_manager_of(artist_id));

-- Managers mark an enquiry read — and NOTHING else.
--
-- An `for update` policy ALONE is not enough. In a stock Supabase project the
-- `authenticated` role holds table-level UPDATE on public tables, and RLS has no column
-- granularity, so a policy that merely scopes rows would let a manager rewrite
-- `message`, `to_email`, or `status` on their own inbox. Revoke the blanket grant and
-- re-grant exactly one column. The column grant is the real control here; the policy
-- only scopes WHICH rows.
revoke update on public.enquiries from authenticated;
grant update (read_at) on public.enquiries to authenticated;

create policy enquiries_mark_read on public.enquiries
  for update using (public.is_admin() or public.is_manager_of(artist_id))
          with check (public.is_admin() or public.is_manager_of(artist_id));

-- ---------------------------------------------------------------------------
-- The abuse ledger / rate-limit counter
-- ---------------------------------------------------------------------------
-- bigint identity rather than uuid: this is a high-volume append-only log whose only
-- query shape is a time-ordered range scan per ip_hash, and random uuid v4 keys destroy
-- index locality for exactly that shape.
create table public.contact_attempts (
  id         bigint generated always as identity primary key,
  slug       text,  -- as submitted; may not resolve to an artist
  artist_id  uuid references public.artists (id) on delete set null,
  purpose    text,
  -- SHA-256(salt || ':' || ip), hex, truncated. SALTED is non-negotiable: the whole
  -- IPv4 space is ~4 billion hashes, so an UNSALTED column is a plaintext IP column
  -- with extra steps. The salt lives in an Edge Function secret (CONTACT_IP_SALT) and
  -- the hashing happens in Deno, so the raw IP never reaches Postgres at all.
  ip_hash    text not null,
  outcome    text not null check (outcome in (
               'accepted','honeypot','invalid','rate_limited',
               'unknown_artist','no_recipient','send_failed')),
  created_at timestamptz not null default now(),
  constraint contact_attempts_ip_len check (char_length(ip_hash) between 8 and 64)
);

create index contact_attempts_ip_created_idx on public.contact_attempts (ip_hash, created_at desc);
create index contact_attempts_created_idx    on public.contact_attempts (created_at);

alter table public.contact_attempts enable row level security;

-- Admin only. Managers get no read at all: this is cross-tenant ops noise, and it
-- carries network identifiers that have no manager use.
create policy contact_attempts_admin_read on public.contact_attempts
  for select using (public.is_admin());
