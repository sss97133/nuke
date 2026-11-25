-- library_document_corrections_v1: a library document's catalogue fields are corrected by a cited row, never edited.
--
-- WHY. library_documents rows come from inserts by the manual scripts and have no correction path: 4 rows
-- (dedada6b, f4496746, b9910657, cd9a64cb; 292 chunks each, identical pages) are catalogued as a 1978 light truck
-- manual while their own foreword says they are a motor home chassis manual. A wrong title or year misleads every
-- reader of the library and every rule cited to it (vehicle_decode_rule_proposals cites these documents).
--
-- ROWS. library_document_corrections: one row per (document, field) correction, with the old and new value, the
-- chunk of the same document that shows the true value (basis_chunk_id), a note, and who corrected it. A newer
-- correction of the same field supersedes the older (superseded_by / superseded_at); nothing is deleted.
-- is_factory_original = true needs the page that carries the document's current publisher correction, and that publisher
-- must name the make of the document's library (reference_libraries.make); false needs no witness.
-- field 'duplicate_of' is the duplicate edge: duplicate_of_document_id names the survivor; the duplicate stays.
--
-- WRITER. library_document_correct(...) is the only writer (no table write grant to any API role). It refuses a
-- correction the basis chunk does not show: a title whose words are not all in the chunk, a year or publisher /
-- edition / part number not printed in it, a duplicate edge whose survivor lacks the identical chunk at the same page
-- or holds a different number of chunks.
--
-- READERS. library_documents_current (security_invoker) is library_documents with the current correction of each
-- field laid over it, plus duplicate_of. The five readers that read library_documents (get_manual_pages_for_field,
-- get_vehicle_library_docs, get_vehicle_references, search_document_chunks, search_service_manual_chunks) read the view
-- instead; search_service_manual_chunks also leaves out a duplicate's chunks unless that document is asked for by id.
-- Contract: supabase/sql/test_library_document_corrections.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.library_document_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.library_documents (id),
  field text NOT NULL CHECK (field IN ('title', 'document_type', 'year_published', 'year_range_start', 'year_range_end',
                                       'publisher', 'edition', 'part_number', 'is_factory_original', 'duplicate_of')),
  old_value jsonb,
  new_value jsonb,
  duplicate_of_document_id uuid REFERENCES public.library_documents (id),
  basis_chunk_id uuid NOT NULL REFERENCES public.service_manual_chunks (id),
  basis_page integer,
  basis_note text NOT NULL CHECK (length(btrim(basis_note)) >= 12),
  corrected_by text NOT NULL CHECK (corrected_by ~ '^(agent|job):[a-z0-9_.-]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES public.library_document_corrections (id) DEFERRABLE INITIALLY DEFERRED,
  superseded_at timestamptz,
  CHECK ((superseded_by IS NULL) = (superseded_at IS NULL)),
  CHECK ((field = 'duplicate_of') = (duplicate_of_document_id IS NOT NULL)),
  CHECK (duplicate_of_document_id IS DISTINCT FROM document_id),
  CHECK (field = 'duplicate_of' OR new_value IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS library_document_corrections_current
  ON public.library_document_corrections (document_id, field) WHERE superseded_at IS NULL;
ALTER TABLE public.library_document_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_document_corrections_read ON public.library_document_corrections;
-- a correction is visible exactly when its document is (library_documents' own row level security decides)
CREATE POLICY library_document_corrections_read ON public.library_document_corrections FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.library_documents d WHERE d.id = library_document_corrections.document_id));
REVOKE ALL ON public.library_document_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.library_document_corrections TO anon, authenticated, service_role;
COMMENT ON TABLE public.library_document_corrections IS
  'library_document_corrections_v1: a cited correction of one catalogue field of a library document (or a duplicate_of edge to a survivor). Written only by library_document_correct; read through library_documents_current.';

-- The catalogue with current corrections laid over it ------------------------------------------------------------------
CREATE OR REPLACE VIEW public.library_documents_current WITH (security_invoker = true) AS
SELECT d.id, d.library_id, coalesce(c.document_type, d.document_type) AS document_type, coalesce(c.title, d.title) AS title,
       d.description, d.file_url, d.thumbnail_url, d.file_size_bytes, d.page_count, d.mime_type,
       coalesce(c.year_published, d.year_published) AS year_published,
       coalesce(c.year_range_start, d.year_range_start) AS year_range_start,
       coalesce(c.year_range_end, d.year_range_end) AS year_range_end,
       coalesce(c.publisher, d.publisher) AS publisher, coalesce(c.part_number, d.part_number) AS part_number, d.language,
       coalesce(c.edition, d.edition) AS edition, d.tags,
       coalesce(c.is_factory_original, d.is_factory_original) AS is_factory_original,
       d.is_verified, d.quality_rating, d.view_count, d.download_count, d.bookmark_count, d.uploaded_by, d.uploaded_at,
       d.verified_by, d.verified_at, d.created_at, d.updated_at, d.uploader_type, d.uploader_org_id, d.metadata,
       c.duplicate_of, c.n > 0 AS corrected
  FROM public.library_documents d
  CROSS JOIN LATERAL (
    SELECT max(x.new_value #>> '{}') FILTER (WHERE x.field = 'title') AS title,
           max(x.new_value #>> '{}') FILTER (WHERE x.field = 'document_type') AS document_type,
           (max(x.new_value #>> '{}') FILTER (WHERE x.field = 'year_published'))::int AS year_published,
           (max(x.new_value #>> '{}') FILTER (WHERE x.field = 'year_range_start'))::int AS year_range_start,
           (max(x.new_value #>> '{}') FILTER (WHERE x.field = 'year_range_end'))::int AS year_range_end,
           max(x.new_value #>> '{}') FILTER (WHERE x.field = 'publisher') AS publisher,
           max(x.new_value #>> '{}') FILTER (WHERE x.field = 'edition') AS edition,
           max(x.new_value #>> '{}') FILTER (WHERE x.field = 'part_number') AS part_number,
           (max(x.new_value #>> '{}') FILTER (WHERE x.field = 'is_factory_original'))::boolean AS is_factory_original,
           (max(x.duplicate_of_document_id::text) FILTER (WHERE x.field = 'duplicate_of'))::uuid AS duplicate_of,
           count(*) AS n
      FROM public.library_document_corrections x
     WHERE x.document_id = d.id AND x.superseded_at IS NULL) c;
GRANT SELECT ON public.library_documents_current TO anon, authenticated, service_role;
COMMENT ON VIEW public.library_documents_current IS
  'library_document_corrections_v1: library_documents with each field''s current cited correction applied, plus duplicate_of (the survivor) and corrected.';

-- The writer --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.library_document_correct(
  p_document uuid, p_field text, p_new_value jsonb, p_basis_chunk uuid, p_basis_note text, p_corrected_by text,
  p_duplicate_of uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $f$
DECLARE
  d public.library_documents%ROWTYPE;
  c public.service_manual_chunks%ROWTYPE;
  page text;
  cur public.library_document_corrections%ROWTYPE;
  v_old jsonb; v_new jsonb := p_new_value; v_id uuid := gen_random_uuid(); w text;
BEGIN
  SELECT * INTO d FROM public.library_documents WHERE id = p_document FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'library_document_correct: no document %', p_document; END IF;
  SELECT * INTO c FROM public.service_manual_chunks WHERE id = p_basis_chunk;
  IF NOT FOUND OR c.document_id <> p_document THEN
    RAISE EXCEPTION 'library_document_correct: basis chunk % is not a page of document %', p_basis_chunk, p_document; END IF;
  page := ' ' || regexp_replace(upper(c.content), '[^A-Z0-9]+', ' ', 'g') || ' ';

  IF p_field = 'title' THEN
    IF jsonb_typeof(v_new) <> 'string' OR length(btrim(v_new #>> '{}')) = 0 THEN RAISE EXCEPTION 'title must be a non-empty string'; END IF;
    FOR w IN SELECT m[1] FROM regexp_matches(upper(v_new #>> '{}'), '([A-Z0-9]{3,})', 'g') m LOOP
      IF position(' ' || w || ' ' IN page) = 0 THEN
        RAISE EXCEPTION 'library_document_correct: title word % is not printed on the basis page', w; END IF;
    END LOOP;
  ELSIF p_field IN ('year_published', 'year_range_start', 'year_range_end') THEN
    IF jsonb_typeof(v_new) <> 'number' OR (v_new #>> '{}') !~ '^(19|20)[0-9]{2}$' THEN RAISE EXCEPTION '% must be a year', p_field; END IF;
    IF position(' ' || (v_new #>> '{}') || ' ' IN page) = 0 THEN
      RAISE EXCEPTION 'library_document_correct: year % is not printed on the basis page', v_new #>> '{}'; END IF;
  ELSIF p_field IN ('publisher', 'edition', 'part_number') THEN
    IF jsonb_typeof(v_new) <> 'string' OR length(btrim(v_new #>> '{}')) = 0 THEN RAISE EXCEPTION '% must be a non-empty string', p_field; END IF;
    IF position(' ' || btrim(regexp_replace(upper(v_new #>> '{}'), '[^A-Z0-9]+', ' ', 'g')) || ' ' IN page) = 0 THEN
      RAISE EXCEPTION 'library_document_correct: % is not printed on the basis page', p_field; END IF;
  ELSIF p_field = 'document_type' THEN
    IF jsonb_typeof(v_new) <> 'string' OR NOT EXISTS (SELECT 1 FROM public.library_documents WHERE document_type = v_new #>> '{}') THEN
      RAISE EXCEPTION 'document_type must be one already in the library'; END IF;
  ELSIF p_field = 'is_factory_original' THEN
    IF jsonb_typeof(v_new) <> 'boolean' THEN RAISE EXCEPTION 'is_factory_original must be a boolean'; END IF;
    -- true is witnessed by the document's own page printing its publisher, and that publisher naming the make of the
    -- document's library (a manufacturer's division prints its make; a reprint house does not). false needs no witness.
    IF v_new = 'true'::jsonb THEN
      SELECT x.new_value #>> '{}' INTO w FROM public.library_document_corrections x
       WHERE x.document_id = p_document AND x.field = 'publisher' AND x.superseded_at IS NULL AND x.basis_chunk_id = p_basis_chunk;
      IF w IS NULL THEN
        RAISE EXCEPTION 'library_document_correct: is_factory_original true needs a current publisher correction cited to the same page'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.reference_libraries rl
                      WHERE rl.id = d.library_id AND length(btrim(coalesce(rl.make, ''))) > 0
                        AND position(' ' || btrim(regexp_replace(upper(rl.make), '[^A-Z0-9]+', ' ', 'g')) || ' '
                                     IN ' ' || regexp_replace(upper(w), '[^A-Z0-9]+', ' ', 'g') || ' ') > 0) THEN
        RAISE EXCEPTION 'library_document_correct: publisher % does not name the make of the document''s library', w; END IF;
    END IF;
  ELSIF p_field = 'duplicate_of' THEN
    IF p_duplicate_of IS NULL OR p_duplicate_of = p_document THEN RAISE EXCEPTION 'duplicate_of needs another document'; END IF;
    IF EXISTS (SELECT 1 FROM public.library_document_corrections
                WHERE document_id = p_duplicate_of AND field = 'duplicate_of' AND superseded_at IS NULL) THEN
      RAISE EXCEPTION 'library_document_correct: survivor % is itself a duplicate', p_duplicate_of; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.service_manual_chunks s
                    WHERE s.document_id = p_duplicate_of AND s.page_number IS NOT DISTINCT FROM c.page_number AND s.content = c.content)
       OR (SELECT count(*) FROM public.service_manual_chunks WHERE document_id = p_duplicate_of)
          <> (SELECT count(*) FROM public.service_manual_chunks WHERE document_id = p_document) THEN
      RAISE EXCEPTION 'library_document_correct: % does not hold the same pages as %', p_duplicate_of, p_document; END IF;
    v_new := to_jsonb(p_duplicate_of::text);
  ELSE
    RAISE EXCEPTION 'library_document_correct: field % cannot be corrected', p_field;
  END IF;

  SELECT * INTO cur FROM public.library_document_corrections
   WHERE document_id = p_document AND field = p_field AND superseded_at IS NULL FOR UPDATE;
  v_old := CASE WHEN cur.id IS NOT NULL THEN cur.new_value
                WHEN p_field = 'duplicate_of' THEN NULL ELSE to_jsonb(d) -> p_field END;
  IF v_old IS NOT DISTINCT FROM v_new THEN RAISE EXCEPTION 'library_document_correct: % already reads that value', p_field; END IF;

  IF cur.id IS NOT NULL THEN
    UPDATE public.library_document_corrections SET superseded_at = now(), superseded_by = v_id WHERE id = cur.id;
  END IF;
  INSERT INTO public.library_document_corrections (id, document_id, field, old_value, new_value, duplicate_of_document_id,
                                                   basis_chunk_id, basis_page, basis_note, corrected_by)
  VALUES (v_id, p_document, p_field, v_old, v_new, CASE WHEN p_field = 'duplicate_of' THEN p_duplicate_of END,
          p_basis_chunk, c.page_number, p_basis_note, p_corrected_by);
  RETURN v_id;
END $f$;
REVOKE ALL ON FUNCTION public.library_document_correct(uuid, text, jsonb, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.library_document_correct(uuid, text, jsonb, uuid, text, text, uuid) TO service_role;

-- Readers read the corrected catalogue -----------------------------------------------------------------------------------
DO $patch$
DECLARE f text; d text; n int;
  a text := 'library_documents ld';
  dup_a text := '(p_document_id IS NULL OR smc.document_id = p_document_id)';
  dup_r text := E'(p_document_id IS NULL OR smc.document_id = p_document_id)\n    AND (ld.duplicate_of IS NULL OR smc.document_id = p_document_id) -- library_document_corrections_v1';
BEGIN
  FOREACH f IN ARRAY ARRAY['get_manual_pages_for_field', 'get_vehicle_library_docs', 'get_vehicle_references',
                           'search_document_chunks', 'search_service_manual_chunks'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f;
    IF d IS NULL THEN RAISE EXCEPTION '% not found', f; END IF;
    IF position('library_documents_current' IN d) > 0 THEN CONTINUE; END IF;
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    IF n <> 1 THEN RAISE EXCEPTION '%: % reads of library_documents ld, expected 1', f, n; END IF;
    d := replace(d, a, 'public.library_documents_current ld');
    IF f = 'search_service_manual_chunks' THEN
      n := (length(d) - length(replace(d, dup_a, ''))) / length(dup_a);
      IF n <> 1 THEN RAISE EXCEPTION 'search_service_manual_chunks: document filter anchor drifted (% matches)', n; END IF;
      d := replace(d, dup_a, dup_r);
    END IF;
    EXECUTE d;
  END LOOP;
END $patch$;
