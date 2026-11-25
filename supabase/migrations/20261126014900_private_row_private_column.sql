-- private_row_private_column_v1: a probe kind for values in a column anon or authenticated should not read.
--
-- WHY (ta-readers, 2026-11-26). observation_sources is being narrowed to 23 columns for anon and authenticated; until
-- then authenticated reads notes, trust_factors and species_evidence (internal). The lead wants a watch row per column
-- that reads exposed before the narrowing and 0 after. No kind fits: withheld_column samples only rows whose column anon
-- cannot select (nothing before the narrowing) and counts rows, not values.
--
-- WHAT. Kind 'private_column', direct read only (reader ''):
--   * sample: rows whose column holds a value (x.<col> IS NOT NULL), whatever the grants say today;
--   * read: count(x.<col>) over the sampled keys as each audience. A column the audience cannot select raises 42501,
--     which the assay already reads as denied, seen 0; rows the policies hide count 0; a NULL the reader is served
--     (a masking view or a column default) counts 0.
--   * label relation.column, so three columns of one table are three readings;
--   * a probe whose column is absent reads missing, as a missing relation or reader does.
--   private_row_probes: subject_kind CHECK gains private_column; reader_shape gains "private_column only with
--   reader '' and no reader_args".
-- The assay is patched by anchors, guarded: only over the body 20261125235500 left (prosrc md5 146b7575..., read live
-- 2026-11-26) or this one (marker).
-- TEST. supabase/sql/test_private_row_reader_private_column.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.private_row_probes DROP CONSTRAINT private_row_probes_subject_kind_check;
ALTER TABLE public.private_row_probes ADD CONSTRAINT private_row_probes_subject_kind_check
  CHECK (subject_kind = ANY (ARRAY['image', 'vehicle', 'user', 'flag', 'visibility', 'withheld_column', 'private_column']));
ALTER TABLE public.private_row_probes DROP CONSTRAINT IF EXISTS private_row_probes_private_column_shape;
ALTER TABLE public.private_row_probes ADD CONSTRAINT private_row_probes_private_column_shape
  CHECK (subject_kind <> 'private_column' OR (reader = '' AND reader_args IS NULL AND reader_ids IS NULL AND reader_tail IS NULL));

DO $patch$
DECLARE
  src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.assay_private_row_exposure()'::regprocedure);
  def text := pg_get_functiondef('public.assay_private_row_exposure()'::regprocedure);
  n int;
  a1 text := $a$    label := CASE WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;$a$;
  r1 text := $r$    -- private_row_private_column_v1: a column probe is labelled relation.column
    label := CASE WHEN p.subject_kind = 'private_column' THEN p.relation || '.' || p.subject_column
                  WHEN p.reader = '' THEN p.relation ELSE p.reader || '()' END;$r$;
  a2 text := $a$      WHEN 'withheld_column' THEN format($a$;
  r2 text := $r$      WHEN 'private_column' THEN format('x.%I IS NOT NULL', p.subject_column)
      WHEN 'withheld_column' THEN format($r$;
  a3 text := $a$    IF ktype IS NULL OR (p.reader <> '' AND NOT EXISTS ($a$;
  r3 text := $r$    IF ktype IS NULL
       OR (p.subject_kind = 'private_column' AND NOT EXISTS (
             SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', p.relation))
                                            AND a.attname = p.subject_column AND NOT a.attisdropped))
       OR (p.reader <> '' AND NOT EXISTS ($r$;
  a4 text := $a$            EXECUTE format('SELECT count(*) FROM public.%I x WHERE x.%I = ANY ($1::%s[])', p.relation, p.row_key, ktype)$a$;
  r4 text := $r$            EXECUTE format('SELECT count(%s) FROM public.%I x WHERE x.%I = ANY ($1::%s[])',
                           CASE WHEN p.subject_kind = 'private_column' THEN format('x.%I', p.subject_column) ELSE '*' END,
                           p.relation, p.row_key, ktype)$r$;
BEGIN
  IF position('private_row_private_column_v1' IN src) > 0 THEN RETURN; END IF;
  IF md5(src) <> '146b7575e2794b8892d083ac86e125f8' THEN
    RAISE EXCEPTION 'assay_private_row_exposure body drifted (prosrc md5 %), re-read before patching', md5(src);
  END IF;
  n := (length(def) - length(replace(def, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'private_column anchor 1: % matches', n; END IF;
  n := (length(def) - length(replace(def, a2, ''))) / length(a2);
  IF n <> 1 THEN RAISE EXCEPTION 'private_column anchor 2: % matches', n; END IF;
  n := (length(def) - length(replace(def, a3, ''))) / length(a3);
  IF n <> 1 THEN RAISE EXCEPTION 'private_column anchor 3: % matches', n; END IF;
  n := (length(def) - length(replace(def, a4, ''))) / length(a4);
  IF n <> 1 THEN RAISE EXCEPTION 'private_column anchor 4: % matches', n; END IF;
  EXECUTE replace(replace(replace(replace(def, a1, r1), a2, r2), a3, r3), a4, r4);
END
$patch$;

COMMIT;
