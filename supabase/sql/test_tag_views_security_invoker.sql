-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_<name> -f supabase/sql/test_tag_views_security_invoker.sql
-- Proves 20261125201500_tag_views_security_invoker.sql: through tag_analysis_view and enhanced_tag_context, anon, a
-- signed-in stranger and the owner each read exactly the image_tags rows the table's own policies give them (same ids),
-- under production's open image_tags policies of 2026-11-25 and again under #3917's narrowed policy; enhanced_tag_context
-- gives anon and a stranger no receipt vendor or amount and no private-source timeline title, and still gives the owner
-- both. Before the migration, anon reads the owner's receipt vendor and amount through enhanced_tag_context (the defect).
-- Which assertion fails if the migration is removed: "anon: no receipt vendor or amount, no private-source title".
-- Fixture: supabase/sql/fixtures/photo_reading_select_base.sql, then image_tags, timeline_events and receipts with the
-- columns the views read, their foreign keys, production's SELECT policies and grants (2026-11-25), and both views'
-- live text (pg_get_viewdef).
-- Fixture rows only, in a disposable database. -- ALLOW_RAW_TESTIMONY_WRITE
\ir fixtures/photo_reading_select_base.sql

ALTER TABLE public.vehicle_images ADD COLUMN taken_at timestamptz;
GRANT SELECT (taken_at) ON public.vehicle_images TO anon;
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE, user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text, source text, title text, event_date date, labor_hours numeric);
-- guardrail-allow(center-key-fk): receipts.vehicle_id: production has no foreign key on it (pg_constraint 2026-11-25)
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id),
  vendor_name text, total_amount numeric(10,2), scope_type text, scope_id text, vehicle_id uuid);
CREATE TABLE public.image_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE,
  timeline_event_id uuid REFERENCES public.timeline_events(id) ON DELETE CASCADE,
  x_position double precision, y_position double precision, tag_type character varying(255), created_by character varying(255),
  verified_at timestamp(0) without time zone, metadata jsonb, source_type text, automated_confidence double precision,
  image_url text, tag_name text, width numeric(5,2), height numeric(5,2), confidence integer, ai_detection_data jsonb,
  verified boolean, manual_override boolean, training_feedback jsonb, parent_tag_id uuid, validation_status text);

-- Production's SELECT policies (2026-11-25).
ALTER TABLE public.image_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Image tags are publicly viewable" ON public.image_tags FOR SELECT USING (true);
CREATE POLICY "Public tag reading" ON public.image_tags FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY image_tags_select_all ON public.image_tags FOR SELECT USING (true);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own receipts" ON public.receipts USING (((SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view own receipts" ON public.receipts FOR SELECT USING (((SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can view vehicle receipts" ON public.receipts FOR SELECT USING ((((scope_type = 'vehicle'::text) AND (EXISTS ( SELECT 1
   FROM vehicles
  WHERE (((vehicles.id)::text = receipts.scope_id) AND (vehicles.uploaded_by = ( SELECT auth.uid() AS uid)))))) OR ((scope_type = 'user'::text) AND (user_id = ( SELECT auth.uid() AS uid))) OR ((scope_type IS NULL) AND (user_id = ( SELECT auth.uid() AS uid)))));
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public vehicle timeline events are viewable" ON public.timeline_events FOR SELECT TO anon, authenticated USING ((EXISTS ( SELECT 1
   FROM vehicles WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.is_public = true)))));
