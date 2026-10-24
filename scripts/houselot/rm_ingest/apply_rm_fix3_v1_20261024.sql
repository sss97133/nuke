-- rm_fix3_v1_20261024: (1) fix 30 older URL-as-lot attach records (agg_houselot v1/v4/v7), (2) keep non_vehicle_item out of
-- sale_price_basis_v1_comps, (3) normalize_make(text, integer year) routed through canonical_make_era_rules.
create table if not exists public.backup_rm_fix3_v1_20261024_attach(event_id uuid primary key, old_attach_basis jsonb, new_lot text, run_id text, backed_up_at timestamptz default now());
with ids as materialized (select event_id from backup_agg_houselot_v1_20261024 union select event_id from backup_agg_houselot_v4_20261024 union select event_id from backup_agg_houselot_v7_20261024),
b as materialized (select e.id, e.metadata->'attach_basis' ab from ids join public.vehicle_events e on e.id=ids.event_id
  where e.metadata->'attach_basis'->>'lot_number' ~* '(/|://|^www\.|\.(com|net|org|co\.uk)\M)')
insert into public.backup_rm_fix3_v1_20261024_attach(event_id, old_attach_basis, new_lot, run_id)
select b.id, b.ab, case when he.lot_number is not null and he.lot_number !~* '(/|://|^www\.|\.(com|net|org|co\.uk)\M)' and he.lot_number_source_url is not null then he.lot_number end, 'rm_fix3_v1_20261024'
from b left join public.vehicle_events he on he.id=(b.ab->>'cited_event_id')::uuid
on conflict (event_id) do nothing;

-- cited lot available: use the house event's cited lot_number
update public.vehicle_events e set metadata = e.metadata || jsonb_build_object('attach_basis', (e.metadata->'attach_basis') || jsonb_build_object(
  'lot_number', k.new_lot,
  'citation', 'barrett-jackson house lot '||k.new_lot||' '||he.source_url||' (lot read from '||he.lot_number_source_url||')',
  'lot_fix', jsonb_build_object('run_id','rm_fix3_v1_20261024','old_lot_number', k.old_attach_basis->>'lot_number')))
from public.backup_rm_fix3_v1_20261024_attach k join public.vehicle_events he on he.id=(k.old_attach_basis->>'cited_event_id')::uuid
where e.id=k.event_id and k.new_lot is not null and e.metadata->'attach_basis'->>'lot_number' ~* '(/|://|^www\.|\.(com|net|org|co\.uk)\M)';

-- no cited lot on the house event: the URL is a listing reference, not a lot; lot_number removed (null), URL kept
update public.vehicle_events e set metadata = e.metadata || jsonb_build_object('attach_basis', ((e.metadata->'attach_basis') - 'lot_number') || jsonb_build_object(
  'listing_ref', k.old_attach_basis->>'lot_number',
  'lot_fix', jsonb_build_object('run_id','rm_fix3_v1_20261024','old_lot_number', k.old_attach_basis->>'lot_number','note','house event has no cited lot_number; URL moved to listing_ref')))
from public.backup_rm_fix3_v1_20261024_attach k
where e.id=k.event_id and k.new_lot is null and e.metadata->'attach_basis'->>'lot_number' ~* '(/|://|^www\.|\.(com|net|org|co\.uk)\M)';

-- (2) comps view excludes non-vehicle items (sale_price_basis_v1 is a table; shadow_sale_prices untouched)
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
  WHERE (b.price_usd IS NOT NULL) AND (NOT (EXISTS ( SELECT 1 FROM (vehicle_events e JOIN vehicles v ON ((v.id = e.vehicle_id))) WHERE ((e.id = s.event_id) AND (v.listing_kind = 'non_vehicle_item'::text)))));

-- (3) year-aware normalize_make: era rules first, then the original lookup
create or replace function public.normalize_make(input_make text, input_year integer)
 returns text language plpgsql stable as $function$
declare r record;
begin
  if input_make is null or input_make = '' or input_year is null then return public.normalize_make(input_make); end if;
  select er.canonical_make_id, cm.canonical_name into r
    from public.canonical_make_era_rules er left join public.canonical_makes cm on cm.id = er.canonical_make_id
   where lower(er.make_text) = lower(trim(input_make))
     and (er.year_min is null or input_year >= er.year_min) and (er.year_max is null or input_year <= er.year_max)
   order by er.id limit 1;
  if found then
    if r.canonical_make_id is null then return input_make; end if;  -- rule says do not map
    return r.canonical_name;
  end if;
  return public.normalize_make(input_make);
end; $function$;
comment on function public.normalize_make(text, integer) is 'rm_fix3_v1_20261024: year-aware; applies canonical_make_era_rules before alias lookup';

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
  v_make_canonical := normalize_make(input_make, input_year);
  
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
