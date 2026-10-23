-- Revert of 20261023230000_document_pages.sql: restores capture_sets_build, then drops the new objects.
SET lock_timeout = '5s';
SET statement_timeout = '120s';
CREATE OR REPLACE FUNCTION public.capture_sets_build(p_user uuid, p_gap_s integer DEFAULT 480, p_radius_m numeric DEFAULT 100, p_oncar_conf numeric DEFAULT NULL::numeric, p_doc_conf numeric DEFAULT NULL::numeric)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, n integer, image_ids uuid[], unlinked_ids uuid[], filed_vehicle_ids uuid[], vin_keys text[], anchors jsonb, decision text, target_vehicle_id uuid, proposed_vin text, confidence numeric, reasons text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '170s'
AS $function$
DECLARE
  v_oncar numeric := coalesce(p_oncar_conf, 0.95);
  v_doc   numeric := coalesce(p_doc_conf, 0.80);
BEGIN
  RETURN QUERY
  WITH p AS MATERIALIZED (
    SELECT vi.id, vi.taken_at, vi.latitude::float8 lat, vi.longitude::float8 lon, vi.vehicle_id, vi.vehicle_vin,
           vi.vehicle_vin_confidence, coalesce(vi.is_document, false) OR coalesce(vi.doc_flag, false) is_doc,
           coalesce(vi.is_duplicate, false) OR coalesce(vi.is_superseded, false) OR coalesce(vi.is_sensitive, false)
             OR coalesce(vi.vision_gate_status::text, '') IN ('rejected_personal', 'rejected_misattributed') blocked,
           lag(vi.taken_at) OVER w pt, lag(vi.latitude::float8) OVER w plat, lag(vi.longitude::float8) OVER w plon
    FROM vehicle_images vi
    WHERE vi.user_id = p_user AND vi.source = 'capture_relay_ios' AND vi.taken_at IS NOT NULL
      AND nullif(vi.image_url, '') IS NOT NULL
    WINDOW w AS (ORDER BY vi.taken_at, vi.id)
  ), g AS MATERIALIZED (
    SELECT p.*, sum(CASE WHEN p.pt IS NULL OR extract(epoch FROM p.taken_at - p.pt) > p_gap_s
                      OR (p.lat IS NOT NULL AND p.plat IS NOT NULL AND
                          6371000 * 2 * asin(sqrt(least(1, power(sin(radians(p.lat - p.plat) / 2), 2) +
                            cos(radians(p.lat)) * cos(radians(p.plat)) * power(sin(radians(p.lon - p.plon) / 2), 2)))) > p_radius_m)
                    THEN 1 ELSE 0 END) OVER (ORDER BY p.taken_at, p.id) sid
    FROM p
  ), roster AS MATERIALIZED (
    SELECT v.id, v.vin, vin_match_key(v.vin) k FROM vehicles v
    WHERE (v.owner_id = p_user OR v.user_id = p_user) AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND length(coalesce(v.vin, '')) >= 5
  ), reads AS MATERIALIZED (
    -- uploaded on-device reads (vehicle_vin) and cited text reads
    SELECT g.sid, g.id image_id, g.is_doc doc, vin_match_key(g.vehicle_vin) k, g.vehicle_vin vin,
           coalesce(g.vehicle_vin_confidence, 0.9) conf, 'upload' via
    FROM g WHERE length(coalesce(g.vehicle_vin, '')) >= 8
       OR (length(g.vehicle_vin) BETWEEN 5 AND 7 AND g.vehicle_vin ~ '[0-9]' AND coalesce(g.vehicle_vin_confidence, 0) >= 0.8)
    UNION ALL
    SELECT g.sid, g.id, r.is_document OR g.is_doc, vin_match_key(c->>'vin'), c->>'vin', coalesce((c->>'conf')::numeric, 0.5),
           'text_read:' || r.id
    FROM g JOIN image_text_reads r ON r.image_id = g.id AND r.revoked_at IS NULL
    CROSS JOIN LATERAL jsonb_array_elements(r.vin_candidates) c
  ), anch AS MATERIALIZED (
    SELECT r.sid, r.k, bool_or(NOT r.doc) on_car, max(r.conf) conf, min(r.vin) vin,
           (SELECT array_agg(DISTINCT ro.id) FROM roster ro WHERE ro.k = r.k) roster_ids,
           jsonb_agg(jsonb_build_object('image_id', r.image_id, 'vin', r.vin, 'document', r.doc, 'conf', r.conf, 'via', r.via)) cites
    FROM reads r WHERE r.k IS NOT NULL GROUP BY r.sid, r.k
  ), sets AS (
    SELECT g.sid, min(g.taken_at) t0, max(g.taken_at) t1, count(*)::int n, array_agg(g.id ORDER BY g.taken_at) ids,
           array_agg(g.id ORDER BY g.taken_at) FILTER (WHERE g.vehicle_id IS NULL AND NOT g.blocked) unl,
           array_agg(DISTINCT g.vehicle_id) FILTER (WHERE g.vehicle_id IS NOT NULL
             AND g.vehicle_id <> '14447ecd-293e-4203-9045-90102559c904'::uuid) filed,
           (array_agg(g.id ORDER BY g.taken_at) FILTER (WHERE g.lat IS NOT NULL AND g.vehicle_id IS NULL))[1] gps_img
    FROM g GROUP BY g.sid
  ), j AS (
    SELECT s.*, (SELECT array_agg(a.k ORDER BY a.k) FROM anch a WHERE a.sid = s.sid) keys,
           (SELECT jsonb_agg(jsonb_build_object('vin', a.vin, 'on_car', a.on_car, 'roster', a.roster_ids, 'cites', a.cites))
              FROM anch a WHERE a.sid = s.sid) anchors_j,
           (SELECT a.k FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_k,
           (SELECT a.vin FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_vin,
           (SELECT a.on_car FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_on_car,
           (SELECT a.roster_ids FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_roster
    FROM sets s
  )
  SELECT 'ios:' || p_user || ':' || to_char(j.t0 AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS'), j.t0, j.t1, j.n, j.ids,
         coalesce(j.unl, '{}'), coalesce(j.filed, '{}'), coalesce(j.keys, '{}'), coalesce(j.anchors_j, '[]'),
         dd.decision, d.target, d.pvin, d.conf, d.reasons
  FROM j
  CROSS JOIN LATERAL (SELECT
      CASE
        WHEN coalesce(cardinality(j.unl), 0) = 0 THEN 'nothing'
        WHEN coalesce(cardinality(j.keys), 0) >= 2 THEN 'review'
        WHEN cardinality(j.keys) = 1 AND cardinality(j.one_roster) = 1
             AND (j.filed IS NULL OR j.filed = j.one_roster) THEN 'attach'
        WHEN cardinality(j.keys) = 1 AND j.one_roster IS NULL AND j.filed IS NULL
             AND (vin_check_digit_ok(j.one_vin) OR length(j.one_k) BETWEEN 8 AND 13) THEN 'create'
        WHEN cardinality(j.keys) = 1 THEN 'review'
        WHEN cardinality(j.filed) = 1 THEN 'review'
        ELSE 'nothing'
      END decision) dd
  CROSS JOIN LATERAL (SELECT
      CASE WHEN dd.decision = 'attach' THEN j.one_roster[1]
           WHEN dd.decision = 'review' AND j.keys IS NULL AND cardinality(j.filed) = 1 THEN j.filed[1]
           WHEN dd.decision = 'review' AND cardinality(j.keys) = 1 THEN j.one_roster[1] END target,
      CASE WHEN cardinality(j.keys) = 1 THEN j.one_vin END pvin,
      CASE WHEN dd.decision IN ('attach', 'create') THEN CASE WHEN j.one_on_car THEN v_oncar ELSE v_doc END END conf,
      array_remove(ARRAY[
        CASE WHEN coalesce(cardinality(j.keys), 0) >= 2 THEN 'two_or_more_vins' END,
        CASE WHEN cardinality(j.keys) = 1 AND j.filed IS NOT NULL AND j.filed <> coalesce(j.one_roster, '{}')
             THEN 'vin_conflicts_with_filed_vehicle' END,
        CASE WHEN cardinality(j.keys) = 1 AND cardinality(j.one_roster) > 1 THEN 'vin_on_several_roster_vehicles' END,
        CASE WHEN cardinality(j.keys) = 1 AND NOT j.one_on_car THEN 'vin_from_document_only' END,
        CASE WHEN cardinality(j.keys) = 1 AND j.one_on_car THEN 'vin_on_car' END,
        CASE WHEN j.keys IS NULL AND cardinality(j.filed) = 1 THEN 'set_partly_filed' END
      ], NULL) reasons) d;
END $function$;
DROP TRIGGER IF EXISTS document_evidence_enqueue_rescore ON public.document_evidence;
DROP FUNCTION IF EXISTS public.document_evidence_enqueue_rescore();
DROP FUNCTION IF EXISTS public.document_period_coverage(uuid, date);
DROP FUNCTION IF EXISTS public.document_ingest_revoke(uuid);
DROP TABLE IF EXISTS public.capture_set_rescore_queue;
DROP TABLE IF EXISTS public.document_coverage_targets;
DROP TABLE IF EXISTS public.document_evidence;
DROP TABLE IF EXISTS public.document_pages;
DROP TABLE IF EXISTS public.document_batches;
