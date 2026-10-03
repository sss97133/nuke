-- Public comment atoms: reuse the observation log, existing derivation queue and
-- cron 487. Pilot population is one public vehicle, not the whole comment corpus.
-- Queue rows are operating metadata. Source testimony is never rewritten.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

ALTER TABLE public.vehicle_observations ADD COLUMN source_comment_id uuid;
ALTER TABLE public.vehicle_observations
  ADD CONSTRAINT vehicle_observations_source_comment_id_fkey
  FOREIGN KEY (source_comment_id) REFERENCES public.auction_comments(id) NOT VALID;
COMMENT ON COLUMN public.vehicle_observations.source_comment_id IS
'One inferred atomic claim/question/answer/plan cites one auction_comments grain. New references are FK-enforced; historical rows remain NULL and unvalidated. Same vehicle, auction linkage, exact quote, source posted_at and confidence <=0.6 are checked on admission and qualified by the reader. Writer: ingest-observation; reader: popup_vehicle_intel.comment_evidence.';
-- No 10-million-row index build here. The reader uses the existing vehicle
-- index and a bounded source page; a concurrent index is a separate operation.

CREATE OR REPLACE FUNCTION public.validate_comment_observation_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE c public.auction_comments%ROWTYPE;
BEGIN
  IF NEW.source_comment_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.source_comment_id IS NOT NULL THEN
      RAISE EXCEPTION 'a sourced comment claim cannot lose its source link' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO c FROM public.auction_comments
    WHERE id = NEW.source_comment_id FOR SHARE;
  IF NOT FOUND OR c.vehicle_id IS NULL OR NEW.vehicle_id IS DISTINCT FROM c.vehicle_id
     OR c.posted_at IS NULL OR c.bid_amount IS NOT NULL OR c.comment_type = 'bid'
     OR nullif(btrim(c.comment_text), '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.auction_events e
       WHERE e.id = c.auction_event_id AND e.vehicle_id = c.vehicle_id)
     OR NOT EXISTS (SELECT 1 FROM public.vehicles v
       WHERE v.id = c.vehicle_id AND v.is_public IS TRUE) THEN
    RAISE EXCEPTION 'invalid public comment source relation' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind::text IS DISTINCT FROM 'comment'
     OR NEW.observed_at IS DISTINCT FROM c.posted_at
     OR NEW.confidence_score IS NULL OR NEW.confidence_score < 0 OR NEW.confidence_score > 0.6
     OR NEW.structured_data->'is_inferred' IS DISTINCT FROM 'true'::jsonb
     OR nullif(btrim(NEW.content_text), '') IS NULL
     OR strpos(c.comment_text, NEW.content_text) = 0 THEN
    RAISE EXCEPTION 'comment claim must retain exact source quote, event clock and inferred qualification'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.validate_comment_observation_source() IS
'Admission assay for new/changed typed comment claims: source exists, is non-bid public same-vehicle/event testimony, quote is exact, observed_at is source posted_at, inferred confidence is finite 0..0.6. No source facts or clocks are changed.';
REVOKE ALL ON FUNCTION public.validate_comment_observation_source() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_validate_comment_observation_source_insert
BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
WHEN (NEW.source_comment_id IS NOT NULL)
EXECUTE FUNCTION public.validate_comment_observation_source();
CREATE TRIGGER trg_validate_comment_observation_source_update
BEFORE UPDATE OF source_comment_id, vehicle_id, kind, content_text, observed_at, confidence_score, structured_data
ON public.vehicle_observations FOR EACH ROW
WHEN (OLD.source_comment_id IS NOT NULL OR NEW.source_comment_id IS NOT NULL)
EXECUTE FUNCTION public.validate_comment_observation_source();

ALTER TABLE public.comment_claims_progress ADD COLUMN extraction_version text;
ALTER TABLE public.comment_claims_progress ADD COLUMN extraction_result jsonb;
COMMENT ON COLUMN public.comment_claims_progress.extraction_version IS
'Named extraction contract that earned completion, not a legacy llm_processed boolean. public_comment_atoms_v1 completes only after canonical claim readback or an explicit validated empty result.';
COMMENT ON COLUMN public.comment_claims_progress.extraction_result IS
'First validated public-comment model result with source digest, version, model, cost and response time. Worker compare-and-swap caches it once before landing claims; persistence retries reuse it without another model call. Never credentials or private source material.';
COMMENT ON COLUMN public.comment_claims_progress.observation_ids IS
'Canonical vehicle_observations IDs read back after atomic claims land through ingest-observation; completion evidence, not attempted writes. Array entries are not foreign keys.';
COMMENT ON COLUMN public.comment_claims_progress.llm_processed IS
'True only after all accepted atoms persist and are verified, or a validated explicit empty extraction. Check extraction_version; historical booleans alone do not establish this contract.';
-- The previous policy was ALL TO public USING(true), despite its name.
DROP POLICY IF EXISTS "Service role full access" ON public.comment_claims_progress;
CREATE POLICY comment_claims_progress_public_read ON public.comment_claims_progress
  FOR SELECT TO public USING (true);