CREATE POLICY "Users can view timeline events for vehicles they own" ON public.timeline_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM vehicles WHERE ((vehicles.id = timeline_events.vehicle_id) AND (vehicles.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY timeline_events_author_read ON public.timeline_events FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY timeline_events_private_source_read ON public.timeline_events AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (((source IS NULL) OR (source <> ALL (ARRAY['whatsapp_ingest'::text, 'call_history'::text, 'call_history_lead_pattern'::text, 'imessage_thread'::text, 'apple_health_export'::text])) OR (user_id = ( SELECT auth.uid() AS uid))));
GRANT SELECT ON public.image_tags, public.timeline_events, public.receipts TO anon, authenticated;
GRANT ALL ON public.image_tags, public.timeline_events, public.receipts TO service_role;

-- The two views as production holds them (pg_get_viewdef, 2026-11-25), owned by the migration role, no security_invoker.
CREATE VIEW public.tag_analysis_view AS
 SELECT id,
    vehicle_id,
    image_url,
    tag_name,
    tag_type,
    source_type,
    confidence,
    automated_confidence,
    verified,
    validation_status,
    created_by,
    verified_at,
    manual_override,
    x_position,
    y_position,
    width,
    height,
    ai_detection_data,
    training_feedback,
    parent_tag_id,
        CASE
            WHEN ((source_type = 'ai'::text) AND (verified = true)) THEN 'ai_confirmed'::text
            WHEN ((source_type = 'ai'::text) AND (verified = false)) THEN 'ai_unverified'::text
            WHEN (source_type = 'manual'::text) THEN 'human_created'::text
            WHEN (parent_tag_id IS NOT NULL) THEN 'human_correction'::text
            ELSE source_type
        END AS tag_origin_type,
        CASE
            WHEN (source_type = 'expert'::text) THEN (100)::double precision
            WHEN ((source_type = 'manual'::text) AND (verified = true)) THEN (95)::double precision
            WHEN ((source_type = 'ai'::text) AND (verified = true)) THEN (90)::double precision
            WHEN ((source_type = 'ai'::text) AND (automated_confidence > (80)::double precision)) THEN (80)::double precision
            WHEN (source_type = 'manual'::text) THEN (75)::double precision
            ELSE COALESCE(automated_confidence, (50)::double precision)
        END AS reliability_score
   FROM image_tags it;
CREATE VIEW public.enhanced_tag_context AS
 SELECT it.id,
    it.tag_name,
    it.tag_type,
    it.confidence,
    it.source_type,
    it.verified,
    it.metadata,
    te.title AS timeline_event_title,
    te.event_date,
    te.event_type,
    te.labor_hours,
    vi.image_url,
    vi.taken_at,
    r.vendor_name AS receipt_vendor,
    r.total_amount AS receipt_amount,
        CASE
            WHEN ((it.metadata ->> 'ai_supervised'::text) = 'true'::text) THEN 'AI-Supervised'::text
            WHEN (it.source_type = 'ai'::text) THEN 'AI-Generated'::text
            ELSE 'Manual'::text
        END AS tag_source,
    (it.metadata ->> 'work_session'::text) AS work_session,
    (it.metadata ->> 'user_notes'::text) AS user_notes,
    (it.metadata ->> 'part_number'::text) AS part_number,
    (it.metadata ->> 'brand'::text) AS brand,
    (it.metadata ->> 'category'::text) AS category,
    (it.metadata ->> 'connected_receipt_id'::text) AS connected_receipt_id
   FROM (((image_tags it
     LEFT JOIN timeline_events te ON ((it.timeline_event_id = te.id)))
     LEFT JOIN vehicle_images vi ON ((it.image_id = vi.id)))
     LEFT JOIN receipts r ON ((((it.metadata ->> 'connected_receipt_id'::text))::uuid = r.id)));
GRANT SELECT ON public.tag_analysis_view, public.enhanced_tag_context TO anon, authenticated;
GRANT ALL ON public.tag_analysis_view, public.enhanced_tag_context TO service_role;

-- Rows. u1 owns public car A and private car B. A receipt of u1's (TSTVENDOR, 123.45) is connected to tag t_pub on A's
-- shown photo; t_pub's event is public. t_priv_src on A has a whatsapp_ingest event of u1's (title TSTPRIVATE).
-- t_private_car is on B's photo. t_car_only is on A with no photo.
INSERT INTO public.receipts (id, user_id, vendor_name, total_amount, scope_type) VALUES
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'TSTVENDOR', 123.45, NULL);
INSERT INTO public.timeline_events (id, vehicle_id, user_id, event_type, source, title, event_date, labor_hours) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'work', NULL, 'public work', '2026-11-01', 2),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'message', 'whatsapp_ingest', 'TSTPRIVATE', '2026-11-02', NULL);
INSERT INTO public.image_tags (id, image_id, vehicle_id, timeline_event_id, tag_name, source_type, verified, created_by, metadata) VALUES
  ('f0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'alternator', 'manual', true, '00000000-0000-0000-0000-000000000001', '{"connected_receipt_id": "e0000000-0000-0000-0000-000000000001"}'),
  ('f0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'hose', 'ai', false, '00000000-0000-0000-0000-000000000001', '{}'),
  ('f0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', NULL, 'seat', 'ai', true, '00000000-0000-0000-0000-000000000001', '{}'),
  ('f0000000-0000-0000-0000-000000000004', NULL, 'a0000000-0000-0000-0000-00000000000a', NULL, 'whole car', 'manual', true, '00000000-0000-0000-0000-000000000001', '{}');

-- What a caller reads: ids through each view and through image_tags, and the receipt/title values seen.
CREATE FUNCTION public.t_read() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'base', (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM public.image_tags),
    'tav', (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM public.tag_analysis_view),
    'etc', (SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM public.enhanced_tag_context),
    'vendor', (SELECT count(*) FROM public.enhanced_tag_context WHERE receipt_vendor IS NOT NULL OR receipt_amount IS NOT NULL),
    'private_title', (SELECT count(*) FROM public.enhanced_tag_context WHERE timeline_event_title = 'TSTPRIVATE'),
    'private_car', (SELECT count(*) FROM public.tag_analysis_view WHERE id = 'f0000000-0000-0000-0000-000000000003')
      + (SELECT count(*) FROM public.enhanced_tag_context WHERE id = 'f0000000-0000-0000-0000-000000000003')) $$;
GRANT EXECUTE ON FUNCTION public.t_read() TO anon, authenticated, service_role;

-- Before: anon reads the owner's receipt vendor and amount and the private-source title through the owner-run view.
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_read() AS anon_before \gset
RESET ROLE;
SELECT public.t_assert((:'anon_before'::jsonb ->> 'vendor')::int = 1 AND (:'anon_before'::jsonb ->> 'private_title')::int = 1,
  format('before: anon reads the receipt vendor/amount and the private-source title through enhanced_tag_context (the defect): %s', :'anon_before'));

\ir ../migrations/20261125201500_tag_views_security_invoker.sql

-- 1. Under production's image_tags policies (open): each caller's view ids equal their table ids; receipts and
--    private-source events follow their own policies.
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_read() AS anon_a \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.t_read() AS u2_a \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000001');
SELECT public.t_read() AS u1_a \gset
RESET ROLE;
SELECT public.t_assert(x ->> 'tav' = x ->> 'base' AND x ->> 'etc' = x ->> 'base', format('open policies, %s: view ids equal image_tags ids', who))
  FROM (VALUES ('anon', :'anon_a'::jsonb), ('stranger', :'u2_a'::jsonb), ('owner', :'u1_a'::jsonb)) v(who, x);
SELECT public.t_assert((x ->> 'vendor')::int = 0 AND (x ->> 'private_title')::int = 0, format('%s: no receipt vendor or amount, no private-source title', who))
  FROM (VALUES ('anon', :'anon_a'::jsonb), ('stranger', :'u2_a'::jsonb)) v(who, x);
SELECT public.t_assert((:'u1_a'::jsonb ->> 'vendor')::int = 1 AND (:'u1_a'::jsonb ->> 'private_title')::int = 1,
  'owner: still reads their receipt vendor/amount and their private-source title');

-- 2. Under #3917's image_tags policy (copied from 20261125181500): the views follow the narrowed table.
DROP POLICY "Image tags are publicly viewable" ON public.image_tags;
DROP POLICY "Public tag reading" ON public.image_tags;
DROP POLICY image_tags_select_all ON public.image_tags;
CREATE POLICY image_tags_select ON public.image_tags FOR SELECT
  USING (
    (image_tags.image_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.vehicles v
       WHERE v.id = image_tags.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL))
    OR (image_tags.image_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.vehicle_images_public vip
          JOIN public.vehicles v ON v.id = vip.vehicle_id
          WHERE vip.id = image_tags.image_id
            AND v.is_public = true
            AND v.deleted_at IS NULL
            AND public.vehicle_image_gallery_eligible(vip)))
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND (image_tags.created_by::text = (SELECT auth.uid())::text
           OR (image_tags.image_id IS NULL AND public.vehicle_viewer_tied(image_tags.vehicle_id))
           OR EXISTS (
             SELECT 1
             FROM public.vehicle_images vi
             WHERE vi.id = image_tags.image_id
               AND (vi.user_id = (SELECT auth.uid())
                    OR public.vehicle_viewer_tied(vi.vehicle_id)))))
  );
