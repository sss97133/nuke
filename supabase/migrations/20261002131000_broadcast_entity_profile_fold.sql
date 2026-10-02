-- REVIEW DRAFT ONLY. Depends on 20261002050326; no production application.
-- First coherent unit: typed organization subject + affected presentation fold + publisher profile.
-- Every input remains in vehicle_observations; no new log/provenance/identity/fold table.
-- Foreground writer is the observation trigger; scheduled writer replays ONLY dirty events,
-- at most20 per run, using the existing event observation index. A view is not called a fold.
-- Source properties here are literal evidence roles, not automatically ratified vehicle facts.
-- No accepted-bid, active-lot-duration, speaker identity, excitement or crowd-emotion projection.
SET statement_timeout='120s';
SET lock_timeout='5s';

ALTER TABLE public.vehicle_observations ADD COLUMN subject_organization_id uuid,
  ADD COLUMN context_bound_at timestamptz;
ALTER TABLE public.vehicle_observations
  ADD CONSTRAINT vehicle_observations_subject_organization_fkey FOREIGN KEY(subject_organization_id)
    REFERENCES public.organizations(id) NOT VALID,
  ADD CONSTRAINT vehicle_observations_organization_subject_check CHECK (
    subject_organization_id IS NULL OR ((subject_type='organization') IS TRUE AND (subject_id=subject_organization_id) IS TRUE)
  ) NOT VALID;
COMMENT ON COLUMN public.vehicle_observations.subject_organization_id IS
  'Typed FK for an organization subject, distinct from carrier publisher or physical vehicle. Intake verifies the existing organization and mirrors subject_id. NULL on legacy/unbound/nonorganization claims; no legacy rewrite. Observed Mecum platform samples use the existing Mecum organization, never the YouTube carrier business.';
COMMENT ON COLUMN public.vehicle_observations.context_bound_at IS
  'System-time instant when typed presentation/carrier/organization context first became bound. Separate from source/event/ingestion clocks; used by as-of replay to exclude later identity knowledge. First binding only through intake or reviewed relink_testimony overload; source body/hash unchanged.';
CREATE FUNCTION public.check_observation_organization_subject() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$ BEGIN
  IF TG_OP='UPDATE' AND NEW.subject_type IS NOT DISTINCT FROM OLD.subject_type AND NEW.subject_id IS NOT DISTINCT FROM OLD.subject_id
    AND NEW.subject_organization_id IS NOT DISTINCT FROM OLD.subject_organization_id THEN RETURN NEW; END IF;
  IF NEW.subject_type='organization' AND NEW.subject_id IS NOT NULL AND NEW.subject_organization_id IS DISTINCT FROM NEW.subject_id THEN
    RAISE EXCEPTION 'new organization attribution requires typed organization FK' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_observation_organization_subject_before_write BEFORE INSERT OR UPDATE OF
  subject_type,subject_id,subject_organization_id ON public.vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION public.check_observation_organization_subject();
COMMENT ON FUNCTION public.check_observation_organization_subject() IS
  'New or changed organization attributions require the typed organization FK. Unchanged legacy subject attribution can receive unrelated supersession/context updates without being rewritten.';

ALTER TABLE public.auction_events
  ADD COLUMN broadcast_publisher_organization_id uuid,
  ADD COLUMN broadcast_evidence_state jsonb,
  ADD COLUMN broadcast_evidence_last_observation_id uuid,
  ADD COLUMN broadcast_evidence_dirty boolean NOT NULL DEFAULT false;
ALTER TABLE public.auction_events
  ADD CONSTRAINT auction_events_broadcast_publisher_fkey FOREIGN KEY(broadcast_publisher_organization_id)
    REFERENCES public.organizations(id) NOT VALID,
  ADD CONSTRAINT auction_events_broadcast_last_observation_fkey FOREIGN KEY(broadcast_evidence_last_observation_id)
    REFERENCES public.vehicle_observations(id) NOT VALID;
ALTER TABLE public.organizations ADD COLUMN broadcast_evidence_state jsonb;
COMMENT ON COLUMN public.auction_events.broadcast_publisher_organization_id IS
  'Publisher/operator of the observed presentation, derived from cited publications.organization_id FK. Not the YouTube carrier/platform, a bidder, seller or named auctioneer. Writer fold_broadcast_profile; conflicts require context resolution, not a global brand string match.';
