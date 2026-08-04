-- Press-kit (EPK) fields the manager fills in by hand. Everything else on the press kit
-- is derived from already-published content, so these two are the whole manual surface.
--
-- They live on `artists` and join ARTIST_SNAPSHOT, which means they publish with the
-- profile: no new publish button, and the PDF and the public /[slug]/epk page can never
-- disagree (they read the same published revision).
--
-- `press_quotes` is jsonb rather than a table because it is a short ORDERED list nobody
-- queries across — the order is the manager's editorial choice, and a table would need a
-- sort_order column plus its own publish path to say the same thing. Shape per element:
--   { "quote": text, "source": text, "url": text|null }
-- Validated in TS on the way in (lib/epk.ts) and coerced on the way out, because older
-- revisions predate the column entirely.
alter table artists add column if not exists press_pitch text;
alter table artists add column if not exists press_quotes jsonb not null default '[]'::jsonb;

-- Reject a scalar or object outright: the read path tolerates junk so an old revision
-- can't take the EPK page down, but there is no reason to accept a bad shape on write.
alter table artists drop constraint if exists artists_press_quotes_is_array;
alter table artists add constraint artists_press_quotes_is_array
  check (jsonb_typeof(press_quotes) = 'array');
