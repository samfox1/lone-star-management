-- An address taken off every list is forgotten (Sam, 2026-10-05).
--
-- Sam removed his own address from Skeen's lists, added it again, and it turned black at once:
-- since 20261006120000 a confirmation belonged to (artist, address) for good, so re-adding never
-- asked again. He chose: "forget it on removal". Now, when an address is no longer on ANY of the
-- artist's lists, its artist_email_confirmations row goes, and adding it again sends a new code.
-- An address still on another list keeps its confirmation (removing Ross from Booking must not
-- un-confirm him on Contact).
--
-- CHECKED AT COMMIT, not at the delete. set_enquiry_recipients saves a kind by deleting its whole
-- list and inserting it again in one call, so at the moment of each delete every address looks
-- unlisted. A plain AFTER DELETE trigger would forget every confirmed address on every save. A
-- DEFERRABLE INITIALLY DEFERRED constraint trigger runs at commit, after the inserts, and sees the
-- list as it ends up. It also covers the other ways rows leave: a kind deleted (cascade), a row
-- deleted by hand, and an address edited in place (UPDATE OF email).
--
-- Legacy rows in their grace (Ross, skeen@) are forgotten the same way: an address removed and
-- added again is a new address, and grace was for the addresses already there on the day.
--
-- Pinned by tests/integration/enquiries/email-confirmations.test.ts, "removal forgets" (the two
-- forgetting tests seen RED before this file; the re-save test is the one a non-deferred trigger
-- fails).

create or replace function public.forget_unlisted_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.artist_email_confirmations c
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

drop trigger if exists enquiry_recipients_forget_unlisted on public.enquiry_recipients;
create constraint trigger enquiry_recipients_forget_unlisted
  after delete or update of email on public.enquiry_recipients
  deferrable initially deferred
  for each row
  execute function public.forget_unlisted_confirmation();