CREATE POLICY comment_claims_progress_service_write ON public.comment_claims_progress
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.comment_claims_progress FROM PUBLIC, anon, authenticated;

ALTER TABLE public.derivation_queue ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.derivation_queue DROP CONSTRAINT derivation_queue_evidence_type_check;
ALTER TABLE public.derivation_queue ADD CONSTRAINT derivation_queue_evidence_type_check CHECK (
  evidence_type IN ('secure_document','vehicle_image','receipt','qb_transaction',
    'imessage_conversation','email','artifact','auction_comment')
) NOT VALID;
ALTER TABLE public.derivation_queue ADD CONSTRAINT derivation_queue_owner_scope_check CHECK (
  (evidence_type = 'auction_comment' AND user_id IS NULL)
  OR (evidence_type <> 'auction_comment' AND user_id IS NOT NULL)
) NOT VALID;
ALTER TABLE public.derivation_queue ADD COLUMN queue_budget_reserved_at timestamptz;
COMMENT ON COLUMN public.derivation_queue.user_id IS
'Credential owner for existing private-evidence types. NULL only for explicitly public auction_comment work paid by the bounded system budget; NULL is not a fabricated author or vehicle owner.';
COMMENT ON COLUMN public.derivation_queue.queue_budget_reserved_at IS
'UTC reservation clock for the one permitted model call for this queue item. Atomic service-only reservation admits at most 24 calls per UTC day at five cents each; subsequent attempts may reuse a cached result but may not reserve again.';
COMMENT ON COLUMN public.derivation_queue.credential_source IS
'Credential attribution for execution. Public auction_comment pilot uses system_api_key; owner evidence retains its own credential chain. Presence does not prove spend or completed output.';
CREATE INDEX idx_derivation_queue_public_comment_budget
  ON public.derivation_queue (queue_budget_reserved_at)
  WHERE evidence_type = 'auction_comment' AND queue_budget_reserved_at IS NOT NULL;

INSERT INTO public.observation_extractors
  (source_id, slug, display_name, extractor_type, edge_function_name, extractor_config,
   produces_kinds, is_active, schedule_type, min_interval_seconds)
SELECT id, 'comment-refinery-atoms-v1', 'Public auction comment atoms',
  'edge_function', 'batch-comment-discovery',
  jsonb_build_object('version','public_comment_atoms_v1',
    'pilot_vehicle_id','2e61fa34-c5b4-4709-9636-4823546a5bc4',
    'reservation_limit_per_utc_day',24,'reserved_cents_per_call',5,
    'max_model_calls_per_item',1,'max_attempts',3,
    'completion','verified canonical observation IDs or validated explicit empty result'),
  ARRAY['comment']::public.observation_kind[], true, 'on_demand', 1
FROM public.observation_sources WHERE slug = 'bat'
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enqueue_public_comment_derivation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- The source stream stays global. Only this declared public pilot enters the
  -- existing paid derivation route; unrelated arrivals and bids remain untouched.
  IF NEW.vehicle_id = '2e61fa34-c5b4-4709-9636-4823546a5bc4'::uuid
     AND NEW.bid_amount IS NULL AND NEW.comment_type IS DISTINCT FROM 'bid'
     AND NEW.posted_at IS NOT NULL AND nullif(btrim(NEW.comment_text), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = NEW.vehicle_id AND v.is_public IS TRUE)
     AND EXISTS (SELECT 1 FROM public.auction_events e
       WHERE e.id = NEW.auction_event_id AND e.vehicle_id = NEW.vehicle_id)
     AND EXISTS (SELECT 1 FROM public.observation_extractors x
       WHERE x.slug = 'comment-refinery-atoms-v1' AND x.is_active IS TRUE) THEN
    INSERT INTO public.derivation_queue
      (user_id,evidence_type,evidence_id,extractor_slug,requested_by,status,max_attempts,credential_source,next_attempt_at)
    VALUES (NULL,'auction_comment',NEW.id,'comment-refinery-atoms-v1','trigger','pending',3,'system_api_key',now()+interval '5 minutes')
    ON CONFLICT (evidence_type,evidence_id,extractor_slug) DO NOTHING;
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.enqueue_public_comment_derivation() IS
'Append-to-work edge for public non-bid comments on the declared Solstice pilot only. One existing derivation_queue item per source comment and extractor; five-minute admission delay protects function rollout. No inference or scheduler creation. Source mutation/replay never produces a second queue item.';
REVOKE ALL ON FUNCTION public.enqueue_public_comment_derivation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enqueue_public_comment_derivation
AFTER INSERT ON public.auction_comments FOR EACH ROW
EXECUTE FUNCTION public.enqueue_public_comment_derivation();

