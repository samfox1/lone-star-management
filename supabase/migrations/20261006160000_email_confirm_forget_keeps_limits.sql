-- Forgetting an address keeps its limits (review, 2026-10-06).
--
-- 20261006130000 forgot an address taken off every list (Sam, 2026-10-05: "forget it on
-- removal") by DELETING its artist_email_confirmations row. That row is also where every limit
-- is counted from:
--
--   sent_at    60 s between sends, 5 an hour and 10 a day per address, and the per-artist (20 an
--              hour) and platform (200 an hour) caps, which count every row's sent_at
--   wrong_at   10 wrong tries a day per address, whatever is resent in between
--
-- So a manager could take an address off a list, put it back, and every budget was empty again:
-- as many Tapir emails to a stranger's inbox as they liked, from the domain every artist sends
-- from, and 5 fresh guesses at the code per round with no daily cap. That is the manager the
-- limits in 20261006120000 were written against.
--
-- Now forgetting CLEARS the row instead of deleting it: not confirmed, no grace, no live code or
-- link (a code or link from before the removal must not confirm the address put back), the
-- per-code count at 0. sent_at and wrong_at stay, and age out as they always do (each is cut to
-- the last 24 h on the next send or wrong try). What Sam asked for still holds: put back, the
-- address is blue and needs a new code. It only cannot get one sooner, or get more of them, than
-- if it had never left.
--
-- Nothing else changes. resolve_enquiry_recipients and email_confirmation_status already read
-- "confirmed_at null, no grace" exactly as "no row"; live_code_sent_at is null once code_hash is;
-- begin_email_confirmation still checks the address is listed before it touches the row. Same
-- trigger, same WHERE, same deferral (checked at commit: 20261006130000 says why).
--
-- Pinned by tests/integration/enquiries/email-confirmations.test.ts, "removal forgets": the 60 s
-- gap and the day's wrong-try lock across a remove + re-add, both seen RED against the DELETE.
-- The grace test passes either way against the hosted project; it was seen RED on a throwaway
-- local Postgres with `grace_until = null` left out of the update below.

create or replace function public.forget_unlisted_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.artist_email_confirmations c
     set confirmed_at     = null,
         grace_until      = null,
         code_hash        = null,
         prev_code_hash   = null,
         code_expires_at  = null,
         code_attempts    = 0,
         token_hash       = null,
         token_expires_at = null
   where c.artist_id = old.artist_id
     and c.email = lower(btrim(old.email))
     and not exists (
       select 1
         from public.enquiry_recipients r
        where r.artist_id = old.artist_id
          and lower(btrim(r.email)) = c.email
     );
  return null;
end;
$$;

-- A trigger function, never a door: nobody calls it (AGENTS.md: revoke by role, not just public).
revoke all on function public.forget_unlisted_confirmation() from public, anon, authenticated;
