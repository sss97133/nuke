-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Release terms on quotes: issue_work_order_quote(..., p_release_conditions), quote hash capture, change-order inheritance,
-- release evaluation. Chained on the change-order contract (live order: 213000 before the backend lifecycle migrations here).
\ir test_work_order_change_orders.sql
ALTER TABLE vehicle_images ADD COLUMN user_id uuid, ADD COLUMN image_url text, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN is_sensitive boolean, ADD COLUMN is_superseded boolean, ADD COLUMN vision_gate_status text;
CREATE TABLE public.organization_vehicles(organization_id uuid, vehicle_id uuid);
\ir ../migrations/20261019200000_work_order_completion_sign.sql
\ir ../migrations/20261019201500_work_order_invoice_payment_witness.sql
\ir ../migrations/20261019220000_job_evidence_attach.sql
\ir ../migrations/20261019221500_quote_release_terms.sql

CREATE FUNCTION public.rel() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT read_work_order_job_path('30000000-0000-0000-0000-000000000001')#>'{stages,accounting,release}' $$;
CREATE FUNCTION public.issue_terms(p_terms jsonb,p_supersedes uuid,p_lines jsonb DEFAULT lines(175)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT issue_work_order_quote('30000000-0000-0000-0000-000000000001',p_lines,NULL,NULL,p_supersedes,p_terms) $$;
GRANT EXECUTE ON FUNCTION public.rel(),public.issue_terms(jsonb,uuid,jsonb) TO authenticated;
SELECT (qstate()#>>'{current_quote,quote_id}') AS cur \gset

SELECT t_assert(rel() @> '{"declared_by":"platform_standard","declared_terms":null,"payment_authorized":false}'
 AND work_order_release_terms_hash_part(NULL)='{}'::jsonb AND work_order_release_terms_hash_part('null')='{}'::jsonb,
 'no terms: platform standard predicates; quotes without terms hash exactly as before');
SELECT t_assert(work_order_release_terms_normalize('["installed_parts_witness",{"kind":"days_signed","days":3},{"kind":"customer_completion_sign"}]')
 = '[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":3},{"kind":"installed_parts_witness"}]'::jsonb,'terms normalize to sorted objects');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format('SELECT issue_terms(%L,%L)','["paid_upfront"]',:'cur'),'malformed release condition'),'unknown condition refused');
