-- The booking email gets its own door (2026-09-13).
--
-- Sam: "the booking email should be on like account or personal settings". It is the
-- highest-priority recipient for enquiries (rung 1 of resolve_booking_recipient), and
-- until now NOTHING in the app could set it: `artist_mail_settings` is admin-write-only,
-- deliberately, because it also holds `sending_domain` — a manager pointing sends at an
-- unverified domain would silently break delivery. That reasoning still stands, so the
-- policy is untouched. This function writes ONE column, for the artist's own managers,
-- and nothing else on the row.
--
-- Blank clears it (the resolver then falls through to the booking link, then site
-- text). A non-address is refused rather than stored: a bad recipient here would beat
-- every good one below it.

create or replace function public.set_booking_email(p_artist_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  if not (public.is_admin() or public.is_manager_of(p_artist_id)) then
    raise exception 'not authorized';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not an email address';
  end if;

  insert into public.artist_mail_settings (artist_id, booking_email)
  values (p_artist_id, v_email)
  on conflict (artist_id) do update set booking_email = excluded.booking_email;

  return v_email;
end;
$$;

-- Manager-facing: the function checks ownership itself, so signed-in callers may
-- execute it; anon may not (AGENTS.md: revoke from public AND anon, by role).
revoke all on function public.set_booking_email(uuid, text) from public, anon;
grant execute on function public.set_booking_email(uuid, text) to authenticated, service_role;
