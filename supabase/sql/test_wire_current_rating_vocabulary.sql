\set ON_ERROR_STOP on
-- Reuse the existing measured-key/source-qualification contract. Fixtures are
-- document and proposal metadata; no vehicle or numerical testimony is written.
\i supabase/sql/test_wire_reference_property_vocabulary.sql
\i supabase/migrations/20261126213314_wire_current_rating_vocabulary.sql
SELECT pg_temp.ok('current rating is an open conditioned class vocabulary proposal only',
 (SELECT status='open' AND payload->>'unit'='A' AND payload->>'cardinality'='multi'
  AND payload->>'verification_scope'='class' AND payload->>'discriminator_key'='wire_current_rating_condition_key'
  FROM public.schema_proposals WHERE id='9c1ef313-f482-428e-8c66-75d38c5f3e07')
 AND NOT EXISTS(SELECT FROM public.observation_properties WHERE property_key='wire_published_current_rating')
 AND NOT EXISTS(SELECT FROM public.vehicle_observations));
CREATE TEMP TABLE rating_proposal_initial AS SELECT to_jsonb(p) AS row FROM public.schema_proposals p WHERE id='9c1ef313-f482-428e-8c66-75d38c5f3e07';
\i supabase/migrations/20261126213314_wire_current_rating_vocabulary.sql
SELECT pg_temp.ok('exact submission replay leaves one unchanged proposal',
 (SELECT to_jsonb(p)=(SELECT row FROM rating_proposal_initial) FROM public.schema_proposals p WHERE id='9c1ef313-f482-428e-8c66-75d38c5f3e07'));
UPDATE public.schema_proposals SET decision_rationale='Fixture review note, not an approval' WHERE id='9c1ef313-f482-428e-8c66-75d38c5f3e07';
\i supabase/migrations/20261126213314_wire_current_rating_vocabulary.sql
SELECT pg_temp.ok('replay preserves review metadata without overwriting it',
 (SELECT decision_rationale='Fixture review note, not an approval' AND status='open' FROM public.schema_proposals WHERE id='9c1ef313-f482-428e-8c66-75d38c5f3e07'));
DO $$ DECLARE m jsonb; BEGIN
 m:=public.schema_proposal_key_gate(ARRAY['9c1ef313-f482-428e-8c66-75d38c5f3e07']::uuid[]);
 PERFORM pg_temp.ok('unretained prototype cannot register current rating',m->>'decision'='refused'
  AND m->'reasons'?'citation_reference_not_current'
  AND NOT EXISTS(SELECT FROM public.observation_properties WHERE property_key='wire_published_current_rating'));
END $$;
-- Adapt only this disposable prototype to the canonical synthetic source from
-- the parent contract. Recompute actual source/object/page qualification instead
-- of stubbing a successful source reader or admitting a numerical value.
UPDATE public.document_pages SET extracted_text=extracted_text||E'\n'||$quote$Wire  Current Rating   Current Rating    Resistance Resistance
Gauge at 80 °C ambient at 100 °C ambient [ohm/m]    [ohm/1000 ft]$quote$;
DO $$ DECLARE pages jsonb; rev text; BEGIN
 SELECT jsonb_agg(jsonb_build_object('page_number',page_number,'printed_label',extraction_notes,
  'extracted_text',extracted_text,'has_diagrams',has_diagrams) ORDER BY page_number) INTO pages FROM public.document_pages;
 SELECT encode(extensions.digest(jsonb_build_object('document',jsonb_build_object('title',r.title,'category',r.category,'source_url',r.source_url,
 'pdf_sha256',r.file_hash,'page_count',r.page_count),'pages',pages,'object_id',o.id,'object_version',o.version)::text,'sha256'),'hex')
 INTO rev FROM public.reference_documents r CROSS JOIN storage.objects o;
 UPDATE public.reference_documents SET source_capture=source_capture||jsonb_build_object('revision',rev,
  'pages_sha256',encode(extensions.digest(pages::text,'sha256'),'hex'));
 UPDATE public.schema_proposals SET evidence=(SELECT jsonb_agg(e||jsonb_build_object('row_id','72000000-0000-0000-0000-000000000003',
  'document_id','72000000-0000-0000-0000-000000000002','file_sha256',repeat('a',64),'reference_revision',rev))
  FROM jsonb_array_elements(evidence)e) WHERE id='9c1ef313-f482-428e-8c66-75d38c5f3e07';
END $$;
CREATE TEMP TABLE rating_properties_before AS TABLE public.observation_properties;
DO $$ DECLARE m jsonb; BEGIN
 m:=public.schema_proposal_key_gate(ARRAY['9c1ef313-f482-428e-8c66-75d38c5f3e07']::uuid[]);
 PERFORM pg_temp.ok('qualified current-rating witness registers only the class key',m->>'decision'='ratified'
  AND EXISTS(SELECT FROM public.observation_properties WHERE property_key='wire_published_current_rating' AND unit='A'
   AND data_type='numeric' AND cardinality='multi' AND verification_scope='class'
   AND discriminator_key='wire_current_rating_condition_key' AND proposed_by_proposal_id='9c1ef313-f482-428e-8c66-75d38c5f3e07')
  AND (SELECT count(*) FROM public.observation_properties)=(SELECT count(*)+1 FROM rating_properties_before)
  AND NOT EXISTS(SELECT FROM public.vehicle_observations)
  AND NOT EXISTS(SELECT FROM public.schema_proposal_reviews WHERE proposal_id='9c1ef313-f482-428e-8c66-75d38c5f3e07'));
 PERFORM pg_temp.ok('current-rating vocabulary does not change the resistance key',
  (SELECT bool_and(to_jsonb(p)=to_jsonb(b)) FROM public.observation_properties p JOIN rating_properties_before b USING(id)));
END $$;
SELECT 'PASS: conditioned current-rating vocabulary metadata replay and canonical source gate; no numerical claims or engineering release' AS result;
