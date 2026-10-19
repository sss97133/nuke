-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- 20261020135000: a verified claimant's organization supply service evidence is shown beside the skill answer as
-- corroboration ('paid for this kind of work n times'), never as a pass; the evidence-derived answer is unchanged.
\ir test_job_loop_replay.sql

DELETE FROM organization_verified_claimants;
DELETE FROM organization_supply_evidence;
INSERT INTO organization_verified_claimants(organization_id, user_id, method, claim_evidence) VALUES
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f', 'domain_email', '{"domain":"fixture.example"}');
INSERT INTO organization_supply_evidence(organization_id, basis_table, basis_id, supply_kind, resolver) VALUES
 ('20000000-0000-0000-0000-000000000001', 'receipts', 'b1000000-0000-0000-0000-000000000001', 'upholstery_service', 'reviewed_alias'),
 ('20000000-0000-0000-0000-000000000001', 'receipts', 'b1000000-0000-0000-0000-000000000002', 'upholstery_service', 'reviewed_alias'),
 ('20000000-0000-0000-0000-000000000001', 'receipts', 'b1000000-0000-0000-0000-000000000003', 'interior_parts', 'reviewed_alias');

SELECT open_requirement_skill_input('10000000-0000-0000-0000-00000000000f', '{}', 'skill', '[{"key":"upholstery_full","from":"reviewed_keyword"}]', 'recover seats') AS a \gset
SELECT open_requirement_skill_input_evidence('10000000-0000-0000-0000-00000000000f', '{}', 'skill', '[{"key":"upholstery_full","from":"reviewed_keyword"}]', 'recover seats') AS a0 \gset
SELECT t_assert((:'a'::jsonb) @> '{"input":"skill","result":"unknown","supply_corroboration":[{"kind":"upholstery_service","capability":"upholstery_full","records":2,"label":"paid for this kind of work 2 times","strength":"corroborating"}]}'
 AND (:'a'::jsonb) - 'supply_corroboration' = (:'a0'::jsonb),
 'verified claimant: paid-for upholstery shown as corroboration; the skill answer itself is the evidence-derived one (still unknown)');
SELECT t_assert(NOT open_requirement_skill_input('10000000-0000-0000-0000-00000000000b', '{}', 'skill', '[{"key":"upholstery_full"}]', 'x') ? 'supply_corroboration'
 AND NOT open_requirement_skill_input('10000000-0000-0000-0000-00000000000f', '{}', 'skill', '[{"key":"engine_diagnostics"}]', 'x') ? 'supply_corroboration'
 AND NOT open_requirement_skill_input('10000000-0000-0000-0000-00000000000f', '{}', 'tool', '[{"key":"upholstery_full"}]', 'x') ? 'supply_corroboration',
 'no claim, no matching capability key, or a non-skill requirement: the shape is unchanged');
UPDATE organization_verified_claimants SET revoked_at = now();
SELECT t_assert(NOT open_requirement_skill_input('10000000-0000-0000-0000-00000000000f', '{}', 'skill', '[{"key":"upholstery_full"}]', 'x') ? 'supply_corroboration',
 'a revoked claim shows nothing');
INSERT INTO actor_capabilities(actor_id,capability_type,evidence_count,derivation,strength,direct_count,corroborating_count,against_count,folded_at) VALUES
 ('60000000-0000-0000-0000-000000000001','upholstery_full',1,'evidence_fold','direct',1,0,0,now());
SELECT t_assert(open_requirement_skill_input(NULL, '{"evidenced_actor_ids":["60000000-0000-0000-0000-000000000001"]}', 'skill', '[{"key":"upholstery_full"}]', 'x')
   @> '{"result":"pass","basis":"evidence_fold"}'
 AND (SELECT count(*) FROM supply_kind_capability_map WHERE supply_kind NOT LIKE '%\_service') = 0
 AND NOT has_function_privilege('authenticated','supply_skill_corroboration(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','open_requirement_skill_input(uuid,jsonb,text,jsonb,text)','EXECUTE'),
 'a pass still comes only from evidence_fold; only service kinds are mapped; helpers internal');
