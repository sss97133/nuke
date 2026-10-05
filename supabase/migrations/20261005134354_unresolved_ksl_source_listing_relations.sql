-- DRAFT: requires owner/root review before deployment or retained admission.
-- Canonical vehicle_events owns source listings; this bridge does not rewrite testimony.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.vehicle_events ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE public.vehicle_events ADD CONSTRAINT vehicle_events_unresolved_listing_shape CHECK (
  vehicle_id IS NOT NULL OR (
    source_platform = 'ksl' AND event_type = 'listing' AND event_status = 'observed'
    AND source_listing_id ~ '^cars\.ksl\.com/auto/listing/[0-9]+$'
    AND source_url = 'https://' || source_listing_id
    AND metadata->>'identity_state' = 'unresolved_source_listing'
    AND metadata->>'writer' = 'ingest-observation:ksl_listing_relation_v1'
    AND id = md5('ksl-email-listing-blip-v1:' || source_listing_id)::uuid
    AND source_organization_id IS NULL AND starting_price IS NULL AND current_price IS NULL
    AND final_price IS NULL AND reserve_price IS NULL AND buy_now_price IS NULL
    AND started_at IS NULL AND ended_at IS NULL AND sold_at IS NULL
    AND bid_count IS NULL AND comment_count IS NULL AND view_count IS NULL AND watcher_count IS NULL
    AND extracted_at IS NULL
  ) IS TRUE
) NOT VALID;
COMMENT ON CONSTRAINT vehicle_events_unresolved_listing_shape ON public.vehicle_events IS
'Only KSL source-listing blips may precede a vehicle match. Observed means dated publisher presentation, not active availability or sale. Unknown prices/outcomes stay NULL; ordinary existing event shapes still require a vehicle.';
-- The constrained namespace-derived PK supplies source-key uniqueness using the
-- existing primary index. No existing large-table index build or rewrite.
CREATE POLICY vehicle_events_resolved_public_boundary ON public.vehicle_events AS RESTRICTIVE
  FOR ALL TO anon,authenticated USING(vehicle_id IS NOT NULL) WITH CHECK(vehicle_id IS NOT NULL);
-- This existing definer aggregate bypasses table RLS. Preserve its vehicle grain:
-- unresolved source blips must not introduce a public NULL-vehicle cohort.
CREATE OR REPLACE VIEW public.vehicle_event_summary AS
SELECT vehicle_id,count(*) AS total_events,
  count(CASE WHEN event_status='sold' THEN 1 END) AS times_sold,
  count(DISTINCT source_platform) AS platforms_seen,
  array_agg(DISTINCT source_platform ORDER BY source_platform) AS platform_list,
  min(started_at) AS first_event_date,max(COALESCE(ended_at,sold_at,started_at)) AS last_event_date,
  max(final_price) AS highest_sale_price,min(final_price) FILTER(WHERE final_price>0) AS lowest_sale_price,
  round(avg(final_price) FILTER(WHERE final_price IS NOT NULL),2) AS avg_sale_price,
  sum(bid_count) AS total_bids,sum(comment_count) AS total_comments,sum(view_count) AS total_views
FROM public.vehicle_events WHERE vehicle_id IS NOT NULL GROUP BY vehicle_id;