SELECT t_assert(t_refused_with(format('SELECT issue_terms(%L,%L)','[{"kind":"days_signed","days":0}]',:'cur'),'malformed release condition'),'days out of range refused');
SELECT t_assert(t_refused_with(format('SELECT issue_terms(%L,%L)','[{"kind":"days_signed"}]',:'cur'),'malformed release condition'),'days_signed needs days');
SELECT t_assert(t_refused_with(format('SELECT issue_terms(%L,%L)','["photos_in_window","photos_in_window"]',:'cur'),'declared twice'),'duplicate condition refused');
SELECT issue_terms('["customer_completion_sign","installed_parts_witness",{"kind":"days_signed","days":3}]',:'cur') AS q4 \gset
SELECT issue_terms('["customer_completion_sign","installed_parts_witness",{"kind":"days_signed","days":3}]',:'cur') AS q4dup \gset
RESET ROLE;
SELECT (:'q4'::jsonb)->>'quote_id' AS q4id \gset
SELECT (:'q4'::jsonb)->>'quote_hash' AS q4hash \gset
SELECT t_assert((:'q4dup'::jsonb)->>'quote_id'=:'q4id' AND ((:'q4dup'::jsonb)->>'duplicate')::boolean
 AND (SELECT conditions FROM work_order_quote_release_terms WHERE quote_id=:'q4id')
   = '[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":3},{"kind":"installed_parts_witness"}]'::jsonb
 AND (SELECT structured_data#>'{work_order_resource,release_conditions}' FROM vehicle_observations WHERE id=:'q4id')
   = '[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":3},{"kind":"installed_parts_witness"}]'::jsonb,
 'quote carries normalized terms on its source and in its terms row; repeat issuance is idempotent');
SELECT t_assert(:'q4hash' = encode(sha256(convert_to((jsonb_build_object('quote_id',q.id,'work_order_id',q.work_order_id,'version',q.version,
   'supersedes_quote_id',q.supersedes_quote_id,'quoting_party',jsonb_build_object('kind',q.quoting_party_kind,'id',q.quoting_user_id),
   'scope_snapshot',q.scope_snapshot,'lines',q.lines,'deposit_requested',NULL::jsonb,'valid_until',q.valid_until)
   || jsonb_build_object('release_conditions',rt.conditions))::text,'UTF8')),'hex')
 AND :'h1' = encode(sha256(convert_to(jsonb_build_object('quote_id',p.id,'work_order_id',p.work_order_id,'version',p.version,
   'supersedes_quote_id',p.supersedes_quote_id,'quoting_party',jsonb_build_object('kind',p.quoting_party_kind,'id',p.quoting_user_id),
   'scope_snapshot',p.scope_snapshot,'lines',p.lines,'deposit_requested',NULL::jsonb,'valid_until',p.valid_until)::text,'UTF8')),'hex'),
 'quote hash covers the declared terms; a quote without terms keeps the original formula')
FROM work_order_quotes q JOIN work_order_quote_release_terms rt ON rt.quote_id=q.id, work_order_quotes p WHERE q.id=:'q4id' AND p.id=:'q1';

-- The customer accepts the quote with terms: the release evaluation uses them.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_order_quote(:'q4id',:'q4hash');
RESET ROLE;
SELECT t_assert(rel() @> '{"declared_by":"accepted_quote","met":false,"payment_authorized":false,"disbursement":"not_performed"}'
 AND (SELECT array_agg(c->>'key') FROM jsonb_array_elements(rel()->'conditions') c)
   = ARRAY['quote_accepted_by_customer','customer_completion_sign','days_signed','installed_parts_witness','invoice_current','invoice_settled_by_payee_witness']
 AND rel()->'conditions' @> '[{"key":"customer_completion_sign","met":false,"declared":true},{"key":"installed_parts_witness","met":false,"basis":"no authenticated supporting delivery attestation"},{"key":"days_signed","met":false,"days":3,"basis":"no customer completion acceptance"}]',
 'declared terms evaluated over evidence');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT attest_work_completion('30000000-0000-0000-0000-000000000001',:'q4hash') AS a4 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_completion('30000000-0000-0000-0000-000000000001',((:'a4'::jsonb)->>'completion_id')::uuid,(:'a4'::jsonb)->>'completion_hash');
RESET ROLE;
SELECT t_assert(rel()->'conditions' @> '[{"key":"customer_completion_sign","met":true}]'
 AND EXISTS (SELECT 1 FROM jsonb_array_elements(rel()->'conditions') c WHERE c->>'key'='days_signed' AND c->>'met'='false' AND c->>'basis' LIKE 'held until %')
 AND rel() @> '{"met":false,"payment_authorized":false}','completion signed; the hold period keeps release unmet; nothing authorized');

-- A change order on the accepted quote carries its terms into its own hash and terms row.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT co('[{"action":"remove","line_index":1}]','Fee dropped') AS c5 \gset
RESET ROLE;
SELECT t_assert((SELECT conditions FROM work_order_quote_release_terms WHERE quote_id=((:'c5'::jsonb)->>'quote_id')::uuid)
   = (SELECT conditions FROM work_order_quote_release_terms WHERE quote_id=:'q4id')
 AND (:'c5'::jsonb)->>'quote_hash' = encode(sha256(convert_to((jsonb_build_object('quote_id',q.id,'work_order_id',q.work_order_id,'version',q.version,
   'supersedes_quote_id',q.supersedes_quote_id,'quoting_party',jsonb_build_object('kind',q.quoting_party_kind,'id',q.quoting_user_id),
   'scope_snapshot',q.scope_snapshot,'lines',q.lines,'deposit_requested',NULL::jsonb,'valid_until',q.valid_until)
   || jsonb_build_object('change_order',q.change_order) || jsonb_build_object('release_conditions',rt.conditions))::text,'UTF8')),'hex'),
 'change order inherits the base quote''s terms, inside its hash')
FROM work_order_quotes q JOIN work_order_quote_release_terms rt ON rt.quote_id=q.id WHERE q.id=((:'c5'::jsonb)->>'quote_id')::uuid;

SELECT t_assert(to_regprocedure('issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid)') IS NULL
 AND has_function_privilege('authenticated','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','issue_work_order_quote(uuid,jsonb,jsonb,timestamptz,uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','record_work_order_quote_release_terms(uuid,jsonb)','EXECUTE'),'grants: one issue signature, authenticated only');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('project_work_order_quote_event(uuid)'::regprocedure),'work_order_release_terms_hash_part|record_work_order_quote_release_terms','g'))=2,
 'quote projector carries the two release-terms lines');
