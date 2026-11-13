CREATE OR REPLACE FUNCTION public.get_all_assemblies_for_vehicle(p_vehicle_year integer, p_vehicle_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'assembly_name', assembly_name,
      'category', assembly_category,
      'description', assembly_description,
      'sub_components', sub_components,
      'possible_states', possible_states,
      'state_indicators', state_indicators
    )), '[]'::JSONB)
    FROM component_assembly_map
    WHERE (
      application_years IS NULL 
      OR p_vehicle_year BETWEEN 
        CAST(SPLIT_PART(application_years, '-', 1) AS INT) 
        AND CAST(SPLIT_PART(application_years, '-', 2) AS INT)
    )
    AND (
      application_models IS NULL 
      OR p_vehicle_model = ANY(application_models)
      OR p_vehicle_model ILIKE ANY(application_models)
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_assembly_context_for_ai(p_assembly_name text, p_vehicle_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_assembly RECORD;
  v_related_parts JSONB;
BEGIN
  -- Get assembly definition
  SELECT * INTO v_assembly
  FROM component_assembly_map
  WHERE assembly_name = p_assembly_name
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Get related catalog parts
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'part_number', part_number,
    'name', name,
    'price', price_current
  )), '[]'::JSONB) INTO v_related_parts
  FROM catalog_parts
  WHERE name ILIKE '%' || p_assembly_name || '%'
  LIMIT 50;
  
  RETURN jsonb_build_object(
    'assembly_name', v_assembly.assembly_name,
    'category', v_assembly.assembly_category,
    'description', v_assembly.assembly_description,
    'sub_components', v_assembly.sub_components,
    'possible_states', v_assembly.possible_states,
    'state_indicators', v_assembly.state_indicators,
    'related_catalog_parts', v_related_parts,
    'application', jsonb_build_object(
      'years', v_assembly.application_years,
      'models', v_assembly.application_models
    )
  );
END;
$function$
;