COMMENT ON COLUMN public.auction_events.broadcast_evidence_state IS
  'Incremental source-grain fold broadcast-event-v1. Counts raw claims and caption attributes, separate display instruments, numeric sufficient statistics for nominal-media sampled display regression. Rate is a proxy USD/nominal source second, never bids/second. Exact event/availability/system clocks remain on inputs; as-of reconstruction replays those inputs. Not authoritative outcome/high_bid/winning_bid/bid_history.';
COMMENT ON COLUMN public.auction_events.broadcast_evidence_last_observation_id IS
  'FK to the last input processed for this event; full lineage is the existing observation log keyed by auction_event_id/citation_publication_id, not a copied provenance store.';
COMMENT ON COLUMN public.auction_events.broadcast_evidence_dirty IS
  'Affected-event work flag for scheduled drain_broadcast_profile_queue. Trigger updates immediately; scheduled replay verifies/repairs only flagged event folds and delta-adjusts their publisher contribution. No full-log scans.';
COMMENT ON COLUMN public.organizations.broadcast_evidence_state IS
  'Delta rollup of attached presentation evidence: covered presentations, source/caption/display counts, sum/count of per-event nominal display regression proxies. Mean applies to observed samples with coverage, never the auction system population or true bid velocity. Writer fold_broadcast_profile; reader read_broadcast_entity_profile.';

CREATE INDEX CONCURRENTLY idx_vo_organization_subject_time
  ON public.vehicle_observations(subject_organization_id,ingested_at DESC) WHERE subject_organization_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_auction_broadcast_dirty
  ON public.auction_events(id) WHERE broadcast_evidence_dirty;
CREATE INDEX CONCURRENTLY idx_auction_broadcast_publisher
  ON public.auction_events(broadcast_publisher_organization_id,id) WHERE broadcast_evidence_state IS NOT NULL;

-- Also enforce existing citation/event contradiction rules on sanctioned late binding.
CREATE TRIGGER check_observation_media_links_before_update BEFORE UPDATE OF
  citation_publication_id,auction_event_id,vehicle_id ON public.vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION public.check_observation_media_links();

CREATE FUNCTION public.broadcast_media_contribution(o public.vehicle_observations) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE d jsonb:=o.structured_data; media jsonb:=d->'media'; c jsonb; instrument text; eligible boolean:=false;
  t numeric; price numeric; requested numeric; decoded numeric;
BEGIN
  IF o.kind::text<>'media' OR coalesce(o.is_superseded,false) OR o.auction_event_id IS NULL
    OR o.citation_publication_id IS NULL OR d->>'kind_detail'='broadcast_profile_derived'
    OR NOT public.observation_is_public(o.kind,d) THEN RETURN NULL; END IF;
  c:=jsonb_build_object('source_claims',1,'caption_attribute_claims',CASE WHEN media ? 'segment_index' THEN 1 ELSE 0 END,
    'display_samples',0,'eligible_display_samples',0,'property',d->>'property');
  IF d->>'property' IN ('current_bid_displayed','background_board_amount') THEN
    instrument:=coalesce(media->>'video_id','unknown')||':'||(d->>'property');
    IF jsonb_typeof(d->'value')='number' AND upper(d->>'unit')='USD' THEN
      price:=(d->>'value')::numeric;
      IF o.media_start_ms IS NOT NULL THEN t:=o.media_start_ms::numeric/1000;
      ELSIF jsonb_typeof(media->'start_seconds')='number' THEN t:=(media->>'start_seconds')::numeric;
      END IF;
      eligible:=t IS NOT NULL AND t>=0 AND price>=0;
      IF media ? 'requested_seek_seconds' AND jsonb_typeof(media->'requested_seek_seconds')<>'number' THEN eligible:=false; END IF;
      IF media ? 'decoded_callback_media_time_seconds' THEN
        IF jsonb_typeof(media->'decoded_callback_media_time_seconds')<>'number' OR
          (media ? 'requested_seek_seconds' AND jsonb_typeof(media->'requested_seek_seconds')<>'number') THEN
          eligible:=false;
        ELSE
          decoded:=(media->>'decoded_callback_media_time_seconds')::numeric;
          requested:=coalesce((media->>'requested_seek_seconds')::numeric,t);
          eligible:=eligible AND abs(decoded-requested)<=0.1;
        END IF;
      END IF;
    END IF;
    c:=c||jsonb_build_object('display_samples',1,'eligible_display_samples',CASE WHEN eligible THEN 1 ELSE 0 END,
      'instrument',instrument,'source_property',d->>'property','n',CASE WHEN eligible THEN 1 ELSE 0 END,
      't',CASE WHEN eligible THEN t ELSE 0 END,'p',CASE WHEN eligible THEN price ELSE 0 END,
      'tt',CASE WHEN eligible THEN t*t ELSE 0 END,'tp',CASE WHEN eligible THEN t*price ELSE 0 END);
  END IF;
  RETURN c;
