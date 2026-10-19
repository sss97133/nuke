-- The live definition of public.sold_vehicle_proof as read from production on 2026-10-14 (pg_get_viewdef).
-- For the contract test only.
CREATE OR REPLACE VIEW public.sold_vehicle_proof AS
 SELECT ov.id AS org_vehicle_id,
    ov.vehicle_id,
    ov.organization_id,
    ov.listing_status,
    ov.sale_date,
    ov.sale_price,
    ov.relationship_type,
    ov.created_at AS marked_sold_at,
    ov.notes AS org_vehicle_notes,
    v.year,
    v.make,
    v.model,
    v.vin,
    COALESCE(el.listing_url, v.bat_auction_url, (te.metadata ->> 'bat_url'::text), v.discovery_url) AS proof_url,
    COALESCE(el.platform,
        CASE
            WHEN ((v.bat_auction_url IS NOT NULL) OR ((te.metadata ->> 'bat_url'::text) IS NOT NULL)) THEN 'bat'::text
            WHEN (v.discovery_url ~~ '%bringatrailer%'::text) THEN 'bat'::text
            WHEN (v.discovery_url ~~ '%carsandbids%'::text) THEN 'cars_and_bids'::text
            WHEN (v.discovery_url ~~ '%ebay%'::text) THEN 'ebay_motors'::text
            ELSE 'unknown'::text
        END) AS proof_platform,
    el.id AS external_listing_id,
    el.listing_status AS external_listing_status,
    el.final_price AS external_final_price,
    el.sold_at AS external_sold_at,
    el.end_date AS external_end_date,
    te.id AS timeline_event_id,
    te.event_date AS timeline_sale_date,
    te.title AS timeline_title,
    te.description AS timeline_description,
    te.cost_amount AS timeline_sale_price,
    (te.metadata ->> 'source'::text) AS timeline_source,
    (te.metadata ->> 'bat_url'::text) AS timeline_bat_url,
    (te.metadata ->> 'lot_number'::text) AS lot_number,
    ( SELECT json_agg(json_build_object('field', dv.field_name, 'value', dv.field_value, 'source', dv.validation_source, 'confidence', dv.confidence_score, 'url', dv.source_url)) AS json_agg
           FROM data_validations dv
          WHERE ((dv.entity_type = 'vehicle'::text) AND (dv.entity_id = ov.vehicle_id) AND (dv.field_name = ANY (ARRAY['sale_price'::text, 'sale_date'::text])) AND (dv.validation_source ~~ '%bat%'::text))) AS validation_proof,
        CASE
            WHEN (el.id IS NOT NULL) THEN 'external_listing'::text
            WHEN ((te.id IS NOT NULL) AND ((te.metadata ->> 'source'::text) = 'bat_import'::text)) THEN 'timeline_bat_import'::text
            WHEN (v.bat_auction_url IS NOT NULL) THEN 'vehicle_bat_url'::text
            WHEN (te.id IS NOT NULL) THEN 'timeline_event'::text
            WHEN ((ov.notes ~~ '%BaT%'::text) OR (ov.notes ~~ '%bringatrailer%'::text)) THEN 'notes_reference'::text
            ELSE 'manual_mark'::text
        END AS proof_type,
        CASE
            WHEN ((el.id IS NOT NULL) AND (el.listing_status = 'sold'::text) AND (el.final_price IS NOT NULL)) THEN 100
            WHEN ((te.id IS NOT NULL) AND ((te.metadata ->> 'source'::text) = 'bat_import'::text) AND (te.cost_amount IS NOT NULL)) THEN 90
            WHEN ((v.bat_auction_url IS NOT NULL) AND (ov.sale_price IS NOT NULL)) THEN 80
            WHEN ((te.id IS NOT NULL) AND (te.event_type = 'sale'::text)) THEN 70
            WHEN ((ov.notes ~~ '%BaT%'::text) OR (ov.notes ~~ '%bringatrailer%'::text)) THEN 60
            ELSE 50
        END AS proof_confidence
   FROM (((organization_vehicles ov
     JOIN vehicles v ON ((v.id = ov.vehicle_id)))
     LEFT JOIN external_listings el ON (((el.vehicle_id = ov.vehicle_id) AND (el.organization_id = ov.organization_id) AND (el.listing_status = 'sold'::text))))
     LEFT JOIN timeline_events te ON (((te.vehicle_id = ov.vehicle_id) AND (te.event_type = 'sale'::text))))
  WHERE (ov.listing_status = 'sold'::text);
