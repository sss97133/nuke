-- Fixture for disposable PG17 contracts: public.vehicle_canonical exactly as production defines it on 2026-11-21
-- (pg_get_viewdef read-only; md5 of pg_get_viewdef(oid) 4637af91499a472f5a09f9a5f1eb09c2, the definition
-- 20261030170900_reconnect_archived_description_properties.sql left), over tables carrying every column the view reads
-- with its live type, plus platform_config (live columns).
-- Include helpers/vehicle_observations_rls_fixture.sql first (roles, observation_kind, vehicles, observation_sources,
-- vehicle_observations, observation_is_public as production has it). This file adds the rest.
-- The eight retained_* functions the view calls have their live signatures and return types, so the view deparses as
-- it does in production, but they are stubbed: the view calls them only for an observation with a
-- source_observation_id, and a contract that needs them installs the real ones (fixtures/retained_*).
-- Owner, options and comment are production's (owned by the session user, no options). The grants are a contract
-- role's, enough for a contract to prove that a replace leaves the view's grants as they were.
CREATE TYPE public.vfc_rank AS ENUM ('preferred', 'normal', 'deprecated');
ALTER TYPE public.observation_kind ADD VALUE IF NOT EXISTS 'contributor_answer';
ALTER TABLE public.vehicles ADD COLUMN listing_kind text;
ALTER TABLE public.observation_sources ADD COLUMN supported_observations public.observation_kind[];
ALTER TABLE public.vehicle_observations
  ADD COLUMN ingested_at timestamptz DEFAULT now(),
  ADD COLUMN confidence_score numeric(3,2),
  ADD COLUMN agent_tier text,
  ADD COLUMN rank public.vfc_rank DEFAULT 'normal',
  ADD COLUMN changeset_id uuid,
  ADD COLUMN property_id uuid,
  ADD COLUMN source_observation_id uuid;
CREATE TABLE public.observation_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text NOT NULL, namespace text NOT NULL DEFAULT 'core',
  label text, data_type text, unit text, applies_to_kinds public.observation_kind[], discriminator_key text,
  ratified_at timestamptz, deprecated_at timestamptz);
CREATE TABLE IF NOT EXISTS public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text NOT NULL UNIQUE,
  config_value jsonb NOT NULL, description text, updated_at timestamptz DEFAULT now(), updated_by uuid);

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['retained_description_identity_value_matches', 'retained_description_year_value_matches',
    'retained_craigslist_year_value_matches', 'retained_craigslist_odometer_value_matches',
    'retained_description_property_value_matches', 'retained_listing_identity_value_matches'] LOOP
    EXECUTE format('CREATE FUNCTION public.%I(p public.vehicle_observations, o public.vehicle_observations) RETURNS boolean '
                   'LANGUAGE sql STABLE AS $fn$ SELECT false $fn$', f);
  END LOOP;
END $$;
CREATE FUNCTION public.retained_native_listing_source(p public.vehicle_observations) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.retained_powertrain_value(p_key text, p_raw jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::jsonb $$;

-- The live text, as pg_get_viewdef printed it.
CREATE VIEW public.vehicle_canonical AS
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
          WHERE ((o.extraction_method IS DISTINCT FROM 'garage_owner_correction_v1'::text) AND (o.is_superseded = false) AND ((o.source_observation_id IS NULL) OR (EXISTS ( SELECT
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

COMMENT ON VIEW public.vehicle_canonical IS 'AX-012: projection of current value per (vehicle_id, property_id, discriminator_value). Single-cardinality and time-ordered-multi properties: discriminator_value = ''__single__'' (one row per property). Simultaneously-distinct multi (e.g. wire_*): discriminator_value carries the per-claim key from structured_data → observation_properties.discriminator_key. Highest rank → confidence → most recent wins.';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_canonical_grantee') THEN
    CREATE ROLE dm_contract_canonical_grantee NOLOGIN;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehicle_canonical TO dm_contract_canonical_grantee;
