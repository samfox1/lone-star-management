-- Every image gets a PRESET kind (Sam, 2026-08-26: "it should have a preset alt tag and
-- type assigned to it already"). `photo` is the default; visual artists switch to
-- `artwork`. Existing nulls are backfilled so the wire never carries "unset".
alter table public.media alter column kind set default 'photo';
update public.media set kind = 'photo' where kind is null;
