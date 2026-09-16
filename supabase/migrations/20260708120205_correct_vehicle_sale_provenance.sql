-- DRAFT — NOT APPLIED. The .DRAFT suffix keeps this out of the migration runner.
-- Rename to 20260708HHMMSS_correct_vehicle_sale_provenance.sql only after Skylar signs off.
--
-- correct_vehicle_sale_provenance: the ONE sanctioned path to correct a vehicle's
-- SALE-DATE or PLATFORM field from a cited source (Class 3 substrate stabilization).
--
-- WHY (the convergence problem, same disease as correct_image_provenance):
-- The 2026-01/02 auction ingest runs stamped `sale_date = <ingest day>` (e.g.
-- 2026-02-25/26/27) over sales that actually happened 2006-2024. The real year is
-- embedded in the listing/discovery URL (e.g. barrett-jackson.com/scottsdale-2009).
-- 17,948 Barrett-Jackson rows are provably wrong this way; the same now()-default
-- also stamped ~2,700 BaT / 1,300 pcarmarket / 600 cars-and-bids rows. Separately,
-- ~1,058 rows carry a `canonical_platform` that names a different primary auction
-- house than the one in their own listing_url (e.g. a bringatrailer.com listing
-- labeled mecum). Every agent that hits one of these writes its own UPDATE — a new
-- fork each time. Agents converge on exactly one thing: a function they can find
-- and call. This is that function.
--
-- It is supersession-safe (the ORIGINAL value + the citation are preserved in
-- vehicles.provenance_metadata -> 'sale_provenance_corrections', recoverable
-- forever — nothing lost, per the trust invariant), and citation-required (refuses
-- a correction with no source document). The corrected value is the projection that
-- every time-windowed analysis (comps, market trends) reads.
--
-- This is the data/provenance layer — NOT the extraction pipeline. It corrects the
-- canonical projection columns on `vehicles`; it does NOT touch any testimony table
-- (vehicle_events / vehicle_observations / vehicle_images). Correcting a canonical
-- projection is not the same as overwriting testimony — the original projection is
-- superseded into provenance_metadata, and no observed row is mutated.
--
-- First batch target: the 17,948 BJ rows whose event-slug year (cited: the URL
-- itself) disagrees with the stamped sale_date year.

CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance(
  p_vehicle_ids uuid[],
  p_field       text,                 -- supported: 'sale_date' | 'canonical_platform'
  p_value       text,                 -- corrected value (cast per field)
  p_source      jsonb,                -- REQUIRED: the citing document {type,ref,extracted_year,...}
  p_asserted_by text DEFAULT 'agent',
  p_reason      text DEFAULT NULL     -- optional human note, e.g. 'ingest-day stamp over URL event year'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_veh       record;
  v_audit     jsonb;
  v_corrected int := 0;
  v_skipped   int := 0;
  v_original  text;
BEGIN
  -- 1. hard gates
  IF p_field NOT IN ('sale_date','canonical_platform') THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance: unsupported field % (supported: sale_date, canonical_platform)', p_field;
  END IF;
  IF p_source IS NULL OR p_source = '{}'::jsonb THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance: a source document (p_source) is required -- corrections must be cited, never guessed';
  END IF;
  -- for sale_date, require the citing source to carry the extracted year so the
  -- correction is self-auditing (the URL event year IS the citation for BJ).
  IF p_field = 'sale_date' AND (p_source ->> 'extracted_year') IS NULL AND (p_source ->> 'ref') IS NULL THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance: sale_date corrections must cite either an extracted_year or a ref URL';
  END IF;

  FOR v_veh IN
    SELECT id, sale_date, canonical_platform, provenance_metadata
    FROM vehicles WHERE id = ANY(p_vehicle_ids)
  LOOP
    v_original := CASE p_field
      WHEN 'sale_date' THEN v_veh.sale_date::text
      WHEN 'canonical_platform' THEN v_veh.canonical_platform
    END;

    -- idempotency: if the field already holds the corrected value, skip (no-op,
    -- no duplicate audit entry). Cast-compare for dates.
    IF (p_field = 'sale_date' AND v_veh.sale_date IS NOT DISTINCT FROM p_value::date)
       OR (p_field = 'canonical_platform' AND v_veh.canonical_platform IS NOT DISTINCT FROM p_value) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- 2. preserve the original + the citation (supersession; recoverable forever)
    v_audit := jsonb_build_object(
      'field', p_field,
      'original', v_original,
      'corrected', p_value,
      'source', p_source,
      'reason', p_reason,
      'asserted_by', p_asserted_by,
      'asserted_at', now());

    -- 3. apply the correction to the canonical projection + log the supersession.
    --    Only the targeted field is written; provenance_metadata append is universal.
    IF p_field = 'sale_date' THEN
      UPDATE vehicles SET
        sale_date = p_value::date,
        provenance_metadata = COALESCE(provenance_metadata,'{}'::jsonb) || jsonb_build_object(
          'sale_provenance_corrections',
            COALESCE(provenance_metadata->'sale_provenance_corrections','[]'::jsonb) || jsonb_build_array(v_audit))
      WHERE id = v_veh.id;
    ELSE  -- canonical_platform
      UPDATE vehicles SET
        canonical_platform = p_value,
        platform_source = COALESCE(p_source->>'ref','correct_vehicle_sale_provenance'),
        provenance_metadata = COALESCE(provenance_metadata,'{}'::jsonb) || jsonb_build_object(
          'sale_provenance_corrections',
            COALESCE(provenance_metadata->'sale_provenance_corrections','[]'::jsonb) || jsonb_build_array(v_audit))
      WHERE id = v_veh.id;
    END IF;

    v_corrected := v_corrected + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'field', p_field, 'value', p_value,
    'vehicles_corrected', v_corrected, 'vehicles_skipped_noop', v_skipped,
    'source', p_source, 'asserted_by', p_asserted_by);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.correct_vehicle_sale_provenance(uuid[],text,text,jsonb,text,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.correct_vehicle_sale_provenance(uuid[],text,text,jsonb,text,text) IS
  'Sanctioned vehicle sale-provenance correction chokepoint (Class 3). Supersedes sale_date or canonical_platform from a REQUIRED source document: preserves the original in vehicles.provenance_metadata.sale_provenance_corrections (nothing lost), updates the projection every time-windowed analysis reads, and records the citation. Every agent corrects sale dates/platforms through THIS, never a raw UPDATE -- so corrections converge instead of forking. Refuses an uncited correction. Does NOT touch any testimony table.';


-- =====================================================================
-- BATCH PASS (illustrative — RUN ONLY AFTER SIGN-OFF, in 1,000-row chunks
-- per db-safety.md). This is the query that feeds the chokepoint the BJ
-- backlog. It does NOT run at migration time; it is documented here so the
-- batch is reproducible and its selection logic is auditable.
-- =====================================================================
--
-- WITH bj AS (
--   SELECT id, sale_date,
--     coalesce(listing_url, discovery_url) AS src_url,
--     (regexp_match(coalesce(listing_url,discovery_url),'barrett-jackson\.com/([^/?]+)'))[1] AS slug
--   FROM vehicles
--   WHERE coalesce(listing_url,discovery_url) LIKE '%barrett-jackson.com%'
-- ),
-- bj2 AS (
--   SELECT id, sale_date, src_url,
--     CASE WHEN slug ~ '(19|20)\d\d'
--          THEN (regexp_match(slug,'((?:19|20)\d\d)'))[1]::int END AS ev_year
--   FROM bj
-- )
-- SELECT correct_vehicle_sale_provenance(
--   ARRAY[id],
--   'sale_date',
--   -- conservative: the URL proves the YEAR, not the exact day. Land it on the
--   -- event year's Jan-01 and record precision='year' in the source, OR (better)
--   -- resolve the exact auction date from the BJ event calendar keyed by the slug.
--   (ev_year::text || '-01-01'),
--   jsonb_build_object('type','listing_url','ref',src_url,'extracted_year',ev_year,
--                      'precision','year','detector','bj_event_slug_year'),
--   'substrate-stabilization-2026-07-08',
--   'ingest-day stamp over URL event year'
-- )
-- FROM bj2
-- WHERE ev_year IS NOT NULL
--   AND sale_date IS NOT NULL
--   AND extract(year FROM sale_date)::int <> ev_year
-- -- LIMIT 1000 per batch, pg_sleep(0.1) between batches.
-- ;
--
-- OPEN DECISION for Skylar: sale_date is a DATE (not just a year). The URL proves
-- only the event YEAR. Two options: (a) land on <year>-01-01 with precision='year'
-- in the citation (honest, coarse), or (b) join the BJ event slug (e.g.
-- 'scottsdale-2009', 'palm-beach-2018') to an event-date table to recover the real
-- auction day. (b) is the correct long-term answer; (a) is the immediate de-poison.


-- =====================================================================
-- INGEST GATE (sketch — NOT created here). The class stops growing only with
-- this. Proposed as a BEFORE INSERT/UPDATE trigger on vehicles: if the incoming
-- sale_date is within N days of now() AND the source URL embeds a conflicting
-- (older) year, reject the now()-default and either (i) set sale_date = NULL with
-- data_quality_flags += 'sale_date_defaulted_rejected', or (ii) derive from the
-- URL year. Left as a sketch because the trigger interacts with the existing
-- trg_resolve_canonical_columns and needs its own receipt + Skylar sign-off.
-- =====================================================================