END $$;
COMMENT ON FUNCTION public.broadcast_media_contribution(public.vehicle_observations) IS
  'Pure versioned public-input measure: counts/caption evidence and distinct display instruments. Typed media_start_ms wins; legacy numeric media.start_seconds supplies a guarded nominal-source fallback without rewriting testimony. Existing observation privacy predicate excludes private testimony from the public aggregate. Alignment mismatch stays a counted sample but is excluded from nominal-offset regression. Derived profile outputs do not feed back into inputs; no true bid or emotion inference.';

CREATE FUNCTION public.broadcast_state_delta(state jsonb,c jsonb,direction integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE outstate jsonb:=coalesce(state,'{"version":"broadcast-event-v1","streams":{},"raw_property_counts":{}}');
  key text; stream jsonb; instrument text:=c->>'instrument'; property text:=c->>'property'; property_count numeric;
BEGIN
  IF c IS NULL THEN RETURN outstate; END IF;
  IF direction NOT IN (-1,1) THEN RAISE EXCEPTION 'invalid fold direction'; END IF;
  FOREACH key IN ARRAY ARRAY['source_claims','caption_attribute_claims','display_samples','eligible_display_samples'] LOOP
    outstate:=jsonb_set(outstate,ARRAY[key],to_jsonb(coalesce((outstate->>key)::numeric,0)+direction*coalesce((c->>key)::numeric,0)),true);
  END LOOP;
  IF property IS NOT NULL THEN
    property_count:=coalesce((outstate#>>ARRAY['raw_property_counts',property])::numeric,0)+direction;
    IF property_count=0 THEN outstate:=outstate#-ARRAY['raw_property_counts',property];
    ELSE outstate:=jsonb_set(outstate,ARRAY['raw_property_counts',property],to_jsonb(property_count),true); END IF;
  END IF;
  IF instrument IS NOT NULL THEN
    stream:=coalesce(outstate#>ARRAY['streams',instrument],jsonb_build_object('source_property',c->>'source_property'));
    FOREACH key IN ARRAY ARRAY['n','t','p','tt','tp'] LOOP
      stream:=jsonb_set(stream,ARRAY[key],to_jsonb(coalesce((stream->>key)::numeric,0)+direction*coalesce((c->>key)::numeric,0)),true);
    END LOOP;
    stream:=jsonb_set(stream,'{sample_count}',to_jsonb(coalesce((stream->>'sample_count')::numeric,0)+direction),true);
    IF (stream->>'sample_count')::numeric=0 THEN outstate:=outstate#-ARRAY['streams',instrument];
    ELSE outstate:=jsonb_set(outstate,ARRAY['streams',instrument],stream,true); END IF;
  END IF;
  IF (outstate->>'source_claims')::numeric=0 THEN RETURN NULL; END IF;
  RETURN outstate;
END $$;

CREATE FUNCTION public.broadcast_event_display_proxy(state jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  WITH eligible AS (
    SELECT value FROM jsonb_each(coalesce(state->'streams','{}'))
    WHERE value->>'source_property'='current_bid_displayed' AND (value->>'n')::numeric>=2
      AND (value->>'n')::numeric*(value->>'tt')::numeric-power((value->>'t')::numeric,2)>0
  )
  SELECT CASE WHEN count(*)=1 THEN max(((value->>'n')::numeric*(value->>'tp')::numeric-(value->>'t')::numeric*(value->>'p')::numeric)
    /((value->>'n')::numeric*(value->>'tt')::numeric-power((value->>'t')::numeric,2))) ELSE NULL END FROM eligible
$$;
COMMENT ON FUNCTION public.broadcast_event_display_proxy(jsonb) IS
  'OLS sampled display growth in USD per nominal media second, only one eligible overlay stream. NULL for insufficient/ambiguous streams. This is a proxy, not bid velocity or auction duration.';

CREATE FUNCTION public.apply_broadcast_organization_delta(org_id uuid,before_state jsonb,after_state jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE state jsonb; key text; before_proxy numeric:=public.broadcast_event_display_proxy(before_state);
  after_proxy numeric:=public.broadcast_event_display_proxy(after_state); old_covered integer; new_covered integer;
BEGIN
  SELECT broadcast_evidence_state INTO state FROM public.organizations WHERE id=org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing publisher organization' USING ERRCODE='23503'; END IF;
  state:=coalesce(state,'{"version":"broadcast-organization-v1"}');
  FOREACH key IN ARRAY ARRAY['source_claims','caption_attribute_claims','display_samples','eligible_display_samples'] LOOP
    state:=jsonb_set(state,ARRAY[key],to_jsonb(coalesce((state->>key)::numeric,0)
      +coalesce((after_state->>key)::numeric,0)-coalesce((before_state->>key)::numeric,0)),true);
  END LOOP;
  old_covered:=CASE WHEN coalesce((before_state->>'source_claims')::numeric,0)>0 THEN 1 ELSE 0 END;
  new_covered:=CASE WHEN coalesce((after_state->>'source_claims')::numeric,0)>0 THEN 1 ELSE 0 END;
  state:=jsonb_set(state,'{covered_presentations}',to_jsonb(coalesce((state->>'covered_presentations')::integer,0)+new_covered-old_covered),true);
  state:=jsonb_set(state,'{display_proxy_event_count}',to_jsonb(coalesce((state->>'display_proxy_event_count')::integer,0)
    +(CASE WHEN after_proxy IS NULL THEN 0 ELSE 1 END)-(CASE WHEN before_proxy IS NULL THEN 0 ELSE 1 END)),true);
  state:=jsonb_set(state,'{display_proxy_event_sum}',to_jsonb(coalesce((state->>'display_proxy_event_sum')::numeric,0)+coalesce(after_proxy,0)-coalesce(before_proxy,0)),true);
  state:=state||jsonb_build_object('computed_at',clock_timestamp(),'coverage_scope','attached sampled presentations; no population inference',
    'proxy_unit','USD/nominal media second','accepted_bid_velocity',NULL,'excitation',NULL);
  UPDATE public.organizations SET broadcast_evidence_state=state WHERE id=org_id;
END $$;

CREATE FUNCTION public.fold_broadcast_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c jsonb; rowevent public.auction_events%ROWTYPE; publisher uuid; previous jsonb; folded jsonb;
  iteration integer; inputrow public.vehicle_observations%ROWTYPE; direction integer;
BEGIN
  -- Old contribution is removed and the new one added: retries/late binding/supersession
  -- never count the same source row twice. Source/hash/body/citations are not edited here.
  FOR iteration IN 1..2 LOOP
    IF iteration=1 THEN
      IF TG_OP='INSERT' THEN CONTINUE; END IF;
      inputrow:=OLD; direction:=-1;
    ELSE inputrow:=NEW; direction:=1; END IF;
    c:=public.broadcast_media_contribution(inputrow);
    IF c IS NULL THEN CONTINUE; END IF;
    SELECT organization_id INTO publisher FROM public.publications WHERE id=inputrow.citation_publication_id;
    IF publisher IS NULL THEN CONTINUE; END IF;
    SELECT * INTO rowevent FROM public.auction_events WHERE id=inputrow.auction_event_id FOR UPDATE;
    IF rowevent.broadcast_publisher_organization_id IS NOT NULL AND rowevent.broadcast_publisher_organization_id<>publisher THEN
      RAISE EXCEPTION 'presentation publisher conflict requires context resolution' USING ERRCODE='23514';
    END IF;
    previous:=rowevent.broadcast_evidence_state;
    IF direction=-1 AND previous IS NULL THEN CONTINUE; END IF;
    folded:=public.broadcast_state_delta(previous,c,direction);
    UPDATE public.auction_events SET broadcast_publisher_organization_id=publisher,broadcast_evidence_state=folded,
      broadcast_evidence_last_observation_id=inputrow.id,broadcast_evidence_dirty=true WHERE id=rowevent.id;
    PERFORM public.apply_broadcast_organization_delta(publisher,previous,folded);
  END LOOP;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.fold_broadcast_profile() IS
  'One source row affects only its presentation and publisher organization; sufficient-statistic deltas avoid whole-log scans. Immutable source tuple dedup is the intake. UPDATE removes old/adds new contribution, supporting context binding and supersession. Source testimony never changes.';

CREATE FUNCTION public.drain_broadcast_profile_queue(p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE e public.auction_events%ROWTYPE; o public.vehicle_observations%ROWTYPE;
  rebuilt jsonb; c jsonb; processed integer:=0; drift integer:=0; inputs integer:=0; last_input uuid;
  event_inputs integer; deferred integer:=0; oversized boolean; max_inputs integer:=5000;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN RAISE EXCEPTION 'limit must be1..50'; END IF;
  FOR e IN SELECT * FROM public.auction_events WHERE broadcast_evidence_dirty ORDER BY id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
    rebuilt:=NULL; last_input:=NULL; event_inputs:=0; oversized:=false;
    FOR o IN SELECT vo.* FROM public.vehicle_observations vo JOIN public.publications p ON p.id=vo.citation_publication_id
      WHERE vo.auction_event_id=e.id AND p.organization_id=e.broadcast_publisher_organization_id
        AND NOT coalesce(vo.is_superseded,false) ORDER BY vo.ingested_at,vo.id LIMIT max_inputs+1 LOOP
      event_inputs:=event_inputs+1;
      IF event_inputs>max_inputs THEN oversized:=true; EXIT; END IF;
      c:=public.broadcast_media_contribution(o);
      IF c IS NOT NULL THEN rebuilt:=public.broadcast_state_delta(rebuilt,c,1); last_input:=o.id; inputs:=inputs+1; END IF;
    END LOOP;
    IF oversized THEN deferred:=deferred+1; CONTINUE; END IF;
    IF coalesce(e.broadcast_evidence_state,'{}') IS DISTINCT FROM coalesce(rebuilt,'{}') THEN drift:=drift+1; END IF;
    PERFORM public.apply_broadcast_organization_delta(e.broadcast_publisher_organization_id,e.broadcast_evidence_state,rebuilt);
    UPDATE public.auction_events SET broadcast_evidence_state=rebuilt,broadcast_evidence_last_observation_id=last_input,
      broadcast_evidence_dirty=false WHERE id=e.id;
    processed:=processed+1;
  END LOOP;
  RETURN jsonb_build_object('processed_events',processed,'replayed_inputs',inputs,'drift_events',drift,'limit',p_limit,
    'max_inputs_per_event',max_inputs,'deferred_oversized_events',deferred);
END $$;
COMMENT ON FUNCTION public.drain_broadcast_profile_queue(integer) IS
  'Scheduled affected-event writer and replay assay: at most50 dirty presentations and5000 inputs/event; oversized events stay dirty and are reported without partial replacement. Indexed attached inputs only; compare statistics and exact publisher delta. Returns processed/input/drift/budget counts; no global log or platform rescan.';

-- Bootstrap only previously attached typed contexts, via new partial indexes, before activating
-- foreground deltas. Live audited first case had none; this also makes local old-input replay explicit.
UPDATE public.auction_events e SET broadcast_publisher_organization_id=x.publisher,broadcast_evidence_dirty=true
FROM (SELECT vo.auction_event_id,min(p.organization_id::text)::uuid AS publisher
  FROM public.vehicle_observations vo JOIN public.publications p ON p.id=vo.citation_publication_id
  WHERE vo.auction_event_id IS NOT NULL AND p.organization_id IS NOT NULL AND vo.kind::text='media'
  GROUP BY vo.auction_event_id HAVING count(DISTINCT p.organization_id)=1) x WHERE e.id=x.auction_event_id;
SELECT public.drain_broadcast_profile_queue(20);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.auction_events WHERE broadcast_evidence_dirty AND broadcast_evidence_state IS NULL) THEN
    RAISE EXCEPTION 'bootstrap exceeded initial replay budget; review remaining contexts before enabling foreground fold';
  END IF;
END $$;
CREATE TRIGGER fold_broadcast_profile_after_input AFTER INSERT OR UPDATE OF
  auction_event_id,citation_publication_id,is_superseded ON public.vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION public.fold_broadcast_profile();

-- Extend the existing sanctioned primitive, not a new testimony writer. Only previously NULL
-- contexts can bind; conflicting reassignment requires a separately reviewed repair/supersession.
CREATE FUNCTION public.relink_testimony(p_observation_type text,p_observation_id uuid,p_target_vehicle_id uuid,
  p_reason text,p_actor_user_id uuid,p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE o public.vehicle_observations%ROWTYPE; carrier uuid; presentation uuid; org uuid; receipt jsonb; changed boolean;
  publication_platform text; publication_video text; source_video text;
BEGIN
  IF coalesce(auth.role(),'') IN ('authenticated','anon') THEN RAISE EXCEPTION 'context binding requires service writer' USING ERRCODE='42501'; END IF;
  IF p_observation_type IS DISTINCT FROM 'observation' OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'observation context and reason required' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_context) AS k WHERE k NOT IN ('publication_id','auction_event_id','organization_subject_id')) THEN
    RAISE EXCEPTION 'unknown context key' USING ERRCODE='22023'; END IF;
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'observation not found'; END IF;
  carrier:=coalesce((p_context->>'publication_id')::uuid,o.citation_publication_id);
  presentation:=coalesce((p_context->>'auction_event_id')::uuid,o.auction_event_id);
  org:=coalesce((p_context->>'organization_subject_id')::uuid,o.subject_organization_id);
  IF (o.citation_publication_id IS NOT NULL AND carrier IS DISTINCT FROM o.citation_publication_id) OR
    (o.auction_event_id IS NOT NULL AND presentation IS DISTINCT FROM o.auction_event_id) OR
    (o.subject_organization_id IS NOT NULL AND org IS DISTINCT FROM o.subject_organization_id) THEN
    RAISE EXCEPTION 'bound context is immutable; reviewed supersession required' USING ERRCODE='23514'; END IF;
  IF org IS NOT NULL AND (o.subject_type<>'organization' OR o.subject_id IS DISTINCT FROM org) THEN
    RAISE EXCEPTION 'typed organization must agree with existing subject' USING ERRCODE='23514'; END IF;
  IF carrier IS NOT NULL THEN
    SELECT platform,platform_id INTO publication_platform,publication_video FROM public.publications WHERE id=carrier;
    IF NOT FOUND THEN RAISE EXCEPTION 'publication not found' USING ERRCODE='23503'; END IF;
    source_video:=o.structured_data#>>'{media,video_id}';
    IF (publication_platform='youtube' AND source_video IS DISTINCT FROM publication_video) OR
      (o.source_identifier LIKE 'youtube:%' AND publication_platform IS DISTINCT FROM 'youtube') THEN
      RAISE EXCEPTION 'source video contradicts carrier publication' USING ERRCODE='23514'; END IF;
  END IF;
  changed:=carrier IS DISTINCT FROM o.citation_publication_id OR presentation IS DISTINCT FROM o.auction_event_id OR org IS DISTINCT FROM o.subject_organization_id;
  IF p_target_vehicle_id IS NOT NULL AND p_target_vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    receipt:=public.relink_testimony(p_observation_type,p_observation_id,p_target_vehicle_id,p_reason,p_actor_user_id);
  END IF;
  IF NOT changed THEN RETURN coalesce(receipt,jsonb_build_object('success',true,'duplicate',true,'observation_id',o.id)); END IF;
  UPDATE public.vehicle_observations SET citation_publication_id=carrier,auction_event_id=presentation,
    subject_organization_id=org,context_bound_at=coalesce(context_bound_at,clock_timestamp()) WHERE id=o.id;
  IF receipt IS NULL THEN
    INSERT INTO public.reattribution_audit(observation_type,old_observation_id,old_vehicle_id,new_observation_id,new_vehicle_id,reason,actor_user_id)
      VALUES('observation',o.id,o.vehicle_id,o.id,o.vehicle_id,p_reason,p_actor_user_id);
  END IF;
  RETURN jsonb_build_object('success',true,'duplicate',false,'observation_id',o.id,'publication_id',carrier,'auction_event_id',presentation,'organization_subject_id',org);
END $$;
REVOKE ALL ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid,jsonb) TO service_role;
COMMENT ON FUNCTION public.relink_testimony(text,uuid,uuid,text,uuid,jsonb) IS
  'Existing sanctioned primitive overload: service-only first binding of nullable typed carrier/presentation/organization context with FK/source-video/contradiction checks and audit, including legacy rows without typed media offsets. Same row/hash/body/citations; duplicate retry no extra audit. Records binding system clock. Does not silently reassign already-bound contexts.';

CREATE FUNCTION public.read_broadcast_entity_profile(p_organization_id uuid,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('organization_id',org.id,'name',org.business_name,'slug',org.slug,
    'fold',org.broadcast_evidence_state,'proxy_unit','USD/nominal media second','accepted_bid_velocity',NULL,'excitation',NULL,
    'derived_subject_claims',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT o.id,o.source_id,o.source_identifier,o.subject_organization_id,o.observed_at,o.ingested_at,o.structured_data,o.property_id
      FROM public.vehicle_observations o WHERE o.subject_organization_id=org.id
        AND o.structured_data->>'kind_detail'='broadcast_profile_derived' AND public.observation_is_public(o.kind,o.structured_data)
      ORDER BY o.ingested_at DESC LIMIT greatest(1,least(p_limit,100)))x),'[]'),
    'presentations',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT e.id,e.vehicle_id,e.broadcast_evidence_state,e.broadcast_evidence_last_observation_id,
        public.broadcast_event_display_proxy(e.broadcast_evidence_state) AS sampled_display_regression_proxy
      FROM public.auction_events e WHERE e.broadcast_publisher_organization_id=org.id AND e.broadcast_evidence_state IS NOT NULL
      ORDER BY e.id LIMIT greatest(1,least(p_limit,100)))x),'[]'))
  FROM public.organizations org WHERE org.id=p_organization_id AND org.is_public IS TRUE
