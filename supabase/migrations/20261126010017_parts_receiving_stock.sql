-- Receiving testimony and conserved stock. No real receipts or physical events seeded.
-- Receipt: docs/wiring/receipts/2026-11-26_parts-receiving-stock.md
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';

CREATE TABLE public.parts_reception_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reception_id uuid REFERENCES public.parts_reception(id),
 receipt_item_id uuid NOT NULL UNIQUE REFERENCES public.receipt_items(id),
 catalog_part_id uuid NOT NULL REFERENCES public.catalog_parts(id),
 custodian_user_id uuid NOT NULL REFERENCES auth.users(id),
 arrival_observation_id uuid NOT NULL UNIQUE REFERENCES public.vehicle_observations(id),
 request_id uuid NOT NULL,
 received_quantity numeric NOT NULL CHECK(received_quantity>0 AND received_quantity<=1000000000),
 unit text NOT NULL CHECK(unit IN('ea','ft')),
 received_at timestamptz NOT NULL CHECK(isfinite(received_at)),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 receipt_line_fingerprint text NOT NULL,
 catalog_identity_fingerprint text NOT NULL,
 package_property_observation_id uuid REFERENCES public.catalog_supply_properties(observation_id),
 UNIQUE(custodian_user_id,request_id),
 CHECK(unit<>'ea' OR received_quantity=trunc(received_quantity))
);
COMMENT ON TABLE public.parts_reception_lots IS 'Grain: one explicitly counted arrival attributed to one custodian and exact owned receipt line. Receipt-backed first path: one credit per line; later partial deliveries need separate receiving evidence. Legacy reception_id stays NULL in v1: that owner has no authorized receipt/custodian edge. Direct ea/ft only. Arrival is not inspection; package claims never expand quantity. Writer record_parts_arrival; reader parts_stock_lot.';

CREATE TABLE public.parts_stock_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lot_id uuid NOT NULL REFERENCES public.parts_reception_lots(id),
 custodian_user_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
 evaluation_id uuid NOT NULL,
 segment_id uuid REFERENCES public.harness_segments(id),
 component_requirement_id uuid,
 component_role text NOT NULL,
 catalog_part_id uuid NOT NULL REFERENCES public.catalog_parts(id),
 quantity numeric NOT NULL CHECK(quantity>0 AND quantity<=1000000000),
 unit text NOT NULL CHECK(unit IN('ea','ft')),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(evaluation_id,vehicle_id) REFERENCES public.harness_model_evaluations(id,vehicle_id),
 FOREIGN KEY(evaluation_id,segment_id) REFERENCES public.harness_model_wire_requirements(evaluation_id,segment_id),
 FOREIGN KEY(evaluation_id,component_requirement_id) REFERENCES public.harness_model_component_requirements(evaluation_id,id),
 CHECK(num_nonnulls(segment_id,component_requirement_id)=1),
 CHECK(unit<>'ea' OR quantity=trunc(quantity)),
 UNIQUE(custodian_user_id,request_id)
);
COMMENT ON TABLE public.parts_stock_allocations IS 'Grain: one immutable reservation from a witnessed lot to one exact evaluation requirement revision. Reservation is intent, not physical pull. Source/target withdrawal holds the reservation; only separately signed release returns its unused quantity. Writer reserve_parts_stock.';

CREATE TABLE public.parts_stock_events (
 observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
 lot_id uuid NOT NULL REFERENCES public.parts_reception_lots(id),
 allocation_id uuid REFERENCES public.parts_stock_allocations(id),
 event_kind text NOT NULL CHECK(event_kind IN('inspection','release','pull')),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 request_id uuid NOT NULL,
 previous_inspection_id uuid REFERENCES public.parts_stock_events(observation_id),
 basis_inspection_id uuid REFERENCES public.parts_stock_events(observation_id),
 accepted_quantity numeric,
 rejected_quantity numeric,
 quantity numeric,
 performed_at timestamptz NOT NULL CHECK(isfinite(performed_at)),
 recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(actor_user_id,request_id),
 CHECK((event_kind='inspection' AND allocation_id IS NULL AND quantity IS NULL AND basis_inspection_id IS NULL
   AND accepted_quantity IS NOT NULL AND accepted_quantity BETWEEN 0 AND 1000000000
   AND rejected_quantity IS NOT NULL AND rejected_quantity BETWEEN 0 AND 1000000000)
 OR (event_kind IN('release','pull') AND allocation_id IS NOT NULL AND previous_inspection_id IS NULL
   AND ((event_kind='release' AND basis_inspection_id IS NULL) OR (event_kind='pull' AND basis_inspection_id IS NOT NULL))
   AND accepted_quantity IS NULL AND rejected_quantity IS NULL AND quantity>0 AND quantity<=1000000000))
);
CREATE UNIQUE INDEX parts_stock_first_inspection ON public.parts_stock_events(lot_id)
 WHERE event_kind='inspection' AND previous_inspection_id IS NULL;
CREATE UNIQUE INDEX parts_stock_inspection_successor ON public.parts_stock_events(previous_inspection_id)
 WHERE previous_inspection_id IS NOT NULL;
CREATE INDEX parts_stock_events_lot ON public.parts_stock_events(lot_id,recorded_at);
CREATE INDEX parts_stock_events_allocation ON public.parts_stock_events(allocation_id) WHERE allocation_id IS NOT NULL;
CREATE INDEX parts_stock_allocations_lot ON public.parts_stock_allocations(lot_id);
CREATE INDEX parts_reception_lots_custodian ON public.parts_reception_lots(custodian_user_id,id);
COMMENT ON TABLE public.parts_stock_events IS 'Typed projection of separately signed stock work_record observations. Inspection reports cumulative accepted/rejected quantities from the original arrival (not an increment or remaining on-hand count); the explicit successor chain prevents duplicate inspection credit. Release and pull each consume remaining reservation, but only release returns stock. No new generic source log.';

CREATE FUNCTION public.parts_stock_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Stock history is immutable; record a separate event'; END $$;
CREATE TRIGGER parts_reception_lots_immutable BEFORE UPDATE OR DELETE ON public.parts_reception_lots FOR EACH ROW EXECUTE FUNCTION public.parts_stock_immutable();
CREATE TRIGGER parts_stock_allocations_immutable BEFORE UPDATE OR DELETE ON public.parts_stock_allocations FOR EACH ROW EXECUTE FUNCTION public.parts_stock_immutable();
CREATE TRIGGER parts_stock_events_immutable BEFORE UPDATE OR DELETE ON public.parts_stock_events FOR EACH ROW EXECUTE FUNCTION public.parts_stock_immutable();
ALTER TABLE public.parts_reception_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts_stock_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts_stock_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY parts_reception_lots_owner ON public.parts_reception_lots FOR SELECT TO authenticated
 USING(custodian_user_id=auth.uid() AND auth.jwt()->>'is_anonymous'='false');
