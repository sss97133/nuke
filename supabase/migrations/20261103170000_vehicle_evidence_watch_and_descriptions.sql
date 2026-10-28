-- Vehicle evidence job: watch + profile description from reconciled facts.
--
-- 1. The extractor and reconciler (scripts/books/vehicle_evidence.py, scripts/books/mail_attachments.py) read local files (PDFs under
--    ~/Documents, Mail.app attachments), so they run under launchd (scripts/books/ag.nuke.vehicle-evidence.plist), hourly, with an
--    incremental cursor. Each run lands a heartbeat cell (field job_heartbeat) through ingest_financial_evidence at most every 6 hours.
--    check_vehicle_evidence_job() is the DB-side watch: cron job watch-vehicle-evidence raises when the heartbeat is older than 14 hours, so
--    a stopped local job shows as failing in v_job_health instead of silently going quiet.
-- 2. The profile description. Rows written by the old fallback (scripts/vision-enrich-urlless-vehicles.mjs) read "... listed at $45,000.
--    located in X. sourced from user-submission. N photos on file." even after the books reconciled the sale. compose_vehicle_description()
--    builds the text from the vehicle's own fields (a sold car says sold, with the reconciled price and date; an internal source token is
--    never printed) and refresh_template_descriptions() rewrites only rows that still hold that template, keeping the before-image in
--    provenance_metadata.description_composed. Cron job refresh-template-descriptions runs it for every owner that has books.
-- No data is written by this migration itself.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.check_vehicle_evidence_job(p_max_age interval DEFAULT interval '14 hours')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_at timestamptz; v_val jsonb;
BEGIN
  SELECT (e.value_normalized->>'at')::timestamptz, e.value_normalized INTO v_at, v_val
    FROM financial_document_extractions e
   WHERE e.field_key = 'job_heartbeat' AND NOT e.is_superseded AND e.value_normalized->>'job' = 'vehicle-evidence'
   ORDER BY (e.value_normalized->>'at')::timestamptz DESC LIMIT 1;
  IF v_at IS NULL OR v_at < now() - p_max_age THEN
    RAISE EXCEPTION 'vehicle-evidence local job has not reported since % (limit %)', coalesce(v_at::text, 'never'), p_max_age;
  END IF;
  RETURN jsonb_build_object('last_heartbeat', v_at, 'last_run', v_val - 'job');
END
$$;

CREATE OR REPLACE FUNCTION public.compose_vehicle_description(p_vehicle_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles%ROWTYPE; head text; loc text; parts text[] := '{}';
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- the identity sentence(s) the template began with: year make model [series] [trim]
  head := regexp_replace(coalesce(v.description, ''), '\s*(listed at \$[\d,]+(\.\d+)?\.|located in .*|sourced from .*|[\d,]+ photos? on file\.)\s*$', '');
  head := regexp_replace(head, '\s*(listed at \$[\d,]+(\.\d+)?\.)', '');
  IF head = '' THEN
    head := btrim(concat_ws(' ', v.year::text, v.make, v.model)) || '.';
  END IF;
  parts := parts || btrim(head);
  IF v.sale_status = 'sold' AND v.sale_price IS NOT NULL THEN
    parts := parts || ('Sold' || CASE WHEN v.sale_date IS NOT NULL THEN ' ' || to_char(v.sale_date, 'Mon YYYY') ELSE '' END
                       || ' for $' || trim(to_char(v.sale_price, 'FM999,999,999')) || '.');
  ELSIF v.sale_status IN ('for_sale', 'available', 'listed') AND v.asking_price IS NOT NULL THEN
    parts := parts || ('Asking $' || trim(to_char(v.asking_price, 'FM999,999,999')) || '.');
  END IF;
  loc := coalesce(nullif(btrim(concat_ws(', ', nullif(v.city, ''), nullif(v.state, ''))), ''),
                  substring(v.description from 'located in ([^.]+)\.'));
  IF loc IS NOT NULL THEN parts := parts || ('Located in ' || loc || '.'); END IF;
  IF coalesce(v.image_count, 0) > 0 THEN
    parts := parts || (v.image_count || CASE WHEN v.image_count = 1 THEN ' photo' ELSE ' photos' END || ' on file.');
  END IF;
  RETURN array_to_string(parts, ' ');
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_template_descriptions(p_owner_id uuid DEFAULT NULL, p_apply boolean DEFAULT false, p_limit integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_new text; v_seen int := 0; v_changed int := 0; o uuid; v_owners uuid[];
BEGIN
  v_owners := CASE WHEN p_owner_id IS NOT NULL THEN ARRAY[p_owner_id]
                   ELSE ARRAY(SELECT DISTINCT d.owner_id FROM financial_documents d) END;
  FOREACH o IN ARRAY v_owners LOOP
    FOR r IN
      SELECT x.id, x.description FROM vehicles x
       WHERE (x.owner_id = o OR x.user_id = o OR x.uploaded_by = o) AND x.deleted_at IS NULL AND x.merged_into_vehicle_id IS NULL
         AND x.description ~ '[0-9,]+ photos? on file\.$'
         AND x.description ~ '(sourced from [^.]*\.|listed at \$[0-9,]+(\.[0-9]+)?\.|located in [^.]*\.) *[0-9,]+ photos? on file\.$|^[^.]*\.( [^.]* trim\.)? *[0-9,]+ photos? on file\.$'
         AND (x.description_source IS NULL OR x.description_source IN ('template', 'composed_from_record'))
       LIMIT p_limit
    LOOP
      v_seen := v_seen + 1;
      v_new := compose_vehicle_description(r.id);
      CONTINUE WHEN v_new IS NULL OR v_new = r.description;
      v_changed := v_changed + 1;
      IF p_apply THEN
        UPDATE vehicles SET description = v_new, description_source = 'composed_from_record', description_generated_at = now(),
               provenance_metadata = jsonb_set(coalesce(provenance_metadata, '{}'::jsonb), '{description_composed}',
                 jsonb_build_object('original', r.description, 'at', now(), 'writer', 'refresh_template_descriptions'))
         WHERE id = r.id;
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('apply', p_apply, 'owners', coalesce(array_length(v_owners, 1), 0), 'template_rows_seen', v_seen, 'rewritten', v_changed);
END
$$;

REVOKE ALL ON FUNCTION public.check_vehicle_evidence_job(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compose_vehicle_description(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_template_descriptions(uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_vehicle_evidence_job(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.compose_vehicle_description(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_template_descriptions(uuid, boolean, integer) TO service_role;
COMMENT ON FUNCTION public.check_vehicle_evidence_job(interval) IS
  'Raises when the local vehicle-evidence launchd job has not reported a heartbeat cell within the interval; cron watch-vehicle-evidence runs it so v_job_health shows a stopped job.';
COMMENT ON FUNCTION public.compose_vehicle_description(uuid) IS
  'Profile description from the vehicle''s own fields: identity, sold price and date when sold, location, photo count. Never prints an internal source token.';
COMMENT ON FUNCTION public.refresh_template_descriptions(uuid, boolean, integer) IS
  'Rewrites descriptions that still hold the old fallback template (listed at / sourced from / N photos on file) using compose_vehicle_description; keeps the original in provenance_metadata.description_composed. Dry run unless p_apply.';

SELECT cron.schedule('watch-vehicle-evidence', '23 * * * *', $c$set statement_timeout = '10s'; select public.check_vehicle_evidence_job()$c$);
SELECT cron.schedule('refresh-template-descriptions', '19,49 * * * *',
  $c$set statement_timeout = '55s'; select public.refresh_template_descriptions(null, true, 300)$c$);

COMMIT;
