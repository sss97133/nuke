-- Reconnect the existing listing evidence fold to its queue and specs reader.
-- Live 2026-10-04: vehicle_field_consensus is empty, undescribed and unowned;
-- detect_field_conflicts only materializes disagreements and has no caller.
-- The inspected vehicle has one sourced listing VIN claim at confidence .60,
-- but its canonical VIN is unknown and get_vehicle_specs omits that field.
-- This materializes REPORTED values; it never accepts testimony or writes VIN.
-- Existing metric cron remains the only scheduled writer. No historical sweep.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.vehicle_field_consensus
  ADD COLUMN source_observation_id uuid REFERENCES public.vehicle_observations(id),
  ADD COLUMN as_of_at timestamptz;

COMMENT ON TABLE public.vehicle_field_consensus IS
'Derived reported-field state, one vehicle × field. detect_field_conflicts folds public listing testimony for dirty vehicles via the existing metric queue. get_vehicle_specs reads the result; canonical vehicle values are separate. Rebuildable, never an acceptance or calibrated truth verdict. RLS remains deny-by-default; the vehicle-gated RPC is the reader.';
COMMENT ON COLUMN public.vehicle_field_consensus.id IS 'UUID of this derived vehicle × field state row, retained across replay.';
COMMENT ON COLUMN public.vehicle_field_consensus.vehicle_id IS 'Foreign key to the vehicle whose sourced listing observations are folded.';
COMMENT ON COLUMN public.vehicle_field_consensus.field_name IS 'Top-level structured_data field vocabulary folded from public listing observations; one row per vehicle × field.';
COMMENT ON COLUMN public.vehicle_field_consensus.consensus_value IS 'Selected reported text. VIN/year/make/model are identity reports ordered by original confidence then event time. All other supported fields are changing reported state, ordered by event chronology first. Ingest time breaks ties, never replaces event time. Unresolved disagreements stay tentative; never an accepted canonical value.';
COMMENT ON COLUMN public.vehicle_field_consensus.consensus_confidence IS 'Uncalibrated stored confidence_score of the selected observation, on the 0–1 scale; neither evidence addition nor a truth probability.';
COMMENT ON COLUMN public.vehicle_field_consensus.resolution_method IS 'Existing vocabulary: unanimous means eligible static reports agree; most_recent selects the latest changing-field report, retaining history; unresolved means static reports disagree or latest changing reports disagree at the same event time. None means verified or owner accepted. Manual rows are preserved.';
COMMENT ON COLUMN public.vehicle_field_consensus.supporting_count IS 'Count of eligible observation rows with the selected reported value. Counts testimony rows, not independent sources.';
COMMENT ON COLUMN public.vehicle_field_consensus.conflicting_count IS 'Count of eligible observation rows with a different reported value; changing fields include prior historical values here. resolution_method, not this count alone, declares unresolved conflict. Zero does not establish truth.';
COMMENT ON COLUMN public.vehicle_field_consensus.supporting_observation_ids IS 'Legacy UUID array metadata; not foreign keys and not used by this fold. The selected source uses source_observation_id.';
COMMENT ON COLUMN public.vehicle_field_consensus.conflicting_observation_ids IS 'Legacy UUID array metadata; not foreign keys and not used by this fold.';
COMMENT ON COLUMN public.vehicle_field_consensus.all_values IS 'Replayable audit summary of eligible public listing reports: value, original confidence, source label, observed_at event time and ingested_at ingest time. Not independent-source votes.';
COMMENT ON COLUMN public.vehicle_field_consensus.resolved_at IS 'Legacy manual resolution time; automated listing folds do not fill it.';
COMMENT ON COLUMN public.vehicle_field_consensus.resolved_by IS 'Legacy resolver declaration; automated listing folds do not fabricate a resolver.';
COMMENT ON COLUMN public.vehicle_field_consensus.created_at IS 'Ingest/system time when this derived vehicle × field row was first created.';
COMMENT ON COLUMN public.vehicle_field_consensus.updated_at IS 'System computation time of its latest replay; not the listing event time.';
COMMENT ON COLUMN public.vehicle_field_consensus.source_observation_id IS 'Foreign key to the selected immutable listing testimony. Its source_id, method, confidence_score, observed_at event time and ingested_at ingest time are authoritative.';
COMMENT ON COLUMN public.vehicle_field_consensus.as_of_at IS 'System cutoff of this current-state fold. Only testimony with both observed_at and ingested_at at or before this time is eligible. This current-state row is not a historical feature snapshot.';

