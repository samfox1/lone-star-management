-- site_content.value NOT NULL: the editor deletes the row on a blank value (an
-- override is either set or absent — never a null row), so enforce that at the
-- column. This removes a preview/public divergence: get_public_site's
-- jsonb_object_agg would emit `key: null` for a null value, while getWorkingSite
-- filters nulls out — the two key→value folds disagreed only on null. With NOT
-- NULL the column can't hold null, so both paths produce the same object.
alter table public.site_content alter column value set not null;
