-- v101 supporting schema capture: behaviour-neutral. DRAFT, local scratch only; not applied anywhere.
--
-- Source: read-only live catalog snapshot and RPC snapshot taken 2026-11-07 (project qkgaybvrernstplzjaam), encoded below by
-- scripts/gen_migration.py (no hand-typed DDL). It records objects the live photo-pipeline-orchestrator v101 depends on that no
-- migration in the repo creates: public.capture_analysis_events, public.capture_upload_status, the base table of
-- public.photo_pipeline_retry_state (the repo only ALTERs it) and public.report_capture_step.
--
-- Semantics (no-op on production):
--   * An object that already exists is NEVER altered, re-granted, re-owned or recreated. Its catalog signature (columns, types,
--     defaults, NOT NULL, identity, constraints, indexes, RLS flags, policies, triggers, sequences, ACLs) is compared with the
--     captured signature and any mismatch RAISES, rolling the whole migration back. Nothing is silently repaired.
--   * An object that is absent is created exactly as captured, then verified against the same signature.
--   * No row is read or written; no data backfill; no DROP / DISABLE TRIGGER / statement_timeout = 0.
-- Not captured here (follow-up, owner-reviewed): the three other photo-pipeline RPC bodies already in
-- 20261109000500_photo_pipeline_backoff.sql and its missing REVOKE/GRANT, photo_pipeline_provider_state (created there),
-- platform_config / vehicle_images (older tables this file only references).
-- Version ordering: this file sorts before 20261109000500_photo_pipeline_backoff.sql, so a fresh replay creates
-- photo_pipeline_retry_state before that migration ALTERs it.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $v101$
DECLARE
  v_names text[] := ARRAY['capture_analysis_events', 'capture_upload_status', 'photo_pipeline_retry_state'];
  v_ddl   text[] := ARRAY[
$ddl$CREATE TABLE public.capture_analysis_events (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step text NOT NULL,
  detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  reported_by text DEFAULT 'trigger'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT capture_analysis_events_pkey PRIMARY KEY (id)
)
;;
CREATE INDEX capture_analysis_events_image_idx ON public.capture_analysis_events USING btree (image_id, id)
;;
CREATE INDEX capture_analysis_events_user_idx ON public.capture_analysis_events USING btree (user_id, created_at DESC)
;;
ALTER TABLE public.capture_analysis_events ENABLE ROW LEVEL SECURITY
;;
CREATE POLICY capture_analysis_events_select_own ON public.capture_analysis_events AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)))
;;
REVOKE ALL ON TABLE public.capture_analysis_events FROM PUBLIC, anon, authenticated, service_role
;;
GRANT SELECT ON TABLE public.capture_analysis_events TO authenticated
;;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.capture_analysis_events TO service_role
;;
REVOKE ALL ON SEQUENCE public.capture_analysis_events_id_seq FROM PUBLIC, anon, authenticated, service_role
;;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.capture_analysis_events_id_seq TO anon
;;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.capture_analysis_events_id_seq TO authenticated
;;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.capture_analysis_events_id_seq TO service_role$ddl$,
$ddl$CREATE TABLE public.capture_upload_status (
  image_id uuid NOT NULL,
  user_id uuid NOT NULL,
  vehicle_id uuid,
  attached boolean DEFAULT false NOT NULL,
  filename text,
  storage_path text,
  stage text DEFAULT 'uploaded'::text NOT NULL,
  stage_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  error_class text,
  http_status integer,
  image_type text,
  confidence numeric,
  current_step text DEFAULT 'queued'::text NOT NULL,
  step_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
  step_updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT capture_upload_status_pkey PRIMARY KEY (image_id),
  CONSTRAINT capture_upload_status_current_step_check CHECK (current_step = ANY (ARRAY['queued'::text, 'downloading'::text, 'classifying'::text, 'reading_text'::text, 'extracting_fields'::text, 'matching_vehicle'::text, 'done'::text, 'failed'::text])),
  CONSTRAINT capture_upload_status_stage_check CHECK (stage = ANY (ARRAY['uploaded'::text, 'classifying'::text, 'classified'::text, 'failed'::text, 'attached'::text]))
)
;;
CREATE INDEX capture_upload_status_user_created_idx ON public.capture_upload_status USING btree (user_id, created_at DESC)
;;
ALTER TABLE public.capture_upload_status ENABLE ROW LEVEL SECURITY
;;
CREATE POLICY capture_upload_status_select_own ON public.capture_upload_status AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)))
;;
REVOKE ALL ON TABLE public.capture_upload_status FROM PUBLIC, anon, authenticated, service_role
;;
GRANT SELECT ON TABLE public.capture_upload_status TO authenticated
;;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.capture_upload_status TO service_role$ddl$,
$ddl$CREATE TABLE public.photo_pipeline_retry_state (
  image_id uuid NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  next_attempt_at timestamp with time zone,
  last_error_class text,
  last_http_status integer,
  last_fallback_error_class text,
  terminal boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  rate_limited_attempts integer DEFAULT 0 NOT NULL,
  CONSTRAINT photo_pipeline_retry_state_pkey PRIMARY KEY (image_id),
  CONSTRAINT photo_pipeline_retry_state_image_id_fkey FOREIGN KEY (image_id) REFERENCES vehicle_images(id) ON DELETE CASCADE
)
;;
CREATE INDEX idx_ppretry_next ON public.photo_pipeline_retry_state USING btree (next_attempt_at)
;;
ALTER TABLE public.photo_pipeline_retry_state ENABLE ROW LEVEL SECURITY
;;
REVOKE ALL ON TABLE public.photo_pipeline_retry_state FROM PUBLIC, anon, authenticated, service_role
;;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.photo_pipeline_retry_state TO anon
;;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.photo_pipeline_retry_state TO authenticated
;;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.photo_pipeline_retry_state TO service_role$ddl$
  ];
  v_sig   text[] := ARRAY[
$sig$table|r|postgres|rls=true|force=false|replident=d|reloptions=|comment=
col|1|id|bigint|notnull=true|default=|identity=a|generated=|comment=|acl=
col|2|image_id|uuid|notnull=true|default=|identity=|generated=|comment=|acl=
col|3|user_id|uuid|notnull=true|default=|identity=|generated=|comment=|acl=
col|4|step|text|notnull=true|default=|identity=|generated=|comment=|acl=
col|5|detail|jsonb|notnull=true|default='{}'::jsonb|identity=|generated=|comment=|acl=
col|6|reported_by|text|notnull=true|default='trigger'::text|identity=|generated=|comment=|acl=
col|7|created_at|timestamp with time zone|notnull=true|default=now()|identity=|generated=|comment=|acl=
con|capture_analysis_events_pkey|p|validated=true|PRIMARY KEY (id)
idx|capture_analysis_events_image_idx|valid=true|primary=false|CREATE INDEX capture_analysis_events_image_idx ON public.capture_analysis_events USING btree (image_id, id)
idx|capture_analysis_events_pkey|valid=true|primary=true|CREATE UNIQUE INDEX capture_analysis_events_pkey ON public.capture_analysis_events USING btree (id)
idx|capture_analysis_events_user_idx|valid=true|primary=false|CREATE INDEX capture_analysis_events_user_idx ON public.capture_analysis_events USING btree (user_id, created_at DESC)
pol|capture_analysis_events_select_own|SELECT|permissive=true|{authenticated}|(user_id = ( SELECT auth.uid() AS uid))|
seq|capture_analysis_events_id_seq|bigint|start=1|min=1|max=9223372036854775807|inc=1|cache=1|cycle=false|owner=postgres|col=id|dep=i
seqacl|capture_analysis_events_id_seq|anon|SELECT|false|postgres
seqacl|capture_analysis_events_id_seq|anon|UPDATE|false|postgres
seqacl|capture_analysis_events_id_seq|anon|USAGE|false|postgres
seqacl|capture_analysis_events_id_seq|authenticated|SELECT|false|postgres
seqacl|capture_analysis_events_id_seq|authenticated|UPDATE|false|postgres
seqacl|capture_analysis_events_id_seq|authenticated|USAGE|false|postgres
seqacl|capture_analysis_events_id_seq|postgres|SELECT|false|postgres
seqacl|capture_analysis_events_id_seq|postgres|UPDATE|false|postgres
seqacl|capture_analysis_events_id_seq|postgres|USAGE|false|postgres
seqacl|capture_analysis_events_id_seq|service_role|SELECT|false|postgres
seqacl|capture_analysis_events_id_seq|service_role|UPDATE|false|postgres
seqacl|capture_analysis_events_id_seq|service_role|USAGE|false|postgres
acl|authenticated|SELECT|false|postgres
acl|postgres|DELETE|false|postgres
acl|postgres|INSERT|false|postgres
acl|postgres|MAINTAIN|false|postgres
acl|postgres|REFERENCES|false|postgres
acl|postgres|SELECT|false|postgres
acl|postgres|TRIGGER|false|postgres
acl|postgres|TRUNCATE|false|postgres
acl|postgres|UPDATE|false|postgres
acl|service_role|DELETE|false|postgres
acl|service_role|INSERT|false|postgres
acl|service_role|REFERENCES|false|postgres
acl|service_role|SELECT|false|postgres
acl|service_role|TRIGGER|false|postgres
acl|service_role|TRUNCATE|false|postgres
acl|service_role|UPDATE|false|postgres$sig$,
$sig$table|r|postgres|rls=true|force=false|replident=d|reloptions=|comment=
col|1|image_id|uuid|notnull=true|default=|identity=|generated=|comment=|acl=
col|2|user_id|uuid|notnull=true|default=|identity=|generated=|comment=|acl=
col|3|vehicle_id|uuid|notnull=false|default=|identity=|generated=|comment=|acl=
col|4|attached|boolean|notnull=true|default=false|identity=|generated=|comment=|acl=
col|5|filename|text|notnull=false|default=|identity=|generated=|comment=|acl=
col|6|storage_path|text|notnull=false|default=|identity=|generated=|comment=|acl=
col|7|stage|text|notnull=true|default='uploaded'::text|identity=|generated=|comment=|acl=
col|8|stage_detail|jsonb|notnull=true|default='{}'::jsonb|identity=|generated=|comment=|acl=
col|9|error_class|text|notnull=false|default=|identity=|generated=|comment=|acl=
col|10|http_status|integer|notnull=false|default=|identity=|generated=|comment=|acl=
col|11|image_type|text|notnull=false|default=|identity=|generated=|comment=|acl=
col|12|confidence|numeric|notnull=false|default=|identity=|generated=|comment=|acl=
col|13|current_step|text|notnull=true|default='queued'::text|identity=|generated=|comment=|acl=
col|14|step_detail|jsonb|notnull=true|default='{}'::jsonb|identity=|generated=|comment=|acl=
col|15|step_updated_at|timestamp with time zone|notnull=true|default=now()|identity=|generated=|comment=|acl=
col|16|created_at|timestamp with time zone|notnull=true|default=now()|identity=|generated=|comment=|acl=
col|17|updated_at|timestamp with time zone|notnull=true|default=now()|identity=|generated=|comment=|acl=
con|capture_upload_status_current_step_check|c|validated=true|CHECK (current_step = ANY (ARRAY['queued'::text, 'downloading'::text, 'classifying'::text, 'reading_text'::text, 'extracting_fields'::text, 'matching_vehicle'::text, 'done'::text, 'failed'::text]))
con|capture_upload_status_pkey|p|validated=true|PRIMARY KEY (image_id)
con|capture_upload_status_stage_check|c|validated=true|CHECK (stage = ANY (ARRAY['uploaded'::text, 'classifying'::text, 'classified'::text, 'failed'::text, 'attached'::text]))
idx|capture_upload_status_pkey|valid=true|primary=true|CREATE UNIQUE INDEX capture_upload_status_pkey ON public.capture_upload_status USING btree (image_id)
idx|capture_upload_status_user_created_idx|valid=true|primary=false|CREATE INDEX capture_upload_status_user_created_idx ON public.capture_upload_status USING btree (user_id, created_at DESC)
pol|capture_upload_status_select_own|SELECT|permissive=true|{authenticated}|(user_id = ( SELECT auth.uid() AS uid))|
acl|authenticated|SELECT|false|postgres
acl|postgres|DELETE|false|postgres
acl|postgres|INSERT|false|postgres
acl|postgres|MAINTAIN|false|postgres
acl|postgres|REFERENCES|false|postgres
acl|postgres|SELECT|false|postgres
acl|postgres|TRIGGER|false|postgres
acl|postgres|TRUNCATE|false|postgres
acl|postgres|UPDATE|false|postgres
acl|service_role|DELETE|false|postgres
acl|service_role|INSERT|false|postgres
acl|service_role|REFERENCES|false|postgres
acl|service_role|SELECT|false|postgres
acl|service_role|TRIGGER|false|postgres
acl|service_role|TRUNCATE|false|postgres
acl|service_role|UPDATE|false|postgres$sig$,
$sig$table|r|postgres|rls=true|force=false|replident=d|reloptions=|comment=
col|1|image_id|uuid|notnull=true|default=|identity=|generated=|comment=|acl=
col|2|attempts|integer|notnull=true|default=0|identity=|generated=|comment=|acl=
col|3|next_attempt_at|timestamp with time zone|notnull=false|default=|identity=|generated=|comment=|acl=
col|4|last_error_class|text|notnull=false|default=|identity=|generated=|comment=|acl=
col|5|last_http_status|integer|notnull=false|default=|identity=|generated=|comment=|acl=
col|6|last_fallback_error_class|text|notnull=false|default=|identity=|generated=|comment=|acl=
col|7|terminal|boolean|notnull=true|default=false|identity=|generated=|comment=|acl=
col|8|updated_at|timestamp with time zone|notnull=true|default=now()|identity=|generated=|comment=|acl=
col|9|rate_limited_attempts|integer|notnull=true|default=0|identity=|generated=|comment=|acl=
con|photo_pipeline_retry_state_image_id_fkey|f|validated=true|FOREIGN KEY (image_id) REFERENCES vehicle_images(id) ON DELETE CASCADE
con|photo_pipeline_retry_state_pkey|p|validated=true|PRIMARY KEY (image_id)
idx|idx_ppretry_next|valid=true|primary=false|CREATE INDEX idx_ppretry_next ON public.photo_pipeline_retry_state USING btree (next_attempt_at)
idx|photo_pipeline_retry_state_pkey|valid=true|primary=true|CREATE UNIQUE INDEX photo_pipeline_retry_state_pkey ON public.photo_pipeline_retry_state USING btree (image_id)
acl|anon|DELETE|false|postgres
acl|anon|INSERT|false|postgres
acl|anon|REFERENCES|false|postgres
acl|anon|SELECT|false|postgres
acl|anon|TRIGGER|false|postgres
acl|anon|TRUNCATE|false|postgres
acl|anon|UPDATE|false|postgres
acl|authenticated|DELETE|false|postgres
acl|authenticated|INSERT|false|postgres
acl|authenticated|REFERENCES|false|postgres
acl|authenticated|SELECT|false|postgres
acl|authenticated|TRIGGER|false|postgres
acl|authenticated|TRUNCATE|false|postgres
acl|authenticated|UPDATE|false|postgres
acl|postgres|DELETE|false|postgres
acl|postgres|INSERT|false|postgres
acl|postgres|MAINTAIN|false|postgres
acl|postgres|REFERENCES|false|postgres
acl|postgres|SELECT|false|postgres
acl|postgres|TRIGGER|false|postgres
acl|postgres|TRUNCATE|false|postgres
acl|postgres|UPDATE|false|postgres
acl|service_role|DELETE|false|postgres
acl|service_role|INSERT|false|postgres
acl|service_role|REFERENCES|false|postgres
acl|service_role|SELECT|false|postgres
acl|service_role|TRIGGER|false|postgres
acl|service_role|TRUNCATE|false|postgres
acl|service_role|UPDATE|false|postgres$sig$
  ];
  i int; v_stmt text; v_oid regclass; v_got text;
