-- Disposable PG17 contract. Reuse the existing physical-grain/segmentation fixture.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_reshape_v1.sql

-- Columns added to the real schema after the reshape fixture's historical cutoff.
ALTER TABLE public.vehicles ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.vehicle_custom_circuits ADD COLUMN checks jsonb, ADD COLUMN checked_at timestamptz,
  ADD COLUMN checks_version text;
ALTER TABLE public.harness_endpoints ADD COLUMN node_kind text, ADD COLUMN topology_node_id uuid,
  ADD COLUMN part_number text, ADD COLUMN notes text;
ALTER TABLE public.harness_nets ADD COLUMN protection_pdm_channel_ids uuid[];
ALTER TABLE public.harness_segments ADD COLUMN design_status text;
ALTER TABLE public.wire_termination_specs ADD COLUMN cavity text,
  ADD COLUMN terminal_contact_catalog_id uuid, ADD COLUMN terminal_contact_pn text,
  ADD COLUMN pin_seal_catalog_id uuid, ADD COLUMN pin_seal_pn text,
  ADD COLUMN crimp_tool_catalog_id uuid, ADD COLUMN crimp_tool_pn text;
CREATE TABLE public.harness_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  observation_id uuid NOT NULL, row_kind text NOT NULL, row_id uuid NOT NULL,
  field text, relation text NOT NULL, created_at timestamptz DEFAULT now());

-- Actual failure shape: circuit says18, catalog key says18, segment scalar retained20.
INSERT INTO public.catalog_parts (id,part_number)
VALUES ('00000000-0000-0000-0000-00000000c018','M22759/32-18-2');
UPDATE public.vehicle_custom_circuits SET circuit_code='23',wire_gauge_awg=18,
  checks='{"R9 pin":["PASS","legacy imported verdict"]}',checked_at='2026-10-16',checks_version='legacy-checker'
WHERE circuit_code='L1';
UPDATE public.harness_segments SET gauge_awg=20,wire_part_id='00000000-0000-0000-0000-00000000c018'
WHERE vehicle_custom_circuit_id='00000000-0000-0000-0000-000000000a04';
UPDATE public.harness_segments s SET planned_length_ft=CASE
  WHEN from_termination_id='00000000-0000-0000-0000-0000000b0101' THEN 1.09 ELSE 3.54 END,
  planned_length_method='fixture route-derived model length'
WHERE vehicle_custom_circuit_id='00000000-0000-0000-0000-000000000a01';
UPDATE public.harness_endpoints SET notes='PRIVATE_TEST invoice and purchase notes' WHERE code='M130-B';
INSERT INTO public.harness_evidence (vehicle_id,observation_id,row_kind,row_id,field,relation)
SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e','00000000-0000-0000-0000-00000000ee01',
 'segment',id,'gauge_awg','contradicts'
FROM public.harness_segments WHERE vehicle_custom_circuit_id='00000000-0000-0000-0000-000000000a04';

\i supabase/migrations/20261125224228_harness_schematic_model_reader.sql