$$;
COMMENT ON FUNCTION public.read_broadcast_entity_profile(uuid,integer) IS
  'Real reader for public organization broadcast fold + typed subject observations + attached presentations. Sources remain in the log. Does not expose private organizations/claims, invent missing bid/emotion measures or serve current aggregate as an historical as-of state.';

REVOKE ALL ON FUNCTION public.apply_broadcast_organization_delta(uuid,jsonb,jsonb),
  public.drain_broadcast_profile_queue(integer),public.read_broadcast_entity_profile(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_broadcast_organization_delta(uuid,jsonb,jsonb),
  public.drain_broadcast_profile_queue(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_broadcast_entity_profile(uuid,integer) TO authenticated,service_role;
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via) VALUES
  ('vehicle_observations','subject_organization_id','ingest-observation','Verified typed organization subject; preserve source body and use sanctioned attribution for later binding.',true,'ingest-observation'),
  ('vehicle_observations','context_bound_at','relink_testimony','First typed context knowledge clock, not event/ingest time.',true,'ingest-observation,relink_testimony'),
  ('auction_events','broadcast_publisher_organization_id','fold_broadcast_profile','Publisher bridge from cited publications; not carrier business.',true,'fold_broadcast_profile'),
  ('auction_events','broadcast_evidence_state','fold_broadcast_profile','Incremental raw-claim/display proxy fold; reader read_broadcast_entity_profile; assay drain_broadcast_profile_queue.',true,'fold_broadcast_profile,drain_broadcast_profile_queue'),
  ('auction_events','broadcast_evidence_last_observation_id','fold_broadcast_profile','Typed input watermark; full lineage stays in observations.',true,'fold_broadcast_profile,drain_broadcast_profile_queue'),
  ('auction_events','broadcast_evidence_dirty','fold_broadcast_profile','Bounded scheduled replay work flag.',true,'fold_broadcast_profile,drain_broadcast_profile_queue'),
  ('organizations','broadcast_evidence_state','fold_broadcast_profile','Affected-event delta rollup with coverage and proxy units; public reader and replay assay attached.',true,'fold_broadcast_profile,drain_broadcast_profile_queue');
-- Scheduled writer/assay enters existing pg_cron/v_job_health commons only after owner review/CI.
SELECT cron.schedule('broadcast-profile-fold','*/5 * * * *','SELECT public.drain_broadcast_profile_queue(20)');
