-- Correct the note on the 2026-10-15 barrett-jackson census row: the landed lots (39,696 distinct http URLs) are
-- below the sitemap's 42,075, so the sitemap does not undercount; the claim written earlier was measured wrongly.
SET LOCAL statement_timeout = '30s';
UPDATE public.source_census c
SET census_notes = 'Distinct URLs in sitemap-vehicles.xml and sitemap-vehicles2.xml (56,700 listed, 42,075 distinct), fetched 2026-10-15. Automobilia sitemap excluded. Vehicle pages only; whether the archive of older sales is fully listed is unchecked.'
FROM public.observation_sources s
WHERE s.id = c.source_id AND s.slug = 'barrett-jackson' AND c.census_at = '2026-10-15 01:00:00+00';