CREATE OR REPLACE FUNCTION public.detect_field_conflicts(p_vehicle_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_as_of timestamptz := statement_timestamp();
  v_record record;
  v_conflicts integer := 0;
  v_seen_fields text[] := '{}';
  v_changing_fields text[] := ARRAY['mileage','reported_mileage','color','exterior_color',
    'interior_color','engine','engine_type','fuel_type','transmission','drivetrain',
    'title_status','title_text','condition_rating','condition_class','body_style',
    'asking_price','currency','location_token','listing_status'];
  v_fields text[] := ARRAY['year','make','model','vin','mileage','reported_mileage',
    'color','exterior_color','interior_color','engine','engine_type','fuel_type',
    'transmission','drivetrain','title_status','title_text','condition_rating',
    'condition_class','body_style','asking_price','currency','location_token','listing_status'];
BEGIN
  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'detect_field_conflicts requires one vehicle' USING ERRCODE = '22023';
  END IF;
  -- Serialize a direct replay with this vehicle's scheduled replay. The metric
  -- drain already holds this parent lock; repeat acquisition is harmless.
  PERFORM 1 FROM public.vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  FOR v_record IN
    WITH reports AS MATERIALIZED (
      SELECT o.id, o.source_id, o.confidence_score, o.observed_at, o.ingested_at,
             s.slug, kv.key AS field_name, kv.value #>> '{}' AS field_value
      FROM public.vehicle_observations o
      LEFT JOIN public.observation_sources s ON s.id = o.source_id
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(o.structured_data) = 'object'
        THEN o.structured_data ELSE '{}'::jsonb END) kv
      WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'listing'
        AND o.subject_type = 'vehicle' AND o.is_superseded IS NOT TRUE
        AND public.observation_is_public(o.kind, o.structured_data)
        AND o.structured_data ?| v_fields AND kv.key = ANY(v_fields)
        AND jsonb_typeof(kv.value) IN ('string','number','boolean')
        AND nullif(btrim(kv.value #>> '{}'), '') IS NOT NULL
        AND o.observed_at <= v_as_of AND o.ingested_at <= v_as_of
    ), ranked AS (
      SELECT r.*, row_number() OVER (PARTITION BY field_name
        ORDER BY CASE WHEN field_name = ANY(v_changing_fields) THEN observed_at END DESC NULLS LAST,
                 confidence_score DESC NULLS LAST, observed_at DESC,
                 ingested_at DESC, id) AS position
      FROM reports r
    )
    SELECT best.field_name, best.id, best.field_value, best.confidence_score,
      count(*) FILTER (WHERE r.field_value = best.field_value)::integer AS supporting,
      count(*) FILTER (WHERE r.field_value <> best.field_value)::integer AS conflicting,
      count(*) FILTER (WHERE r.field_value <> best.field_value
        AND r.observed_at = best.observed_at)::integer AS latest_conflicting,
      jsonb_agg(jsonb_build_object('value',r.field_value,
        'confidence',r.confidence_score,'source',r.slug,
        'observed_at',r.observed_at,'ingested_at',r.ingested_at)
        ORDER BY r.position) AS all_values
    FROM ranked best JOIN ranked r USING (field_name)
    WHERE best.position = 1
    GROUP BY best.field_name, best.id, best.field_value, best.confidence_score,best.observed_at
  LOOP
    v_seen_fields := array_append(v_seen_fields,v_record.field_name);
    INSERT INTO public.vehicle_field_consensus
      (vehicle_id,field_name,consensus_value,consensus_confidence,resolution_method,
       supporting_count,conflicting_count,all_values,source_observation_id,as_of_at)
    VALUES (p_vehicle_id,v_record.field_name,v_record.field_value,v_record.confidence_score,
      CASE WHEN v_record.field_name = ANY(v_changing_fields) AND v_record.latest_conflicting = 0 THEN 'most_recent'
           WHEN v_record.conflicting = 0 THEN 'unanimous' ELSE 'unresolved' END,
      v_record.supporting,v_record.conflicting,v_record.all_values,v_record.id,v_as_of)
    ON CONFLICT (vehicle_id,field_name) DO UPDATE SET
      consensus_value = EXCLUDED.consensus_value,
      consensus_confidence = EXCLUDED.consensus_confidence,
      resolution_method = EXCLUDED.resolution_method,
      supporting_count = EXCLUDED.supporting_count,
      conflicting_count = EXCLUDED.conflicting_count,
      all_values = EXCLUDED.all_values,
      source_observation_id = EXCLUDED.source_observation_id,
      as_of_at = EXCLUDED.as_of_at, updated_at = v_as_of
    WHERE vehicle_field_consensus.resolution_method <> 'manual';
    IF (v_record.field_name = ANY(v_changing_fields) AND v_record.latest_conflicting > 0)
       OR (NOT (v_record.field_name = ANY(v_changing_fields)) AND v_record.conflicting > 0)
    THEN v_conflicts := v_conflicts + 1; END IF;
  END LOOP;

  -- Retire derived state whose last eligible testimony was superseded/relinked.
  -- Original testimony and manual decisions remain untouched.
  DELETE FROM public.vehicle_field_consensus c
  WHERE c.vehicle_id = p_vehicle_id AND c.resolution_method <> 'manual'
    AND c.field_name = ANY(v_fields) AND NOT (c.field_name = ANY(v_seen_fields));
  RETURN v_conflicts;
END;
$function$;
REVOKE ALL ON FUNCTION public.detect_field_conflicts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_field_conflicts(uuid) TO service_role;
COMMENT ON FUNCTION public.detect_field_conflicts(uuid) IS
'Current reported-state fold at vehicle × top-level listing field grain. Existing metric drain is the scheduled owner; fixed-log replay preserves values, sources and counts. Event and ingest time both precede as_of_at. Every supported field except VIN/year/make/model uses event chronology first; prior changing values remain in all_values, same-event disagreements are unresolved. Identity reports use stored confidence then event chronology. Confidence is never vote-inflated; manual decisions retained, canonical values never written.';

CREATE OR REPLACE FUNCTION public.update_vehicle_live_metrics()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE v_id uuid;
BEGIN
  -- Sanctioned relink/supersession changes must invalidate both vehicle heads.
  -- Ordinary processing metadata updates do not dirty this fold.
  FOR v_id IN SELECT DISTINCT id FROM unnest(
    CASE WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.vehicle_id]
         WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.vehicle_id]
         ELSE ARRAY[OLD.vehicle_id,NEW.vehicle_id] END) ids(id)
    WHERE id IS NOT NULL ORDER BY id
  LOOP
    INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty)
    SELECT v_id,true WHERE EXISTS (SELECT 1 FROM public.vehicles WHERE id = v_id)
    ON CONFLICT (vehicle_id) DO UPDATE SET live_metrics_dirty = true,
      queued_at = LEAST(vehicle_metric_recompute_queue.queued_at,now());
  END LOOP;
  RETURN coalesce(NEW,OLD);
