-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Evidence attach from the Library (attach_job_evidence), candidates, the open evidence reader and the execution stage.
\ir test_work_order_invoice_payment_witness.sql
ALTER TABLE vehicle_images ADD COLUMN user_id uuid, ADD COLUMN image_url text, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN is_sensitive boolean, ADD COLUMN is_superseded boolean, ADD COLUMN vision_gate_status text;
CREATE TABLE public.organization_vehicles(organization_id uuid, vehicle_id uuid);
\ir ../migrations/20261019220000_job_evidence_attach.sql

-- C (customer) photos of vehicle 1: one attachable, one sensitive, one gated personal, one of another vehicle, one long before the job.
INSERT INTO vehicle_images(id,vehicle_id,user_id,image_url,taken_at,is_sensitive,vision_gate_status) VALUES
 ('51000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','https://img.invalid/c1.jpg',clock_timestamp(),NULL,NULL),
 ('51000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','https://img.invalid/c2.jpg',clock_timestamp(),true,NULL),
 ('51000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','https://img.invalid/c3.jpg',clock_timestamp(),NULL,'rejected_personal'),
 ('51000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000c','https://img.invalid/c4.jpg',clock_timestamp(),NULL,NULL),
 ('51000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000c','https://img.invalid/c5.jpg','2020-01-01',NULL,NULL),
 ('51000000-0000-0000-0000-00000000000f','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','https://img.invalid/p1.jpg',clock_timestamp(),NULL,'approved'),
 ('51000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000b','https://img.invalid/s1.jpg',clock_timestamp(),NULL,NULL);
CREATE FUNCTION public.attach(p_ids uuid[],p_op uuid DEFAULT NULL,p_note text DEFAULT NULL,p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb
 LANGUAGE sql AS $$ SELECT attach_job_evidence(p_wo,p_ids,p_op,p_note) $$;
CREATE FUNCTION public.evr(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_evidence_read(p_wo) $$;
GRANT EXECUTE ON FUNCTION public.attach(uuid[],uuid,text,uuid),public.evr(uuid) TO anon,authenticated;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT job_evidence_candidates_read('30000000-0000-0000-0000-000000000001') AS k0 \gset
SELECT job_evidence_candidates_read() AS kall \gset
RESET ROLE;
SELECT t_assert((:'k0'::jsonb)->'items' @> '[{"image_id":"51000000-0000-0000-0000-000000000001","clock_basis":"taken_at"}]' AND jsonb_array_length((:'k0'::jsonb)->'items')=1
 AND (:'k0'::jsonb)#>'{coverage,not_attachable_excluded}'='2'
 AND (:'k0'::jsonb)#>'{work_orders,0}' @> '{"role":"customer","window":{"from_basis":"first_acceptance","until_basis":"completion_attestation_plus_1_day"}}'
 AND (:'k0'::jsonb)#>'{sign,rpc}'='"attach_job_evidence"','candidates: own attachable photo in the job window; sensitive and personal excluded; other vehicle and old photo absent');
SELECT t_assert((:'kall'::jsonb)->'items' @> '[{"image_id":"51000000-0000-0000-0000-000000000001","work_order_id":"30000000-0000-0000-0000-000000000001"}]',
 'candidates without a work order span the viewer''s jobs');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-00000000000b}')$q$,'unavailable for evidence'),'stranger cannot attach');
SELECT t_assert(t_refused_with($q$SELECT job_evidence_candidates_read('30000000-0000-0000-0000-000000000001')$q$,'Work order unavailable'),'stranger has no candidates on the job');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-000000000002}')$q$,'sensitive'),'sensitive image refused');
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-000000000003}')$q$,'Personal'),'personal-gated image refused');
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-000000000004}')$q$,'own images of this vehicle'),'image of another vehicle refused');
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-00000000000f}')$q$,'own images of this vehicle'),'someone else''s image refused');
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-000000000001}','99999999-0000-0000-0000-000000000001')$q$,'Operation'),'operation from elsewhere refused');
SELECT t_assert(t_refused_with($q$SELECT attach('{}')$q$,'1 to 50'),'empty attachment refused');
SELECT n_obs() AS nobs0 \gset
SELECT attach('{51000000-0000-0000-0000-000000000001}',:'op1','Before photos of the exhaust') AS e1 \gset
SELECT attach('{51000000-0000-0000-0000-000000000001}',:'op1','Before photos of the exhaust') AS e1dup \gset
SELECT t_assert(t_refused_with($q$SELECT attach('{51000000-0000-0000-0000-000000000001}',NULL,'again')$q$,'already attached'),'an image attaches once per job');
SELECT job_evidence_candidates_read('30000000-0000-0000-0000-000000000001') AS k1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT attach('{51000000-0000-0000-0000-00000000000f}') AS e2 \gset
RESET ROLE;
SELECT t_assert((:'e1'::jsonb) @> jsonb_build_object('attacher_role','customer','image_count',1,'operation_id',:'op1','duplicate',false,'image_visibility_changed',false)
 AND (:'e1dup'::jsonb)->>'attachment_id'=(:'e1'::jsonb)->>'attachment_id' AND ((:'e1dup'::jsonb)->>'duplicate')::boolean AND n_obs()=(:'nobs0')::bigint+2
 AND (:'e2'::jsonb)->>'attacher_role'='accepted_provider','customer and accepted provider attach their own photos; idempotent');
