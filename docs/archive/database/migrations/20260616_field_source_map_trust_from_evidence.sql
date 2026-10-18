-- ============================================================
-- FIELD-PROVENANCE TRUST FROM EVIDENCE (completes the unify)
--
-- Doctrine: docs/library/intellectual/contemplations/habitus-and-the-exchange.md
--
-- The unify repointed vehicle_field_source_map onto observation_sources, but
-- keyed trust off vehicle_field_provenance.primary_source -- which is 99.8% the
-- constant 'system_update', so trust never resolved (true before the unify too).
--
-- The real, resolvable per-source trust lives in field_evidence.source_type
-- (publisher slugs like bat_listing -> bat, ~88% resolve to the registry).
-- This rederives the view's trust columns from the BEST field_evidence row for
-- each (vehicle, field): prefer accepted, then highest source_confidence,
-- normalize {slug}_listing -> slug, resolve veracity/consecration from
-- observation_sources. primary_source is also upgraded from the dead constant
-- to the actual winning source.
--
-- Perf: per-row LATERAL uses idx_field_evidence_field (vehicle_id, field_name)
-- -- same index/access pattern the existing evidence_trail subquery uses.
-- ============================================================

CREATE OR REPLACE VIEW vehicle_field_source_map AS
SELECT v.id AS vehicle_id,
    (((v.year || ' '::text) || v.make) || ' '::text) || v.model AS vehicle_identity,
    vfp.field_name,
    vfp.current_value,
    vfp.total_confidence,
        CASE
            WHEN vfp.total_confidence >= 90 THEN 'HIGH'::text
            WHEN vfp.total_confidence >= 70 THEN 'MEDIUM'::text
            WHEN vfp.total_confidence >= 50 THEN 'LOW'::text
            ELSE 'VERY_LOW'::text
        END AS confidence_rating,
    -- was vfp.primary_source (99.8% the constant 'system_update'); now the real winning source
    COALESCE(best.source_type, vfp.primary_source) AS primary_source,
    COALESCE(round(best.veracity * 100)::int, 50) AS primary_trust_level,
    COALESCE(best.display_name || ' (' || best.category || ')', 'unmapped source'::text) AS source_description,
    vfp.supporting_sources,
    vfp.factory_original_value,
        CASE
            WHEN vfp.modified_value IS NOT NULL THEN 'MODIFIED'::text
            WHEN vfp.factory_original_value IS NOT NULL AND vfp.current_value = vfp.factory_original_value THEN 'FACTORY_ORIGINAL'::text
            WHEN vfp.factory_original_value IS NULL THEN 'NO_VIN_DATA'::text
            ELSE 'UNKNOWN'::text
        END AS modification_status,
    vfp.modification_date,
    ( SELECT jsonb_agg(jsonb_build_object('source', field_evidence.source_type, 'value', field_evidence.proposed_value, 'confidence', field_evidence.source_confidence, 'status', field_evidence.status, 'context', "substring"(field_evidence.extraction_context, 1, 100)) ORDER BY field_evidence.source_confidence DESC) AS jsonb_agg
           FROM field_evidence
          WHERE field_evidence.vehicle_id = vfp.vehicle_id AND field_evidence.field_name = vfp.field_name) AS evidence_trail,
    vfp.last_verified_at,
    vfp.last_verified_by,
    round(best.veracity * 100)::int     AS primary_veracity,
    round(best.consecration * 100)::int AS primary_consecration
   FROM vehicle_field_provenance vfp
     JOIN vehicles v ON vfp.vehicle_id = v.id
     LEFT JOIN LATERAL (
       SELECT fe.source_type, os.display_name, os.category, os.veracity, os.consecration
       FROM field_evidence fe
       LEFT JOIN observation_sources os
         ON os.slug = replace(regexp_replace(lower(fe.source_type), '_listing$', ''), '_', '-')
       WHERE fe.vehicle_id = vfp.vehicle_id AND fe.field_name = vfp.field_name
       ORDER BY (fe.status = 'accepted') DESC, fe.source_confidence DESC NULLS LAST
       LIMIT 1
     ) best ON true;
