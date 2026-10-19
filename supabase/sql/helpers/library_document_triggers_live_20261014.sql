-- Live on production 2026-10-14 (pg_get_functiondef): the three SECURITY INVOKER trigger functions on library_documents
-- that maintain oem_vehicle_specs, reference_libraries and reference_coverage, and their triggers (pg_get_triggerdef).
CREATE OR REPLACE FUNCTION public.link_document_to_specs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_library RECORD;
  v_spec_id UUID;
  v_model TEXT;
BEGIN
  SELECT * INTO v_library FROM reference_libraries WHERE id = NEW.library_id;

  SELECT id INTO v_spec_id
  FROM oem_vehicle_specs
  WHERE make ILIKE v_library.make
    AND ((year_start <= v_library.year AND (year_end IS NULL OR year_end >= v_library.year))
         OR year_start IS NULL)
    AND (series = v_library.series OR series IS NULL)
  LIMIT 1;

  -- Create OEM spec if doesn't exist
  IF v_spec_id IS NULL THEN
    -- Build model from series+body_style, fallback to reference_libraries.model
    v_model := NULLIF(TRIM(COALESCE(v_library.series, '') || ' ' || COALESCE(v_library.body_style, '')), '');
    IF v_model IS NULL OR v_model = '' THEN
      v_model := COALESCE(v_library.model, 'Unknown');
    END IF;

    INSERT INTO oem_vehicle_specs (
      make, model, year_start, series, body_style, source, notes
    ) VALUES (
      v_library.make,
      v_model,
      v_library.year,
      v_library.series,
      v_library.body_style,
      'Reference Library',
      'Auto-created from ' || NEW.title
    )
    RETURNING id INTO v_spec_id;
  END IF;

  -- Cross-link
  UPDATE reference_libraries SET oem_spec_id = v_spec_id WHERE id = NEW.library_id;
  UPDATE oem_vehicle_specs
  SET
    source_library_id = NEW.library_id,
    source_documents = array_append(COALESCE(source_documents, ARRAY[]::UUID[]), NEW.id),
    confidence_score = LEAST(95, 50 + (array_length(COALESCE(source_documents, ARRAY[]::UUID[]), 1) * 20))
  WHERE id = v_spec_id;

  RETURN NEW;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.trigger_update_library_stats()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reference_libraries
    SET 
      document_count = document_count + 1,
      updated_at = NOW()
    WHERE id = NEW.library_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE reference_libraries
    SET 
      document_count = GREATEST(0, document_count - 1),
      updated_at = NOW()
    WHERE id = OLD.library_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$

;
CREATE OR REPLACE FUNCTION public.update_coverage_on_upload()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_library RECORD;
  v_topic TEXT;
BEGIN
  -- Get library context
  SELECT * INTO v_library
  FROM reference_libraries
  WHERE id = NEW.library_id;
  
  -- Determine topic from document type
  v_topic := CASE
    WHEN NEW.document_type ILIKE '%assembly%manual%' OR NEW.document_type ILIKE '%body%' THEN 'body_panels'
    WHEN NEW.document_type ILIKE '%brochure%' OR NEW.document_type ILIKE '%sales%' THEN 'trim_packages'
    WHEN NEW.document_type ILIKE '%paint%' OR NEW.document_type ILIKE '%color%' THEN 'paint_codes'
    WHEN NEW.document_type ILIKE '%parts%catalog%' THEN 'body_panels'
    WHEN NEW.document_type ILIKE '%rpo%' OR NEW.document_type ILIKE '%option%' THEN 'trim_packages'
    ELSE 'general'
  END;
  
  -- Update coverage
  UPDATE reference_coverage
  SET available_documents = array_append(COALESCE(available_documents, ARRAY[]::UUID[]), NEW.id),
      coverage_status = CASE 
        WHEN coverage_status = 'missing' THEN 'partial'
        WHEN coverage_status = 'partial' AND coverage_percentage < 80 THEN 'partial'
        ELSE 'complete'
      END,
      coverage_percentage = LEAST(100, coverage_percentage + 20),
      last_assessed = NOW()
  WHERE make = v_library.make
    AND (model_family = v_library.series OR model_family IS NULL)
    AND v_library.year >= year_range_start
    AND v_library.year <= year_range_end
    AND topic = v_topic;
  
  RETURN NEW;
END;
$function$

;
CREATE TRIGGER trg_link_doc_to_specs AFTER INSERT ON public.library_documents FOR EACH ROW EXECUTE FUNCTION link_document_to_specs();
CREATE TRIGGER trg_update_coverage_on_upload AFTER INSERT ON public.library_documents FOR EACH ROW EXECUTE FUNCTION update_coverage_on_upload();
CREATE TRIGGER trg_update_library_doc_stats AFTER INSERT OR DELETE ON public.library_documents FOR EACH ROW EXECUTE FUNCTION trigger_update_library_stats();
