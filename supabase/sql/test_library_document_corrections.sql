-- Disposable PG17 contract for 20261125124500_library_document_corrections. Synthetic rows only; the five reader
-- functions are the live definitions of 2026-11-25.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $r$;
CREATE TABLE public.library_documents (id uuid, library_id uuid, document_type text, title text, description text, file_url text, thumbnail_url text, file_size_bytes bigint, page_count integer, mime_type text, year_published integer, year_range_start integer, year_range_end integer, publisher text, part_number text, language text, edition text, tags text[], is_factory_original boolean, is_verified boolean, quality_rating integer, view_count integer, download_count integer, bookmark_count integer, uploaded_by uuid, uploaded_at timestamp with time zone, verified_by uuid, verified_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, uploader_type text, uploader_org_id uuid, metadata jsonb, PRIMARY KEY (id));
CREATE TABLE public.reference_libraries (id uuid PRIMARY KEY, year int, make text, model text);
INSERT INTO public.reference_libraries VALUES ('e0000000-0000-0000-0000-00000000000a', 1978, 'Chevrolet', 'C10');
CREATE TABLE public.service_manual_chunks (id uuid PRIMARY KEY, document_id uuid REFERENCES public.library_documents (id),
  page_number int, section_name text, section_heading text, content text, content_type text, key_topics text[]);
GRANT SELECT ON public.library_documents, public.service_manual_chunks TO anon;
CREATE OR REPLACE FUNCTION public.get_manual_pages_for_field(p_vehicle_id uuid, p_field_name text)
 RETURNS TABLE(page_id uuid, catalog_name text, page_number integer, image_url text, topics text[], relevance_score integer)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  required_topics_arr TEXT[];
  optional_topics_arr TEXT[];
