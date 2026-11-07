-- receipt_type_signals: capture the live definition (drift repair) — form chrome is not fitment.
--
-- Production held a hot-patched receipt_type_signals (applied directly, 2026-11-06) that no migration carried: on top of
-- 20261109130000 it removes a vendor form's printed category/department header ("CATEGORY: CA" + a MOPAR / FORD / GM box)
-- before the vehicle regexes read the text. That header held a FAC7001 Trans Am vent tube as Dodge on 2026-11-05 (receipt
-- b3556e03, visually checked 2026-11-06). This file reproduces the live body (read-only fetch 2026-11-07) so a rebuild from
-- migrations gives the same gate. receipt_type_gate, receipt_type_gate_sv and trigger trg_rvl_enforce /
-- receipt_vehicle_links_enforce were compared the same day and already equal their latest migrations (20261027010000,
-- 20261028005000): no change for them. Contract: supabase/sql/test_receipt_type_signals.sql.
-- Detector for future drift: scripts/ci/function-drift-check.mjs.
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
  -- A vendor form's printed category/department header (Classic Industries "CATEGORY: CA" + "MOPAR" box) is form chrome, not fitment:
  -- it held a FAC7001 Trans Am vent tube as Dodge on 2026-11-05 (receipt b3556e03, visually checked 2026-11-06).
  txt as (select regexp_replace(regexp_replace(t, '\m(dc or hub pickup|hub pickup|store pickup|in-store pickup|for pickup|picked up|pickup fee|truck freight|freight truck|ltl freight)\M', ' ', 'g'),
      '\mcategory:?\s*[a-z]{1,4}\s*[,;/]?\s*(mopar|ford|gm|chevy|chevrolet|pontiac|truck)\M', ' category ', 'g') t from raw)
  select jsonb_build_object(
    'makes', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['gm','pontiac','ford','porsche','honda','nissan','dodge','jeep','toyota','lexus']) m
       where t ~ case m when 'gm' then '\m(chevrolet|chevy|gmc|cheyenne|scottsdale|corvair)\M' when 'dodge' then '\m(dodge|mopar)\M' when 'toyota' then '\m(toyota|land cruiser)\M' else '\m'||m||'\M' end),
    'truck', (select t ~ '\m(lmc truck|truck|pickup|offroad|off-road|4x4|4wd|suburban|blazer|k5|k10|k20|k1500|k2500|c10|c20|squarebody|bronco|wrangler|cheyenne|scottsdale|transfer case|leaf spring)\M' from txt),
    'car', (select t ~ '\m(mustang|corvette|porsche|911|corvair|maxima|camaro|firebird|trans am|f-body|gto|lemans|tempest)\M' from txt),
    'models', (select coalesce(jsonb_agg(distinct m),'[]') from txt, unnest(array['mustang','corvette','bronco','suburban','blazer','corvair','wrangler','maxima','firebird','camaro']) m where t ~ ('\m'||m||'\M'))
  ) $function$;
