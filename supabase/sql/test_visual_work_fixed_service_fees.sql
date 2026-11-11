-- Disposable synthetic source-to-reader contract; no production rows or prices.
\set ON_ERROR_STOP on
\ir test_visual_work_master_cost_fold.sql
\ir ../migrations/20261111153359_visual_work_fixed_service_fees.sql

DO $$
DECLARE v uuid:='10000000-0000-0000-0000-000000000001'; p jsonb; op jsonb; fee jsonb; hourly jsonb; j jsonb; s jsonb; bad jsonb;
BEGIN
 PERFORM set_config('test.role','anon',false); PERFORM set_config('test.uid','',false);
 ASSERT NOT has_function_privilege('anon','visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','visual_work_master_cost_fold(uuid,jsonb,boolean,boolean)','EXECUTE');
 SELECT packet INTO p FROM baseline_packet; hourly:=p#>'{operations,0}';
 fee:=jsonb_build_object('type','fixed_service_fee','unit_fee',jsonb_build_object('min',30,'typical',30,'max',30),
  'currency','USD','unit','assembly','price_basis','published_starting_price',
  'source_url','https://machine.example/services','source_retrieved_at','2026-01-01T12:00:00Z','source_sha256',repeat('d',64),
  'derivation','Conditional service comparison; excludes engine bench assembly, vehicle installation and custom fitting.');
 op:=hourly||jsonb_build_object('physical_operation_key','machine.pistons','system_key','machining','label','Mount pistons on rods',
  'quantity',jsonb_build_object('value',8,'unit','assembly','basis','explicit_assumption','derivation','Eight assemblies in the reconstruction scenario.'),
  'reference',fee,'selected',true);
 p:=p||jsonb_build_object('materials','[]'::jsonb,'operations',jsonb_build_array(op));
 -- A private reported rate is deliberately unusable; a service fee must not read
 -- or expose it, nor derive hours by dividing the price by a rate.
 p:=p||'{"rate_basis":{"kind":"reported","rate":777,"currency":"USD"}}';
 UPDATE vehicle_observations SET is_superseded=true WHERE kind='work_record';
 UPDATE vehicle_observations SET is_superseded=false,structured_data=p WHERE id IN
  ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003');
 j:=vehicle_build_log_public(v,false); s:=j#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,kind}'='labor' AND s#>>'{rows,0,status}'='resolved' AND s#>>'{rows,0,claim_count}'='2',s::text;
 ASSERT (s#>>'{rows,0,cost,typical}')::numeric=240 AND s#>'{rows,0,hours}'='null' AND s#>'{rows,0,rate_basis}'='null';
 ASSERT s#>>'{rows,0,formula}'='8 assembly × (30 / 30 / 30) USD per assembly; person-hours unknown';
 ASSERT s#>'{rows,0,reference,unit_fee}'=fee->'unit_fee' AND s#>>'{rows,0,reference,source_sha256}'=repeat('d',64);
 ASSERT s#>>'{rows,0,reference,price_basis}'='published_starting_price' AND j::text NOT LIKE '%777%';
 ASSERT s#>'{totals,hours}'='null' AND s#>>'{totals,hours_coverage,status}'='unestimated'
  AND s#>>'{totals,hours_coverage,unknown_lines}'='1' AND s#>>'{totals,hours_coverage,estimated_lines}'='0';
 ASSERT (s#>>'{totals,labor_currencies,0,cost,typical}')::numeric=240 AND s#>'{totals,material_currencies}'='[]';
 ASSERT s#>'{totals}'=s#>'{systems,0,totals}' AND s#>>'{coverage,duplicate_claims_folded}'='1';
 ASSERT j#>'{visual_work,0,receipts,0,amount}'='null';
 -- A conflicting duplicate price is withheld, never summed or averaged.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,reference,unit_fee}','{"min":31,"typical":31,"max":31}')
 WHERE id='a0000000-0000-0000-0000-000000000003';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'conflicting_physical_key' AND s#>'{totals,currencies}'='[]';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a0000000-0000-0000-0000-000000000003';
 -- Mixed hour and fee lines retain both costs but declare the hours partial.
 UPDATE vehicle_observations SET structured_data=p||jsonb_build_object('operations',jsonb_build_array(op,hourly),
  'rate_basis',jsonb_build_object('kind','explicit_assumption','rate',100,'currency','USD','derivation','Explicit test rate.'))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT (s#>>'{totals,currencies,0,cost,typical}')::numeric=1040 AND s#>>'{totals,hours,typical}'='8';
 ASSERT s#>>'{totals,hours_coverage,status}'='partial' AND s#>>'{totals,hours_coverage,labor_lines}'='2'
  AND s#>>'{totals,hours_coverage,estimated_lines}'='1' AND s#>>'{totals,hours_coverage,unknown_lines}'='1';
 ASSERT (SELECT x#>>'{totals,hours_coverage,status}' FROM jsonb_array_elements(s->'systems') x WHERE x->>'system_key'='machining')='unestimated';
 -- Ordered public-menu ranges retain their own currency, independent of the
 -- hourly line's rate/currency. The fee is never converted into an hour range.
 UPDATE vehicle_observations SET structured_data=jsonb_set(structured_data,'{operations,0,reference}',
  fee||'{"currency":"EUR","price_basis":"published_menu_price","unit_fee":{"min":25,"typical":30,"max":40}}')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{totals,labor_currencies,0,currency}'='EUR' AND s#>'{totals,labor_currencies,0,cost}'='{"min":200,"typical":240,"max":320}';
 ASSERT s#>>'{totals,labor_currencies,1,currency}'='USD' AND (s#>>'{totals,labor_currencies,1,cost,typical}')::numeric=800;
 ASSERT s#>>'{totals,hours,typical}'='8' AND s#>>'{totals,hours_coverage,status}'='partial';
 -- Explicit scenario selection is required even without an overlap group.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations}',jsonb_build_array(op-'selected'))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'fixed_service_selection_required' AND s#>'{rows,0,cost}'='null';
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,selected}','false')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='excluded' AND s#>'{totals,currencies}'='[]'
  AND s#>>'{totals,hours_coverage,status}'='not_applicable';
 -- A sole surviving overlap alternative cannot become implicitly selected.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations}',jsonb_build_array((op-'selected')||'{"overlap_group":"machine.scope"}'))
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'overlap_selection_unresolved' AND s#>'{totals,currencies}'='[]';
 -- Invalid numbers, currency, units, attribution and clocks fail closed.
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  fee||'{"unit_fee":{"min":-1,"typical":30,"max":30}}',
  fee||'{"unit_fee":{"min":31,"typical":30,"max":30}}',
  fee||'{"unit_fee":{"min":30,"typical":31,"max":30}}',
  fee||'{"unit_fee":{"min":30,"typical":30,"max":1000001}}',
  fee||'{"unit_fee":{"min":0,"typical":"NaN","max":30}}',
  fee||'{"unit_fee":{"min":null,"typical":30,"max":30}}',fee||'{"currency":"usd"}',fee-'currency',
  fee||'{"unit":"pair"}',fee||'{"price_basis":"private_invoice"}',fee||'{"derivation":" "}',
  fee||'{"source_url":"javascript:alert(1)"}',fee||'{"source_url":"https://user:secret@machine.example/services"}',
  fee||'{"source_url":"https://machine.example/has space"}',fee||'{"source_sha256":"bad"}',fee-'source_sha256',
  fee||'{"source_retrieved_at":"not a time"}',fee||'{"source_retrieved_at":"2999-01-01T00:00:00Z"}',
  fee||'{"source_retrieved_at":"2026-02-31T00:00:00Z"}',fee-'source_retrieved_at')) LOOP
  UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,reference}',bad)
  WHERE id='a0000000-0000-0000-0000-000000000001';
  s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
  ASSERT s#>>'{rows,0,status}'='unresolved' AND s#>'{totals,currencies}'='[]' AND s#>'{totals,hours}'='null',bad::text;
 END LOOP;
 -- A genuine attributed zero fee is a zero price, not zero time.
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,reference,unit_fee}','{"min":0,"typical":0,"max":0}')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>>'{rows,0,status}'='resolved' AND (s#>>'{totals,currencies,0,cost,typical}')::numeric=0 AND s#>'{totals,hours}'='null';
 UPDATE vehicle_observations SET structured_data=jsonb_set(p,'{operations,0,evidence_role}','"observed_transition"')
 WHERE id='a0000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'fixed_service_scope_unqualified' AND s#>'{totals,currencies}'='[]';
 UPDATE vehicle_observations SET structured_data=p WHERE id='a0000000-0000-0000-0000-000000000001';
 UPDATE vehicle_observations SET is_superseded=true WHERE id='a5000000-0000-0000-0000-000000000001';
 s:=vehicle_build_log_public(v,false)#>'{master_ledger,scenarios,0}';
 ASSERT s#>'{rows,0,reasons}' ? 'source_unavailable' AND s#>'{rows,0,cost}'='null' AND s#>'{totals,currencies}'='[]';
 UPDATE vehicle_observations SET is_superseded=false WHERE id='a5000000-0000-0000-0000-000000000001';
 UPDATE vehicle_images SET is_sensitive=true WHERE id='4abcdef1-0000-0000-0000-000000000002';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicle_images SET is_sensitive=false;
 UPDATE vehicles SET is_public=false;
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger');
 UPDATE vehicles SET is_public=true;
 UPDATE vehicle_observations SET confidence_score=.9 WHERE id='a0000000-0000-0000-0000-000000000001';
 ASSERT NOT (vehicle_build_log_public(v,false)?'master_ledger'),'Existing attributed-work admission gate is unchanged';
 RAISE NOTICE 'fixed service fees: actual reader, selection, duplicates, 20 invalid inputs, zero price, separate unknown hours, source withdrawal and privacy pass';
END $$;
