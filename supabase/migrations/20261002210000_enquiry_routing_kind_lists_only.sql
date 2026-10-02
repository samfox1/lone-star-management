-- Each kind of enquiry goes ONLY to the addresses added to that kind (Sam, 2026-10-02).
--
-- Sam: "I dont want the main address to recieve everything, I should have to add each one
-- individually." Until this file, `resolve_enquiry_recipients` put a PRIMARY in front of every
-- kind's list, found by `resolve_booking_recipient`'s three rungs:
--
--   1. artist_mail_settings.booking_email
--   2. the booking link (links.role = 'booking', mailto: stripped)
--   3. site_content.booking_email
--
-- so one address received Booking, Demo, Contact and every invented kind, whether or not
-- anyone had put it on those lists. That is gone. Now:
--
--   - a kind is addressed to its OWN enquiry_recipients, in the order they were added, and to
--     nobody else; the earliest-added is the primary (`to_email`);
--   - none of the three rungs is read for routing at all;
--   - a kind with no addresses resolves NOBODY, so submit_enquiry stores the enquiry
--     `unroutable` and sends nothing (the rule since 20260928141000 for an artist with no
--     address anywhere), and it shows in the inbox.
--
-- submit_enquiry is NOT redefined: it already takes the single `is_primary` row as `to_email`
-- and aggregates every row by `ordinal` into `to_emails`, and both keep their meaning. Every
-- row's `recipient_source` is now 'recipient_list' (allowed by enquiries_recipient_source_check
-- since 20260928141000; the old values stay allowed because stored rows carry them). The
-- contact Edge Function only forwards what submit_enquiry returns (pickRecipients), so it needs
-- no deploy.
--
-- THE FALLBACK FUNCTIONS ARE DROPPED, not left unused: `resolve_booking_recipient` (the rungs)
-- and `booking_recipient_preview` (the dashboard's read of them, no longer called since Settings
-- › Email shows each kind's own list). A function left behind is one `create or replace` away
-- from routing through the rungs again, with nothing to say it happened.
--
-- NOT CHANGED: what the rungs mean outside routing. site_content.booking_email and the booking
-- link are still the PUBLIC contact the site and the EPK show (lib/epk.ts). The
-- artist_mail_settings.booking_email column and its door (set_booking_email) stay; nothing in
-- the app writes or routes from it any more (see the column comment below).
--
-- Pinned by tests/integration/enquiries/enquiry-recipients.test.ts and enquiry-door.test.ts
-- (the tests gated on this file going live), each seen RED against 20260928141000.

-- ---------------------------------------------------------------------------
-- The resolver: the kind's own list, and nothing else
-- ---------------------------------------------------------------------------
-- Same signature and return table as before, so submit_enquiry's call is unchanged.
-- `row_number()` rather than a bare ORDER BY: the caller aggregates by `ordinal`, which decides
-- who appears first in the To: header. No de-duplication is needed: enquiry_recipients is
-- unique per kind on lower(email) (20260921120000).
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
    where er.artist_id = p_artist_id
      and k.slug = p_purpose
  ) l;
$$;

-- Service-only (AGENTS.md: revoke from public, anon AND authenticated, by role).
revoke all on function public.resolve_enquiry_recipients(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_enquiry_recipients(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The rungs, gone
-- ---------------------------------------------------------------------------
-- The preview first: it calls the resolver below it.
drop function if exists public.booking_recipient_preview(uuid);
drop function if exists public.resolve_booking_recipient(uuid);

comment on column public.artist_mail_settings.booking_email is
  'NOT USED FOR ROUTING since 20261002210000: each enquiry kind goes only to its own enquiry_recipients. Was rung 1 of resolve_booking_recipient (dropped). Kept so the change is additive; set_booking_email still writes it.';
