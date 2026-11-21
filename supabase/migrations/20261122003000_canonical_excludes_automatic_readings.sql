-- vehicle_canonical: automatic photo readings are provisional and are never canonical.
--
-- Why. The automatic photo reader writes provisional readings with agent_tier 'subscription automatic' (the tier
-- platform_config 'image_reading_tiers' names at config_value -> 'automatic' ->> 'tier', 20261120140000). An automatic
-- reading is not a fact until it is agreed. 20261121230000 made five functions ignore the tier through
-- public.image_reading_tier_is_automatic(); vehicle_canonical, which picks the best standing observation per vehicle and
-- registered property, had no tier test, so an automatic reading that carries a property_id could become the canonical
-- value and outrank a reviewed one.
--
-- After. The row source the view ranks (the ranked CTE) leaves out observations whose agent_tier is the automatic tier,
-- before ranking, so for the same vehicle and property the best remaining observation is canonical. Observations with
-- any other tier, and with no tier, rank exactly as before. Nothing else changes: the same columns in the same order with
-- the same types, no view options, the same owner, grants and comment (CREATE OR REPLACE VIEW keeps the relation, so
-- owner, grants, comment and dependent objects stay; the post-check proves it).
--
--   * The definition below is the live one, pg_get_viewdef read 2026-11-21 (what 20261030170900 left), with one
--     predicate added at the top level of the ranked CTE's WHERE, after (o.is_superseded = false):
--       AND (o.agent_tier IS DISTINCT FROM 'subscription automatic'::text)
--   * The tier is a literal, not image_reading_tier_is_automatic(): the view is read over many rows, and a per-row
--     function that reads config is the wrong cost. The guard refuses to apply when the config names a different tier
--     or has no row, and the post-check refuses a definition that does not carry the configured tier.
--   * Definition fingerprints: md5(pg_get_viewdef('public.vehicle_canonical'::regclass)), the plain (not pretty) form,
--     with search_path = public, which this file sets so the deploy session cannot change how names print (every
--     object the view names is in public or pg_catalog, so with public on the path none is schema-qualified; that is
--     also how the live definition printed through the default path "$user", public, extensions).
--       was     4637af91499a472f5a09f9a5f1eb09c2  (the live definition, read 2026-11-21)
--       becomes 4d1a2e57a880181691e5bd8eb0c30002  (the definition below, as PG17 prints it back)
--     The contract builds the view from the live text over tables with the live column types and gets the same 'was'
--     md5 as production, so the plain text is stable between the contract database and production; no normalised form
--     is needed.
--   * The guard refuses any definition other than 'was' or 'becomes' and changes nothing. On 'becomes' (a replay) the
--     replace restates the same definition and the fingerprints after are those before.
--   * Cost: one comparison on a column of the row being ranked.
--
-- Verify after the deploy run:
--   select md5(pg_get_viewdef('public.vehicle_canonical'::regclass)) -> 4d1a2e57a880181691e5bd8eb0c30002
--   select relkind, reloptions, relacl from pg_class where oid = 'public.vehicle_canonical'::regclass
--     -> v, null, the same acl as before
-- Contract: supabase/sql/test_canonical_excludes_automatic_readings.sql
-- Revert: supabase/sql/revert_20261122003000_canonical_excludes_automatic_readings.sql

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

DO $guard$
DECLARE
  v_tier text;
  v_md5 text;