SELECT t_assert(jsonb_array_length((:'k1'::jsonb)->'items')=0,'attached photos leave the candidates');
SELECT t_assert(EXISTS (SELECT 1 FROM vehicle_observations o WHERE o.id=((:'e1'::jsonb)->>'attachment_id')::uuid AND o.kind='work_record'
   AND o.submitted_by_user_id='10000000-0000-0000-0000-00000000000c' AND o.extraction_method='work_order_evidence_attach_sign_v1'
   AND o.structured_data#>'{work_order_evidence,image_ids}'='["51000000-0000-0000-0000-000000000001"]'),'source: owner-input work_record naming the images');

-- The image is later gated for review: strangers lose it, its owner keeps it. Nothing about the image was written by the Sign.
UPDATE vehicle_images SET vision_gate_status='review_needed' WHERE id='51000000-0000-0000-0000-000000000001';
SET ROLE anon;
SELECT as_user(NULL);
SELECT evr() AS ra \gset
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT evr() AS rc \gset
RESET ROLE;
SELECT t_assert(jsonb_array_length((:'ra'::jsonb)->'attachments')=2
 AND (:'ra'::jsonb)->'attachments' @> jsonb_build_array(jsonb_build_object('attachment_id',(:'e1'::jsonb)->>'attachment_id','images','[]'::jsonb,'images_withheld',1,'note',null,
     'operation',jsonb_build_object('operation_id',:'op1','task_description','Fabricate stainless exhaust')),
   jsonb_build_object('attachment_id',(:'e2'::jsonb)->>'attachment_id','images_withheld',0,'images',jsonb_build_array(jsonb_build_object('image_id','51000000-0000-0000-0000-00000000000f'))))
 AND NOT :'ra' ~ '("user_id"|Before photos|c1\.jpg)' AND (:'ra'::jsonb)->'viewer' @> '{"party":false,"actions":[]}',
 'anon: attachments open, review-gated image withheld and counted, no notes or raw ids');
SELECT t_assert((:'rc'::jsonb)->'attachments' @> jsonb_build_array(jsonb_build_object('note','Before photos of the exhaust','images_withheld',0,
   'images',jsonb_build_array(jsonb_build_object('image_id','51000000-0000-0000-0000-000000000001','image_url','https://img.invalid/c1.jpg'))))
 AND (:'rc'::jsonb)#>'{viewer,actions}' @> '[{"action":"attach_evidence"}]','customer (image owner): own image, note, attach action');
SELECT t_assert((SELECT vision_gate_status='review_needed' AND is_sensitive IS NULL FROM vehicle_images WHERE id='51000000-0000-0000-0000-000000000001'),'image row untouched by the Sign');

SELECT t_assert(jp('execution') @> '{"attached_evidence":{"attachments":2,"images":2,"operations_with_evidence":1,"by_role":{"customer":1,"accepted_provider":1}}}',
 'job path execution counts attached evidence');
SELECT t_assert(t_refused_with(format('DELETE FROM work_order_evidence_images WHERE attachment_id=%L',(:'e1'::jsonb)->>'attachment_id'),'immutable'),'evidence rows are immutable');
SET ROLE service_role;
SELECT t_assert((project_work_order_evidence_attachment(((:'e1'::jsonb)->>'attachment_id')::uuid)->>'duplicate')::boolean
 AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(work_order_job_path_scoreboard()) k)::text=:'board_keys','projector replay idempotent; scoreboard shape unchanged');
RESET ROLE;
SELECT t_assert(has_function_privilege('authenticated','attach_job_evidence(uuid,uuid[],uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','attach_job_evidence(uuid,uuid[],uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','job_evidence_candidates_read(uuid,timestamptz,integer)','EXECUTE')
 AND has_function_privilege('anon','work_order_evidence_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_evidence_image_visible(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','project_work_order_evidence_attachment(uuid)','EXECUTE'),'grants');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('read_work_order_job_path(uuid)'::regprocedure),'work_order_(completion|accounting|execution_evidence)_overlay','g'))=3,
 'job path carries the three overlay lines once each');
