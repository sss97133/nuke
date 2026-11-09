-- Synthetic, disposable PostgreSQL contract only; never production.
-- Runs the reviewed pre-repair definitions, then 20261109055301 (admission + reader), then 20261109070000 (re-derivation),
-- and checks: demotion, the no-holding negative case, idempotent rerun, signed evidence, exact rollback, and re-derive after rollback.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('fixture.role',true) $$;
CREATE TABLE vehicles(id uuid PRIMARY KEY, year int, make text, model text, trim text, user_id uuid, owner_id uuid, uploaded_by uuid,
 primary_image_url text, purchase_price numeric, image_count bigint, merged_into_vehicle_id uuid, deleted_at timestamptz, is_public boolean);
CREATE TABLE ownership_verifications(id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, status text,
 title_document_url text, verification_category text, expires_at timestamp, human_reviewer_id uuid);
CREATE TABLE vehicle_user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,user_id uuid,role text,
 revoked_at timestamptz,revoked_by uuid,is_active boolean,context text,granted_by uuid,granted_at timestamptz,created_at timestamptz,
 expires_at timestamptz, permissions text[] DEFAULT '{}');
CREATE UNIQUE INDEX permission_role ON vehicle_user_permissions(vehicle_id,user_id,role) WHERE is_active=true;
CREATE UNIQUE INDEX permission_pair ON vehicle_user_permissions(vehicle_id,user_id);
CREATE TABLE vehicle_ownerships(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,owner_profile_id uuid,owner_identity_id uuid,
 role text,verification_id uuid,proof_event_id uuid,is_current boolean,start_date date,end_date date,ownership_type text,updated_at timestamptz);
CREATE TABLE ownership_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,from_user_id uuid,to_user_id uuid,
 status text,completed_at timestamptz,cancelled_at timestamptz);
CREATE TABLE vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,user_id uuid,documented_by_user_id uuid,
 image_url text,created_at timestamptz,is_superseded boolean);
CREATE TABLE discovered_vehicles(vehicle_id uuid,user_id uuid,is_active boolean,relationship_type text);
CREATE TABLE work_sessions(vehicle_id uuid,user_id uuid,session_date date);
CREATE TABLE vehicle_contributors(vehicle_id uuid,user_id uuid);
CREATE TABLE nuke_estimates(vehicle_id uuid,estimated_value numeric,comp_method text,calculated_at timestamptz);
CREATE TABLE vehicle_activity(vehicle_id uuid,last_activity_at timestamptz);
CREATE TABLE receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vendor text);
CREATE TABLE receipt_vehicle_links(receipt_id uuid, vehicle_id uuid, user_id uuid);
CREATE FUNCTION vehicle_image_gallery_eligible(vehicle_images) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- garage_derivation_evidence as live (20261108175533): append-only, supersede only.
CREATE TABLE garage_derivation_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, vehicle_id uuid, other_vehicle_id uuid,
 user_id uuid, organization_id uuid, session_key text, subject_key text, image_ids uuid[] NOT NULL DEFAULT '{}', conclusion text NOT NULL,
 conclusion_detail jsonb NOT NULL DEFAULT '{}', confidence numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1), rationale text,
 evidence jsonb NOT NULL DEFAULT '{}', producer_agent text NOT NULL DEFAULT 'injestion', producer_script text NOT NULL, producer_version text NOT NULL,
 model text, viewer int, run_id uuid NOT NULL, source_run_id uuid, content_hash text NOT NULL, dedupe_key text NOT NULL UNIQUE,
 observed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), superseded_at timestamptz, superseded_by uuid, superseded_reason text,
 CHECK (kind = ANY (ARRAY['scene_label','place_match','place_exemplar','sign_read','duplicate_judgment','seller_history_match','relationship_role','receipt_work_correlation'])));
CREATE FUNCTION derived_rows_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% is append-only: supersede, never delete', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  IF OLD.superseded_at IS NOT NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by' - 'superseded_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by' - 'superseded_reason') THEN
    RAISE EXCEPTION '% is append-only: only an active row can be superseded', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER garage_derivation_evidence_append_only BEFORE DELETE OR UPDATE ON garage_derivation_evidence FOR EACH ROW EXECUTE FUNCTION derived_rows_append_only();
-- live set_single_current_owner and stamp_vehicle_permission_grantor (2026-11-09)
CREATE FUNCTION set_single_current_owner() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if NEW.owner_identity_id is not null then NEW.updated_at := now(); return NEW; end if;
  if NEW.is_current then
    update vehicle_ownerships set is_current = false, end_date = coalesce(end_date, NEW.start_date)
     where vehicle_id = NEW.vehicle_id and id <> NEW.id and is_current = true and owner_identity_id is null;
  end if;
  NEW.updated_at := now(); return NEW;