BEGIN
  SELECT pc.config_value -> 'automatic' ->> 'tier' INTO v_tier
    FROM public.platform_config pc WHERE pc.config_key = 'image_reading_tiers';
  IF v_tier IS DISTINCT FROM 'subscription automatic' THEN
    RAISE EXCEPTION 'platform_config image_reading_tiers names the automatic tier %, not ''subscription automatic''; the view literal would disagree with the config',
      coalesce(quote_literal(v_tier), '(no row or no value)');
  END IF;
  IF (SELECT c.relkind FROM pg_class c WHERE c.oid = to_regclass('public.vehicle_canonical')) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'public.vehicle_canonical is not a view';
  END IF;
  v_md5 := md5(pg_get_viewdef('public.vehicle_canonical'::regclass));
  IF v_md5 NOT IN ('4637af91499a472f5a09f9a5f1eb09c2', '4d1a2e57a880181691e5bd8eb0c30002') THEN
    RAISE EXCEPTION 'public.vehicle_canonical is not the definition this migration was written from (md5 % of pg_get_viewdef, expected 4637af91499a472f5a09f9a5f1eb09c2); review the change before adding the tier predicate',
      v_md5;
  END IF;
  -- What the replace must leave as it was: owner, options, grants, comment, and the columns with their types and order.
  PERFORM set_config('canonical_tier.before',
    (SELECT concat_ws(E'\n', pg_get_userbyid(c.relowner), coalesce(c.reloptions::text, '-'), coalesce(c.relacl::text, '-'),
              coalesce(obj_description(c.oid, 'pg_class'), '-'),
              (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
       FROM pg_class c WHERE c.oid = 'public.vehicle_canonical'::regclass),
    true);
END $guard$;

CREATE OR REPLACE VIEW public.vehicle_canonical AS
 WITH ranked AS (
         SELECT o.vehicle_id,
            o.property_id,
            o.id AS observation_id,
            o.structured_data,
            o.content_text,
            o.confidence_score,
            o.observed_at,
            o.source_id,
            o.rank,
            o.kind,
            o.changeset_id,
            op.discriminator_key,
                CASE
                    WHEN (op.discriminator_key IS NOT NULL) THEN (o.structured_data ->> op.discriminator_key)
                    ELSE '__single__'::text
                END AS discriminator_value,
            row_number() OVER (PARTITION BY o.vehicle_id, o.property_id,
                CASE
                    WHEN (op.discriminator_key IS NOT NULL) THEN (o.structured_data ->> op.discriminator_key)
                    ELSE '__single__'::text
                END ORDER BY
                CASE (o.rank)::text
                    WHEN 'preferred'::text THEN 0
                    WHEN 'normal'::text THEN 1
                    WHEN 'deprecated'::text THEN 2
                    ELSE 3
                END, COALESCE(o.confidence_score, (0)::numeric) DESC, o.observed_at DESC) AS rn
           FROM (vehicle_observations o
             JOIN observation_properties op ON ((op.id = o.property_id)))
          WHERE ((o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'::text) AND (o.is_superseded = false)
            AND (o.agent_tier IS DISTINCT FROM 'subscription automatic'::text)
            AND ((o.source_observation_id IS NULL) OR (EXISTS ( SELECT
                   FROM (((vehicle_observations ip
                     JOIN observation_sources isp ON (((isp.id = ip.source_id) AND (isp.slug = 'bat'::text) AND ('specification'::observation_kind = ANY (isp.supported_observations)))))
                     JOIN vehicles iv ON (((iv.id = ip.vehicle_id) AND (iv.is_public IS TRUE) AND (iv.deleted_at IS NULL) AND (iv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text))))
                     JOIN observation_properties ir ON (((ir.id = o.property_id) AND (ir.property_key = (o.structured_data ->> 'property_key'::text)) AND (ir.property_key = ANY (ARRAY['make'::text, 'model'::text])) AND (ir.namespace = 'core'::text) AND (ir.label =
                        CASE ir.property_key
                            WHEN 'make'::text THEN 'Make'::text
                            ELSE 'Model'::text
                        END) AND (ir.data_type = 'string'::text) AND (ir.unit IS NULL) AND (ir.ratified_at IS NOT NULL) AND (ir.deprecated_at IS NULL) AND ('specification'::observation_kind = ANY (ir.applies_to_kinds)))))
                  WHERE ((ip.id = o.source_observation_id) AND observation_is_public(ip.kind, ip.structured_data) AND retained_description_identity_value_matches(ip.*, o.*)))) OR (EXISTS ( SELECT
                   FROM (((vehicle_observations yp
                     JOIN vehicles yv ON (((yv.id = yp.vehicle_id) AND (yv.is_public IS TRUE) AND (yv.deleted_at IS NULL) AND (yv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text))))
                     JOIN observation_sources ys ON (((ys.id = yp.source_id) AND (ys.slug = 'bat'::text) AND ('specification'::observation_kind = ANY (ys.supported_observations)))))
                     JOIN observation_properties yr ON (((yr.id = o.property_id) AND (yr.property_key = 'year'::text) AND (yr.namespace = 'core'::text) AND (yr.label = 'Model Year'::text) AND (yr.data_type = 'integer'::text) AND (yr.unit IS NULL) AND (yr.ratified_at IS NOT NULL) AND (yr.deprecated_at IS NULL) AND ('specification'::observation_kind = ANY (yr.applies_to_kinds)))))
                  WHERE ((yp.id = o.source_observation_id) AND observation_is_public(yp.kind, yp.structured_data) AND retained_description_year_value_matches(yp.*, o.*)))) OR (EXISTS ( SELECT
                   FROM (((vehicle_observations yp
                     JOIN vehicles yv ON (((yv.id = yp.vehicle_id) AND (yv.is_public IS TRUE) AND (yv.deleted_at IS NULL) AND (yv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text))))
                     JOIN observation_sources ys ON (((ys.id = yp.source_id) AND (ys.slug = 'craigslist'::text) AND ('listing'::observation_kind = ANY (ys.supported_observations)))))
                     JOIN observation_properties yr ON (((yr.id = o.property_id) AND (yr.property_key = 'year'::text) AND (yr.namespace = 'core'::text) AND (yr.label = 'Model Year'::text) AND (yr.data_type = 'integer'::text) AND (yr.unit IS NULL) AND (yr.ratified_at IS NOT NULL) AND (yr.deprecated_at IS NULL) AND ('listing'::observation_kind = ANY (yr.applies_to_kinds)))))
                  WHERE ((yp.id = o.source_observation_id) AND observation_is_public(yp.kind, yp.structured_data) AND retained_craigslist_year_value_matches(yp.*, o.*)))) OR (EXISTS ( SELECT
                   FROM (((vehicle_observations cp
                     JOIN vehicles cv ON (((cv.id = cp.vehicle_id) AND (cv.is_public IS TRUE) AND (cv.deleted_at IS NULL) AND (cv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text))))
                     JOIN observation_sources cs ON (((cs.id = cp.source_id) AND (cs.slug = 'craigslist'::text) AND ('listing'::observation_kind = ANY (cs.supported_observations)))))
                     JOIN observation_properties cr ON (((cr.id = o.property_id) AND (cr.property_key = 'mileage_miles'::text) AND (cr.namespace = 'core'::text) AND (cr.label = 'Odometer Reading (mi)'::text) AND (cr.unit = 'miles'::text) AND (cr.data_type = 'integer'::text) AND (cr.ratified_at IS NOT NULL) AND (cr.deprecated_at IS NULL) AND ('listing'::observation_kind = ANY (cr.applies_to_kinds)))))
                  WHERE ((cp.id = o.source_observation_id) AND observation_is_public(cp.kind, cp.structured_data) AND retained_craigslist_odometer_value_matches(cp.*, o.*)))) OR (EXISTS ( SELECT
                   FROM (((vehicle_observations dp
                     JOIN observation_sources ds ON (((ds.id = dp.source_id) AND ((ds.slug = 'bat'::text) OR ((ds.slug = 'mecum'::text) AND (dp.extraction_method = 'public_lot_index'::text)) OR retained_native_listing_source(dp.*)))))
                     JOIN vehicles dv ON (((dv.id = dp.vehicle_id) AND (dv.is_public IS TRUE) AND (dv.deleted_at IS NULL) AND (dv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text))))
                     JOIN observation_properties dr ON (((dr.id = o.property_id) AND (dr.property_key = (o.structured_data ->> 'property_key'::text)) AND (dr.namespace = 'core'::text) AND (dr.deprecated_at IS NULL))))
                  WHERE ((dp.id = o.source_observation_id) AND ((((o.kind)::text = ANY ((ds.supported_observations)::text[])) AND ((o.kind)::text = ANY ((dr.applies_to_kinds)::text[])) AND retained_description_property_value_matches(dp.*, o.*)) OR (('specification'::observation_kind = ANY (ds.supported_observations)) AND ('specification'::observation_kind = ANY (dr.applies_to_kinds)) AND (dr.ratified_at IS NOT NULL) AND (dr.unit IS NULL) AND (dr.data_type =
                        CASE
                            WHEN (dr.property_key = 'year'::text) THEN 'integer'::text
                            ELSE 'string'::text
                        END) AND (dr.label =
                        CASE dr.property_key
                            WHEN 'year'::text THEN 'Model Year'::text
                            WHEN 'make'::text THEN 'Make'::text
                            WHEN 'model'::text THEN 'Model'::text
                            ELSE 'VIN'::text
                        END) AND retained_listing_identity_value_matches(dp.*, o.*)))))) OR (EXISTS ( SELECT 1
                   FROM (((vehicle_observations rp
                     JOIN observation_sources rs ON (((rs.id = rp.source_id) AND ((rs.slug = 'bat'::text) OR retained_native_listing_source(rp.*)))))
                     JOIN vehicles rv ON (((rv.id = rp.vehicle_id) AND (rv.is_public IS TRUE) AND (rv.deleted_at IS NULL) AND (rv.listing_kind IS DISTINCT FROM 'non_vehicle_item'::text))))
                     JOIN observation_properties rk ON (((rk.id = o.property_id) AND (rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text, 'engine_configuration'::text, 'engine_displacement_l'::text, 'transmission_type'::text, 'drivetrain_layout'::text])) AND (rk.namespace = 'core'::text) AND (rk.deprecated_at IS NULL))))
                  WHERE ((rp.id = o.source_observation_id) AND (rp.id <> o.id) AND (rp.vehicle_id = o.vehicle_id) AND (rp.source_id = o.source_id) AND (rp.source_url = o.source_url) AND (rp.is_superseded IS FALSE) AND (rp.property_id IS NULL) AND (rp.subject_type = 'vehicle'::text) AND (rp.subject_id IS NULL) AND ((((rp.kind)::text = 'listing'::text) AND (rp.extraction_method = 'html_match'::text) AND (rp.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'::text)) OR retained_native_listing_source(rp.*)) AND (rp.confidence_score >= 0.6) AND (rp.confidence_score <= (1)::numeric) AND isfinite(rp.ingested_at) AND ((o.kind)::text = 'specification'::text) AND (o.extraction_method = 'retained_listing_property_projection_v1'::text) AND ((o.structured_data ->> 'source_observation_id'::text) = (rp.id)::text) AND ((o.structured_data -> rk.property_key) =
                        CASE
                            WHEN (rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text])) THEN (rp.structured_data ->
                            CASE rk.property_key
                                WHEN 'exterior_color'::text THEN 'color'::text
                                ELSE 'interior_color'::text
                            END)
                            ELSE retained_powertrain_value(rk.property_key, (rp.structured_data ->
                            CASE rk.property_key
                                WHEN 'transmission_type'::text THEN 'transmission'::text
                                WHEN 'drivetrain_layout'::text THEN 'drivetrain'::text
                                ELSE 'engine_size'::text
                            END))
                        END) AND ((rk.property_key = ANY (ARRAY['interior_color'::text, 'exterior_color'::text])) OR (((o.structured_data -> 'source_value'::text) = (rp.structured_data ->
                        CASE rk.property_key
                            WHEN 'transmission_type'::text THEN 'transmission'::text
                            WHEN 'drivetrain_layout'::text THEN 'drivetrain'::text
                            ELSE 'engine_size'::text
                        END)) AND ((o.structured_data ->> 'normalization_version'::text) = 'retained_powertrain_v1'::text))) AND ((o.structured_data ->> 'claim_role'::text) = 'listing_claim'::text) AND ((o.structured_data ->> 'observed_at_basis'::text) = 'source_testimony_recorded_at'::text) AND (o.observed_at = rp.ingested_at) AND (o.confidence_score >= (0)::numeric) AND (o.confidence_score <= 0.6))))) AND (o.property_id IS NOT NULL) AND ((o.rank)::text <> 'deprecated'::text))
        )
 SELECT vehicle_id,
    property_id,
    observation_id,
    structured_data,
    content_text,
    confidence_score,
    observed_at,
    source_id,
    kind,
    rank,
    changeset_id,
    discriminator_value
   FROM ranked
  WHERE (rn = 1);

DO $check$
DECLARE
  v_tier text;
  v_def text := pg_get_viewdef('public.vehicle_canonical'::regclass);
BEGIN
  SELECT pc.config_value -> 'automatic' ->> 'tier' INTO v_tier
    FROM public.platform_config pc WHERE pc.config_key = 'image_reading_tiers';
  IF md5(v_def) <> '4d1a2e57a880181691e5bd8eb0c30002' THEN
    RAISE EXCEPTION 'public.vehicle_canonical did not land as written (md5 % of pg_get_viewdef, expected 4d1a2e57a880181691e5bd8eb0c30002)', md5(v_def);
  END IF;
  IF strpos(v_def, '(o.agent_tier IS DISTINCT FROM ' || quote_literal(v_tier) || '::text)') = 0 THEN
    RAISE EXCEPTION 'public.vehicle_canonical does not leave out the automatic tier the config names';
  END IF;
  IF (SELECT concat_ws(E'\n', pg_get_userbyid(c.relowner), coalesce(c.reloptions::text, '-'), coalesce(c.relacl::text, '-'),
              coalesce(obj_description(c.oid, 'pg_class'), '-'),
              (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        FROM pg_class c WHERE c.oid = 'public.vehicle_canonical'::regclass) IS DISTINCT FROM current_setting('canonical_tier.before') THEN
    RAISE EXCEPTION 'public.vehicle_canonical changed owner, options, grants, comment or columns; only its row source was to change';
  END IF;
END $check$;

COMMIT;
