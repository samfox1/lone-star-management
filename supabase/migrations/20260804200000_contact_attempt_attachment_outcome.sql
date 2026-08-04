-- Upload tickets count against the per-IP rate limit.
--
-- The brief is explicit that attachments must not be a way around the existing limit, so
-- each ticket minted is logged as its own attempt: a request asking for three files costs
-- four slots, not one.
--
-- A NEW outcome value rather than reusing 'accepted'. Three extra 'accepted' rows for a
-- single enquiry would make the ledger lie to whoever reads it, and contact_attempts is
-- the only forensic record of what this endpoint has been asked to do. Widening a CHECK is
-- additive: it cannot invalidate a row that already exists.
--
-- Separate from 20260804190000 because that migration is already applied. Editing an
-- applied migration leaves the file disagreeing with what actually ran, which is the one
-- thing a migration history exists to prevent.
alter table public.contact_attempts drop constraint if exists contact_attempts_outcome_check;
alter table public.contact_attempts add constraint contact_attempts_outcome_check
  check (outcome in (
    'accepted','honeypot','invalid','rate_limited',
    'unknown_artist','no_recipient','send_failed','attachment'));
