-- Evidence feature layer (shadow only; nothing live reads it).
-- feature = sum over cited evidence of trust x role x decay x polarity; plus independent-source counts.
-- All source->feature associations and trust values are rows in evidence_source_feature_map (no hard-coded mapping).

CREATE TABLE IF NOT EXISTS public.evidence_source_feature_map (
  id serial PRIMARY KEY,
  source_table text NOT NULL,          -- evidence_claims | document_ocr_queue | identifier_exposures | vehicle_field_provenance
  source_key text NOT NULL,            -- field_hint | document_type | evidence_class | field_name
  feature text NOT NULL CHECK (feature IN ('condition','originality','documented_work','records','ownership','identity')),
  base_trust numeric NOT NULL CHECK (base_trust BETWEEN 0 AND 1),
  half_life_days numeric,              -- NULL = no decay
  basis text NOT NULL,
  UNIQUE (source_table, source_key, feature));
ALTER TABLE public.evidence_source_feature_map ENABLE ROW LEVEL SECURITY;

INSERT INTO public.evidence_source_feature_map (source_table, source_key, feature, base_trust, half_life_days, basis) VALUES
 ('evidence_claims','condition_issue','condition',1,NULL,'trust/decay taken from evidence_trust_registry row of the claim'),
 ('evidence_claims','originality','originality',1,NULL,'trust/decay from evidence_trust_registry'),
 ('evidence_claims','documented_work','documented_work',1,NULL,'trust/decay from evidence_trust_registry'),
 ('evidence_claims','records_present','records',1,NULL,'trust/decay from evidence_trust_registry'),
 ('evidence_claims','ownership_history','ownership',1,NULL,'trust/decay from evidence_trust_registry'),
 ('document_ocr_queue','title','ownership',0.95,NULL,'state-issued title: primary ownership document'),
 ('document_ocr_queue','title','identity',0.95,NULL,'title carries VIN'),
 ('document_ocr_queue','registration','ownership',0.9,NULL,'state registration'),
 ('document_ocr_queue','registration','identity',0.9,NULL,'registration carries VIN'),
 ('document_ocr_queue','bill_of_sale','ownership',0.85,NULL,'transfer document'),
 ('document_ocr_queue','lien_release','ownership',0.85,NULL,'transfer document'),
 ('document_ocr_queue','odometer_disclosure','records',0.9,NULL,'federal odometer statement'),
 ('document_ocr_queue','receipt','documented_work',0.85,3650,'work receipt (work_record half-life)'),
 ('document_ocr_queue','repair_order','documented_work',0.9,3650,'shop repair order'),
 ('document_ocr_queue','inspection_report','records',0.85,730,'third-party inspection'),
 ('document_ocr_queue','smog_certificate','records',0.8,730,'state smog record'),
 ('document_ocr_queue','cost_sheet','records',0.6,NULL,'dealer internal doc'),
 ('document_ocr_queue','deal_jacket','records',0.6,NULL,'dealer internal doc'),
 ('document_ocr_queue','buyers_order','ownership',0.7,NULL,'sale contract'),
 ('document_ocr_queue','auction_slip','ownership',0.7,NULL,'auction transfer slip'),
 ('document_ocr_queue','consignment_agreement','ownership',0.7,NULL,'consignment contract'),
 ('document_ocr_queue','shipping_bill','records',0.5,NULL,'logistics doc'),
 ('identifier_exposures','plate_stamping','identity',0.95,NULL,'physical VIN stamping read from photo'),
 ('identifier_exposures','document','identity',0.9,NULL,'VIN read from a document image'),
 ('identifier_exposures','photo_text','identity',0.8,NULL,'VIN text in a photo'),
 ('vehicle_field_provenance','vin','identity',0.6,NULL,'scaled by total_confidence/100; each supporting source counted'),
 ('vehicle_field_provenance','year','identity',0.3,NULL,'scaled by total_confidence/100'),
 ('vehicle_field_provenance','make','identity',0.3,NULL,'scaled by total_confidence/100'),
 ('vehicle_field_provenance','model','identity',0.3,NULL,'scaled by total_confidence/100'),
 ('vehicle_field_provenance','engine_type','originality',0.3,NULL,'factory_original_value vs modified_value; polarity -1 when modified'),
 ('vehicle_field_provenance','transmission','originality',0.3,NULL,'factory_original_value vs modified_value; polarity -1 when modified')