BEGIN
  FOR i IN 1 .. array_length(v_names, 1) LOOP
    IF to_regclass('public.' || v_names[i]) IS NULL THEN
      FOREACH v_stmt IN ARRAY string_to_array(v_ddl[i], E'\n;;\n') LOOP
        EXECUTE v_stmt;
      END LOOP;
    END IF;
    v_oid := to_regclass('public.' || v_names[i]);
    SELECT concat_ws(E'\n',
      -- table header
      (SELECT concat_ws('|', 'table', c.relkind, pg_get_userbyid(c.relowner), 'rls=' || c.relrowsecurity, 'force=' || c.relforcerowsecurity,
                'replident=' || c.relreplident::text, 'reloptions=' || coalesce(c.reloptions::text, ''),
                'comment=' || coalesce(obj_description(c.oid, 'pg_class'), ''))
         FROM pg_class c WHERE c.oid = v_oid),
      -- columns
      (SELECT string_agg(concat_ws('|', 'col', a.attnum, a.attname, format_type(a.atttypid, a.atttypmod), 'notnull=' || a.attnotnull,
                'default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), 'identity=' || a.attidentity::text, 'generated=' || a.attgenerated::text,
                'comment=' || coalesce(col_description(a.attrelid, a.attnum), ''), 'acl=' || coalesce(a.attacl::text, '')),
                E'\n' ORDER BY a.attnum)
         FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped),
      -- constraints (NOT NULL is compared via attnotnull; newer Postgres also lists it here as contype n)
      (SELECT string_agg(concat_ws('|', 'con', k.conname, k.contype, 'validated=' || k.convalidated,
                replace(pg_get_constraintdef(k.oid), 'public.', '')), E'\n' ORDER BY k.conname)
         FROM pg_constraint k WHERE k.conrelid = v_oid AND k.contype <> 'n'),
      -- indexes
      (SELECT string_agg(concat_ws('|', 'idx', ic.relname, 'valid=' || x.indisvalid, 'primary=' || x.indisprimary,
                pg_get_indexdef(x.indexrelid)), E'\n' ORDER BY ic.relname)
         FROM pg_index x JOIN pg_class ic ON ic.oid = x.indexrelid WHERE x.indrelid = v_oid),
      -- policies
      (SELECT string_agg(concat_ws('|', 'pol', p.policyname, p.cmd, 'permissive=' || (p.permissive = 'PERMISSIVE'), p.roles::text,
                coalesce(p.qual, ''), coalesce(p.with_check, '')), E'\n' ORDER BY p.policyname)
         FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_names[i]),
      -- user triggers
      (SELECT string_agg('trg|' || pg_get_triggerdef(t.oid), E'\n' ORDER BY t.tgname)
         FROM pg_trigger t WHERE t.tgrelid = v_oid AND NOT t.tgisinternal),
      -- identity sequences
      (SELECT string_agg(concat_ws('|', 'seq', s.sequencename, s.data_type, 'start=' || s.start_value, 'min=' || s.min_value,
                'max=' || s.max_value, 'inc=' || s.increment_by, 'cache=' || s.cache_size, 'cycle=' || s.cycle,
                'owner=' || s.sequenceowner, 'col=' || a.attname, 'dep=' || dp.deptype::text), E'\n' ORDER BY s.sequencename)
         FROM pg_depend dp
         JOIN pg_class sc ON sc.oid = dp.objid AND sc.relkind = 'S'
         JOIN pg_sequences s ON s.schemaname = 'public' AND s.sequencename = sc.relname
         JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
        WHERE dp.refobjid = v_oid AND dp.classid = 'pg_class'::regclass AND dp.deptype IN ('i', 'a')),
      (SELECT string_agg(concat_ws('|', 'seqacl', sc.relname, CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,
                e.privilege_type, 'false', pg_get_userbyid(e.grantor)), E'\n' ORDER BY sc.relname, CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END, e.privilege_type)
         FROM pg_depend dp
         JOIN pg_class sc ON sc.oid = dp.objid AND sc.relkind = 'S'
         CROSS JOIN LATERAL aclexplode(sc.relacl) e
        WHERE dp.refobjid = v_oid AND dp.classid = 'pg_class'::regclass AND dp.deptype IN ('i', 'a')),
      -- table ACL
      (SELECT string_agg(concat_ws('|', 'acl', CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,
                e.privilege_type, e.is_grantable::text, pg_get_userbyid(e.grantor)), E'\n'
                ORDER BY CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END, e.privilege_type)
         FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) e WHERE c.oid = v_oid)
    ) INTO v_got;
    -- Exact match first. Fallback tolerates only one rendering change of newer servers: CHECK ((expr)) instead of CHECK (expr).
    IF v_got IS DISTINCT FROM v_sig[i]
       AND regexp_replace(v_got, '^(con\|[^|]*\|c\|validated=[a-z]+\|CHECK )\((\(.*\))\)$', '\1\2', 'ng') IS DISTINCT FROM v_sig[i] THEN
      RAISE EXCEPTION 'v101 capture: public.% differs from the captured live definition; nothing was altered. captured:% live:%',
        v_names[i], E'\n' || v_sig[i], E'\n' || v_got;
    END IF;
  END LOOP;
