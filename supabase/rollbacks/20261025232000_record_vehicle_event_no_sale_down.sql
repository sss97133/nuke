-- Restore events changed by record_vehicle_event_no_sale from their own audit trail (last entry), then drop the function.
-- Vehicle corrections are reverted from vehicles.provenance_metadata.sale_provenance_corrections (asserted_by record_vehicle_event_no_sale).
-- update vehicle_events e set event_status = o->>'event_status', final_price = (o->>'final_price')::numeric, sold_at = (o->>'sold_at')::timestamptz,
--   ended_at = (o->>'ended_at')::timestamptz, price_kind = o->>'price_kind', price_kind_source = o->>'price_kind_source',
--   price_verification = o->>'price_verification', price_verification_source = o->>'price_verification_source',
--   price_verification_run_id = o->>'price_verification_run_id', price_verification_at = (o->>'price_verification_at')::timestamptz,
--   hammer_price = (o->>'hammer_price')::numeric, gross_price = (o->>'gross_price')::numeric,
--   buyer_premium_amount = (o->>'buyer_premium_amount')::numeric, net_to_owner = (o->>'net_to_owner')::numeric
-- from (select id, metadata->'no_sale_corrections'->-1->'original' o from vehicle_events where metadata ? 'no_sale_corrections') x where x.id = e.id;
DROP FUNCTION IF EXISTS public.record_vehicle_event_no_sale(uuid, text, numeric, text, text, date);