END;
$function$;
DROP TRIGGER trg_update_live_metrics ON public.vehicle_observations;
CREATE TRIGGER trg_update_live_metrics AFTER INSERT OR DELETE OR
  UPDATE OF vehicle_id,is_superseded,observed_at,ingested_at,structured_data,kind,subject_type,source_id,confidence_score
ON public.vehicle_observations FOR EACH ROW EXECUTE FUNCTION public.update_vehicle_live_metrics();

-- Recover the live queue drain (not represented in the older migration tree),
-- add the existing field fold, and carry retry evidence across failed claims.
CREATE OR REPLACE FUNCTION public.drain_vehicle_metric_queue(p_batch_size integer DEFAULT 100)
RETURNS TABLE(processed integer,errored integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE r record; n_processed integer := 0; n_errored integer := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'metric drain batch size must be 1..1000' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    DELETE FROM public.vehicle_metric_recompute_queue
    WHERE vehicle_id IN (SELECT vehicle_id FROM public.vehicle_metric_recompute_queue
      ORDER BY queued_at,vehicle_id LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
    RETURNING vehicle_id,live_metrics_dirty,observation_count_dirty,attempts
  LOOP
    BEGIN
      -- Match the direct fold's parent-first lock order before derived writes.
      PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
      IF r.observation_count_dirty THEN
        UPDATE public.vehicles v SET observation_count = (
          SELECT count(*) FROM public.vehicle_observations o WHERE o.vehicle_id = r.vehicle_id)
        WHERE v.id = r.vehicle_id;
      END IF;
      IF r.live_metrics_dirty THEN
        INSERT INTO public.vehicle_live_metrics
          (vehicle_id,observation_count,comment_count,last_observation_at,updated_at)
        SELECT r.vehicle_id,count(*),count(*) FILTER (WHERE kind = 'comment'),max(observed_at),now()
        FROM public.vehicle_observations WHERE vehicle_id = r.vehicle_id
        ON CONFLICT (vehicle_id) DO UPDATE SET
          observation_count = EXCLUDED.observation_count,comment_count = EXCLUDED.comment_count,
          last_observation_at = EXCLUDED.last_observation_at,updated_at = EXCLUDED.updated_at;
        PERFORM public.detect_field_conflicts(r.vehicle_id);
      END IF;
      n_processed := n_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      n_errored := n_errored + 1;
      INSERT INTO public.vehicle_metric_recompute_queue
        (vehicle_id,live_metrics_dirty,observation_count_dirty,queued_at,attempts,last_error)
      VALUES (r.vehicle_id,r.live_metrics_dirty,r.observation_count_dirty,now(),coalesce(r.attempts,0)+1,SQLERRM)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        live_metrics_dirty = vehicle_metric_recompute_queue.live_metrics_dirty OR EXCLUDED.live_metrics_dirty,
        observation_count_dirty = vehicle_metric_recompute_queue.observation_count_dirty OR EXCLUDED.observation_count_dirty,
        attempts = greatest(vehicle_metric_recompute_queue.attempts,EXCLUDED.attempts),
        last_error = EXCLUDED.last_error,queued_at = EXCLUDED.queued_at;
      -- Keep failures visible/retryable; never drop an unmaterialized fold.
      RAISE WARNING 'metric fold failed for vehicle %, attempt %: %',r.vehicle_id,coalesce(r.attempts,0)+1,SQLERRM;
    END;
  END LOOP;
  RETURN QUERY SELECT n_processed,n_errored;
END;
$function$;
REVOKE ALL ON FUNCTION public.drain_vehicle_metric_queue(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_metric_queue(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_vehicle_specs(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH gate AS MATERIALIZED (
    SELECT v.* FROM public.vehicles v WHERE v.id = p_vehicle_id
      AND v.deleted_at IS NULL AND coalesce(v.listing_kind,'') <> 'non_vehicle_item'
      AND (v.is_public = true OR auth.uid() IN (v.user_id,v.owner_id,v.uploaded_by))
  ), fields(ord,label,fld) AS (VALUES
    (1,'VIN','vin'),(2,'Mileage','mileage'),(3,'Transmission','transmission'),
    (4,'Drivetrain','drivetrain'),(5,'Body','body_style'),(6,'Color','color'),
    (7,'Interior','interior_color'),(8,'Engine','engine_type'),(9,'Fuel','fuel_type')
  ), reports AS MATERIALIZED (
    SELECT c.*,o.source_id,o.observed_at,o.ingested_at,o.extraction_method,s.slug
    FROM public.vehicle_field_consensus c
    JOIN public.vehicle_observations o ON o.id = c.source_observation_id
    LEFT JOIN public.observation_sources s ON s.id = o.source_id
    WHERE c.vehicle_id = p_vehicle_id AND EXISTS (SELECT 1 FROM gate)
      AND o.vehicle_id = c.vehicle_id AND o.is_superseded IS NOT TRUE
      AND o.kind = 'listing' AND o.subject_type = 'vehicle'
      AND o.structured_data->>c.field_name IS NOT DISTINCT FROM c.consensus_value
      AND o.confidence_score IS NOT DISTINCT FROM c.consensus_confidence
      AND public.observation_is_public(o.kind,o.structured_data)
      AND o.observed_at <= c.as_of_at AND o.ingested_at <= c.as_of_at
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM gate) THEN NULL ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'field',f.fld,'label',f.label,'value',nullif(btrim(to_jsonb(g)->>f.fld),''),
      'inline_source',to_jsonb(g)->>(f.fld||'_source'),
      'reported_value',CASE WHEN nullif(btrim(to_jsonb(g)->>f.fld),'') IS NULL
        AND r.resolution_method <> 'unresolved' THEN r.consensus_value END,
      'reported_conflict',r.source_observation_id IS NOT NULL AND coalesce(r.resolution_method = 'unresolved' OR (
        nullif(btrim(to_jsonb(g)->>f.fld),'') IS NOT NULL AND
        lower(btrim(to_jsonb(g)->>f.fld)) IS DISTINCT FROM lower(btrim(r.consensus_value))),false),
      'reported_count',coalesce(r.supporting_count+r.conflicting_count,0),
      'reported_source',r.slug,'source_observation_id',r.source_observation_id,
      'reported_observed_at',r.observed_at,'reported_ingested_at',r.ingested_at,
      'reported_confidence',r.consensus_confidence,'reported_method',r.extraction_method,
      'as_of_at',r.as_of_at,
      'rooted',nullif(btrim(to_jsonb(g)->>f.fld),'') IS NOT NULL AND coalesce((
        lower(btrim(to_jsonb(g)->>f.fld)) = lower(btrim(r.consensus_value))
        OR EXISTS (SELECT 1 FROM public.vehicle_images i
          WHERE i.vehicle_id = p_vehicle_id
            AND i.id = CASE WHEN to_jsonb(g)->>(f.fld||'_source_image_id')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (to_jsonb(g)->>(f.fld||'_source_image_id'))::uuid END
            AND i.is_sensitive IS NOT TRUE AND i.is_superseded IS NOT TRUE
            AND i.is_duplicate IS NOT TRUE
            AND (i.vision_gate_status IS NULL OR i.vision_gate_status::text = 'approved')
            AND coalesce(i.image_vehicle_match_status,'') NOT IN ('mismatch','unrelated'))
        OR EXISTS (SELECT 1 FROM public.vehicle_field_sources fs
          WHERE fs.vehicle_id = p_vehicle_id AND fs.field_name = f.fld
            AND lower(btrim(fs.field_value)) = lower(btrim(to_jsonb(g)->>f.fld))
            AND coalesce(fs.source_type,'') NOT IN ('computed',''))
        OR EXISTS (SELECT 1 FROM public.field_evidence fe
          WHERE fe.vehicle_id = p_vehicle_id AND fe.field_name = f.fld
            AND lower(btrim(fe.proposed_value)) = lower(btrim(to_jsonb(g)->>f.fld))
            AND fe.status IN ('pending','accepted'))
      ),false),'evidence_count',coalesce(r.supporting_count+r.conflicting_count,0)) ORDER BY f.ord)
    FROM fields f CROSS JOIN gate g LEFT JOIN reports r ON r.field_name = f.fld
    WHERE nullif(btrim(to_jsonb(g)->>f.fld),'') IS NOT NULL OR r.source_observation_id IS NOT NULL
  ),'[]'::jsonb) END
$function$;
REVOKE ALL ON FUNCTION public.get_vehicle_specs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vehicle_specs(uuid) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.get_vehicle_specs(uuid) IS
'Vehicle-gated spec reader. value is the canonical vehicle value; reported_value is a sole nonconflicting listing report when value is unknown, and reported_conflict preserves disagreement. Rootedness requires value-matching active evidence. Source observation FK, method, stored confidence, event/ingest clocks and fold as_of are retained. Reads materialized report state, never rescans the listing log at page time; no testimony promotion.';

INSERT INTO public.pipeline_registry
  (table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('vehicle_field_consensus',NULL,'detect_field_conflicts',
  'Public sourced listing state for dirty vehicles. Existing drain_vehicle_metric_queue via drain-vehicle-derived-queues cron; reader get_vehicle_specs, drill get_field_provenance. Assay: fresh listing fields acquire a keyed source and two source clocks by the next successful metric drain; replay preserves counts; canonical values remain separate.',
  true,'drain_vehicle_metric_queue')
ON CONFLICT (table_name,column_name) DO NOTHING;

-- Preserve the existing drill contract and image gates; qualify the source
-- clocks and enforce the observation-level public gate beneath a public vehicle.
CREATE OR REPLACE FUNCTION public.get_field_provenance(p_vehicle_id uuid, p_field text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with gate as (
    select v.* from public.vehicles v
    where v.id = p_vehicle_id
      and (v.is_public = true
           or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  prov as (
    select primary_source, total_confidence
    from public.vehicle_field_provenance
    where vehicle_id = p_vehicle_id and field_name = p_field
    limit 1
  ), visible_images as materialized (
    select i.id, i.image_url
    from public.vehicle_images i
    where i.vehicle_id = p_vehicle_id and exists (select 1 from gate)
      and nullif(btrim(i.image_url), '') is not null
      and i.is_sensitive is not true and i.is_superseded is not true
      and i.is_duplicate is not true
      and (i.vision_gate_status is null or i.vision_gate_status::text = 'approved')
      and coalesce(i.image_vehicle_match_status, '') not in ('mismatch', 'unrelated')
  ), field_observations as materialized (
    select o.*, s.slug as source_slug, s.base_trust_score as source_trust,
           case when o.structured_data->>'image_id'
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (o.structured_data->>'image_id')::uuid end as legacy_image_id
    from public.vehicle_observations o
    left join public.observation_sources s on s.id = o.source_id
    where o.vehicle_id = p_vehicle_id and o.is_superseded is not true
      and o.structured_data ? p_field
      and (public.observation_is_public(o.kind,o.structured_data)
           or exists (select 1 from gate g where auth.uid() in (g.user_id,g.owner_id,g.uploaded_by)))
  ), image_observations as (
    -- Typed derived edges are authoritative when present. Visibility is checked
    -- again at read time; a hidden typed edge must not reopen a JSON fallback.
    select o.*, w.id as witness_id, w.witness_role,
           i.id as visible_image_id, i.image_url as visible_image_url
    from field_observations o
    join public.observation_witnesses w on w.observation_id = o.id and w.witness_role = 'derived'
    join visible_images i on i.id = w.image_id
    union all
    select o.*, null::uuid as witness_id, null::text as witness_role,
           i.id as visible_image_id, i.image_url as visible_image_url
    from field_observations o
    join visible_images i on i.id = o.legacy_image_id
    where not exists (select 1 from public.observation_witnesses w
      where w.observation_id = o.id and w.witness_role = 'derived')
  ), readable_observations as (
    select o.* from field_observations o
    where (not (o.structured_data ? 'image_id') and not exists (
      select 1 from public.observation_witnesses w
      where w.observation_id = o.id and w.witness_role = 'derived'))
      or exists (select 1 from image_observations i where i.id = o.id)
  )
  select case when not exists (select 1 from gate) then null else jsonb_build_object(
    'field', p_field,
    'vehicle_id', p_vehicle_id,
    'value',             (select to_jsonb(g)->>p_field                          from gate g),
    -- inline source falls back to the consensus primary_source (vehicle_field_provenance)
    'inline_source', coalesce(
        (select to_jsonb(g)->>(p_field||'_source')     from gate g),
        (select primary_source from prov)),
    'inline_confidence', coalesce(
        (select to_jsonb(g)->>(p_field||'_confidence') from gate g),
        (select total_confidence::text from prov)),
    -- source image falls back to the cited field_evidence row's photo
    'source_image_url', coalesce(
        (select i.image_url from visible_images i
          where i.id = case
            when (select to_jsonb(g)->>(p_field||'_source_image_id') from gate g)
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (select to_jsonb(g)->>(p_field||'_source_image_id') from gate g)::uuid end),
        (select i.image_url from public.field_evidence fe
          join visible_images i on
            i.id = case when fe.raw_extraction_data->>'photo_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (fe.raw_extraction_data->>'photo_id')::uuid end
            or (not (fe.raw_extraction_data ? 'photo_id')
                and i.image_url = fe.raw_extraction_data->>'image_url')
          where fe.vehicle_id = p_vehicle_id and fe.field_name = p_field
            and fe.status <> 'superseded' and fe.status not like 'rejected%'
          order by fe.source_confidence desc nulls last limit 1)),
    -- evidence = vehicle_field_sources ∪ field_evidence (the consensus pipeline), highest confidence first
    'evidence', coalesce((
        select jsonb_agg(e order by (e->>'confidence')::numeric desc nulls last) from (
          select jsonb_build_object(
            'source','vehicle_field_sources','value',fs.field_value,
            'source_type',fs.source_type,'confidence',fs.confidence_score,
            'verified',fs.is_verified,'reasoning',fs.ai_reasoning,
            'image_id',i.id,'at',fs.created_at) as e
          from public.vehicle_field_sources fs
          left join visible_images i on i.id = fs.source_image_id
          where fs.vehicle_id = p_vehicle_id and fs.field_name = p_field
            and coalesce(fs.field_value,'') <> ''
          union all
          select jsonb_build_object(
            'source','field_evidence','value',fe.proposed_value,
            'source_type',fe.source_type,'confidence',fe.source_confidence,
            'verified',(fe.status='accepted'),'reasoning',fe.extraction_context,
            'image_id',i.id,'at',fe.created_at) as e
          from public.field_evidence fe
          left join visible_images i on i.id = case
            when fe.raw_extraction_data->>'photo_id'
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (fe.raw_extraction_data->>'photo_id')::uuid end
          where fe.vehicle_id = p_vehicle_id and fe.field_name = p_field
            and coalesce(fe.proposed_value,'') <> '' and fe.status <> 'superseded' and fe.status not like 'rejected%'
        ) all_e), '[]'::jsonb),
    'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id',o.id,'content',left(o.content_text,400),
            'value',o.structured_data->>p_field,'confidence',o.confidence_score,
            'observed_at',o.observed_at,'ingested_at',o.ingested_at,
            'extraction_method',o.extraction_method,'agent_model',o.agent_model,'kind',o.kind::text,
            'source_slug',o.source_slug,'trust',o.source_trust,'source_url',o.source_url)
            order by o.confidence_score desc nulls last,o.observed_at desc nulls last,o.ingested_at desc,o.id)
        from readable_observations o), '[]'::jsonb),
    'image_observations', coalesce((
        select jsonb_agg(jsonb_build_object(
            'observation_id',o.id,'image_id',o.visible_image_id,
            'witness_id',o.witness_id,'witness_role',o.witness_role,
            'image_url',o.visible_image_url,'value',o.structured_data->>p_field,
            'source_slug',o.source_slug,'source_url',o.source_url,
            'extraction_method',o.extraction_method,'agent_model',o.agent_model,
            'observed_at',o.observed_at,'ingested_at',o.ingested_at,
            'confidence',o.confidence_score,
            'claim_role',o.structured_data->>'claim_role',
            'image_region',o.structured_data->'image_region',
            'reference',o.structured_data->'reference',
            'source_family',o.structured_data->>'source_family',
            'visual_relation',o.structured_data->>'visual_relation',
            'limitation',coalesce(o.structured_data->>'limitation',o.extraction_metadata->>'limitation'),
            'is_inferred',coalesce(o.structured_data->'is_inferred',o.extraction_metadata->'is_inferred'))
            order by o.confidence_score desc nulls last, o.ingested_at desc, o.id)
        from image_observations o), '[]'::jsonb)
  ) end
$function$;

NOTIFY pgrst,'reload schema';
COMMIT;