end $$;
CREATE TRIGGER trg_single_current_owner BEFORE INSERT OR UPDATE ON vehicle_ownerships FOR EACH ROW EXECUTE FUNCTION set_single_current_owner();
CREATE FUNCTION stamp_vehicle_permission_grantor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN NEW.granted_by := auth.uid(); NEW.granted_at := now();
  ELSIF (NEW.vehicle_id, NEW.user_id, NEW.role, NEW.granted_by) IS DISTINCT FROM (OLD.vehicle_id, OLD.user_id, OLD.role, OLD.granted_by)
     OR (coalesce(NEW.is_active, true) AND NOT coalesce(OLD.is_active, true)) THEN NEW.granted_by := auth.uid(); NEW.granted_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_stamp_vehicle_permission_grantor BEFORE INSERT OR UPDATE ON vehicle_user_permissions FOR EACH ROW EXECUTE FUNCTION stamp_vehicle_permission_grantor();
\ir fixtures/garage_ownership_before.sql
CREATE TRIGGER trg_enforce_user_vehicle_evidence BEFORE INSERT OR UPDATE ON vehicle_user_permissions FOR EACH ROW EXECUTE FUNCTION enforce_user_vehicle_evidence();
CREATE FUNCTION assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; END $$;
CREATE FUNCTION refuses(statement text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN raise_exception THEN RETURN; END;
  RAISE EXCEPTION 'FAIL: unexpectedly admitted %',statement;
 END $$;
CREATE FUNCTION rel(v text) RETURNS text LANGUAGE sql AS $$
 SELECT relationship FROM get_user_garage('10000000-0000-4000-8000-000000000001') WHERE vehicle_id=('20000000-0000-4000-8000-'||lpad(v,12,'0'))::uuid $$;
CREATE FUNCTION vid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;

-- U1 = the account; U2 = another account.  Vehicles:
-- 1 photographed, self-granted co_owner (the leak)          2 current title + owner permission (stays owner)
-- 3 NEGATIVE: created/uploaded the profile (source custody), consigned for a seller, linked receipts, photos, expired title; no holding
-- 4 co_owner with no photos and no title (file custody only) 5 legal_title period with no verification; U2 also holds a current period
-- 6 legal_title period backed by a completed transfer (left alone)
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','service_role',false);
INSERT INTO vehicles(id,year,make,model,is_public) SELECT vid(n),1970,'Fixture','Car',true FROM generate_series(1,6) n;
UPDATE vehicles SET user_id=auth.uid(), uploaded_by=auth.uid() WHERE id IN (vid(3), vid(4));
INSERT INTO vehicle_images(vehicle_id,user_id,created_at,image_url) VALUES
 (vid(1),auth.uid(),now()-interval '200 days','i1'),(vid(2),auth.uid(),now()-interval '200 days','i2'),(vid(3),auth.uid(),now()-interval '200 days','i3');
INSERT INTO ownership_verifications VALUES
 ('30000000-0000-4000-8000-000000000002',vid(2),auth.uid(),'approved','https://example.test/title','title_document',now()+interval '30 days',auth.uid()),
 ('30000000-0000-4000-8000-000000000003',vid(3),auth.uid(),'approved','https://example.test/title','title_document',now()-interval '1 day',null);
INSERT INTO vehicle_user_permissions(id,vehicle_id,user_id,role,is_active,granted_by,granted_at,context) VALUES
 ('40000000-0000-4000-8000-000000000001',vid(1),auth.uid(),'co_owner',true,auth.uid(),now(),'owner request: garage visibility'),
 ('40000000-0000-4000-8000-000000000002',vid(2),auth.uid(),'owner',true,auth.uid(),now(),'Auto-granted via approval'),
 ('40000000-0000-4000-8000-000000000003',vid(3),auth.uid(),'consigned',true,auth.uid(),now(),'seller consignment');
-- 4: inserted under the pre-repair guard while it still had a title row, the way legacy rows were admitted
INSERT INTO ownership_verifications VALUES ('30000000-0000-4000-8000-000000000004',vid(4),auth.uid(),'approved','https://example.test/t','custody_evidence',null,null);
INSERT INTO vehicle_user_permissions(id,vehicle_id,user_id,role,is_active,granted_by,granted_at) VALUES
 ('40000000-0000-4000-8000-000000000004',vid(4),auth.uid(),'co_owner',true,auth.uid(),now());
INSERT INTO receipts(id,user_id,vendor) VALUES ('50000000-0000-4000-8000-000000000003',auth.uid(),'Parts store');
INSERT INTO receipt_vehicle_links VALUES ('50000000-0000-4000-8000-000000000003',vid(3),auth.uid());
INSERT INTO vehicle_ownerships(id,vehicle_id,owner_profile_id,role,is_current,ownership_type,start_date) VALUES
 ('60000000-0000-4000-8000-000000000005',vid(5),auth.uid(),'verified_owner',true,'legal_title','2014-12-24');
INSERT INTO ownership_verifications VALUES ('30000000-0000-4000-8000-000000000051',vid(5),'10000000-0000-4000-8000-000000000002','approved','https://example.test/u2','title_document',null,null);
INSERT INTO vehicle_ownerships(id,vehicle_id,owner_profile_id,role,verification_id,is_current,ownership_type,start_date) VALUES
 ('60000000-0000-4000-8000-000000000051',vid(5),'10000000-0000-4000-8000-000000000002','owner','30000000-0000-4000-8000-000000000051',false,'legal_title',null);
UPDATE vehicle_ownerships SET is_current=true WHERE id='60000000-0000-4000-8000-000000000051';  -- the trigger ends U1's period ...
UPDATE vehicle_ownerships SET is_current=true WHERE id='60000000-0000-4000-8000-000000000005';  -- ... and this ends U2's
ALTER TABLE vehicle_ownerships DISABLE TRIGGER trg_single_current_owner;                         -- fixture: two open periods, as legacy data has
UPDATE vehicle_ownerships SET is_current=true, end_date=null WHERE vehicle_id=vid(5);
ALTER TABLE vehicle_ownerships ENABLE TRIGGER trg_single_current_owner;
INSERT INTO ownership_transfers(vehicle_id,to_user_id,status,completed_at) VALUES (vid(6),auth.uid(),'completed',now()-interval '10 days');
INSERT INTO vehicle_ownerships(id,vehicle_id,owner_profile_id,role,is_current,ownership_type,start_date) VALUES
 ('60000000-0000-4000-8000-000000000006',vid(6),auth.uid(),'owner',true,'legal_title',current_date-10);
SELECT assert(rel('1')='owner','reproduce: photographed co_owner shown as owner');
SELECT assert(rel('4')='owner','reproduce: custody-only co_owner shown as owner');
SELECT assert(rel('5')='owner','reproduce: uncited legal_title period shown as owner');

\ir ../migrations/20261109055301_garage_ownership_requires_evidence.sql
\ir ../migrations/20261109070000_rederive_ownership_roles.sql

-- the negative case is not owner through the API reader, and cannot be made owner through the write path
SELECT assert(rel('3') IS DISTINCT FROM 'owner','custody + consignment + receipts + photos + expired title is not owner');
SELECT refuses($q$UPDATE vehicle_user_permissions SET role='co_owner' WHERE id='40000000-0000-4000-8000-000000000003'$q$);
SELECT refuses($q$UPDATE vehicle_user_permissions SET role='owner' WHERE id='40000000-0000-4000-8000-000000000003'$q$);

CREATE TEMP TABLE before_vup AS SELECT * FROM vehicle_user_permissions;
CREATE TEMP TABLE before_vo AS SELECT * FROM vehicle_ownerships;
SELECT assert((SELECT count(*)=3 FROM rederive_vehicle_ownership_roles('70000000-0000-4000-8000-000000000001','test-sha',null,true)),'dry run: 1, 4, 5');
SELECT assert(NOT EXISTS (SELECT * FROM before_vup EXCEPT SELECT * FROM vehicle_user_permissions),'dry run writes nothing');
SELECT assert((SELECT count(*)=0 FROM garage_derivation_evidence),'dry run signs nothing');

CREATE TEMP TABLE run1 AS SELECT * FROM rederive_vehicle_ownership_roles('70000000-0000-4000-8000-000000000001','test-sha',null,false);
SELECT assert((SELECT string_agg(row_id::text||'='||decision, ',' ORDER BY row_id) FROM run1) =
  '40000000-0000-4000-8000-000000000001=contributor,40000000-0000-4000-8000-000000000004=retracted,60000000-0000-4000-8000-000000000005=claimed_unverified','decisions');
SELECT assert((SELECT role='contributor' AND is_active AND granted_by=auth.uid() FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000001'),'photos -> contributor, granted_by kept');
SELECT assert((SELECT role='co_owner' AND NOT is_active AND revoked_at IS NOT NULL FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000004'),'no photos -> retracted, row kept');
SELECT assert((SELECT role='owner' AND is_active FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000002'),'title owner untouched');
SELECT assert((SELECT role='consigned' FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000003'),'consignment association untouched');
SELECT assert((SELECT ownership_type='claimed_unverified' AND is_current AND start_date='2014-12-24' FROM vehicle_ownerships WHERE id='60000000-0000-4000-8000-000000000005'),'period kept, title claim withdrawn');
SELECT assert((SELECT is_current AND ownership_type='legal_title' FROM vehicle_ownerships WHERE id='60000000-0000-4000-8000-000000000051'),'another account''s titled open period not ended or retyped');
SELECT assert((SELECT ownership_type='legal_title' FROM vehicle_ownerships WHERE id='60000000-0000-4000-8000-000000000006'),'completed transfer keeps legal_title');
SELECT assert((SELECT count(*)=3 FROM garage_derivation_evidence WHERE run_id='70000000-0000-4000-8000-000000000001' AND producer_version='test-sha' AND kind='relationship_role'),'every decision signed');
SELECT assert((SELECT count(*)=3 FROM ownership_role_rederivation_backup WHERE run_id='70000000-0000-4000-8000-000000000001' AND evidence_id IS NOT NULL),'every decision backed up');
SELECT assert((SELECT count(*)=0 FROM pg_trigger WHERE tgname IN ('trg_single_current_owner','trg_enforce_user_vehicle_evidence') AND tgenabled<>'O'),'triggers re-enabled after run');
SELECT assert(rel('1') IS DISTINCT FROM 'owner' AND rel('4') IS DISTINCT FROM 'owner' AND rel('5') IS DISTINCT FROM 'owner' AND rel('3') IS DISTINCT FROM 'owner','no unsupported owner after run');
SELECT assert(rel('2')='owner','titled vehicle still owner');
-- rerun (and a reload of the reader) finds nothing more to do
SELECT assert((SELECT count(*)=0 FROM rederive_vehicle_ownership_roles('70000000-0000-4000-8000-000000000002','test-sha',null,false)),'rerun is a no-op');
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000002',false);
SELECT set_config('fixture.role','authenticated',false);
SELECT assert((SELECT count(*)=1 FROM get_user_garage('10000000-0000-4000-8000-000000000001') WHERE relationship='owner'),'public projection: only the titled vehicle');
SELECT set_config('fixture.uid','10000000-0000-4000-8000-000000000001',false);
SELECT set_config('fixture.role','service_role',false);

-- rollback restores the exact rows, supersedes the evidence, and re-enables the guard
SELECT assert((SELECT count(*)=3 FROM rollback_ownership_role_rederivation('70000000-0000-4000-8000-000000000001','test',true)),'rollback dry run lists 3');
SELECT assert((SELECT count(*)=3 FROM rollback_ownership_role_rederivation('70000000-0000-4000-8000-000000000001','test',false)),'rollback applies 3');
SELECT assert(NOT EXISTS ((SELECT * FROM before_vup EXCEPT SELECT * FROM vehicle_user_permissions) UNION ALL (SELECT * FROM vehicle_user_permissions EXCEPT SELECT * FROM before_vup)),'permissions restored exactly');
SELECT assert(NOT EXISTS ((SELECT * FROM before_vo EXCEPT SELECT * FROM vehicle_ownerships) UNION ALL (SELECT * FROM vehicle_ownerships EXCEPT SELECT * FROM before_vo)),'periods restored exactly');
SELECT assert((SELECT count(*)=3 FROM garage_derivation_evidence WHERE run_id='70000000-0000-4000-8000-000000000001' AND superseded_at IS NOT NULL),'evidence superseded, not deleted');
SELECT assert((SELECT count(*)=0 FROM pg_trigger WHERE tgname IN ('trg_single_current_owner','trg_enforce_user_vehicle_evidence') AND tgenabled<>'O'),'triggers re-enabled after rollback');
SELECT assert((SELECT count(*)=0 FROM rollback_ownership_role_rederivation('70000000-0000-4000-8000-000000000001','again',false)),'rollback is one-shot');
SELECT refuses($q$INSERT INTO vehicle_user_permissions(vehicle_id,user_id,role,is_active,granted_by) VALUES (vid(1),'10000000-0000-4000-8000-000000000002','co_owner',true,'10000000-0000-4000-8000-000000000002')$q$);
-- after rollback the reader still qualifies the restored rows, and re-running the producer reaches the same result
SELECT assert(rel('1') IS DISTINCT FROM 'owner','reader qualifies restored row');
SELECT assert((SELECT count(*)=3 FROM rederive_vehicle_ownership_roles('70000000-0000-4000-8000-000000000003','test-sha',null,false)),'re-derive after rollback');
SELECT assert((SELECT role='contributor' FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000001'),'same decision after re-derive');
SELECT set_config('fixture.role','authenticated',false);
SELECT assert((SELECT role FROM vehicle_user_permissions WHERE id='40000000-0000-4000-8000-000000000001')='contributor','');
\echo 'ownership role re-derivation contract PASS'