ON CONFLICT DO NOTHING;

-- One row per cited piece of evidence, point-in-time (only evidence observed on/before p_as_of).
CREATE OR REPLACE FUNCTION public.evidence_items(p_vehicle_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (feature text, source_family text, source_ref text, weight numeric, polarity int, citation text)
LANGUAGE sql STABLE SET search_path = public AS $f$
  -- text claims: only speech acts assertion/denial, only author roles passing the blind precision gate
  SELECT m.feature, 'bat:'||c.author_role||':'||c.author_key, c.id::text,
         t.base_trust * coalesce(public.observation_relevance(c.observed_at, t.half_life_days, p_as_of), 1),
         c.polarity, coalesce(c.source_url, '') || ' "' || left(c.quote, 160) || '"'
  FROM evidence_claims c
  JOIN evidence_trust_registry t ON t.id = c.trust_id
  JOIN evidence_roles_validated g ON g.author_role = c.author_role AND g.passes
  JOIN evidence_source_feature_map m ON m.source_table = 'evidence_claims' AND m.source_key = c.field_hint
  WHERE c.vehicle_id = p_vehicle_id AND c.speech_act IN ('assertion','denial') AND c.polarity <> 0
    AND (c.observed_at IS NULL OR c.observed_at <= p_as_of)
  UNION ALL
  SELECT m.feature, 'ocr:'||q.id, q.id::text,
         m.base_trust * coalesce(q.document_type_confidence, 1) * coalesce(public.observation_relevance(q.created_at, m.half_life_days, p_as_of), 1),
         1, 'document_ocr_queue ' || q.id || ' (' || q.document_type || ')'
  FROM document_ocr_queue q
  JOIN evidence_source_feature_map m ON m.source_table = 'document_ocr_queue' AND m.source_key = q.document_type
  WHERE q.linked_vehicle_id = p_vehicle_id AND q.status = 'complete' AND q.created_at <= p_as_of
  UNION ALL
  SELECT m.feature, 'ie:'||coalesce(e.image_id::text, e.id::text), e.id::text,
         m.base_trust * coalesce(e.reader_confidence, 1) * CASE WHEN e.partial THEN 0.5 ELSE 1 END,
         1, 'identifier_exposures ' || e.id || ' ' || coalesce(e.evidence_class,'')
  FROM identifier_exposures e
  JOIN evidence_source_feature_map m ON m.source_table = 'identifier_exposures' AND m.source_key = e.evidence_class
  WHERE e.vehicle_id = p_vehicle_id AND e.superseded_at IS NULL AND e.created_at <= p_as_of
  UNION ALL
  SELECT m.feature, 'vfp:'||src, p.field_name,
         m.base_trust * least(coalesce(p.total_confidence, 50), 100) / 100.0,
         CASE WHEN m.feature = 'originality' AND p.modified_value IS NOT NULL AND p.modified_value IS DISTINCT FROM p.factory_original_value THEN -1 ELSE 1 END,
         'vehicle_field_provenance ' || p.field_name || ' via ' || src
  FROM vehicle_field_provenance p
  JOIN evidence_source_feature_map m ON m.source_table = 'vehicle_field_provenance' AND m.source_key = p.field_name
  CROSS JOIN LATERAL unnest(array_remove(array[p.primary_source] || coalesce(p.supporting_sources, '{}'), NULL)) src
  WHERE p.vehicle_id = p_vehicle_id
$f$;

CREATE TABLE IF NOT EXISTS public.evidence_features (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  as_of timestamptz NOT NULL, run_id uuid NOT NULL,
  f_condition numeric, f_originality numeric, f_documented_work numeric, f_records numeric, f_ownership numeric, f_identity numeric,
  n_condition int, n_originality int, n_documented_work int, n_records int, n_ownership int, n_identity int,
  n_sources int, n_photos int, citations jsonb, computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, as_of));