CREATE POLICY parts_stock_allocations_owner ON public.parts_stock_allocations FOR SELECT TO authenticated
 USING(custodian_user_id=auth.uid() AND auth.jwt()->>'is_anonymous'='false');
CREATE POLICY parts_stock_events_owner ON public.parts_stock_events FOR SELECT TO authenticated
 USING(actor_user_id=auth.uid() AND auth.jwt()->>'is_anonymous'='false');
REVOKE ALL ON public.parts_reception_lots,public.parts_stock_allocations,public.parts_stock_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.parts_reception_lots,public.parts_stock_allocations,public.parts_stock_events TO authenticated;

CREATE FUNCTION public.parts_stock_actor() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated'
 OR auth.jwt()->>'is_anonymous' IS DISTINCT FROM 'false' THEN
 RAISE EXCEPTION 'A nonanonymous account must sign physical receiving work' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END $$;

CREATE FUNCTION public.parts_receipt_line_fingerprint(p_item uuid) RETURNS text LANGUAGE sql STABLE
SET search_path=pg_catalog,public AS $$
 SELECT md5(jsonb_build_array(i.id,i.receipt_id,i.line_number,i.description,i.part_number,i.vendor_sku,i.quantity,i.line_source)::text)
 FROM public.receipt_items i WHERE i.id=p_item
$$;
CREATE FUNCTION public.parts_catalog_identity_fingerprint(p_part uuid) RETURNS text LANGUAGE sql STABLE
SET search_path=pg_catalog,public AS $$
 SELECT md5(jsonb_build_array(c.id,c.catalog_id,c.part_number,c.supplier_url)::text) FROM public.catalog_parts c WHERE c.id=p_part
$$;

