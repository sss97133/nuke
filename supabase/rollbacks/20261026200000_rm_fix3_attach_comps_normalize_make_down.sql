-- revert rm_fix3_v1_20261024
-- drop the (validated) check, restore the old URL-shaped lots, then re-add it NOT VALID (as after rm_fix2):
alter table public.vehicle_events drop constraint if exists vehicle_events_attach_lot_not_url;
update public.vehicle_events e set metadata = e.metadata || jsonb_build_object('attach_basis', k.old_attach_basis)
from public.backup_rm_fix3_v1_20261024_attach k where e.id=k.event_id and e.metadata->'attach_basis'->'lot_fix'->>'run_id'='rm_fix3_v1_20261024';
alter table public.vehicle_events add constraint vehicle_events_attach_lot_not_url check (((metadata->'attach_basis')->>'lot_number') is null or ((metadata->'attach_basis')->>'lot_number') !~* '(/|://|^www\.|\.(com|net|org|co\.uk)\M)') not valid;
create or replace view public.sale_price_basis_v1_comps as
SELECT s.event_id,
    s.platform,
    s.sale_date,
    b.basis,
    b.price_usd,
    s.confidence,
    s.fee_rule
   FROM (sale_price_basis_v1 s
     CROSS JOIN LATERAL ( VALUES ('gross'::text,s.gross_usd), ('hammer'::text,s.hammer_usd), ('net_to_owner'::text,s.net_to_owner_usd)) b(basis, price_usd))
  WHERE (b.price_usd IS NOT NULL);
CREATE OR REPLACE FUNCTION public.normalize_model(input_make text, input_model text, input_year integer DEFAULT NULL::integer)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_canonical TEXT;
  v_make_canonical TEXT;
  v_cleaned_model TEXT;
BEGIN
  -- First normalize the make
  v_make_canonical := normalize_make(input_make);
  
  -- Clean the model - remove locations
  v_cleaned_model := regexp_replace(input_model, '\s+(in\s+)?[A-Z][a-z]+,?\s*[A-Z]{0,2}\s*$', '', 'gi');
  v_cleaned_model := regexp_replace(v_cleaned_model, '\s+(Fort Worth|Commerce Twp|Lithia Springs|Minneapolis|Jackson|Michigan|California|Oregon|Illinois|Kansas|Georgia).*$', '', 'gi');
  v_cleaned_model := TRIM(v_cleaned_model);
  
  -- Look up canonical model using correct column names
  SELECT canonical_model INTO v_canonical
  FROM canonical_models
  WHERE make = v_make_canonical
    AND (
      v_cleaned_model = ANY(aliases)
      OR LOWER(v_cleaned_model) = LOWER(canonical_model)
      OR LOWER(v_cleaned_model) LIKE '%' || LOWER(canonical_model) || '%'
    )
    AND (input_year IS NULL OR input_year BETWEEN COALESCE(year_start, 1900) AND COALESCE(year_end, 2100))
  LIMIT 1;
  
  IF v_canonical IS NOT NULL THEN
    RETURN v_canonical;
  ELSE
    RETURN v_cleaned_model;
  END IF;
END;
$function$;
drop function if exists public.normalize_make(text, integer);