CREATE OR REPLACE FUNCTION public.reserve_public_comment_derivation(p_queue_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '5s' SET lock_timeout = '1s'
AS $fn$
DECLARE
  q public.derivation_queue%ROWTYPE;
  used integer;
  utc_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public-comment-derivation-budget-v1',0)) THEN
    RETURN jsonb_build_object('allowed',false,'reason','busy');
  END IF;
  SELECT * INTO q FROM public.derivation_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND OR q.evidence_type <> 'auction_comment'
     OR q.extractor_slug <> 'comment-refinery-atoms-v1' OR q.user_id IS NOT NULL
     OR q.status <> 'claimed' OR q.attempts < 1 OR q.attempts > q.max_attempts
     OR NOT EXISTS (
       SELECT 1 FROM public.auction_comments c
       JOIN public.vehicles v ON v.id = c.vehicle_id AND v.is_public IS TRUE
       JOIN public.auction_events e ON e.id = c.auction_event_id AND e.vehicle_id = c.vehicle_id
       WHERE c.id = q.evidence_id
         AND c.vehicle_id = '2e61fa34-c5b4-4709-9636-4823546a5bc4'::uuid
         AND c.bid_amount IS NULL AND c.comment_type IS DISTINCT FROM 'bid'
         AND c.posted_at IS NOT NULL AND nullif(btrim(c.comment_text),'') IS NOT NULL
     )
     OR NOT EXISTS (SELECT 1 FROM public.observation_extractors x
       WHERE x.slug = q.extractor_slug AND x.is_active IS TRUE) THEN
    RETURN jsonb_build_object('allowed',false,'reason','not_eligible');
  END IF;
  IF q.queue_budget_reserved_at IS NOT NULL THEN
    RETURN jsonb_build_object('allowed',false,'reason','already_reserved');
  END IF;
  SELECT count(*) INTO used FROM public.derivation_queue
    WHERE evidence_type = 'auction_comment'
      AND queue_budget_reserved_at >= utc_day
      AND queue_budget_reserved_at < utc_day + interval '1 day';
  IF used >= 24 THEN
    RETURN jsonb_build_object('allowed',false,'reason','budget_exhausted',
      'daily_limit',24,'daily_reserved',used);
  END IF;
  UPDATE public.derivation_queue SET queue_budget_reserved_at = now(),
    cost_cents = 5, credential_source = 'system_api_key'
    WHERE id = p_queue_id;
  RETURN jsonb_build_object('allowed',true,'reason','reserved',
    'reserved_cents',5,'daily_limit',24,'daily_reserved',used+1);
END
$fn$;
COMMENT ON FUNCTION public.reserve_public_comment_derivation(uuid) IS
'Service-only finite spend admission for one claimed public pilot comment item. Serialized daily maximum 24 reservations (five cents each), one reservation per item. A reservation is not provider spend or successful extraction; later persistence retries reuse extraction_result only.';
REVOKE ALL ON FUNCTION public.reserve_public_comment_derivation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_public_comment_derivation(uuid) TO service_role;

-- Bounded metadata replay for the existing pilot: at most 52 source rows.
-- No auction comment or observation is updated, classified or synthesized.
-- Active-auction timeliness policy: newest source comments are processed first,
-- matching the existing reader's latest-20 source window.
INSERT INTO public.derivation_queue
  (user_id,evidence_type,evidence_id,extractor_slug,requested_by,status,max_attempts,credential_source,next_attempt_at,priority)
SELECT NULL,'auction_comment',c.id,'comment-refinery-atoms-v1','backfill','pending',3,'system_api_key',
  now()+interval '5 minutes',row_number() OVER (ORDER BY c.posted_at DESC,c.id DESC)::integer
FROM (
  SELECT id, vehicle_id, auction_event_id, bid_amount, comment_type, posted_at, comment_text
  FROM public.auction_comments
  WHERE vehicle_id = '2e61fa34-c5b4-4709-9636-4823546a5bc4'::uuid
  ORDER BY posted_at DESC NULLS LAST, id DESC LIMIT 52
) c
JOIN public.vehicles v ON v.id = c.vehicle_id AND v.is_public IS TRUE
JOIN public.auction_events e ON e.id = c.auction_event_id AND e.vehicle_id = c.vehicle_id
WHERE c.bid_amount IS NULL AND c.comment_type IS DISTINCT FROM 'bid'
  AND c.posted_at IS NOT NULL AND nullif(btrim(c.comment_text),'') IS NOT NULL
ON CONFLICT (evidence_type,evidence_id,extractor_slug) DO NOTHING;

INSERT INTO public.pipeline_registry
  (table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES
 ('vehicle_observations','source_comment_id','ingest-observation',
  'Atomic sourced comment atom; same vehicle and source clock, exact quote, inferred qualification; reader popup_vehicle_intel.comment_evidence.',true,'ingest-observation'),
 ('comment_claims_progress','extraction_version','batch-comment-discovery',
  'Versioned completion receipt per source comment; only verified atom readback or validated empty extraction completes.',true,'batch-comment-discovery extract_claims'),
 ('comment_claims_progress','extraction_result','batch-comment-discovery',
  'First cached model result per source comment/version; enables bounded persistence replay without another model call.',true,'batch-comment-discovery extract_claims'),
 ('derivation_queue','queue_budget_reserved_at','reserve_public_comment_derivation',
  'One paid-call reservation per public source comment work item; maximum 24 five-cent reservations per UTC day.',true,'reserve_public_comment_derivation')
ON CONFLICT (table_name,column_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '10s'
AS $function$
  SELECT jsonb_build_object(
    'comment_evidence', (
      WITH source_page AS MATERIALIZED (
        SELECT c.id, c.auction_event_id, c.posted_at, c.is_seller, c.comment_type,
               c.external_identity_id, c.source_url, c.comment_text
        FROM public.auction_comments c
        JOIN public.auction_events e ON e.id = c.auction_event_id AND e.vehicle_id = c.vehicle_id
        JOIN public.vehicles v ON v.id = c.vehicle_id AND v.is_public IS TRUE
        WHERE c.vehicle_id = p_vehicle_id AND c.bid_amount IS NULL
          AND c.comment_type IS DISTINCT FROM 'bid' AND c.posted_at IS NOT NULL
          AND nullif(btrim(c.comment_text), '') IS NOT NULL
        ORDER BY c.posted_at DESC, c.id DESC LIMIT 21
      ), sources AS MATERIALIZED (
        SELECT * FROM source_page ORDER BY posted_at DESC, id DESC LIMIT 20
      ), atom_page AS MATERIALIZED (
        SELECT o.id, o.source_comment_id, o.content_text, o.structured_data,
               o.confidence_score, o.observed_at, o.ingested_at, o.agent_model,
               o.extraction_method
        FROM public.vehicle_observations o
        JOIN sources c ON c.id = o.source_comment_id
        WHERE o.vehicle_id = p_vehicle_id AND o.kind::text = 'comment'
          AND o.is_superseded IS NOT TRUE AND o.observed_at = c.posted_at
          AND o.confidence_score BETWEEN 0 AND 0.6
          AND o.structured_data->'is_inferred' = 'true'::jsonb
          AND nullif(btrim(o.content_text), '') IS NOT NULL
          AND strpos(c.comment_text, o.content_text) > 0
        ORDER BY o.ingested_at DESC, o.id DESC LIMIT 201
      ), atoms AS MATERIALIZED (
        SELECT * FROM atom_page ORDER BY ingested_at DESC, id DESC LIMIT 200
      )
      SELECT jsonb_build_object(
        'source_limit', 20, 'atom_limit', 200,
        'sources_returned', (SELECT count(*) FROM sources),
        'atoms_returned', (SELECT count(*) FROM atoms),
        'sources_truncated', (SELECT count(*) > 20 FROM source_page),
        'atoms_truncated', (SELECT count(*) > 200 FROM atom_page),
        'scope', 'Latest 20 non-bid public source comments; at most 200 qualified atoms linked to those sources. Inferred source testimony, not verified vehicle facts.',
        'source_comments', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'comment_id', c.id, 'auction_event_id', c.auction_event_id,
            'posted_at', c.posted_at, 'source_url', c.source_url,
            'is_seller', c.is_seller, 'comment_type', c.comment_type,
            'author_identity_id', c.external_identity_id,
            'excerpt', left(c.comment_text, 1200),
            'excerpt_truncated', length(c.comment_text) > 1200,
            'processed', coalesce(p.llm_processed IS TRUE
              AND p.extraction_version = 'public_comment_atoms_v1', false),
            'extraction_version', p.extraction_version,
            'processed_at', p.processed_at
          ) ORDER BY c.posted_at DESC, c.id DESC)
          FROM sources c LEFT JOIN public.comment_claims_progress p ON p.comment_id = c.id
        ), '[]'::jsonb),
        'atoms', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'observation_id', a.id, 'source_comment_id', a.source_comment_id,
            'quote', a.content_text, 'data', a.structured_data,
            'confidence', a.confidence_score, 'is_inferred', true,
            'observed_at', a.observed_at, 'ingested_at', a.ingested_at,
            'agent_model', a.agent_model, 'extraction_method', a.extraction_method
          ) ORDER BY a.ingested_at DESC, a.id DESC) FROM atoms a
        ), '[]'::jsonb)
      )
    ),
    'comment_intel', (
      SELECT jsonb_build_object(
        'sentiment', raw_extraction->'sentiment',
        'key_quotes', raw_extraction->'key_quotes',
        'expert_insights', raw_extraction->'expert_insights',
        'community_concerns', raw_extraction->'community_concerns',
        'price_sentiment', raw_extraction->'price_sentiment',
        'market_signals', raw_extraction->'market_signals',
        'seller_disclosures', raw_extraction->'seller_disclosures',
        'authenticity', raw_extraction->'authenticity_discussion',
        'overall_sentiment', overall_sentiment,
        'sentiment_score', sentiment_score,
        'comment_count', comment_count
      )
      FROM comment_discoveries
      WHERE vehicle_id = p_vehicle_id
      ORDER BY discovered_at DESC
      LIMIT 1
    ),
    'description_intel', (
      SELECT jsonb_build_object(
        'red_flags', raw_extraction->'flags',
        'mods', raw_extraction->'mods',
        'work_history', raw_extraction->'work',
        'condition', raw_extraction->'cond',
        'condition_note', raw_extraction->'cond_note',
        'title_status', raw_extraction->'title',
        'owner_count', raw_extraction->'owners',
        'matching_numbers', raw_extraction->'matching',
        'documentation', raw_extraction->'docs',
        'option_codes', raw_extraction->'codes',
        'equipment', raw_extraction->'equip',
        'price_positive', raw_extraction->'price_pos',
        'price_negative', raw_extraction->'price_neg'
      )
      FROM description_discoveries
      WHERE vehicle_id = p_vehicle_id
      ORDER BY discovered_at DESC
      LIMIT 1
    ),
    'scores', (
      SELECT jsonb_build_object(
        'nuke_estimate', nuke_estimate,
        'nuke_confidence', nuke_estimate_confidence,
        'heat_score', heat_score,
        'deal_score', deal_score
      )
      FROM vehicles
      WHERE id = p_vehicle_id
    ),
    'apparitions', COALESCE((
      SELECT jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.event_date DESC NULLS LAST)
      FROM (
        SELECT source_platform as platform, source_url as url,
               event_type, COALESCE(sold_at, ended_at, started_at) as event_date,
               COALESCE(final_price, current_price) as price
        FROM vehicle_events
        WHERE vehicle_id = p_vehicle_id
        ORDER BY COALESCE(sold_at, ended_at, started_at) DESC NULLS LAST
        LIMIT 10
      ) sub
    ), '[]'::jsonb),
    'recent_comps', COALESCE((
      SELECT jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.sale_date DESC NULLS LAST)
      FROM (
        SELECT v.id, v.year, v.model, v.sale_price, v.sale_date,
               v.primary_image_url as thumbnail, v.mileage
        FROM vehicles v
        CROSS JOIN (SELECT make, model FROM vehicles WHERE id = p_vehicle_id) ref
        WHERE v.make = ref.make AND v.model = ref.model
          AND v.id != p_vehicle_id
          AND v.sale_price > 0
          AND v.is_public = true
        ORDER BY v.sale_date DESC NULLS LAST
        LIMIT 6
      ) sub
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.popup_vehicle_intel(uuid) IS
'Existing vehicle intelligence reader plus bounded comment_evidence: latest 20 public non-bid source comments and at most 200 qualifying same-vehicle sourced inferred atoms, explicit truncation and versioned completion. Quotes are testimony; questions/plans remain their recorded states. Legacy summary, description, score, apparition and comp keys are preserved.';

NOTIFY pgrst, 'reload schema';
