-- Aston Martin rows whose make was split at the first word, corrected through correct_vehicle_identity.
--
-- Measured 2026-11-13 through PostgREST as anon (vehicles, deleted_at IS NULL):
--   make = 'Aston'                                    60 rows, all created on or before 2026-10-16
--     (33 manual_entry 2026-07, 15 rmsothebys_import 2026-10-14/15, 7 url_scraper 2026-10-15/16, 5 facebook 2026-04/05);
--     59 carry the rest of the make at the head of model ('martin db4 gt zagato').
--   make = 'Aston Martin' AND model ILIKE 'martin %'  61 rows (57 created 2026-02), 'Martin' repeated in model.
--   make = 'Aston Martin'                             6,374 rows; 576 created after 2026-10-16, none of them split,
--     so the writers are no longer producing this and only the stored rows remain.
-- Consumer that fails: universal-search for "aston martin db4 gt zagato" (limit 100) does not return vehicle
-- d37c72b9-3186-4188-994b-8bb86fbd0f4e (RM Sotheby's MO26 lot r0024), and the make's inventory omits all 60.
-- The identity guard is fill-only, so a re-land with the right make is refused; these need the correction writer.
--
-- Rule, per row:
--   new make  = 'Aston Martin' (only where the stored make is exactly 'Aston').
--   new model = the words after "<year> Aston Martin" in the row's own title when the title has that shape,
--               otherwise the stored model without its leading 'martin'.
--   citation  = the row's title, or the slug of its listing URL, and only when that text reads "aston martin".
-- A row with no such citation is left as it is and counted (a Facebook row with no title, the Mecum lot whose own
-- title reads "2003 Aston DB7"). Prior values are kept in superseded_rows by the writer.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

DO $correct$
DECLARE
  r          record;
  receipt    jsonb;
  cite_type  text;
  cite_ref   text;
  cite_title text;
  slug       text;
  new_model  text;
  from_title text;
  n_done     integer := 0;
  n_nocite   integer := 0;
  n_other    integer := 0;
BEGIN
  FOR r IN
    SELECT v.id, v.year, v.make, v.model, v.title,
           coalesce(nullif(v.discovery_url, ''), nullif(v.listing_url, '')) AS url
      FROM public.vehicles v
     WHERE v.make IN ('Aston', 'Aston Martin')
       AND v.model ~* '^martin\s+\S'
       AND v.deleted_at IS NULL
     ORDER BY v.id
     LIMIT 500
  LOOP
    slug := (regexp_match(coalesce(r.url, ''), '([^/?#]+)/?(?:[?#].*)?$'))[1];
    IF lower(regexp_replace(coalesce(r.title, ''), '[^A-Za-z0-9]+', ' ', 'g')) LIKE '%aston martin%' THEN
      cite_type := 'vehicles.title'; cite_ref := r.id::text; cite_title := r.title;
    ELSIF lower(regexp_replace(coalesce(slug, ''), '[^A-Za-z0-9]+', ' ', 'g')) LIKE '%aston martin%' THEN
      cite_type := 'listing_url'; cite_ref := r.url; cite_title := slug;
    ELSE
      n_nocite := n_nocite + 1;
      RAISE NOTICE 'aston martin split: % left as is, no title or URL slug reads "aston martin"', r.id;
      CONTINUE;
    END IF;

    from_title := btrim((regexp_match(coalesce(r.title, ''), '^\s*(?:19|20)\d\d\s+aston[\s-]+martin\s+(\S.*)$', 'i'))[1]);
    IF from_title IS NOT NULL AND length(from_title) <= 80 AND from_title !~* '^martin\M' THEN
      new_model := from_title;
    ELSE
      new_model := btrim(regexp_replace(r.model, '^martin\s+', '', 'i'));
    END IF;

    BEGIN
      receipt := public.correct_vehicle_identity(
        r.id,
        jsonb_build_object('year', r.year, 'make', r.make, 'model', r.model),
        CASE WHEN r.make = 'Aston'
             THEN jsonb_build_object('make', 'Aston Martin', 'model', new_model)
             ELSE jsonb_build_object('model', new_model) END,
        jsonb_build_object('type', cite_type, 'ref', cite_ref, 'title', cite_title, 'url', r.url,
                           'asserted_by', 'migration:20261116247000'),
        'Make was split at its first word: the cited text reads "Aston Martin", stored as make/model with Martin in model');
      IF receipt ->> 'status' = 'corrected' THEN
        n_done := n_done + 1;
      ELSE
        n_other := n_other + 1;
        RAISE NOTICE 'aston martin split: % not corrected: %', r.id, receipt;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      n_other := n_other + 1;
      RAISE NOTICE 'aston martin split: % refused: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'aston martin split: corrected %, no citation %, refused or stale %', n_done, n_nocite, n_other;
  IF n_done = 0 THEN
    RAISE EXCEPTION 'aston martin split: no row was corrected (no citation %, refused %); read the notices above', n_nocite, n_other;
  END IF;
END $correct$;

COMMIT;
