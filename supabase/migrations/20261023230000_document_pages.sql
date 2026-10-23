-- Camera-roll document path: pages photographed with the regular iPhone camera arrive through
-- (Named capture_document_pages: public.document_pages already holds manual/book pages. A first apply
-- stopped after creating the empty document_batches table; this file is idempotent over that.)
-- capture_relay_ios like any car photo. A router (edge function document-page-router) classifies
-- them and registers each page here. Registered pages:
--   * are excluded from capture_sets_build (no 2026 "car set", no GPS/time/visual reference);
--   * carry the document's own date from OCR (date_source 'ocr'), or none ('none') — never EXIF;
--   * may belong to a batch opened by a handwritten label card {box, vehicle hint, year hint};
--     the hint is soft, cited evidence, never a filing;
--   * are grouped into multi-page documents (doc_key) by shot sequence.
-- One dated document_evidence row per document; inserting one enqueues a debounced rescore of
-- the owner's capture sets within ±7 days (capture_set_rescore_queue, one row per user-day).
-- document_period_coverage() gives the 0..1 coverage the scorer scales the no-evidence penalty by.
-- Nothing here writes vehicle_images.vehicle_id or creates vehicles.
-- Additive. Revert: supabase/sql/revert_20261023230000_document_pages.sql.
SET lock_timeout = '5s';
SET statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.document_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  label_image_id uuid NOT NULL UNIQUE,
  label_text     text,
  box            text,
  vehicle_hint   text,
  year_hint      int CHECK (year_hint BETWEEN 1880 AND 2100),
  opened_at      timestamptz NOT NULL,
  run_id         uuid NOT NULL,
  cites          jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz
);

CREATE TABLE IF NOT EXISTS public.capture_document_pages (
  image_id         uuid PRIMARY KEY,
  user_id          uuid NOT NULL,
  batch_id         uuid REFERENCES public.document_batches(id) ON DELETE SET NULL,
  doc_key          text NOT NULL,
  page_no          int NOT NULL DEFAULT 1 CHECK (page_no >= 1),
  is_label_card    boolean NOT NULL DEFAULT false,
  doc_type         text,
  class_conf       numeric(4,3) CHECK (class_conf BETWEEN 0 AND 1),
  classifier       text NOT NULL,
  doc_date         date,
  date_source      text NOT NULL DEFAULT 'none' CHECK (date_source IN ('ocr', 'none')),
  date_text        text,
  extraction       jsonb NOT NULL DEFAULT '{}',
  cost_usd         numeric(8,5) NOT NULL DEFAULT 0,
  run_id           uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  CHECK ((date_source = 'ocr') = (doc_date IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS document_pages_user_doc ON public.capture_document_pages (user_id, doc_key, page_no);
CREATE INDEX IF NOT EXISTS document_pages_run ON public.capture_document_pages (run_id);

CREATE TABLE IF NOT EXISTS public.document_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  doc_key       text NOT NULL,
  image_ids     uuid[] NOT NULL,
  doc_date      date NOT NULL,
  doc_type      text,
  vin           text,
  vehicle_text  text,
  hint_vehicle_id uuid,
  batch_id      uuid REFERENCES public.document_batches(id) ON DELETE SET NULL,
  cites         jsonb NOT NULL DEFAULT '[]',
  run_id        uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  UNIQUE (user_id, doc_key, run_id)
);
CREATE INDEX IF NOT EXISTS document_evidence_user_date ON public.document_evidence (user_id, doc_date) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.document_coverage_targets (
  user_id       uuid NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL CHECK (period_end >= period_start),
  expected_docs int NOT NULL CHECK (expected_docs > 0),
  note          text,
  PRIMARY KEY (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS public.capture_set_rescore_queue (
  user_id      uuid NOT NULL,
  day          date NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  not_before   date NOT NULL DEFAULT (current_date + 1),
  reasons      jsonb NOT NULL DEFAULT '[]',
  done_run_id  uuid,
  done_at      timestamptz,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS capture_set_rescore_queue_due ON public.capture_set_rescore_queue (not_before) WHERE done_at IS NULL;

-- Debounce: one row per user-day; a new document re-arms it for tomorrow's run.
CREATE OR REPLACE FUNCTION public.document_evidence_enqueue_rescore()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  INSERT INTO capture_set_rescore_queue AS q (user_id, day, reasons)
  SELECT NEW.user_id, d::date, jsonb_build_array(NEW.id)
  FROM generate_series(NEW.doc_date - 7, NEW.doc_date + 7, interval '1 day') d
  ON CONFLICT (user_id, day) DO UPDATE
    SET requested_at = now(), not_before = current_date + 1, done_at = NULL, done_run_id = NULL,
        reasons = CASE WHEN q.reasons @> jsonb_build_array(NEW.id) THEN q.reasons ELSE q.reasons || jsonb_build_array(NEW.id) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS document_evidence_enqueue_rescore ON public.document_evidence;
CREATE TRIGGER document_evidence_enqueue_rescore AFTER INSERT ON public.document_evidence
  FOR EACH ROW EXECUTE FUNCTION public.document_evidence_enqueue_rescore();

-- Coverage of a period by dated documents, 0..1. NULL when no target is set (caller treats as 0,
-- so the no-evidence penalty stays off until the paperwork for that period is in).
CREATE OR REPLACE FUNCTION public.document_period_coverage(p_user uuid, p_day date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT least(1, (SELECT count(DISTINCT e.doc_key) FROM document_evidence e
                   WHERE e.user_id = p_user AND e.revoked_at IS NULL
                     AND e.doc_date BETWEEN t.period_start AND t.period_end)::numeric / t.expected_docs)
  FROM document_coverage_targets t
  WHERE t.user_id = p_user AND p_day BETWEEN t.period_start AND t.period_end
  ORDER BY t.period_start DESC LIMIT 1
$$;

-- Withdraw everything one router run wrote (pages leave the exclusion, evidence stops counting).
CREATE OR REPLACE FUNCTION public.document_ingest_revoke(p_run uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH a AS (UPDATE capture_document_pages SET revoked_at = now() WHERE run_id = p_run AND revoked_at IS NULL RETURNING 1),
       b AS (UPDATE document_evidence SET revoked_at = now() WHERE run_id = p_run AND revoked_at IS NULL RETURNING 1),
       c AS (UPDATE document_batches SET revoked_at = now() WHERE run_id = p_run AND revoked_at IS NULL RETURNING 1)
  SELECT jsonb_build_object('pages', (SELECT count(*) FROM a), 'evidence', (SELECT count(*) FROM b), 'batches', (SELECT count(*) FROM c))
$$;

ALTER TABLE public.document_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capture_document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_coverage_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capture_set_rescore_queue ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_batches','capture_document_pages','document_evidence','document_coverage_targets','capture_set_rescore_queue'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())', t || '_owner_read', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.document_evidence_enqueue_rescore() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.document_period_coverage(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_period_coverage(uuid, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.document_ingest_revoke(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_ingest_revoke(uuid) TO service_role;

-- capture_sets_build: live definition (from 20261023180000) plus one NOT EXISTS on capture_document_pages.
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
      AND NOT EXISTS (SELECT 1 FROM capture_document_pages dp WHERE dp.image_id = vi.id AND dp.revoked_at IS NULL)
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