CREATE FUNCTION public.parts_stock_sign(p_id uuid,p_actor uuid,p_method text,p_subject uuid,p_request uuid,p_at timestamptz,p_payload jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public SET timezone='UTC' AS $$
BEGIN
 IF public.parts_stock_actor() IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Signer mismatch' USING ERRCODE='42501'; END IF;
 PERFORM public.record_account_work(p_id,p_method,p_request,p_subject,NULL,p_at,'reported_time','Account-signed material stock event',p_payload,
  encode(sha256(convert_to(jsonb_build_array(p_method,p_actor,p_request,p_payload)::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION public.parts_stock_source_current(p_observation uuid,p_actor uuid,p_method text,p_subject uuid,p_at timestamptz,p_payload jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.vehicle_observations o JOIN public.observation_sources src ON src.id=o.source_id
 WHERE o.id=p_observation AND src.slug='owner-input' AND o.kind::text='work_record' AND o.vehicle_id IS NULL
 AND o.subject_type='asset' AND o.subject_id=p_subject AND o.submitted_by_user_id=p_actor
 AND o.extraction_method=p_method AND o.structured_data=p_payload AND o.observed_at=p_at AND o.source_event_at=p_at
 AND o.is_superseded IS FALSE AND o.superseded_by IS NULL AND o.superseded_at IS NULL)
$$;

CREATE FUNCTION public.parts_arrival_payload(p_lot public.parts_reception_lots) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('profile','parts_arrival_sign_v1','lot_id',p_lot.id,'reception_id',p_lot.reception_id,
 'reception_link_state',CASE WHEN p_lot.reception_id IS NULL THEN 'not_linked' ELSE 'unqualified_context' END,
 'receipt_item_id',p_lot.receipt_item_id,'catalog_part_id',p_lot.catalog_part_id,'quantity',p_lot.received_quantity,
 'unit',p_lot.unit,'received_at',p_lot.received_at,'receipt_line_fingerprint',p_lot.receipt_line_fingerprint,
 'catalog_identity_fingerprint',p_lot.catalog_identity_fingerprint,'package_property_observation_id',p_lot.package_property_observation_id,
 'quantity_basis','direct_count_or_measurement','inspection','not_implied','receipt_line_is_this_arrival',true)
$$;
CREATE FUNCTION public.parts_stock_event_payload(p_event public.parts_stock_events) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
 SELECT jsonb_build_object('profile',CASE WHEN p_event.event_kind='inspection' THEN 'parts_inspection_sign_v1' ELSE 'parts_stock_sign_v1' END,
 'lot_id',p_event.lot_id,'allocation_id',p_event.allocation_id,'event_kind',p_event.event_kind,
 'previous_inspection_id',p_event.previous_inspection_id,'accepted_quantity',p_event.accepted_quantity,
 'basis_inspection_id',p_event.basis_inspection_id,
 'rejected_quantity',p_event.rejected_quantity,'quantity',p_event.quantity,'performed_at',p_event.performed_at)
$$;

CREATE FUNCTION public.parts_stock_lot_status(p_lot uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE l public.parts_reception_lots%ROWTYPE; e public.parts_stock_events%ROWTYPE; accepted numeric; rejected numeric;
 reserved numeric; released numeric; pulled numeric; holds text[]='{}'; current_inspection boolean=false;
BEGIN
 SELECT * INTO l FROM public.parts_reception_lots WHERE id=p_lot; IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT public.parts_stock_source_current(l.arrival_observation_id,l.custodian_user_id,'parts_arrival_sign_v1',l.id,l.received_at,public.parts_arrival_payload(l))
 THEN holds:=array_append(holds,'arrival_source_withdrawn_or_changed'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id WHERE i.id=l.receipt_item_id
 AND r.user_id=l.custodian_user_id AND r.is_active IS TRUE AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL)
 OR public.parts_receipt_line_fingerprint(l.receipt_item_id) IS DISTINCT FROM l.receipt_line_fingerprint
 THEN holds:=array_append(holds,'receipt_source_withdrawn_or_changed'); END IF;
 IF public.parts_catalog_identity_fingerprint(l.catalog_part_id) IS DISTINCT FROM l.catalog_identity_fingerprint
 THEN holds:=array_append(holds,'catalog_identity_changed'); END IF;
 IF (public.receipt_item_product_card(l.receipt_item_id)->>'catalog_part_id') IS DISTINCT FROM l.catalog_part_id::text
 THEN holds:=array_append(holds,'receipt_catalog_identity_unqualified'); END IF;
 SELECT x.* INTO e FROM public.parts_stock_events x WHERE x.lot_id=l.id AND x.event_kind='inspection'
 AND NOT EXISTS(SELECT 1 FROM public.parts_stock_events nxt WHERE nxt.previous_inspection_id=x.observation_id);
 IF e.observation_id IS NULL THEN holds:=array_append(holds,'inspection_not_recorded');
 ELSE
   current_inspection:=public.parts_stock_source_current(e.observation_id,e.actor_user_id,'parts_inspection_sign_v1',l.id,e.performed_at,public.parts_stock_event_payload(e));
   IF NOT current_inspection THEN holds:=array_append(holds,'inspection_source_withdrawn_or_changed');
   ELSE accepted:=e.accepted_quantity; rejected:=e.rejected_quantity; END IF;
 END IF;
 SELECT coalesce(sum(a.quantity),0) INTO reserved FROM public.parts_stock_allocations a WHERE a.lot_id=l.id;
 -- A withdrawn physical pull still reserves its claimed stock conservatively. A
 -- withdrawn release cannot free it. History is retained and qualification held.
 SELECT coalesce(sum(x.quantity) FILTER(WHERE x.event_kind='release' AND public.parts_stock_source_current(x.observation_id,x.actor_user_id,'parts_stock_sign_v1',l.id,x.performed_at,public.parts_stock_event_payload(x))),0),
 coalesce(sum(x.quantity) FILTER(WHERE x.event_kind='pull'),0) INTO released,pulled FROM public.parts_stock_events x WHERE x.lot_id=l.id;
 IF EXISTS(SELECT 1 FROM public.parts_stock_events x WHERE x.lot_id=l.id AND x.event_kind IN('release','pull')
 AND NOT public.parts_stock_source_current(x.observation_id,x.actor_user_id,'parts_stock_sign_v1',l.id,x.performed_at,public.parts_stock_event_payload(x)))
 THEN holds:=array_append(holds,'stock_event_source_withdrawn_or_changed'); END IF;
 IF accepted IS NOT NULL AND accepted<reserved-released THEN holds:=array_append(holds,'inspection_below_committed_quantity'); END IF;
 RETURN jsonb_build_object('lot_id',l.id,'catalog_part_id',l.catalog_part_id,'unit',l.unit,'received_quantity',l.received_quantity,
 'reception_id',l.reception_id,'reception_link_state',CASE WHEN l.reception_id IS NULL THEN 'not_linked' ELSE 'unqualified_context' END,
 'received_at',l.received_at,'arrival_observation_id',l.arrival_observation_id,'inspection_observation_id',e.observation_id,
 'inspection_state',CASE WHEN e.observation_id IS NULL THEN 'not_recorded' WHEN NOT current_inspection THEN 'held' ELSE 'recorded' END,
 'accepted_quantity',accepted,'rejected_quantity',rejected,'not_assessed_quantity',CASE WHEN accepted IS NOT NULL THEN l.received_quantity-accepted-rejected END,
 'reserved_quantity',reserved,'released_quantity',released,'pulled_quantity',pulled,
 'available_quantity',CASE WHEN cardinality(holds)=0 THEN greatest(accepted-reserved+released,0) END,
 'holds',to_jsonb(holds),'allocation_is_not_cut_release',true);
END $$;

CREATE FUNCTION public.record_parts_arrival(p_request_id uuid,p_arrival jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE actor uuid:=public.parts_stock_actor(); l public.parts_reception_lots%ROWTYPE; existing public.parts_reception_lots%ROWTYPE;
 line public.receipt_items%ROWTYPE; r public.receipts%ROWTYPE; body jsonb;
BEGIN
 IF p_request_id IS NULL OR jsonb_typeof(p_arrival) IS DISTINCT FROM 'object'
 OR p_arrival-ARRAY['receipt_item_id','catalog_part_id','quantity','unit','received_at','package_property_observation_id','receipt_line_is_this_arrival']<>'{}'::jsonb
 OR p_arrival->'receipt_line_is_this_arrival' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(p_arrival->'quantity') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Explicit counted arrival shape required'; END IF;
 l.id:=gen_random_uuid(); l.reception_id:=NULL; l.receipt_item_id:=(p_arrival->>'receipt_item_id')::uuid;
 l.catalog_part_id:=(p_arrival->>'catalog_part_id')::uuid; l.custodian_user_id:=actor; l.request_id:=p_request_id;
 l.arrival_observation_id:=gen_random_uuid(); l.received_quantity:=(p_arrival->>'quantity')::numeric; l.unit:=p_arrival->>'unit';
 l.received_at:=(p_arrival->>'received_at')::timestamptz; l.package_property_observation_id:=(p_arrival->>'package_property_observation_id')::uuid;
 IF l.receipt_item_id IS NULL OR l.catalog_part_id IS NULL OR l.unit NOT IN('ea','ft') OR l.unit IS NULL
 OR l.received_quantity NOT BETWEEN 0.000000001 AND 1000000000 OR (l.unit='ea' AND l.received_quantity<>trunc(l.received_quantity))
 OR l.received_at IS NULL OR NOT isfinite(l.received_at) OR l.received_at>statement_timestamp() THEN RAISE EXCEPTION 'Invalid counted units or event clock'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('parts-arrival:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO existing FROM public.parts_reception_lots WHERE custodian_user_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  l.id:=existing.id; l.receipt_line_fingerprint:=existing.receipt_line_fingerprint;
  l.catalog_identity_fingerprint:=existing.catalog_identity_fingerprint;
  IF public.parts_arrival_payload(existing) IS DISTINCT FROM public.parts_arrival_payload(l) THEN RAISE EXCEPTION 'Request already signed with different arrival'; END IF;
  RETURN public.parts_stock_lot_status(existing.id)||jsonb_build_object('duplicate',true);
 END IF;
 SELECT * INTO line FROM public.receipt_items WHERE id=l.receipt_item_id FOR UPDATE;
 SELECT * INTO r FROM public.receipts WHERE id=line.receipt_id FOR SHARE;
 IF r.id IS NULL OR r.user_id IS DISTINCT FROM actor OR r.is_active IS NOT TRUE OR r.is_superseded IS TRUE OR r.duplicate_of IS NOT NULL
 THEN RAISE EXCEPTION 'Current owned receipt line required' USING ERRCODE='42501'; END IF;
 -- Legacy reception has no keyed account/receipt relationship. Do not accept
 -- even a contextual caller locator or query its existence; the edge stays open.
 PERFORM 1 FROM public.catalog_parts WHERE id=l.catalog_part_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Catalog part unavailable'; END IF;
 IF l.package_property_observation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.catalog_supply_properties p
 WHERE p.observation_id=l.package_property_observation_id AND p.catalog_part_id=l.catalog_part_id)
 THEN RAISE EXCEPTION 'Package interpretation belongs to another product'; END IF;
 l.receipt_line_fingerprint:=public.parts_receipt_line_fingerprint(l.receipt_item_id);
 l.catalog_identity_fingerprint:=public.parts_catalog_identity_fingerprint(l.catalog_part_id);
 IF EXISTS(SELECT 1 FROM public.parts_reception_lots WHERE receipt_item_id=l.receipt_item_id)
 THEN RAISE EXCEPTION 'This receipt line already credits one arrival; another delivery requires separate evidence'; END IF;
 body:=public.parts_arrival_payload(l);
 PERFORM public.parts_stock_sign(l.arrival_observation_id,actor,'parts_arrival_sign_v1',l.id,p_request_id,l.received_at,body);
 INSERT INTO public.parts_reception_lots(id,reception_id,receipt_item_id,catalog_part_id,custodian_user_id,arrival_observation_id,
 request_id,received_quantity,unit,received_at,receipt_line_fingerprint,catalog_identity_fingerprint,package_property_observation_id)
 VALUES(l.id,l.reception_id,l.receipt_item_id,l.catalog_part_id,actor,l.arrival_observation_id,p_request_id,l.received_quantity,l.unit,
 l.received_at,l.receipt_line_fingerprint,l.catalog_identity_fingerprint,l.package_property_observation_id);
 RETURN public.parts_stock_lot_status(l.id)||jsonb_build_object('duplicate',false);
END $$;

CREATE FUNCTION public.record_parts_inspection(p_request_id uuid,p_lot_id uuid,p_accepted_quantity numeric,p_rejected_quantity numeric,
 p_performed_at timestamptz,p_previous_inspection_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE actor uuid:=public.parts_stock_actor(); l public.parts_reception_lots%ROWTYPE; e public.parts_stock_events%ROWTYPE;
 old public.parts_stock_events%ROWTYPE; latest public.parts_stock_events%ROWTYPE;
BEGIN
 SELECT * INTO l FROM public.parts_reception_lots WHERE id=p_lot_id AND custodian_user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned lot unavailable' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_accepted_quantity IS NULL OR p_rejected_quantity IS NULL
 OR p_accepted_quantity NOT BETWEEN 0 AND l.received_quantity OR p_rejected_quantity NOT BETWEEN 0 AND l.received_quantity
 OR p_accepted_quantity+p_rejected_quantity>l.received_quantity
 OR (l.unit='ea' AND (p_accepted_quantity<>trunc(p_accepted_quantity) OR p_rejected_quantity<>trunc(p_rejected_quantity)))
 OR p_performed_at IS NULL OR NOT isfinite(p_performed_at) OR p_performed_at<l.received_at OR p_performed_at>statement_timestamp()
 THEN RAISE EXCEPTION 'Explicit inspected arrival balance and clock required'; END IF;
 e.observation_id:=gen_random_uuid(); e.lot_id:=l.id; e.event_kind:='inspection'; e.actor_user_id:=actor; e.request_id:=p_request_id;
 e.previous_inspection_id:=p_previous_inspection_id; e.accepted_quantity:=p_accepted_quantity; e.rejected_quantity:=p_rejected_quantity; e.performed_at:=p_performed_at;
 SELECT * INTO old FROM public.parts_stock_events WHERE actor_user_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF public.parts_stock_event_payload(old) IS DISTINCT FROM public.parts_stock_event_payload(e) THEN RAISE EXCEPTION 'Request already signed with different inspection'; END IF;
  RETURN public.parts_stock_lot_status(l.id)||jsonb_build_object('duplicate',true);
 END IF;
 SELECT x.* INTO latest FROM public.parts_stock_events x WHERE x.lot_id=l.id AND x.event_kind='inspection'
 AND NOT EXISTS(SELECT 1 FROM public.parts_stock_events nxt WHERE nxt.previous_inspection_id=x.observation_id);
 IF latest.observation_id IS DISTINCT FROM p_previous_inspection_id OR (latest.observation_id IS NOT NULL AND p_performed_at<latest.performed_at)
 THEN RAISE EXCEPTION 'Inspection predecessor changed or event clock regressed'; END IF;
 PERFORM public.parts_stock_sign(e.observation_id,actor,'parts_inspection_sign_v1',l.id,p_request_id,p_performed_at,public.parts_stock_event_payload(e));
 INSERT INTO public.parts_stock_events(observation_id,lot_id,event_kind,actor_user_id,request_id,previous_inspection_id,accepted_quantity,rejected_quantity,performed_at)
 VALUES(e.observation_id,l.id,'inspection',actor,p_request_id,p_previous_inspection_id,p_accepted_quantity,p_rejected_quantity,p_performed_at);
 RETURN public.parts_stock_lot_status(l.id)||jsonb_build_object('duplicate',false);
END $$;

CREATE FUNCTION public.parts_stock_lot(p_lot_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.parts_stock_actor();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.parts_reception_lots WHERE id=p_lot_id AND custodian_user_id=actor) THEN RETURN NULL; END IF;
 RETURN public.parts_stock_lot_status(p_lot_id);
END $$;

-- Reuse the published model and exact requirement keys. This is not a second
-- material/contact/cavity resolver and does not turn structural checks into cut release.
CREATE FUNCTION public.parts_stock_requirement(p_vehicle uuid,p_evaluation uuid,p_segment uuid,p_component uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE model jsonb; r jsonb;
BEGIN
 IF num_nonnulls(p_segment,p_component)<>1 THEN RETURN NULL; END IF;
 model:=public.harness_evaluated_model(p_vehicle);
 IF model->>'current' IS DISTINCT FROM 'true' OR model#>>'{model,evaluation_id}' IS DISTINCT FROM p_evaluation::text THEN RETURN NULL; END IF;
 IF p_segment IS NOT NULL THEN
  SELECT q INTO r FROM jsonb_array_elements(model#>'{model,wire_requirements}') q WHERE q->>'segment_id'=p_segment::text;
  IF r->>'state' IS DISTINCT FROM 'provisional' OR r->>'unit' IS DISTINCT FROM 'ft' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('quantity',r->'planned_quantity','unit','ft','role','wire','catalog_part_id',r->'catalog_part_id',
   'segment_id',p_segment,'evaluation_id',p_evaluation);
 ELSE
  SELECT q INTO r FROM jsonb_array_elements(model#>'{model,component_requirements}') q WHERE q->>'id'=p_component::text;
  IF r->>'state' IS DISTINCT FROM 'provisional' OR r->>'unit' IS DISTINCT FROM 'each' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('quantity',r->'quantity','unit','ea','role',r->'role','catalog_part_id',r->'catalog_part_id',
   'component_requirement_id',p_component,'evaluation_id',p_evaluation,
   'termination_id',r->'termination_id','endpoint_id',r->'endpoint_id','splice_id',r->'splice_id');
 END IF;
END $$;

CREATE FUNCTION public.parts_stock_allocation_status(p_allocation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE a public.parts_stock_allocations%ROWTYPE; l jsonb; r jsonb; released numeric; pulled numeric; settled numeric;
BEGIN
 SELECT * INTO a FROM public.parts_stock_allocations WHERE id=p_allocation; IF NOT FOUND THEN RETURN NULL; END IF;
 l:=public.parts_stock_lot_status(a.lot_id);
 r:=public.parts_stock_requirement(a.vehicle_id,a.evaluation_id,a.segment_id,a.component_requirement_id);
 SELECT coalesce(sum(quantity) FILTER(WHERE event_kind='release'),0),coalesce(sum(quantity) FILTER(WHERE event_kind='pull'),0),coalesce(sum(quantity),0)
 INTO released,pulled,settled FROM public.parts_stock_events WHERE allocation_id=a.id;
 RETURN jsonb_build_object('allocation_id',a.id,'lot_id',a.lot_id,'vehicle_id',a.vehicle_id,'evaluation_id',a.evaluation_id,
 'segment_id',a.segment_id,'component_requirement_id',a.component_requirement_id,'component_role',a.component_role,
 'quantity',a.quantity,'unit',a.unit,'released_quantity',released,'pulled_quantity',pulled,'remaining_reservation',a.quantity-settled,
 'target_current',r IS NOT NULL,'target_hold',CASE WHEN r IS NULL THEN 'requirement_revision_not_current' END,
 'lot',l,'cut_ready',false);
END $$;

CREATE FUNCTION public.reserve_parts_stock(p_request_id uuid,p_lot_id uuid,p_vehicle_id uuid,p_evaluation_id uuid,
 p_segment_id uuid,p_component_requirement_id uuid,p_quantity numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE actor uuid:=public.parts_stock_actor(); l public.parts_reception_lots%ROWTYPE; a public.parts_stock_allocations%ROWTYPE;
 previous public.parts_stock_allocations%ROWTYPE; state jsonb; r jsonb; committed numeric;
BEGIN
 IF p_request_id IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 0.000000001 AND 1000000000
 OR num_nonnulls(p_segment_id,p_component_requirement_id)<>1 THEN RAISE EXCEPTION 'Exact requirement and quantity required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('parts-reserve:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO l FROM public.parts_reception_lots WHERE id=p_lot_id AND custodian_user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned stock lot unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL AND (v.user_id=actor OR v.owner_id=actor))
 THEN RAISE EXCEPTION 'Owned target vehicle required' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.parts_stock_allocations WHERE custodian_user_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF ROW(previous.lot_id,previous.vehicle_id,previous.evaluation_id,previous.segment_id,previous.component_requirement_id,previous.quantity)
   IS DISTINCT FROM ROW(p_lot_id,p_vehicle_id,p_evaluation_id,p_segment_id,p_component_requirement_id,p_quantity)
  THEN RAISE EXCEPTION 'Reservation request changed'; END IF;
  RETURN public.parts_stock_allocation_status(previous.id)||jsonb_build_object('duplicate',true);
 END IF;
 -- Lock order: lot, then vehicle evaluation cursor. A source invalidation must
 -- either precede this qualification or make the retained reservation stale.
 PERFORM 1 FROM public.harness_model_state WHERE vehicle_id=p_vehicle_id FOR UPDATE;
 r:=public.parts_stock_requirement(p_vehicle_id,p_evaluation_id,p_segment_id,p_component_requirement_id);
 IF r IS NULL OR r->>'catalog_part_id' IS DISTINCT FROM l.catalog_part_id::text OR r->>'unit' IS DISTINCT FROM l.unit
 OR (r->>'quantity')::numeric IS NULL OR (l.unit='ea' AND p_quantity<>trunc(p_quantity))
 THEN RAISE EXCEPTION 'Current exact material requirement unavailable'; END IF;
 state:=public.parts_stock_lot_status(l.id);
 IF jsonb_array_length(state->'holds')<>0 OR (state->>'available_quantity')::numeric<p_quantity
 THEN RAISE EXCEPTION 'Inspected available stock is insufficient or held'; END IF;
 -- Prior revision reservations still consume the physical requirement. A new
 -- evaluation is not a new piece or permission to reserve the same part twice.
 SELECT coalesce(sum(x.quantity-coalesce(released.qty,0)),0) INTO committed
 FROM public.parts_stock_allocations x LEFT JOIN LATERAL (
 SELECT sum(ev.quantity) qty FROM public.parts_stock_events ev WHERE ev.allocation_id=x.id AND ev.event_kind='release'
 AND public.parts_stock_source_current(ev.observation_id,ev.actor_user_id,'parts_stock_sign_v1',ev.lot_id,ev.performed_at,public.parts_stock_event_payload(ev))
 ) released ON true WHERE x.vehicle_id=p_vehicle_id AND (
  (p_segment_id IS NOT NULL AND x.segment_id=p_segment_id)
  OR (p_component_requirement_id IS NOT NULL AND x.component_requirement_id IS NOT NULL AND x.component_role=r->>'role' AND EXISTS(
   SELECT 1 FROM public.harness_model_component_requirements old_r
   JOIN public.harness_model_component_requirements new_r ON new_r.evaluation_id=p_evaluation_id AND new_r.id=p_component_requirement_id
   WHERE old_r.evaluation_id=x.evaluation_id AND old_r.id=x.component_requirement_id AND (
    old_r.id=new_r.id OR old_r.termination_id=new_r.termination_id OR old_r.splice_id=new_r.splice_id
    OR (old_r.endpoint_id=new_r.endpoint_id AND old_r.role IN('connector_housing','wedge_lock','boot'))
    OR EXISTS(SELECT 1 FROM public.harness_model_component_contributors old_edge
     JOIN public.harness_model_component_contributors new_edge ON new_edge.termination_id=old_edge.termination_id
     WHERE old_edge.evaluation_id=old_r.evaluation_id AND old_edge.requirement_id=old_r.id
       AND new_edge.evaluation_id=new_r.evaluation_id AND new_edge.requirement_id=new_r.id))
  )));
 IF committed+p_quantity>(r->>'quantity')::numeric THEN RAISE EXCEPTION 'Requirement already reserved or consumed'; END IF;
 a.id:=gen_random_uuid();
 INSERT INTO public.parts_stock_allocations(id,lot_id,custodian_user_id,request_id,vehicle_id,evaluation_id,segment_id,component_requirement_id,
 component_role,catalog_part_id,quantity,unit)
 VALUES(a.id,l.id,actor,p_request_id,p_vehicle_id,p_evaluation_id,p_segment_id,p_component_requirement_id,r->>'role',l.catalog_part_id,p_quantity,l.unit);
 RETURN public.parts_stock_allocation_status(a.id)||jsonb_build_object('duplicate',false);
END $$;

CREATE FUNCTION public.record_parts_stock_event(p_request_id uuid,p_allocation_id uuid,p_event_kind text,p_quantity numeric,p_performed_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE actor uuid:=public.parts_stock_actor(); a public.parts_stock_allocations%ROWTYPE; l public.parts_reception_lots%ROWTYPE;
 e public.parts_stock_events%ROWTYPE; previous public.parts_stock_events%ROWTYPE; basis public.parts_stock_events%ROWTYPE;
 settled numeric; state jsonb;
BEGIN
 SELECT * INTO a FROM public.parts_stock_allocations WHERE id=p_allocation_id AND custodian_user_id=actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned reservation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.parts_reception_lots WHERE id=a.lot_id FOR UPDATE;
 IF p_request_id IS NULL OR p_event_kind NOT IN('release','pull') OR p_event_kind IS NULL OR p_quantity IS NULL
 OR p_quantity NOT BETWEEN 0.000000001 AND a.quantity OR (l.unit='ea' AND p_quantity<>trunc(p_quantity))
 OR p_performed_at IS NULL OR NOT isfinite(p_performed_at) OR p_performed_at<a.recorded_at OR p_performed_at>statement_timestamp()
 THEN RAISE EXCEPTION 'Explicit reservation event quantity and clock required'; END IF;
 e.observation_id:=gen_random_uuid(); e.lot_id:=l.id; e.allocation_id:=a.id; e.actor_user_id:=actor;
 e.request_id:=p_request_id; e.event_kind:=p_event_kind; e.quantity:=p_quantity; e.performed_at:=p_performed_at;
 SELECT * INTO previous FROM public.parts_stock_events WHERE actor_user_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  e.basis_inspection_id:=previous.basis_inspection_id;
  IF public.parts_stock_event_payload(previous) IS DISTINCT FROM public.parts_stock_event_payload(e) THEN RAISE EXCEPTION 'Stock event request changed'; END IF;
  RETURN public.parts_stock_allocation_status(a.id)||jsonb_build_object('observation_id',previous.observation_id,'duplicate',true);
 END IF;
 SELECT coalesce(sum(quantity),0) INTO settled FROM public.parts_stock_events WHERE allocation_id=a.id;
 IF settled+p_quantity>a.quantity THEN RAISE EXCEPTION 'Quantity already released or pulled'; END IF;
 IF p_event_kind='pull' THEN
  PERFORM 1 FROM public.harness_model_state WHERE vehicle_id=a.vehicle_id FOR UPDATE;
  IF public.parts_stock_requirement(a.vehicle_id,a.evaluation_id,a.segment_id,a.component_requirement_id) IS NULL
  THEN RAISE EXCEPTION 'Reservation target revision is held'; END IF;
  state:=public.parts_stock_lot_status(l.id);
  IF jsonb_array_length(state->'holds')<>0 THEN RAISE EXCEPTION 'Physical stock qualification is held'; END IF;
  -- A late report cannot borrow an inspection that happened after its pull.
  -- The inspection chain is monotone in performed time; select its as-of leaf.
  SELECT b.* INTO basis FROM public.parts_stock_events b WHERE b.lot_id=l.id AND b.event_kind='inspection' AND b.performed_at<=p_performed_at
  AND NOT EXISTS(SELECT 1 FROM public.parts_stock_events nxt WHERE nxt.previous_inspection_id=b.observation_id AND nxt.performed_at<=p_performed_at);
  IF basis.observation_id IS NULL OR basis.accepted_quantity<p_quantity
  OR NOT public.parts_stock_source_current(basis.observation_id,basis.actor_user_id,'parts_inspection_sign_v1',l.id,basis.performed_at,public.parts_stock_event_payload(basis))
  THEN RAISE EXCEPTION 'No qualified inspection precedes this physical pull'; END IF;
  IF EXISTS(
   SELECT 1 FROM (
    SELECT accepted_quantity,sum(quantity) OVER(ORDER BY performed_at RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative
    FROM (
     SELECT x.performed_at,x.quantity,b.accepted_quantity FROM public.parts_stock_events x
     JOIN public.parts_stock_events b ON b.observation_id=x.basis_inspection_id
     WHERE x.lot_id=l.id AND x.event_kind='pull'
     UNION ALL SELECT p_performed_at,p_quantity,basis.accepted_quantity
    ) claims
   ) ledger WHERE cumulative>accepted_quantity
  ) THEN RAISE EXCEPTION 'Pull history exceeds its contemporaneous inspected quantity'; END IF;
  e.basis_inspection_id:=basis.observation_id;
 END IF;
 PERFORM public.parts_stock_sign(e.observation_id,actor,'parts_stock_sign_v1',l.id,p_request_id,p_performed_at,public.parts_stock_event_payload(e));
 INSERT INTO public.parts_stock_events(observation_id,lot_id,allocation_id,event_kind,actor_user_id,request_id,quantity,performed_at,basis_inspection_id)
 VALUES(e.observation_id,l.id,a.id,p_event_kind,actor,p_request_id,p_quantity,p_performed_at,e.basis_inspection_id);
 RETURN public.parts_stock_allocation_status(a.id)||jsonb_build_object('observation_id',e.observation_id,'duplicate',false);
END $$;

-- Private consumer for an already signed pull. A later physical operation makes
-- new-stock evaluation stale, but cannot erase a valid historical material debit.
CREATE FUNCTION public.parts_stock_pull_status(p_observation uuid,p_vehicle uuid,p_segment uuid,p_quantity numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.parts_stock_actor(); e public.parts_stock_events%ROWTYPE; b public.parts_stock_events%ROWTYPE;
 a public.parts_stock_allocations%ROWTYPE; l public.parts_reception_lots%ROWTYPE; state jsonb; holds text[]='{}'; valid boolean;
BEGIN
 SELECT * INTO e FROM public.parts_stock_events WHERE observation_id=p_observation AND actor_user_id=actor AND event_kind='pull';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.parts_stock_allocations WHERE id=e.allocation_id AND custodian_user_id=actor;
 SELECT * INTO l FROM public.parts_reception_lots WHERE id=e.lot_id AND custodian_user_id=actor;
 IF a.id IS NULL OR l.id IS NULL OR a.lot_id<>l.id OR a.vehicle_id IS DISTINCT FROM p_vehicle
 OR a.segment_id IS DISTINCT FROM p_segment OR a.component_requirement_id IS NOT NULL OR a.component_role<>'wire'
 OR a.unit<>'ft' OR l.unit<>'ft' OR a.catalog_part_id<>l.catalog_part_id THEN RETURN NULL; END IF;
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 0.000000001 AND e.quantity THEN holds:=array_append(holds,'pull_quantity_insufficient'); END IF;
 IF NOT public.parts_stock_source_current(e.observation_id,actor,'parts_stock_sign_v1',l.id,e.performed_at,public.parts_stock_event_payload(e))
 THEN holds:=array_append(holds,'pull_source_withdrawn_or_changed'); END IF;
 SELECT * INTO b FROM public.parts_stock_events WHERE observation_id=e.basis_inspection_id AND event_kind='inspection' AND lot_id=l.id AND actor_user_id=actor;
 IF b.observation_id IS NULL OR b.performed_at>e.performed_at OR b.accepted_quantity<e.quantity
 OR NOT public.parts_stock_source_current(b.observation_id,actor,'parts_inspection_sign_v1',l.id,b.performed_at,public.parts_stock_event_payload(b))
 THEN holds:=array_append(holds,'pull_inspection_basis_withdrawn_or_changed'); END IF;
 state:=public.parts_stock_lot_status(l.id);
 holds:=holds||ARRAY(SELECT h FROM jsonb_array_elements_text(state->'holds') h WHERE h IN(
 'arrival_source_withdrawn_or_changed','receipt_source_withdrawn_or_changed','catalog_identity_changed','receipt_catalog_identity_unqualified'));
 valid:=cardinality(holds)=0;
 RETURN jsonb_build_object('observation_id',e.observation_id,'allocation_id',a.id,'lot_id',l.id,'catalog_part_id',l.catalog_part_id,
 'vehicle_id',a.vehicle_id,'segment_id',a.segment_id,'quantity',e.quantity,'unit','ft','performed_at',e.performed_at,
 'basis_inspection_id',e.basis_inspection_id,'binding_valid',valid,'source_material_valid',valid,
 'allocation_revision_current',public.parts_stock_requirement(a.vehicle_id,a.evaluation_id,a.segment_id,NULL) IS NOT NULL,
 'holds',to_jsonb(holds),'current_lot_holds',state->'holds','stock_debit_already_recorded',true);
END $$;

CREATE FUNCTION public.parts_stock_allocation(p_allocation_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.parts_stock_actor();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.parts_stock_allocations WHERE id=p_allocation_id AND custodian_user_id=actor) THEN RETURN NULL; END IF;
 RETURN public.parts_stock_allocation_status(p_allocation_id);
END $$;

CREATE FUNCTION public.parts_stock_inventory(p_vehicle_id uuid,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC' AS $$
DECLARE actor uuid:=public.parts_stock_actor(); take integer:=greatest(1,least(coalesce(p_limit,50),100)); snapshot jsonb; current_eval uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=p_vehicle_id AND v.deleted_at IS NULL AND (v.user_id=actor OR v.owner_id=actor)) THEN RETURN NULL; END IF;
 snapshot:=public.harness_evaluated_model(p_vehicle_id);
 IF snapshot->>'current'='true' THEN current_eval:=(snapshot#>>'{model,evaluation_id}')::uuid; END IF;
 RETURN (
 WITH page AS MATERIALIZED (
  SELECT l.* FROM public.parts_reception_lots l WHERE l.custodian_user_id=actor AND (p_after_id IS NULL OR l.id>p_after_id)
  ORDER BY l.id LIMIT take+1
 ), shown AS MATERIALIZED (SELECT * FROM page ORDER BY id LIMIT take),
 allocations AS MATERIALIZED (
  SELECT a.*,coalesce(t.released,0) AS recorded_release_quantity,coalesce(t.credited_release,0) AS credited_release_quantity,
   coalesce(t.pulled,0) AS pulled_quantity,coalesce(t.pulls,'[]'::jsonb) AS pulls
  FROM public.parts_stock_allocations a JOIN shown l ON l.id=a.lot_id
  LEFT JOIN LATERAL (
   SELECT sum(e.quantity) FILTER(WHERE e.event_kind='release') AS released,
    sum(e.quantity) FILTER(WHERE e.event_kind='release' AND public.parts_stock_source_current(e.observation_id,actor,'parts_stock_sign_v1',l.id,e.performed_at,public.parts_stock_event_payload(e))) AS credited_release,
    sum(e.quantity) FILTER(WHERE e.event_kind='pull') AS pulled,
    jsonb_agg(jsonb_build_object('observation_id',e.observation_id,'quantity',e.quantity,'unit',a.unit,'performed_at',e.performed_at,
     'basis_inspection_id',e.basis_inspection_id,
     'source_current',public.parts_stock_source_current(e.observation_id,actor,'parts_stock_sign_v1',l.id,e.performed_at,public.parts_stock_event_payload(e)),
     'inspection_basis_current',b.observation_id IS NOT NULL AND public.parts_stock_source_current(b.observation_id,actor,'parts_inspection_sign_v1',l.id,b.performed_at,public.parts_stock_event_payload(b)))
     ORDER BY e.performed_at,e.observation_id) FILTER(WHERE e.event_kind='pull') AS pulls
   FROM public.parts_stock_events e LEFT JOIN public.parts_stock_events b ON b.observation_id=e.basis_inspection_id AND b.lot_id=l.id AND b.event_kind='inspection'
   WHERE e.allocation_id=a.id AND e.actor_user_id=actor
  ) t ON true WHERE a.custodian_user_id=actor AND a.vehicle_id=p_vehicle_id
 ), rows AS (
  SELECT l.id,public.parts_stock_lot_status(l.id)||jsonb_build_object('receipt_item_id',l.receipt_item_id,'receipt_id',rc.id,
   'receipt_vehicle_id',rc.vehicle_id,'receipt_source_visible',rc.id IS NOT NULL,
   'part_number',cp.part_number,'part_number_basis','current_catalog_reference','package_property_observation_id',l.package_property_observation_id,
   'recorded_at',l.recorded_at,'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'allocation_id',a.id,'evaluation_id',a.evaluation_id,'segment_id',a.segment_id,'component_requirement_id',a.component_requirement_id,
    'component_role',a.component_role,'quantity',a.quantity,'unit',a.unit,'recorded_at',a.recorded_at,
    'remaining_reservation',a.quantity-a.recorded_release_quantity-a.pulled_quantity,
    'recorded_release_quantity',a.recorded_release_quantity,'credited_release_quantity',a.credited_release_quantity,
    'pulled_quantity',a.pulled_quantity,'target_current',coalesce(a.evaluation_id=current_eval,false),'pulls',a.pulls)
    ORDER BY a.recorded_at,a.id) FROM allocations a WHERE a.lot_id=l.id),'[]'::jsonb)) AS row
  FROM shown l JOIN public.catalog_parts cp ON cp.id=l.catalog_part_id
  LEFT JOIN public.receipt_items i ON i.id=l.receipt_item_id
   AND public.parts_receipt_line_fingerprint(i.id)=l.receipt_line_fingerprint
  LEFT JOIN public.receipts rc ON rc.id=i.receipt_id AND rc.user_id=actor
   AND rc.is_active IS TRUE AND rc.is_superseded IS NOT TRUE AND rc.duplicate_of IS NULL
 ) SELECT jsonb_build_object('vehicle_id',p_vehicle_id,'viewer','custodian','rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM rows),'[]'::jsonb),
  'next_after',CASE WHEN (SELECT count(*) FROM page)>take THEN (SELECT id FROM shown ORDER BY id DESC LIMIT 1) END,
  'recorded_lot_count',(SELECT count(*) FROM public.parts_reception_lots WHERE custodian_user_id=actor),
  'current_evaluation_id',current_eval,'model_status',snapshot->'status',
  'receiving_scope','one_explicit_count_per_owned_receipt_line','unreceipted_stock','not_assessed','additional_deliveries_on_same_line','needs_separate_evidence')
 );
END $$;
COMMENT ON FUNCTION public.parts_stock_inventory(uuid,uuid,integer) IS 'Discoverable owner inventory for a vehicle workspace. Paged own received-lot claims and qualification; this vehicle''s exact reservations and signed pull choices. Canonical evaluation read once. No receipt money/prose; other-account/unreceipted stock and repeated arrivals are not inferred. Actor authorization remains in each writer.';

CREATE FUNCTION public.parts_receipt_stock_identity(p_receipt_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.parts_stock_actor(); card jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.receipt_items i JOIN public.receipts r ON r.id=i.receipt_id
  WHERE i.id=p_receipt_item_id AND r.user_id=actor AND r.is_active IS TRUE
  AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL) THEN RETURN NULL; END IF;
 card:=public.receipt_item_product_card(p_receipt_item_id);
 RETURN jsonb_build_object('receipt_item_id',p_receipt_item_id,
  'identity_state',CASE WHEN card->>'catalog_part_id' IS NULL THEN 'unqualified' ELSE 'qualified' END,
  'catalog_part_id',card->'catalog_part_id','part_number',card->'part_number',
  'source_page_url',card->'page_url','captured_at',card->'captured_at',
  'basis','existing_receipt_product_card','arrival_not_implied',true);
END $$;
COMMENT ON FUNCTION public.parts_receipt_stock_identity(uuid) IS 'Exact current owned receipt line only; delegates product qualification to existing receipt_item_product_card. No line-number inference, receipt prose/money, widened base grant or inventory claim.';

-- All helpers are private. Dedicated account signatures are the only writers;
-- service credentials are deliberately unable to sign for a custodian.
REVOKE ALL ON FUNCTION public.parts_stock_immutable(),public.parts_stock_actor(),public.parts_receipt_line_fingerprint(uuid),
 public.parts_catalog_identity_fingerprint(uuid),public.parts_stock_sign(uuid,uuid,text,uuid,uuid,timestamptz,jsonb),
 public.parts_stock_source_current(uuid,uuid,text,uuid,timestamptz,jsonb),public.parts_arrival_payload(public.parts_reception_lots),
 public.parts_stock_event_payload(public.parts_stock_events),public.parts_stock_lot_status(uuid),public.parts_stock_lot(uuid),
 public.parts_stock_requirement(uuid,uuid,uuid,uuid),public.parts_stock_allocation_status(uuid),public.parts_stock_allocation(uuid),
 public.parts_stock_pull_status(uuid,uuid,uuid,numeric),
 public.parts_stock_inventory(uuid,uuid,integer),public.parts_receipt_stock_identity(uuid),
 public.reserve_parts_stock(uuid,uuid,uuid,uuid,uuid,uuid,numeric),public.record_parts_stock_event(uuid,uuid,text,numeric,timestamptz),
 public.record_parts_arrival(uuid,jsonb),public.record_parts_inspection(uuid,uuid,numeric,numeric,timestamptz,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_parts_arrival(uuid,jsonb),public.record_parts_inspection(uuid,uuid,numeric,numeric,timestamptz,uuid),
 public.parts_stock_lot(uuid),public.parts_stock_allocation(uuid),public.reserve_parts_stock(uuid,uuid,uuid,uuid,uuid,uuid,numeric),
 public.record_parts_stock_event(uuid,uuid,text,numeric,timestamptz),public.parts_stock_inventory(uuid,uuid,integer),
 public.parts_receipt_stock_identity(uuid) TO authenticated;
CREATE POLICY parts_stock_testimony_private ON public.vehicle_observations AS RESTRICTIVE FOR SELECT TO anon,authenticated
 USING(coalesce(extraction_method,'') NOT IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1')
 OR (submitted_by_user_id=auth.uid() AND auth.jwt()->>'is_anonymous'='false'));

CREATE FUNCTION public.parts_stock_testimony_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
  OR auth.jwt()->>'is_anonymous' IS DISTINCT FROM 'false' OR NEW.submitted_by_user_id IS DISTINCT FROM auth.uid()
  OR NEW.kind::text<>'work_record' OR NEW.vehicle_id IS NOT NULL OR NEW.subject_type<>'asset'
  OR NEW.structured_data->>'profile' IS DISTINCT FROM NEW.extraction_method
  OR NEW.observer_raw->>'user_id' IS DISTINCT FROM auth.uid()::text
  OR NEW.is_superseded IS DISTINCT FROM false OR NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL
  THEN RAISE EXCEPTION 'Stock testimony requires the account signer' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retain signed stock testimony'; END IF;
 IF (to_jsonb(NEW)-ARRAY['is_superseded','superseded_by','superseded_at','is_processed','processed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_superseded','superseded_by','superseded_at','is_processed','processed_at'])
 OR (OLD.is_superseded IS TRUE AND NEW.is_superseded IS NOT TRUE)
 OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by)
 OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
 OR NEW.is_superseded IS NULL
 OR (NEW.is_superseded IS FALSE AND (NEW.superseded_by IS NOT NULL OR NEW.superseded_at IS NOT NULL))
 OR (NEW.is_superseded IS TRUE AND NEW.superseded_at IS NULL)
 THEN RAISE EXCEPTION 'Signed stock testimony is immutable; retire coherently'; END IF;
 IF NEW.superseded_by IS NOT NULL AND (NEW.superseded_by=NEW.id OR NOT EXISTS(
 SELECT 1 FROM public.vehicle_observations nxt WHERE nxt.id=NEW.superseded_by AND nxt.submitted_by_user_id=OLD.submitted_by_user_id
 AND nxt.subject_type=OLD.subject_type AND nxt.subject_id=OLD.subject_id AND nxt.extraction_method=OLD.extraction_method))
 THEN RAISE EXCEPTION 'Stock testimony successor must retain actor and subject'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER parts_stock_testimony_insert BEFORE INSERT ON public.vehicle_observations FOR EACH ROW
 WHEN(NEW.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1'))
 EXECUTE FUNCTION public.parts_stock_testimony_guard();
CREATE TRIGGER parts_stock_testimony_update BEFORE UPDATE ON public.vehicle_observations FOR EACH ROW
 WHEN(OLD.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1')
 OR NEW.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1'))
 EXECUTE FUNCTION public.parts_stock_testimony_guard();
CREATE TRIGGER parts_stock_testimony_delete BEFORE DELETE ON public.vehicle_observations FOR EACH ROW
 WHEN(OLD.extraction_method IN('parts_arrival_sign_v1','parts_inspection_sign_v1','parts_stock_sign_v1'))
 EXECUTE FUNCTION public.parts_stock_testimony_guard();
REVOKE ALL ON FUNCTION public.parts_stock_testimony_guard() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
