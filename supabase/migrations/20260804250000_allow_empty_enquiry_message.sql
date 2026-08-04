-- A demo may arrive with no written message.
--
-- Skeen's demo form sends a link and optional audio; the note is optional, because "here
-- are two tracks" is a complete submission without a covering sentence. Requiring a
-- message rejected every one of them with missing_field.
--
-- The invariant is not "a message exists", it is "the enquiry carries SOMETHING" — a
-- message, a demo link, or an attachment. That cannot be checked here: the demo link is
-- written after the row, and attachments do not exist until upload tickets are issued.
-- So it moves to the Edge Function (`hasContent` in validate.ts), and this CHECK relaxes
-- to a length cap only.
--
-- A real loosening of submit_enquiry's "correct on its own" property, stated rather than
-- hidden: a direct service_role call could now store an empty enquiry. service_role is the
-- only grantee, and the function in front of it enforces the real rule.
alter table public.enquiries drop constraint if exists enquiries_message_len;
alter table public.enquiries add constraint enquiries_message_len
  check (char_length(message) <= 5000);
