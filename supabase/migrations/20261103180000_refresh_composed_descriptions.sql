-- A description this writer composed (description_source composed_from_record) is recomposed whenever the vehicle's facts change, so a
-- reconciled sale price that moves is not left behind in the text. Template rows (description_source NULL) are still matched by shape.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.compose_vehicle_description(p_vehicle_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v vehicles%ROWTYPE; head text; loc text; parts text[] := '{}';
BEGIN
  SELECT * INTO v FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- the identity sentence(s) the template began with: year make model [series] [trim]
  head := regexp_replace(coalesce(v.description, ''), '\s*(listed at |Sold |Asking |[Ll]ocated in |sourced from |[0-9,]+ photos? on file).*$', '');
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
                  substring(v.description from '[Ll]ocated in ([^.]+)\.'));
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
         AND (x.description_source = 'composed_from_record'      -- text this writer made: recompose when the vehicle's facts change
              OR (x.description_source IS NULL AND x.description ~ '[0-9,]+ photos? on file\.$'
                  AND x.description ~ '(sourced from [^.]*\.|listed at \$[0-9,]+(\.[0-9]+)?\.|located in [^.]*\.) *[0-9,]+ photos? on file\.$|^[^.]*\.( [^.]* trim\.)? *[0-9,]+ photos? on file\.$'))
       LIMIT p_limit
    LOOP
      v_seen := v_seen + 1;
      v_new := compose_vehicle_description(r.id);
      CONTINUE WHEN v_new IS NULL OR v_new = r.description;
      v_changed := v_changed + 1;
      IF p_apply THEN
        UPDATE vehicles SET description = v_new, description_source = 'composed_from_record', description_generated_at = now(),
               provenance_metadata = jsonb_set(coalesce(provenance_metadata, '{}'::jsonb), '{description_composed}',
                 jsonb_build_object('original', coalesce(provenance_metadata->'description_composed'->>'original', r.description), 'at', now(), 'writer', 'refresh_template_descriptions'))
         WHERE id = r.id;
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('apply', p_apply, 'owners', coalesce(array_length(v_owners, 1), 0), 'template_rows_seen', v_seen, 'rewritten', v_changed);
END
$$;


COMMIT;
