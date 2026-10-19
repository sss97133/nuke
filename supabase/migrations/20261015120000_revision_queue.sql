-- The revision queue: a lot that did not land whole is a revision item, never a "failed" lot.
--
-- OWNER (2026-10-15): "failed lots dont make sense. that just a queue for revision."
--
-- HOME. import_queue already is the work queue and ledger of listing URLs (one row per lot URL, UNIQUE listing_url, with
-- source, status, attempts, lease columns, error, failure_category, vehicle_id). It is extended, not duplicated. Its 'failed'
-- status stays accepted because 75 writer sites in 44 functions and 4 views / 9 functions (pulse, health, source_target_coverage)
-- read it; this migration adds the vocabulary and the list over it, and the stored word is retired in a later step once those
-- readers move (list in the PR).
--
-- VOCABULARY. status gains 'revision' (the lot did not land whole) and 'resolved' (left the queue because it was proven to be
-- something else). A lot leaves the queue only through resolve_revision_item: outcome landed_whole (status complete),
-- non_vehicle, dead_page or duplicate_of (status resolved). Nothing is deleted; the outcome is recorded on the row.
-- ITEM SHAPE (columns on import_queue): revision_missing text[] (what is missing: vehicle_link, event, description, photos,
-- comments, or a landing-depth field name), revision_reason (why), next_action (what to do), revision_source (who raised it),
-- revision_detail jsonb, snapshot_id (the retained capture), outcome, outcome_at, outcome_detail, revised_count.
-- WORKERS claim with claim_revision_items(source, worker, limit, actions): leases with locked_by / locked_at (15 minutes),
-- FOR UPDATE SKIP LOCKED, so per-source workers never take the same item. A worker that could not fix an item calls
-- release_revision_item with the next action (reparse_retained, then refetch, then classify_non_vehicle) and a retry time.
-- WRITERS record with record_revision_item (any lane) and record_lot_depth (the landing-depth test: raises a thin or unlinked
-- lot, and resolves it landed_whole once a later reading finds it whole).
-- READ. v_revision_queue (open items, and derivation_queue's failed rows as item_kind derivation) and v_revision_summary.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.import_queue
  ADD COLUMN IF NOT EXISTS revision_missing text[],
  ADD COLUMN IF NOT EXISTS revision_reason text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS revision_source text,
  ADD COLUMN IF NOT EXISTS revision_detail jsonb,
  ADD COLUMN IF NOT EXISTS snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_detail jsonb,
  ADD COLUMN IF NOT EXISTS revised_count integer;

ALTER TABLE public.import_queue DROP CONSTRAINT IF EXISTS import_queue_status_check;
ALTER TABLE public.import_queue ADD CONSTRAINT import_queue_status_check CHECK (status = ANY (ARRAY[
  'pending','processing','complete','failed','skipped','duplicate','pending_review','pending_strategy','revision','resolved'])) NOT VALID;
ALTER TABLE public.import_queue DROP CONSTRAINT IF EXISTS import_queue_revision_vocab;
ALTER TABLE public.import_queue ADD CONSTRAINT import_queue_revision_vocab CHECK (
  (revision_reason IS NULL OR revision_reason IN ('parser_gap','blocked','rate_limited','billing','timeout','lock_timeout',
     'duplicate_key','quality_gate','bad_data','not_found','thin_landing','unlinked_capture','other'))
  AND (next_action IS NULL OR next_action IN ('reparse_retained','refetch','relink','classify_non_vehicle','retry','wait','none'))
  AND (outcome IS NULL OR outcome IN ('landed_whole','non_vehicle','dead_page','duplicate_of'))) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_import_queue_revision_claim
  ON public.import_queue (source_id, next_action, priority DESC, created_at) WHERE status = 'revision';

COMMENT ON COLUMN public.import_queue.revision_missing IS 'What the lot is missing when it did not land whole: vehicle_link, event, description, photos, comments, or a landing-depth field name.';
COMMENT ON COLUMN public.import_queue.revision_reason IS 'Why: parser_gap, blocked, rate_limited, billing, timeout, lock_timeout, duplicate_key, quality_gate, bad_data, not_found, thin_landing, unlinked_capture, other.';
COMMENT ON COLUMN public.import_queue.next_action IS 'What a revision worker does next: reparse_retained (current parser on the retained capture), refetch, relink, classify_non_vehicle, retry, wait, none.';
COMMENT ON COLUMN public.import_queue.revision_source IS 'Who raised the item: a writer or function name, landing_depth, or retrofit.';
COMMENT ON COLUMN public.import_queue.snapshot_id IS 'The retained capture (listing_page_snapshots.id) the item was raised against, when known.';
COMMENT ON COLUMN public.import_queue.outcome IS 'How the lot left the queue: landed_whole, non_vehicle, dead_page or duplicate_of. Never deleted; NULL while open.';
COMMENT ON COLUMN public.import_queue.revised_count IS 'Revision attempts made by workers.';

-- RETROFIT: the existing failed rows become revision items. The stored status stays failed until the readers move; the list
-- (v_revision_queue) names every one of them as a revision item. Reason and next action come from failure_category; a lot with a
-- retained capture is re-parsed first, otherwise re-fetched.
UPDATE public.import_queue q SET
  revision_reason = CASE q.failure_category
    WHEN 'extraction_failed' THEN 'parser_gap' WHEN 'parse_error' THEN 'parser_gap' WHEN 'bad_data' THEN 'bad_data'
    WHEN 'billing' THEN 'billing' WHEN 'blocked' THEN 'blocked' WHEN 'rate_limited' THEN 'rate_limited'
    WHEN 'timeout' THEN 'timeout' WHEN 'duplicate' THEN 'duplicate_key' WHEN 'identity_insufficient' THEN 'quality_gate'
    WHEN 'missing_fields' THEN 'thin_landing' ELSE 'other' END,
  next_action = CASE
    WHEN q.failure_category IN ('billing','rate_limited','blocked') THEN 'wait'
    WHEN q.failure_category = 'identity_insufficient' THEN 'relink'
    WHEN EXISTS (SELECT 1 FROM public.listing_page_snapshots s WHERE s.listing_url = q.listing_url AND s.success
                 AND (s.html IS NOT NULL OR s.html_storage_path IS NOT NULL) LIMIT 1) THEN 'reparse_retained'
    ELSE 'refetch' END,
  revision_missing = ARRAY['landing'],
  revision_source = 'retrofit',
  revision_detail = jsonb_build_object('failure_category', q.failure_category, 'error_message', left(q.error_message, 300)),
  revised_count = coalesce(q.revised_count, 0)
WHERE q.status = 'failed' AND q.revision_reason IS NULL;

CREATE OR REPLACE FUNCTION public.record_revision_item(
  p_url text, p_missing text[], p_reason text, p_next_action text, p_raised_by text,
  p_snapshot_id uuid DEFAULT NULL, p_detail jsonb DEFAULT '{}'::jsonb, p_vehicle_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_id uuid; v_status text; v_urls text[];
  v_key text := regexp_replace(regexp_replace(regexp_replace(lower(trim(p_url)), '[?#].*$', ''), '^https?://(www\.)?', ''), '/+$', '');
BEGIN
  v_urls := ARRAY[p_url, 'https://' || v_key, 'https://www.' || v_key, 'http://' || v_key, 'https://' || v_key || '/', 'https://www.' || v_key || '/'];
  SELECT id, status INTO v_id, v_status FROM public.import_queue WHERE listing_url = ANY (v_urls) ORDER BY (listing_url = p_url) DESC LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.import_queue (listing_url, status, revision_missing, revision_reason, next_action, revision_source, revision_detail,
                                     snapshot_id, vehicle_id, revised_count, raw_data)
    VALUES (p_url, 'revision', p_missing, p_reason, p_next_action, p_raised_by, p_detail, p_snapshot_id, p_vehicle_id, 0,
            jsonb_build_object('source', 'record_revision_item'))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;
  IF v_status = 'resolved' THEN RETURN v_id; END IF;   -- proven something else: a new report does not reopen it
  UPDATE public.import_queue SET
    status = CASE WHEN status IN ('pending','processing') THEN status ELSE 'revision' END,
    revision_missing = (SELECT array_agg(DISTINCT m ORDER BY m) FROM unnest(coalesce(revision_missing, '{}') || p_missing) m),
    revision_reason = p_reason, next_action = p_next_action, revision_source = p_raised_by,
    revision_detail = coalesce(revision_detail, '{}') || p_detail,
    snapshot_id = coalesce(p_snapshot_id, snapshot_id), vehicle_id = coalesce(p_vehicle_id, vehicle_id),
    outcome = NULL, outcome_at = NULL, updated_at = now()
  WHERE id = v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_revision_item(p_id uuid, p_outcome text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_outcome NOT IN ('landed_whole','non_vehicle','dead_page','duplicate_of') THEN
    RAISE EXCEPTION 'resolve_revision_item: outcome % is not landed_whole, non_vehicle, dead_page or duplicate_of', p_outcome;
  END IF;
  UPDATE public.import_queue SET
    status = CASE WHEN p_outcome = 'landed_whole' THEN 'complete' ELSE 'resolved' END,
    outcome = p_outcome, outcome_at = now(), outcome_detail = p_detail,
    locked_by = NULL, locked_at = NULL, updated_at = now()
  WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.claim_revision_items(p_source_slug text, p_worker text, p_limit integer DEFAULT 10,
  p_actions text[] DEFAULT ARRAY['reparse_retained','refetch','relink','classify_non_vehicle','retry'])
RETURNS TABLE (id uuid, listing_url text, source_id uuid, vehicle_id uuid, snapshot_id uuid, revision_missing text[],
               revision_reason text, next_action text, attempts integer)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.import_queue q SET locked_by = p_worker, locked_at = now(), last_attempt_at = now(),
         attempts = coalesce(q.attempts, 0) + 1, revised_count = coalesce(q.revised_count, 0) + 1
  WHERE q.id IN (
    SELECT c.id FROM public.import_queue c
    LEFT JOIN public.scrape_sources s ON s.id = c.source_id
    WHERE c.status IN ('revision','failed') AND c.outcome IS NULL AND c.next_action = ANY (p_actions)
      AND (p_source_slug IS NULL OR lower(s.name) = lower(p_source_slug) OR s.id::text = p_source_slug)
      AND (c.locked_at IS NULL OR c.locked_at < now() - interval '15 minutes')
      AND (c.next_attempt_at IS NULL OR c.next_attempt_at <= now())
    ORDER BY c.priority DESC NULLS LAST, c.created_at
    LIMIT least(greatest(p_limit, 1), 100) FOR UPDATE OF c SKIP LOCKED)
  RETURNING q.id, q.listing_url, q.source_id, q.vehicle_id, q.snapshot_id, q.revision_missing, q.revision_reason, q.next_action, q.attempts;
$$;

CREATE OR REPLACE FUNCTION public.release_revision_item(p_id uuid, p_next_action text, p_retry_after interval DEFAULT interval '1 hour',
  p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE public.import_queue SET locked_by = NULL, locked_at = NULL, next_action = p_next_action,
         next_attempt_at = now() + p_retry_after, revision_detail = coalesce(revision_detail, '{}') || p_detail, updated_at = now()
  WHERE id = p_id AND outcome IS NULL;
$$;

-- The landing-depth test raises a lot that is thin or unlinked, and closes it landed_whole when a later reading finds it whole.
CREATE OR REPLACE FUNCTION public.record_lot_depth(p_url text, p_missing text[], p_snapshot_id uuid, p_vehicle_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_id uuid;
BEGIN
  IF coalesce(array_length(p_missing, 1), 0) = 0 THEN
    SELECT id INTO v_id FROM public.import_queue
      WHERE listing_url = p_url AND status = 'revision' AND outcome IS NULL AND revision_source = 'landing_depth';
    IF v_id IS NOT NULL THEN PERFORM public.resolve_revision_item(v_id, 'landed_whole', jsonb_build_object('by', 'landing_depth')); END IF;
    RETURN v_id;
  END IF;
  RETURN public.record_revision_item(p_url, p_missing,
    CASE WHEN 'vehicle_link' = ANY (p_missing) THEN 'unlinked_capture' ELSE 'thin_landing' END,
    CASE WHEN 'vehicle_link' = ANY (p_missing) THEN 'relink' ELSE 'reparse_retained' END,
    'landing_depth', p_snapshot_id, jsonb_build_object('measured_at', now()), p_vehicle_id);
END $$;

REVOKE ALL ON FUNCTION public.record_revision_item(text, text[], text, text, text, uuid, jsonb, uuid),
  public.resolve_revision_item(uuid, text, jsonb), public.claim_revision_items(text, text, integer, text[]),
  public.release_revision_item(uuid, text, interval, jsonb), public.record_lot_depth(text, text[], uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.v_revision_queue WITH (security_invoker = true) AS
SELECT 'lot'::text AS item_kind, q.id AS item_id, s.name AS source, q.listing_url,
       CASE WHEN q.locked_at > now() - interval '15 minutes' THEN 'working' ELSE 'revision' END AS state,
       coalesce(q.revision_missing, ARRAY['landing']) AS missing, coalesce(q.revision_reason, 'other') AS reason,
       coalesce(q.next_action, 'refetch') AS next_action, q.attempts, q.revision_source AS raised_by,
       coalesce(q.processed_at, q.updated_at, q.created_at) AS raised_at, q.snapshot_id, q.vehicle_id, q.next_attempt_at
FROM public.import_queue q LEFT JOIN public.scrape_sources s ON s.id = q.source_id
WHERE q.status IN ('revision', 'failed') AND q.outcome IS NULL
UNION ALL
SELECT 'derivation', d.id, d.extractor_slug, NULL, 'revision', ARRAY['derived_observations'], 'other', 'retry', d.attempts,
       d.requested_by, coalesce(d.completed_at, d.created_at), d.source_snapshot_id, d.source_vehicle_id, d.next_attempt_at
FROM public.derivation_queue d WHERE d.status = 'failed';

CREATE OR REPLACE VIEW public.v_revision_summary WITH (security_invoker = true) AS
SELECT item_kind, source, state, reason, next_action, count(*) AS items, min(raised_at) AS oldest
FROM public.v_revision_queue GROUP BY 1, 2, 3, 4, 5;

REVOKE ALL ON public.v_revision_queue, public.v_revision_summary FROM anon, authenticated;
COMMENT ON VIEW public.v_revision_queue IS 'Every lot that did not land whole, and derivation items that need another pass: what is missing, why, and the next action. Open items only; closed items keep their outcome on import_queue.';
COMMENT ON VIEW public.v_revision_summary IS 'v_revision_queue counted by kind, source, state, reason and next action.';

COMMIT;