SELECT public.t_claims(''); SET ROLE anon;
SELECT public.t_read() AS anon_b \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT public.t_read() AS u2_b \gset
SELECT public.t_claims('00000000-0000-0000-0000-000000000001');
SELECT public.t_read() AS u1_b \gset
RESET ROLE;
SELECT public.t_assert(x ->> 'tav' = x ->> 'base' AND x ->> 'etc' = x ->> 'base', format('#3917 policy, %s: view ids equal image_tags ids', who))
  FROM (VALUES ('anon', :'anon_b'::jsonb), ('stranger', :'u2_b'::jsonb), ('owner', :'u1_b'::jsonb)) v(who, x);
SELECT public.t_assert((x ->> 'private_car')::int = 0 AND (x ->> 'vendor')::int = 0, format('#3917 policy, %s: no private-car tag, no receipt through either view', who))
  FROM (VALUES ('anon', :'anon_b'::jsonb), ('stranger', :'u2_b'::jsonb)) v(who, x);
SELECT public.t_assert((:'u1_b'::jsonb ->> 'private_car')::int = 2 AND (:'u1_b'::jsonb ->> 'vendor')::int = 1, 'owner: the private-car tag through both views, and the receipt');

-- 3. Options.
SELECT public.t_assert((SELECT bool_and('security_invoker=true' = ANY (reloptions)) FROM pg_class
  WHERE oid IN ('public.tag_analysis_view'::regclass, 'public.enhanced_tag_context'::regclass)), 'both views are security_invoker');

SELECT 'tag_views_security_invoker contract: PASS' AS result;