DO $$
DECLARE g jsonb; again jsonb; old_hash text; n int; ft numeric; seg jsonb;
BEGIN
  g:=public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  again:=public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF g->>'snapshot_hash' IS DISTINCT FROM again->>'snapshot_hash' THEN RAISE EXCEPTION 'Unchanged read changed hash'; END IF;
  IF g->>'snapshot_kind' <> 'current_read_not_published_revision' THEN RAISE EXCEPTION 'Read snapshot pretends to publish a revision'; END IF;
  SELECT count(*),sum((x->>'planned_length_ft')::numeric) INTO n,ft
  FROM jsonb_array_elements(g->'segments') x WHERE x->>'circuit_code'='110';
  IF n<>2 OR ft<>4.63 THEN RAISE EXCEPTION '110 physical pieces / plan: %, %',n,ft; END IF;
  IF jsonb_array_length(g->'connector_matings')<>1 THEN RAISE EXCEPTION 'Reciprocal mate not deduplicated'; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(g->'connector_matings') x WHERE x ? 'planned_length_ft') THEN
    RAISE EXCEPTION 'Mate was turned into cable footage'; END IF;
  IF EXISTS (SELECT FROM public.harness_segments s
    JOIN public.wire_termination_specs f ON f.id=s.from_termination_id
    JOIN public.wire_termination_specs t ON t.id=s.to_termination_id
    WHERE f.endpoint_id='00000000-0000-0000-0000-0000000000e3'
      AND t.endpoint_id='00000000-0000-0000-0000-0000000000e4') THEN RAISE EXCEPTION 'Fixture manufactured a cable between mates'; END IF;
  SELECT x INTO seg FROM jsonb_array_elements(g->'segments') x WHERE x->>'circuit_code'='23';
  IF seg->>'specification_state'<>'conflict' OR seg->>'gauge_awg'<>'20'
    OR seg->>'circuit_gauge_awg'<>'18' OR seg->>'keyed_part_number'<>'M22759/32-18-2'
    OR seg->>'legacy_check_state'<>'unversioned' THEN RAISE EXCEPTION '23 contradiction hidden: %',seg; END IF;
  IF jsonb_array_length(g->'evidence_edges')<>1 THEN RAISE EXCEPTION 'Field witness edge missing'; END IF;
  IF g::text LIKE '%PRIVATE_TEST%' THEN RAISE EXCEPTION 'Free-text purchase notes leaked'; END IF;
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(g->'segments') x
    WHERE x->>'circuit_code'='O1' AND x->>'link_state'='incomplete') THEN RAISE EXCEPTION 'Open end lost'; END IF;
  old_hash:=g->>'snapshot_hash';
  UPDATE public.wire_termination_specs SET cavity='B09' WHERE id='00000000-0000-0000-0000-0000000b0101';
  again:=public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF again->>'snapshot_hash'=old_hash THEN RAISE EXCEPTION 'Changed cavity did not change snapshot'; END IF;
  UPDATE public.wire_termination_specs SET cavity=NULL WHERE id='00000000-0000-0000-0000-0000000b0101';
  IF public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')->>'snapshot_hash'<>old_hash THEN
    RAISE EXCEPTION 'Restoring identical facts did not restore hash'; END IF;
  -- Wrong-circuit ends are not silently accepted as physical connectivity.
  UPDATE public.wire_termination_specs SET circuit_id='00000000-0000-0000-0000-000000000a04'
  WHERE id='00000000-0000-0000-0000-0000000b0101';
  again:=public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(again->'segments') x
    WHERE x->>'circuit_code'='110' AND x->>'link_state'='stale') THEN RAISE EXCEPTION 'Wrong-circuit end accepted'; END IF;
  UPDATE public.wire_termination_specs SET circuit_id='00000000-0000-0000-0000-000000000a01'
  WHERE id='00000000-0000-0000-0000-0000000b0101';
  -- Reader must not correct source scalars or imported checks itself.
  IF (SELECT gauge_awg FROM public.harness_segments WHERE vehicle_custom_circuit_id='00000000-0000-0000-0000-000000000a04')<>20
    THEN RAISE EXCEPTION 'Reader changed design source'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.harness_schematic_model(uuid)'::regprocedure)
    THEN RAISE EXCEPTION 'Reader bypasses source RLS'; END IF;
END $$;

-- Existing source grants remain the limit: no SECURITY DEFINER or new source grants in the migration.
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
GRANT SELECT ON public.vehicles,public.vehicle_wiring_overlays,public.vehicle_custom_circuits,
 public.harness_designs,public.harness_endpoints,public.wire_termination_specs,public.catalog_parts,
 public.harness_evidence TO anon,authenticated;
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-00000000ff01',false,
 '00000000-0000-0000-0000-00000000ff11',NULL,NULL);
SET ROLE anon;
DO $$ BEGIN
  IF public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e') IS NULL THEN RAISE EXCEPTION 'Public graph not readable'; END IF;
  IF public.harness_schematic_model('00000000-0000-0000-0000-00000000ff01') IS NOT NULL THEN RAISE EXCEPTION 'Private graph visible'; END IF;
  IF public.harness_schematic_model('00000000-0000-0000-0000-00000000ff02') IS NOT NULL THEN RAISE EXCEPTION 'Missing vehicle graph fabricated'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid','00000000-0000-0000-0000-00000000ff11',false);
SET ROLE authenticated;
DO $$ BEGIN
  IF public.harness_schematic_model('00000000-0000-0000-0000-00000000ff01') IS NULL THEN RAISE EXCEPTION 'Owner cannot read own graph'; END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET deleted_at=now() WHERE id='00000000-0000-0000-0000-00000000ff01';
SET ROLE authenticated;
DO $$ BEGIN
  IF public.harness_schematic_model('00000000-0000-0000-0000-00000000ff01') IS NOT NULL THEN RAISE EXCEPTION 'Deleted graph returned'; END IF;
END $$;
RESET ROLE;
DROP POLICY "Public read for public vehicles" ON public.harness_segments;
CREATE POLICY reader_contract_deny_segments ON public.harness_segments FOR SELECT USING (false);
SET ROLE anon;
DO $$ BEGIN
  IF jsonb_array_length(public.harness_schematic_model('e08bf694-970f-4cbe-8a74-8715158a0f2e')->'segments')<>0 THEN
    RAISE EXCEPTION 'Reader bypassed segment RLS'; END IF;
END $$;
RESET ROLE;
SELECT 'test_harness_schematic_model: PASS' AS result;
