-- Attachments expire into a TOMBSTONE instead of vanishing.
--
-- Found by the skeen side reviewing the contract (2026-08-04), and it was a real bug, not
-- a wording problem: the sweep deleted the object AND the row, so "attachment expired"
-- could never render — there was nothing left to render it from. A manager would see a
-- demo enquiry that had quietly lost the fact it ever had audio, with no way to tell that
-- from one that never had any.
--
-- The row now survives with its filename and type. `storage_path` is nulled (the object is
-- gone, and keeping a path to nothing invites a signing attempt that can only fail) and
-- `expired_at` records when.
--
-- This also makes two states that were being conflated genuinely distinguishable:
--   expired_at set   -> "attachment expired", the file was here and the 90 days ran out
--   no path, no stamp -> the upload never completed (the row is written when the ticket
--                        is minted, not when the bytes land)
-- Those look identical in a database that deletes the row, and they are different facts
-- the manager might reasonably act on differently.
alter table public.enquiry_attachments add column if not exists expired_at timestamptz;

-- Nullable now that the sweep clears it.
alter table public.enquiry_attachments alter column storage_path drop not null;

-- The sweep scans for rows that still hold an object and are past the window.
create index if not exists enquiry_attachments_sweep_idx
  on public.enquiry_attachments (created_at)
  where storage_path is not null;

comment on column public.enquiry_attachments.expired_at is
  'When the audio was deleted by the 90-day sweep. The row is kept so the dashboard can say the attachment expired rather than silently showing nothing.';
