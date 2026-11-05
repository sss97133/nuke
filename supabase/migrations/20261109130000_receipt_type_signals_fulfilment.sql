-- receipt_type_signals: fulfilment words are not vehicle words, and Pontiac F-bodies are cars.
--
-- Measured 2026-11-05 on the first binder landed through land_document_pages (65 receipts on a 1973 Pontiac Firebird):
-- six were held type_gate_fail. Three because an O'Reilly line reads "DC or Hub Pickup" / "ordered from hub/DC for pickup"
-- (the truck regex matched "pickup"), one because a Classic Industries page is stamped "TRUCK FREIGHT", and two whose
-- vehicle hint "1973 Pontiac Firebird" counted for nothing because neither "pontiac" nor "firebird" was a car signal.
-- Now the fulfilment and shipping phrases are removed before the vehicle regexes run, "pontiac" is a make, and
-- firebird / trans am / f-body / gto / lemans / tempest are car words, with firebird and camaro as models. A page whose
-- category reads MOPAR on a Pontiac still fails, as it should. Contract: supabase/sql/test_receipt_type_signals.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.receipt_type_signals(r receipts)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  with raw as (select lower(concat_ws(' ',
      r.raw_json #>> '{data_v2,vehicle_hint}', r.raw_extraction #>> '{data,vehicle_hint}',
      r.raw_json #>> '{card_projection,vehicle_hint}', r.raw_extraction #>> '{vehicle,make}', r.raw_extraction #>> '{vehicle,model}',
      r.vendor_name, r.raw_extraction #>> '{data,notes}',
      (select string_agg(coalesce(description,'')||' '||coalesce(category,''),' ') from receipt_items i where i.receipt_id=r.id),
      (select string_agg(x->>'description',' ') from jsonb_array_elements(case when jsonb_typeof(r.raw_json#>'{data_v2,line_items}')='array' then r.raw_json#>'{data_v2,line_items}' else '[]' end) x)
    )) t),
  -- Fulfilment and shipping words are not vehicle words: "DC or Hub Pickup", "picked up", "TRUCK FREIGHT" held six Firebird
  -- receipts as trucks on 2026-11-05. They are removed before the vehicle regexes read the text.
  txt as (select regexp_replace(t, '\m(dc or hub pickup|hub pickup|store pickup|in-store pickup|for pickup|picked up|pickup fee|truck freight|freight truck|ltl freight)\M', ' ', 'g') t from raw)
  select jsonb_build_object(
    'makes', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['gm','pontiac','ford','porsche','honda','nissan','dodge','jeep','toyota','lexus']) m
       where t ~ case m when 'gm' then '\m(chevrolet|chevy|gmc|cheyenne|scottsdale|corvair)\M' when 'dodge' then '\m(dodge|mopar)\M' when 'toyota' then '\m(toyota|land cruiser)\M' else '\m'||m||'\M' end),
    'truck', (select t ~ '\m(lmc truck|truck|pickup|offroad|off-road|4x4|4wd|suburban|blazer|k5|k10|k20|k1500|k2500|c10|c20|squarebody|bronco|wrangler|cheyenne|scottsdale|transfer case|leaf spring)\M' from txt),
    'car', (select t ~ '\m(mustang|corvette|porsche|911|corvair|maxima|camaro|firebird|trans am|f-body|gto|lemans|tempest)\M' from txt),
    'models', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['mustang','corvette','bronco','suburban','blazer','corvair','wrangler','maxima','firebird','camaro']) m where t ~ ('\m'||m||'\M'))
  ) $function$