END
$v101$;

-- public.report_capture_step: create when absent, then verify definition (whitespace-insensitive), security attributes and ACL.
DO $v101$
DECLARE
  v_def text := $def$CREATE OR REPLACE FUNCTION public.report_capture_step(p_image_id uuid, p_step text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.capture_upload_status%rowtype;
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_new_stage text;
begin
  if p_step is null or p_step not in ('queued','downloading','classifying','reading_text','extracting_fields','matching_vehicle','done','failed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_step', 'image_id', p_image_id, 'step', p_step);
  end if;
  select * into v_row from public.capture_upload_status where image_id = p_image_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_tracked', 'image_id', p_image_id, 'step', p_step);
  end if;
  v_new_stage := v_row.stage;
  if v_row.stage = 'uploaded' and p_step in ('downloading','classifying','reading_text','extracting_fields','matching_vehicle') then
    v_new_stage := 'classifying';
  end if;
  update public.capture_upload_status set
    current_step = p_step,
    step_detail = case when p_step in ('queued','downloading') then v_detail else step_detail || v_detail end,
    step_updated_at = now(), stage = v_new_stage, updated_at = now()
  where image_id = p_image_id
  returning * into v_row;
  insert into public.capture_analysis_events (image_id, user_id, step, detail, reported_by) values (p_image_id, v_row.user_id, p_step, v_detail, 'orchestrator');
  return jsonb_build_object('ok', true, 'image_id', v_row.image_id, 'step', v_row.current_step, 'stage', v_row.stage, 'step_updated_at', v_row.step_updated_at);
end;
$function$
$def$;
  v_oid oid; v_got text; v_acl text;
  v_acl_expected text := $sig$fnacl|postgres|EXECUTE|false|postgres
fnacl|service_role|EXECUTE|false|postgres$sig$;
BEGIN
  IF to_regprocedure('public.report_capture_step(uuid,text,jsonb)') IS NULL THEN
    EXECUTE v_def;
    REVOKE ALL ON FUNCTION public.report_capture_step(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.report_capture_step(uuid, text, jsonb) TO service_role;
  END IF;
  v_oid := to_regprocedure('public.report_capture_step(uuid,text,jsonb)');
  SELECT regexp_replace(pg_get_functiondef(v_oid), '\s+', ' ', 'g') INTO v_got;
  IF v_got IS DISTINCT FROM regexp_replace(v_def, '\s+', ' ', 'g') THEN
    RAISE EXCEPTION 'v101 capture: public.report_capture_step differs from the captured live definition; nothing was altered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef AND NOT proleakproof AND proconfig = ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'v101 capture: public.report_capture_step security attributes differ (SECURITY DEFINER, search_path=public expected)';
  END IF;
  SELECT string_agg(concat_ws('|', 'fnacl', CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,
           e.privilege_type, e.is_grantable::text, pg_get_userbyid(e.grantor)), E'\n'
           ORDER BY CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END, e.privilege_type)
    INTO v_acl FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) e WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM v_acl_expected THEN
    RAISE EXCEPTION 'v101 capture: public.report_capture_step ACL differs; captured:% live:%', E'\n' || v_acl_expected, E'\n' || coalesce(v_acl, '(none)');
  END IF;
END
$v101$;

COMMIT;