BEGIN
  -- Get required topics for this field
  SELECT required_topics, COALESCE(optional_topics, ARRAY[]::TEXT[])
  INTO required_topics_arr, optional_topics_arr
  FROM vehicle_field_validators 
  WHERE field_name = p_field_name 
  LIMIT 1;
  
  IF required_topics_arr IS NULL THEN
    RETURN; -- No validators defined
  END IF;
  
  -- Return ALL indexed brochures (year-agnostic for now - all squarebodies)
  RETURN QUERY
  SELECT 
    ld.id as page_id,
    COALESCE(ld.title, 'Reference Page') as catalog_name,
    1 as page_number,
    ld.file_url as image_url,
    ARRAY(SELECT jsonb_array_elements_text(ld.metadata->'indexed_topics'))::TEXT[] as topics,
    CASE 
      WHEN (ld.metadata->'indexed_topics')::jsonb ?| required_topics_arr THEN 100
      WHEN (ld.metadata->'indexed_topics')::jsonb ?| optional_topics_arr THEN 75
      ELSE 50
    END as relevance_score
  FROM library_documents ld
  WHERE ld.document_type = 'brochure'
  AND ld.metadata->'indexed_topics' IS NOT NULL
  AND (ld.metadata->'indexed_topics')::jsonb ?| (required_topics_arr || optional_topics_arr)
  ORDER BY relevance_score DESC
  LIMIT 5;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vehicle_library_docs(p_vehicle_id uuid)
 RETURNS TABLE(doc_id uuid, doc_type text, title text, file_url text, page_count integer, contributor_name text, org_name text, uploaded_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ld.id,
    ld.document_type,
    ld.title,
    ld.file_url,
    ld.page_count,
    COALESCE(p.full_name, p.username, 'Anonymous') as contributor_name,
    b.business_name as org_name,
    ld.uploaded_at
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  JOIN vehicle_library_links vll ON vll.library_id = rl.id
  LEFT JOIN profiles p ON p.id = ld.uploaded_by
  LEFT JOIN businesses b ON b.id = ld.uploader_org_id
  WHERE vll.vehicle_id = p_vehicle_id
  ORDER BY ld.uploaded_at DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vehicle_references(p_vehicle_id uuid)
 RETURNS TABLE(document_id uuid, document_title text, document_type text, page_count integer)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    ld.id,
    ld.title,
    ld.document_type,
    ld.page_count
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  JOIN vehicle_library_links vll ON vll.library_id = rl.id
  WHERE vll.vehicle_id = p_vehicle_id
  ORDER BY ld.is_factory_original DESC, ld.uploaded_at DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.search_document_chunks(p_query text, p_document_type text DEFAULT NULL::text, p_document_id uuid DEFAULT NULL::uuid, p_brand text DEFAULT NULL::text, p_material_category text DEFAULT NULL::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, document_id uuid, document_type text, document_title text, page_number integer, section_name text, section_heading text, content text, content_type text, key_topics text[], product_name text, product_code text, brand text, color_code text, mixing_ratio jsonb, application_method text, material_category text, compatibility text[], relevance_score real)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id,
    dc.document_id,
    dc.document_type,
    ld.title as document_title,
    dc.page_number,
    dc.section_name,
    dc.section_heading,
    dc.content,
    dc.content_type,
    dc.key_topics,
    dc.product_name,
    dc.product_code,
    dc.brand,
    dc.color_code,
    dc.mixing_ratio,
    dc.application_method,
    dc.material_category,
    dc.compatibility,
    ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', p_query)) as relevance_score
  FROM document_chunks dc
  JOIN library_documents ld ON dc.document_id = ld.id
  WHERE 
    (p_document_type IS NULL OR dc.document_type = p_document_type)
    AND (p_document_id IS NULL OR dc.document_id = p_document_id)
    AND (p_brand IS NULL OR dc.brand ILIKE '%' || p_brand || '%')
    AND (p_material_category IS NULL OR dc.material_category = p_material_category)
    AND (
      to_tsvector('english', dc.content) @@ plainto_tsquery('english', p_query)
      OR dc.key_topics && string_to_array(lower(p_query), ' ')
      OR (dc.product_name IS NOT NULL AND dc.product_name ILIKE '%' || p_query || '%')
      OR (dc.product_code IS NOT NULL AND dc.product_code ILIKE '%' || p_query || '%')
    )
  ORDER BY relevance_score DESC, dc.page_number
  LIMIT p_limit;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.search_service_manual_chunks(p_query text, p_document_id uuid DEFAULT NULL::uuid, p_section_name text DEFAULT NULL::text, p_content_type text DEFAULT NULL::text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, document_id uuid, document_title text, page_number integer, section_name text, section_heading text, content text, content_type text, key_topics text[], relevance_score real)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    smc.id,
    smc.document_id,
    ld.title as document_title,
    smc.page_number,
    smc.section_name,
    smc.section_heading,
    smc.content,
    smc.content_type,
    smc.key_topics,
    ts_rank(to_tsvector('english', smc.content), plainto_tsquery('english', p_query)) as relevance_score
  FROM service_manual_chunks smc
  JOIN library_documents ld ON smc.document_id = ld.id
  WHERE 
    (p_document_id IS NULL OR smc.document_id = p_document_id)
    AND (p_section_name IS NULL OR smc.section_name = p_section_name)
    AND (p_content_type IS NULL OR smc.content_type = p_content_type)
    AND (
      to_tsvector('english', smc.content) @@ plainto_tsquery('english', p_query)
      OR smc.key_topics && string_to_array(lower(p_query), ' ')
    )
  ORDER BY relevance_score DESC, smc.page_number
  LIMIT p_limit;
END;
$function$
;

INSERT INTO public.library_documents (id, library_id, title, document_type, is_factory_original) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', '1978 Light Truck Service Manual', 'service_manual', false),
  ('d0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000a', '1978 Light Truck Service Manual', 'service_manual', true),
  ('d0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000a', 'Other manual', 'service_manual', true);
INSERT INTO public.service_manual_chunks (id, document_id, page_number, content) VALUES
  ('c0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-00000000000a', 2,
   E'FOREWORD This manual has been developed to provide service\ninformation for the Chevrolet motor home chassis.'),
  ('c0000000-0000-0000-0000-0000000000a3', 'd0000000-0000-0000-0000-00000000000a', 3, 'Printed in 1991. Brake bleeding procedure.'),
  ('c0000000-0000-0000-0000-0000000000b2', 'd0000000-0000-0000-0000-00000000000b', 2,
   E'FOREWORD This manual has been developed to provide service\ninformation for the Chevrolet motor home chassis.'),
  ('c0000000-0000-0000-0000-0000000000b3', 'd0000000-0000-0000-0000-00000000000b', 3, 'Printed in 1991. Brake bleeding procedure.'),
  ('c0000000-0000-0000-0000-0000000000c2', 'd0000000-0000-0000-0000-00000000000c', 2,
   E'FOREWORD This manual has been developed to provide service\ninformation for the Chevrolet motor home chassis.'),
  ('c0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-00000000000a', 1,
   E'SERVICE MANUAL\nCHEVROLET MOTOR DIVISION\nGENERAL MOTORS CORPORATION'),
  ('c0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-00000000000b', 1,
   E'SERVICE MANUAL\nCHEVROLET MOTOR DIVISION\nGENERAL MOTORS CORPORATION'),
  ('c0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-00000000000c', 1,
   E'REPRINTED BY HELM INCORPORATED\nFROM THE CHEVROLET ORIGINAL');

\ir ../migrations/20261125124500_library_document_corrections.sql
\ir ../migrations/20261125124500_library_document_corrections.sql
SET client_min_messages = warning;

DO $t$
DECLARE A uuid := 'd0000000-0000-0000-0000-00000000000a'; B uuid := 'd0000000-0000-0000-0000-00000000000b';
        C uuid := 'd0000000-0000-0000-0000-00000000000c'; k1 uuid; k2 uuid; n int; ok boolean;
BEGIN
  -- the view is the table until a correction lands
  IF (SELECT count(*) FROM public.library_documents_current) <> 3
     OR EXISTS (SELECT 1 FROM public.library_documents_current WHERE corrected OR duplicate_of IS NOT NULL
                   OR title <> '1978 Light Truck Service Manual' AND id <> C) THEN RAISE EXCEPTION 'view differs before corrections'; END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname IN ('get_manual_pages_for_field', 'get_vehicle_library_docs', 'get_vehicle_references',
        'search_document_chunks', 'search_service_manual_chunks') AND prosrc LIKE '%library_documents_current ld%') <> 5 THEN
    RAISE EXCEPTION 'not every reader reads the corrected view'; END IF;

  -- refused: a word not on the basis page; a basis page of another document; a year not printed; a non-factory type
  BEGIN PERFORM public.library_document_correct(A, 'title', '"Chevrolet Motor Home Chassis Service Manual 1978"',
                  'c0000000-0000-0000-0000-0000000000a2', 'foreword names the chassis', 'agent:ta-facts');
        RAISE EXCEPTION 'unprinted title word admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unprinted title word admitted' THEN RAISE; END IF; END;
  BEGIN PERFORM public.library_document_correct(A, 'title', '"Chevrolet Motor Home Chassis Service Manual"',
                  'c0000000-0000-0000-0000-0000000000b2', 'foreword names the chassis', 'agent:ta-facts');
        RAISE EXCEPTION 'foreign basis admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'foreign basis admitted' THEN RAISE; END IF; END;
  BEGIN PERFORM public.library_document_correct(A, 'year_published', '1988',
                  'c0000000-0000-0000-0000-0000000000a3', 'printing line on page three', 'agent:ta-facts');
        RAISE EXCEPTION 'unprinted year admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unprinted year admitted' THEN RAISE; END IF; END;

  -- the title correction, read back through the view and the manual search
  k1 := public.library_document_correct(A, 'title', '"Chevrolet Motor Home Chassis Service Manual"',
          'c0000000-0000-0000-0000-0000000000a2', 'foreword names the chassis', 'agent:ta-facts');
  IF (SELECT title FROM public.library_documents_current WHERE id = A) <> 'Chevrolet Motor Home Chassis Service Manual' THEN
    RAISE EXCEPTION 'view does not show the correction'; END IF;
  IF (SELECT title FROM public.library_documents WHERE id = A) <> '1978 Light Truck Service Manual' THEN RAISE EXCEPTION 'base row edited'; END IF;
  IF (SELECT old_value #>> '{}' FROM public.library_document_corrections WHERE id = k1) <> '1978 Light Truck Service Manual' THEN
    RAISE EXCEPTION 'old value not kept'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search_service_manual_chunks('brake', A) WHERE document_title = 'Chevrolet Motor Home Chassis Service Manual') THEN
    RAISE EXCEPTION 'manual search does not read the corrected title'; END IF;

  -- a second title correction supersedes the first; the same value again is refused
  k2 := public.library_document_correct(A, 'title', '"Chevrolet Motor Home Chassis Manual"',
          'c0000000-0000-0000-0000-0000000000a2', 'shorter form of the foreword', 'agent:ta-facts');
  IF NOT EXISTS (SELECT 1 FROM public.library_document_corrections WHERE id = k1 AND superseded_by = k2 AND superseded_at IS NOT NULL)
     OR (SELECT old_value #>> '{}' FROM public.library_document_corrections WHERE id = k2) <> 'Chevrolet Motor Home Chassis Service Manual'
     OR (SELECT count(*) FROM public.library_document_corrections WHERE document_id = A AND field = 'title' AND superseded_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'supersession wrong'; END IF;
  BEGIN PERFORM public.library_document_correct(A, 'title', '"Chevrolet Motor Home Chassis Manual"',
                  'c0000000-0000-0000-0000-0000000000a2', 'shorter form of the foreword', 'agent:ta-facts');
        RAISE EXCEPTION 'no-op admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'no-op admitted' THEN RAISE; END IF; END;

  -- printed year and factory flag
  PERFORM public.library_document_correct(A, 'year_published', '1991', 'c0000000-0000-0000-0000-0000000000a3', 'printing line on page three', 'agent:ta-facts');
  PERFORM public.library_document_correct(C, 'is_factory_original', 'false', 'c0000000-0000-0000-0000-0000000000c2', 'reprint, no GM part number', 'agent:ta-facts');
  IF (SELECT year_published FROM public.library_documents_current WHERE id = A) <> 1991
     OR (SELECT is_factory_original FROM public.library_documents_current WHERE id = C) IS NOT FALSE THEN RAISE EXCEPTION 'typed fields wrong'; END IF;

  -- duplicate edge: refused when the pages differ (C has fewer); accepted for identical pages; survivor cannot be a duplicate
  BEGIN PERFORM public.library_document_correct(C, 'duplicate_of', NULL, 'c0000000-0000-0000-0000-0000000000c2', 'same foreword text', 'agent:ta-facts', A);
        RAISE EXCEPTION 'unequal duplicate admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unequal duplicate admitted' THEN RAISE; END IF; END;
  PERFORM public.library_document_correct(B, 'duplicate_of', NULL, 'c0000000-0000-0000-0000-0000000000b2', 'same 2 pages, same text', 'agent:ta-facts', A);
  IF (SELECT duplicate_of FROM public.library_documents_current WHERE id = B) IS DISTINCT FROM A THEN RAISE EXCEPTION 'duplicate edge not read'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.library_documents WHERE id = B) THEN RAISE EXCEPTION 'duplicate removed'; END IF;
  BEGIN PERFORM public.library_document_correct(A, 'duplicate_of', NULL, 'c0000000-0000-0000-0000-0000000000a2', 'same 2 pages, same text', 'agent:ta-facts', B);
        RAISE EXCEPTION 'duplicate survivor admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'duplicate survivor admitted' THEN RAISE; END IF; END;
  SELECT count(*) INTO n FROM public.search_service_manual_chunks('brake');
  IF n <> 1 THEN RAISE EXCEPTION 'search returns duplicate pages: %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.search_service_manual_chunks('brake', B)) THEN RAISE EXCEPTION 'duplicate unreadable by id'; END IF;

  -- factory flag: true needs the page carrying the current publisher, and that publisher naming the library's make
  BEGIN PERFORM public.library_document_correct(A, 'is_factory_original', 'true', 'c0000000-0000-0000-0000-0000000000a1', 'title page prints the division', 'agent:ta-facts');
        RAISE EXCEPTION 'factory flag without publisher admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'factory flag without publisher admitted' THEN RAISE; END IF; END;
  PERFORM public.library_document_correct(A, 'publisher', '"Chevrolet Motor Division"', 'c0000000-0000-0000-0000-0000000000a1', 'title page prints the division', 'agent:ta-facts');
  BEGIN PERFORM public.library_document_correct(A, 'is_factory_original', 'true', 'c0000000-0000-0000-0000-0000000000a2', 'foreword names the make', 'agent:ta-facts');
        RAISE EXCEPTION 'factory flag cited to another page admitted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'factory flag cited to another page admitted' THEN RAISE; END IF; END;
  PERFORM public.library_document_correct(A, 'is_factory_original', 'true', 'c0000000-0000-0000-0000-0000000000a1', 'title page prints the division', 'agent:ta-facts');
  IF (SELECT is_factory_original FROM public.library_documents_current WHERE id = A) IS NOT TRUE THEN RAISE EXCEPTION 'factory witness not read'; END IF;
  PERFORM public.library_document_correct(C, 'publisher', '"Helm Incorporated"', 'c0000000-0000-0000-0000-0000000000c1', 'title page prints the reprinter', 'agent:ta-facts');
  BEGIN PERFORM public.library_document_correct(C, 'is_factory_original', 'true', 'c0000000-0000-0000-0000-0000000000c1', 'title page prints the reprinter', 'agent:ta-facts');
        RAISE EXCEPTION 'reprint publisher admitted as factory';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'reprint publisher admitted as factory' THEN RAISE; END IF; END;

  -- only the writer writes
  IF has_function_privilege('anon', 'public.library_document_correct(uuid,text,jsonb,uuid,text,text,uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.library_document_correct(uuid,text,jsonb,uuid,text,text,uuid)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.library_document_correct(uuid,text,jsonb,uuid,text,text,uuid)', 'execute')
     OR has_table_privilege('service_role', 'public.library_document_corrections', 'insert')
     OR has_table_privilege('anon', 'public.library_document_corrections', 'update')
     OR NOT has_table_privilege('anon', 'public.library_documents_current', 'select') THEN RAISE EXCEPTION 'grants wrong'; END IF;
END $t$;

SET ROLE anon;
DO $a$ BEGIN
  IF (SELECT title FROM public.library_documents_current WHERE id = 'd0000000-0000-0000-0000-00000000000a') <> 'Chevrolet Motor Home Chassis Manual' THEN
    RAISE EXCEPTION 'anon does not read the correction'; END IF;
END $a$;
RESET ROLE;
\echo library_document_corrections: ok