CREATE TABLE public.vehicle_event_observations (
  observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  vehicle_event_id uuid NOT NULL REFERENCES public.vehicle_events(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  writer text NOT NULL DEFAULT 'ingest-observation:ksl_listing_relation_v1'
    CHECK (writer='ingest-observation:ksl_listing_relation_v1')
);
COMMENT ON TABLE public.vehicle_event_observations IS
'Append-only typed source-listing membership of original admitted observations. One observation/card belongs to one source listing; source testimony and four source/receipt/event/ingest clocks remain on the immutable observation. linked_at records when this relation became known, not original ingestion or current availability. Canonical ingest-observation owns admission. Protected sale ancestry is separate and unchanged.';
COMMENT ON COLUMN public.vehicle_event_observations.observation_id IS 'Original admitted source email/card observation FK; never a rewritten or re-ingested copy.';
COMMENT ON COLUMN public.vehicle_event_observations.vehicle_event_id IS 'Canonical vehicle_events source listing/blip FK, explicitly unresolved vehicle permitted only by narrow KSL shape.';
COMMENT ON COLUMN public.vehicle_event_observations.linked_at IS 'Database recording time of relationship admission; not source time, mailbox receipt or original observation ingestion.';
COMMENT ON COLUMN public.vehicle_event_observations.writer IS 'Canonical producer declaration; authorization is service-role-only RPC execution, not this label.';
CREATE INDEX vehicle_event_observations_event ON public.vehicle_event_observations(vehicle_event_id);
ALTER TABLE public.vehicle_event_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_event_observations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.vehicle_event_observations TO service_role;

CREATE FUNCTION public.preserve_ksl_listing_relation() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='vehicle_events' THEN
    IF OLD.metadata->>'writer' IS DISTINCT FROM 'ingest-observation:ksl_listing_relation_v1' THEN
      IF TG_OP='DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'source listing relationship is append-only' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER preserve_ksl_listing_relation BEFORE UPDATE OR DELETE ON public.vehicle_event_observations
  FOR EACH ROW EXECUTE FUNCTION public.preserve_ksl_listing_relation();
CREATE TRIGGER preserve_ksl_listing_relation_truncate BEFORE TRUNCATE ON public.vehicle_event_observations
  FOR EACH STATEMENT EXECUTE FUNCTION public.preserve_ksl_listing_relation();
CREATE TRIGGER preserve_ksl_listing_parent BEFORE UPDATE OR DELETE ON public.vehicle_events
  FOR EACH ROW EXECUTE FUNCTION public.preserve_ksl_listing_relation();

CREATE FUNCTION public.link_ksl_listing_observations(p_observation_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET statement_timeout='10s' SET lock_timeout='2s' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  source_uuid uuid;
  listing_id text;
  canonical_url text;
  source_key text;
  event_uuid uuid;
  existing_uuid uuid;
  admitted int:=0;
  replayed int:=0;
  ids uuid[];
  one_id uuid;
  candidate_ids uuid[];
  candidate public.vehicle_events%ROWTYPE;
  relations jsonb:='[]'::jsonb;
BEGIN
  IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE='42501'; END IF;
  IF p_observation_ids IS NULL OR cardinality(p_observation_ids)<1 OR cardinality(p_observation_ids)>100
     OR array_position(p_observation_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'expected 1-100 explicit observation UUIDs' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(p_observation_ids) x;
  -- Serialize this bounded, new owner lane without taking a lock on other writers.
  -- A second batch refuses contention; it never holds overlapping key locks in
  -- inconsistent order or waits behind unrelated extraction.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ksl-listing-relation-v1',0)) THEN
    RAISE EXCEPTION 'source listing relation admission already active' USING ERRCODE='55P03';
  END IF;
  SELECT id INTO source_uuid FROM public.observation_sources WHERE slug='ksl';
  IF source_uuid IS NULL THEN RAISE EXCEPTION 'canonical KSL source missing'; END IF;
  FOREACH one_id IN ARRAY ids LOOP
    SELECT * INTO o FROM public.vehicle_observations WHERE id=one_id FOR SHARE NOWAIT;
    IF NOT FOUND OR o.source_id IS DISTINCT FROM source_uuid OR o.kind::text IS DISTINCT FROM 'listing'
       OR o.vehicle_id IS NOT NULL OR coalesce(o.is_superseded,false)
       OR o.extraction_method IS DISTINCT FROM 'mail-alerts-v3'
       OR o.structured_data->>'kind_detail' IS DISTINCT FROM 'publisher_email_listing'
       OR coalesce(o.structured_data->>'email_role','') NOT IN ('saved_search_match','recommendation')
       OR o.observed_at IS NULL OR o.ingested_at IS NULL
       OR o.structured_data->>'email_received_at' IS NULL
       OR coalesce(o.structured_data->>'raw_sha256','') !~ '^[0-9a-f]{64}$'
       OR o.raw_source_ref IS DISTINCT FROM 'sha256:'||(o.structured_data->>'raw_sha256') THEN
      RAISE EXCEPTION 'unsupported admitted KSL email/card observation %',one_id USING ERRCODE='23514';
    END IF;
    listing_id:=o.structured_data->>'listing_id';
    IF listing_id IS NULL OR listing_id !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid listing ID' USING ERRCODE='23514'; END IF;
    canonical_url:='https://cars.ksl.com/auto/listing/'||listing_id;
    source_key:='cars.ksl.com/auto/listing/'||listing_id;
    IF o.source_url NOT IN (canonical_url,'https://cars.ksl.com/listing/'||listing_id)
       OR o.source_url IS NULL OR o.structured_data->>'url' IS DISTINCT FROM canonical_url
       OR o.source_identifier !~ '^email:[0-9a-f]{64}:[0-9a-f]{24}$'
       OR right(o.source_identifier,24) IS DISTINCT FROM left(encode(extensions.digest(canonical_url,'sha256'),'hex'),24)
       OR o.observed_at IS DISTINCT FROM coalesce((o.structured_data->>'email_sent_at')::timestamptz,
                                                  (o.structured_data->>'email_received_at')::timestamptz) THEN
      RAISE EXCEPTION 'source listing identity or clock conflict %',one_id USING ERRCODE='23514';
    END IF;
    -- A unique compatible canonical native listing may already have a vehicle.
    -- Link its source entity only; do not mutate original observation attribution,
    -- parent monetary/state fields, or protected sale ancestry. Multiple episodes,
    -- contradictory key/URL tuples and other event kinds refuse atomically.
    SELECT array_agg(e.id ORDER BY e.id) INTO candidate_ids FROM public.vehicle_events e WHERE e.source_platform='ksl'
      AND (e.source_listing_id IN (source_key,listing_id,'cars.ksl.com/listing/'||listing_id,canonical_url,'https://cars.ksl.com/listing/'||listing_id)
           OR e.source_url IN (canonical_url,'https://cars.ksl.com/listing/'||listing_id));
    IF cardinality(candidate_ids)>1 THEN RAISE EXCEPTION 'multiple canonical listing candidates require review' USING ERRCODE='23514'; END IF;
    IF cardinality(candidate_ids)=1 THEN
      SELECT * INTO candidate FROM public.vehicle_events WHERE id=candidate_ids[1] FOR SHARE NOWAIT;
      IF candidate.event_type IS DISTINCT FROM 'listing'
         OR (candidate.source_url IS NOT NULL AND candidate.source_url NOT IN (canonical_url,'https://cars.ksl.com/listing/'||listing_id))
         OR (candidate.source_listing_id IS NOT NULL AND candidate.source_listing_id NOT IN
              (source_key,listing_id,'cars.ksl.com/listing/'||listing_id,canonical_url,'https://cars.ksl.com/listing/'||listing_id))
         OR (candidate.vehicle_id IS NULL AND candidate.metadata->>'writer' IS DISTINCT FROM 'ingest-observation:ksl_listing_relation_v1') THEN
        RAISE EXCEPTION 'canonical source listing tuple conflicts' USING ERRCODE='23514';
      END IF;
      event_uuid:=candidate.id;
    ELSE
    event_uuid:=md5('ksl-email-listing-blip-v1:'||source_key)::uuid;
    IF EXISTS(SELECT 1 FROM public.vehicle_events WHERE id=event_uuid AND
      (source_listing_id IS DISTINCT FROM source_key OR source_platform IS DISTINCT FROM 'ksl'
       OR metadata->>'writer' IS DISTINCT FROM 'ingest-observation:ksl_listing_relation_v1')) THEN
      RAISE EXCEPTION 'source listing namespace collision' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.vehicle_events WHERE id=event_uuid) THEN
      INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_listing_id,source_url,event_type,event_status,metadata,extraction_method,
        bid_count,comment_count,view_count,watcher_count,extracted_at)
      VALUES(event_uuid,NULL,'ksl',source_key,canonical_url,'listing','observed',
        jsonb_build_object('identity_state','unresolved_source_listing','writer','ingest-observation:ksl_listing_relation_v1'),
        'ksl_listing_relation_v1',NULL,NULL,NULL,NULL,NULL) RETURNING id INTO event_uuid;
    END IF;
    END IF;
    SELECT vehicle_event_id INTO existing_uuid FROM public.vehicle_event_observations WHERE observation_id=one_id;
    IF existing_uuid IS NOT NULL THEN
      IF existing_uuid<>event_uuid THEN RAISE EXCEPTION 'observation already linked to another source listing' USING ERRCODE='23514'; END IF;
      replayed:=replayed+1;
    ELSE
      INSERT INTO public.vehicle_event_observations(observation_id,vehicle_event_id) VALUES(one_id,event_uuid);
      admitted:=admitted+1;
    END IF;
    relations:=relations||jsonb_build_array(jsonb_build_object('observation_id',one_id,'vehicle_event_id',event_uuid));
  END LOOP;
  RETURN jsonb_build_object('success',true,'linked',admitted,'existing',replayed,'relations',relations);
END;
$$;
REVOKE ALL ON FUNCTION public.link_ksl_listing_observations(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_ksl_listing_observations(uuid[]) TO service_role;
COMMENT ON FUNCTION public.link_ksl_listing_observations(uuid[]) IS
'Canonical ingest-observation service-only action; bounds explicit retained IDs to100, verifies KSL source/email/card identity and clocks, atomically creates unresolved vehicle_events listing parents and appends typed observation membership. No testimony rewrite, profiles, availability, prices, sale ancestry, inference or schedules. Replay retains original relation clock/IDs. Parent identity later resolution requires separate approved owner path; this action cannot promote or mutate it.';
COMMIT;