ALTER TABLE public.evidence_features ENABLE ROW LEVEL SECURITY;

-- f_x = sum(weight*polarity) with diminishing returns per independent source family:
-- each family contributes its max-|weight| item, so 10 sentences from one listing != 10 sources.
CREATE OR REPLACE FUNCTION public.compute_evidence_features(p_vehicle_ids uuid[], p_as_of timestamptz[], p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SET statement_timeout = '120s' SET search_path = public AS $fn$
DECLARE n int;
BEGIN
  IF array_length(p_vehicle_ids,1) > 500 THEN RAISE EXCEPTION 'max 500 per call'; END IF;
  INSERT INTO evidence_features AS ef
  SELECT v.vid, v.asof, p_run_id,
    sum(fam.s) FILTER (WHERE fam.feature='condition'), sum(fam.s) FILTER (WHERE fam.feature='originality'),
    sum(fam.s) FILTER (WHERE fam.feature='documented_work'), sum(fam.s) FILTER (WHERE fam.feature='records'),
    sum(fam.s) FILTER (WHERE fam.feature='ownership'), sum(fam.s) FILTER (WHERE fam.feature='identity'),
    count(fam.fam) FILTER (WHERE fam.feature='condition'), count(fam.fam) FILTER (WHERE fam.feature='originality'),
    count(fam.fam) FILTER (WHERE fam.feature='documented_work'), count(fam.fam) FILTER (WHERE fam.feature='records'),
    count(fam.fam) FILTER (WHERE fam.feature='ownership'), count(fam.fam) FILTER (WHERE fam.feature='identity'),
    count(DISTINCT fam.fam),
    (SELECT count(*) FROM image_observations io WHERE io.vehicle_id = v.vid AND io.is_active AND io.observed_at <= v.asof),
    coalesce(jsonb_agg(jsonb_build_object('f',fam.feature,'src',fam.fam,'w',round(fam.s,3),'cite',fam.cite)) FILTER (WHERE fam.fam IS NOT NULL), '[]'),
    now()
  FROM unnest(p_vehicle_ids, p_as_of) v(vid, asof)
  LEFT JOIN LATERAL (
    SELECT i.feature, i.source_family fam,
           (array_agg(i.weight * i.polarity ORDER BY i.weight DESC))[1] s,
           (array_agg(i.citation ORDER BY i.weight DESC))[1] cite
    FROM evidence_items(v.vid, v.asof) i GROUP BY 1,2) fam ON true
  WHERE EXISTS (SELECT 1 FROM vehicles x WHERE x.id = v.vid)
  GROUP BY v.vid, v.asof
  ON CONFLICT (vehicle_id, as_of) DO UPDATE SET run_id=excluded.run_id,
    f_condition=excluded.f_condition, f_originality=excluded.f_originality, f_documented_work=excluded.f_documented_work,
    f_records=excluded.f_records, f_ownership=excluded.f_ownership, f_identity=excluded.f_identity,
    n_condition=excluded.n_condition, n_originality=excluded.n_originality, n_documented_work=excluded.n_documented_work,
    n_records=excluded.n_records, n_ownership=excluded.n_ownership, n_identity=excluded.n_identity,
    n_sources=excluded.n_sources, n_photos=excluded.n_photos, citations=excluded.citations, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;

-- Convenience view: current-time features for any vehicle (computed on read; use the table for bulk).
CREATE OR REPLACE VIEW public.evidence_features_current WITH (security_invoker = true) AS
  SELECT ef.* FROM public.evidence_features ef
  WHERE ef.as_of = (SELECT max(as_of) FROM public.evidence_features e2 WHERE e2.vehicle_id = ef.vehicle_id);
