-- Describe service_executions: all 20 columns, none had a COMMENT ON COLUMN (0 of 20 described before, catalog count on
-- prod, 2026-10-07), and a table comment (there was none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 571,531 rows on 2026-10-07 13:16Z by exact count (the
-- atlas estimate of 570,823 is a stale pg_class.reltuples), no write since the statistics counters began; the newest row
-- was queued 2026-04-14 06:45Z.
--
-- METHOD (read 2026-10-07 13:15-13:50Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants (has_table_privilege for anon and
--   authenticated) and existing comments from pg_attribute, pg_attrdef, pg_constraint, pg_indexes, pg_trigger, pg_policy
--   and pg_description. Row count, fill, minimum and maximum of every column, the counts per status, trigger type, service
--   key and month, the distinct vehicles and vehicle and service pairs, the clock comparisons, and the count of Hagerty
--   rows whose values equal the model-year products are exact counts over the whole table (237 MB heap, read only). The
--   request_data, response_data and fields_populated key sets, the error message shapes (digits masked) and the orphan
--   rows come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 5,127 rows joined to vehicles),
--   because the table holds more than 200,000 rows. The downstream rows in vehicle_field_evidence and
--   vehicle_form_completions are exact counts. What anon can read comes from a count under SET LOCAL ROLE anon in a
--   read-only transaction. "Filled" means non-NULL.
--   Writers and readers from code at origin/main 59cdeec17 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; also git history): the creating migration
--   20251203_service_integration_framework.sql and 20251203_auto_service_triggers.sql (neither is in the prod migration log
--   under that name); the edge function service-orchestrator and supabase/functions/_shared/serviceAdapters.ts as they
--   stood before commit 43b72deae (2026-03-07) deleted the worker; the deployed function list from the management API
--   (service-orchestrator: not found); the live bodies, read with pg_get_functiondef, of trigger_auto_services() and of
--   check_auto_services(uuid), the only function whose body names the table; the trigger vehicle_auto_services_trigger on
--   vehicles; service_integrations (9 rows); cron.job (no command names the table, the worker or check_auto_services);
--   pg_depend (no view); write_receipts (no rows: the table carries no receipt trigger); pg_stat_user_tables;
--   pipeline_registry (no row; none is added here).
-- LIMITS:
--   When trigger_auto_services() was replaced by its no-op body is not recorded in the repo or the migration log. Shapes
--   and orphans come from a 1% block sample and can miss rare cases. pg_stat_user_tables counters began at an unrecorded
--   time (the server last started 2026-09-29 09:20Z). request_data carries the VIN, year, make, model and mileage of each
--   vehicle: quoted values are service keys, status codes, key names, error shapes, column and function names and counts
--   only; no VIN, vehicle id or value of one vehicle.
-- CHANGED EXISTING COMMENTS:
--   None; the table and its columns had no comment.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.service_executions IS
'Queue and log of runs of third-party vehicle services from the service integration framework (20251203_service_integration_framework.sql): one row per queued run of one service for one vehicle (grain: one service run; a vehicle can be queued again for a service after a failure). 571,531 rows on 2026-10-07 for 332,683 vehicles and 557,912 vehicle and service pairs, queued 2025-12-03 .. 2026-04-14 06:45Z (by month: 2025-12 3,651, 2026-01 210,077, 2026-02 201,633, 2026-03 113,613, 2026-04 42,557), none since. Only two of the nine service_integrations ever ran, both free auto services: nhtsa_vin_decode 344,603 rows and hagerty_instant_quote 226,928. Queue writer: the trigger vehicle_auto_services_trigger on vehicles (AFTER INSERT OR UPDATE OF vin, year, make, model) ran trigger_auto_services(), which inserted a queued row for every eligible service of check_auto_services(uuid) with the vehicle fields as request_data. On prod that function is now a no-op (BEGIN RETURN NEW; END), replaced at a time no repo file or logged migration records, so the trigger still fires on every vehicle insert and queues nothing. Worker: the edge function service-orchestrator claimed queued rows ten at a time, ran the adapter of supabase/functions/_shared/serviceAdapters.ts and wrote the outcome here, the fields to vehicle_field_evidence and a row to vehicle_form_completions. Its last run started 2026-02-18 21:55Z, commit 43b72deae (2026-03-07) deleted its source, it is not deployed (management API, 2026-10-07) and no cron job calls it. So nothing drains the queue: 414,419 rows (72.5%) are still queued (222,365 of them queued after the last run), 27 have been stuck in executing since 2026-02, 90,925 completed and 66,160 failed. Mislabel: no Hagerty API was ever called. Without a HAGERTY_API_KEY the Hagerty adapter returns estimates computed from the model year alone (market_value_low = year x 100, market_value_avg = year x 150, market_value_high = year x 200, insurance_value = year x 180, confidence 50). All 48,440 completed hagerty_instant_quote rows carry confidence 50, and 48,433 of them hold exactly those products (2026-10-07). The worker passed them on: vehicle_field_evidence holds 193,752 rows with source_type hagerty_instant_quote (4 fields per run, every one with confidence_score 50) and vehicle_form_completions 48,439 rows with form_type hagerty_instant_quote and provider Hagerty, so placeholder numbers sit downstream labelled as Hagerty values. The NHTSA rows hold decodes from the NHTSA vPIC API (552,292 evidence rows with source_type nhtsa_vin_decode). Orphans: 281 of 5,127 rows of a 1% block sample (5.5%, about 31,000 rows) point at a vehicle id that is not in vehicles, although the foreign key (ON DELETE CASCADE) is validated and its triggers are enabled. pg_stat_user_tables since its counters began (the server last started 2026-09-29 09:20Z; read 13:15Z): 0 inserts, 0 updates, 0 deletes, 0 sequential and 2 index scans. Readers: none live. check_auto_services(uuid) reads it and has no caller; no view, cron job, edge function, frontend file or script names the table. Access: RLS is on with four policies for every role (select, insert, update and delete) that allow rows of vehicles the caller uploaded or rows whose user_id is the caller; anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE (has_table_privilege, 2026-10-07). anon reads 0 rows (counted under SET LOCAL ROLE anon in a read-only transaction); user_id is NULL on every row and no vehicle of the 1% block sample has uploaded_by set, so a signed-in account sees almost nothing. No pipeline_registry row and no write receipts. Clocks: queued_at and created_at are the database clock of the queue insert; started_at, completed_at and updated_at are the worker clock; nothing records when the provider produced its answer.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.service_executions.id IS
'Surrogate key of the run, uuid, gen_random_uuid() default, the PRIMARY KEY. 571,531 values (2026-10-07). The worker wrote it as source_id of the vehicle_field_evidence rows and of the vehicle_form_completions row it produced, so those rows point back here. Unit: none (uuid). Source: column default. Grain: one service run. Clock: n/a.';
COMMENT ON COLUMN public.service_executions.vehicle_id IS
'Vehicle the service ran for: a vehicles.id, nullable but filled on every row, foreign key to vehicles(id) ON DELETE CASCADE (validated, its triggers enabled), indexed (idx_service_executions_vehicle). 332,683 distinct values on 571,531 rows (2026-10-07). In a 1% block sample 281 of 5,127 rows (5.5%; nhtsa_vin_decode 199 of 3,101, hagerty_instant_quote 82 of 2,026) point at an id that is not in vehicles, so about 31,000 rows are orphans whose vehicle was deleted with the RI triggers off; 159 sampled rows belong to a soft-deleted vehicle. Unit: none (uuid). Source: trigger_auto_services (NEW.id of the vehicle). Grain: one service run. Clock: n/a.';
COMMENT ON COLUMN public.service_executions.service_key IS
'Service that ran: a service_integrations.service_key, foreign key (validated, no delete action), nullable but filled on every row. 2 of the 9 keys occur (2026-10-07): nhtsa_vin_decode 344,603 (NHTSA VIN decoder) and hagerty_instant_quote 226,928 (named Hagerty Valuation, but see response_data); the 7 paid or manual services (appraisal_network_booking, bat_submission, carfax_report, cars_bids_submission, gm_heritage, nmvtis_check, spid_auto_extract) never ran. 13,619 rows (2.4%) repeat one of 13,240 vehicle and service pairs, each of which holds a failed run, because check_auto_services queues again after a failure. The creating migration indexed it; that index is absent on prod. Unit: none (text code). Source: check_auto_services through trigger_auto_services. Grain: one service run. Clock: n/a.';
COMMENT ON COLUMN public.service_executions.user_id IS
'Intended account that requested the run (no foreign key), uuid, nullable. NULL on all 571,531 rows (2026-10-07): only the vehicle trigger queued runs, and it sets no user. The four RLS policies compare it with auth.uid(). Unit: none (uuid). Source: none. Grain: one service run. Clock: n/a.';

-- ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.service_executions.status IS
'State of the run, text NOT NULL, default queued, CHECK valid_status in (queued, executing, completed, failed, cancelled, pending_payment). 4 occur (2026-10-07): queued 414,419 (72.5%; nhtsa_vin_decode 256,000, hagerty_instant_quote 158,419), completed 90,925 (nhtsa 42,485, hagerty 48,440), failed 66,160 (nhtsa 46,095, hagerty 20,065) and executing 27 (stuck since 2026-02, last touched 2026-02-15). cancelled and pending_payment never. The worker that moved rows on (service-orchestrator) last ran 2026-02-18 and is deleted, so queued is final: 222,365 queued rows were queued after its last run. Unit: none (text code). Source: column default, then service-orchestrator. Grain: one service run. Clock: as of updated_at.';
COMMENT ON COLUMN public.service_executions.trigger_type IS
'What started the run, text, CHECK valid_trigger_type in (auto, manual, scheduled). auto on 571,530 rows and manual on 1 (2026-10-07); scheduled never. Unit: none (text code). Source: trigger_auto_services (auto). Grain: one service run. Clock: n/a.';
COMMENT ON COLUMN public.service_executions.retry_count IS
'Intended number of retries of the run, integer, nullable, default 0. 0 on all 571,531 rows (2026-10-07): the worker never retried; a failed vehicle was queued again as a new row instead. Unit: count. Source: column default. Grain: one service run. Clock: n/a.';

-- ── Request and response ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.service_executions.request_data IS
'Vehicle fields copied when the run was queued, jsonb, filled on every row (2026-10-07). Keys (1% block sample, every row): vin, year, make, model and mileage of the vehicle at queue time, triggered_by (always vehicle_insert_update) and triggered_at (equal to queued_at on every sampled row). The VIN has 17 characters on 51% of sampled nhtsa_vin_decode rows and 57% of hagerty_instant_quote rows. Holds VINs; none is quoted here. Unit: none (jsonb). Source: trigger_auto_services. Grain: one service run. Clock: queued_at.';
COMMENT ON COLUMN public.service_executions.response_data IS
'What the adapter returned, jsonb, nullable. Filled on 90,992 rows (15.9%, 2026-10-07): every completed run, 66 failed ones (success false and the adapter error) and 1 of the stuck executing ones. Keys: success, fields, confidence, and error on failures. hagerty_instant_quote: confidence 50 on all 48,440 completed rows, the value of the placeholder branch of the Hagerty adapter, which runs when no HAGERTY_API_KEY is set and computes four values from the model year (see fields_populated); the real API branch would return 85. nhtsa_vin_decode: confidence 95 and the decoded fields from the NHTSA vPIC API. Unit: none (jsonb). Source: service-orchestrator (adapter result). Grain: one service run. Clock: completed_at.';
COMMENT ON COLUMN public.service_executions.error_message IS
'Why the run failed, text, nullable. Filled on exactly the 66,160 failed rows (2026-10-07). In a 1% block sample 575 of 576 failed rows say Requirements not met, the worker precheck: nhtsa_vin_decode needs a VIN of 17 characters and a model year from 1981, hagerty_instant_quote a VIN, make, model and a model year up to 1995; the other sampled message is an NHTSA API error (Service Unavailable). The worker could also write No adapter available or the adapter error. Unit: none (text). Source: service-orchestrator. Grain: one service run. Clock: as of updated_at.';
COMMENT ON COLUMN public.service_executions.fields_populated IS
'Fields the service produced, jsonb, nullable. Filled on 90,926 rows (2026-10-07), every completed run and 1 of the stuck executing ones, never {}. hagerty_instant_quote: market_value_low, market_value_avg, market_value_high and insurance_value, which on 48,433 of the 48,440 completed rows equal the model year times 100, 150, 200 and 180, the placeholder estimates of the Hagerty adapter, not Hagerty valuations. nhtsa_vin_decode: year, manufacturer, make, plant_city, model, body_style, engine_type, trim, series, drivetrain and others when NHTSA returned them (year falls back to the vehicle year when NHTSA gives none). service-orchestrator copied each field to vehicle_field_evidence (source_type = service_key, source_id = id, confidence_score = the response confidence): 193,752 hagerty_instant_quote and 552,292 nhtsa_vin_decode evidence rows exist (2026-10-07). Unit: none (jsonb; values in the units of the service, US dollars for the Hagerty keys as the adapter meant them). Source: service-orchestrator (adapter result). Grain: one service run. Clock: completed_at.';
COMMENT ON COLUMN public.service_executions.documents_created IS
'Documents the service created (creating migration: links to documents), uuid array, nullable. An empty array on the 90,926 rows where fields_populated is filled and NULL elsewhere (2026-10-07): no service returned a document. Unit: none (uuid array). Source: service-orchestrator. Grain: one service run. Clock: n/a.';
COMMENT ON COLUMN public.service_executions.form_completion_id IS
'Intended link to the vehicle_form_completions row of the run, uuid, nullable, no foreign key. NULL on all 571,531 rows (2026-10-07); the worker wrote the link the other way, as service_execution_id and source_id on vehicle_form_completions (48,439 hagerty_instant_quote and 42,482 nhtsa_vin_decode rows). Unit: none (uuid). Source: none. Grain: one service run. Clock: n/a.';

-- ── Payment (never written) ────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.service_executions.price_paid IS
'Intended price paid for a paid service, numeric, nullable. NULL on all 571,531 rows (2026-10-07): only free services ran. Unit: unknown (never written; service_integrations.price_usd suggests US dollars). Source: none. Grain: one service run. Clock: n/a.';
COMMENT ON COLUMN public.service_executions.payment_id IS
'Intended payment reference of a paid run, text, nullable. NULL on all 571,531 rows (2026-10-07). Unit: none (text). Source: none. Grain: one service run. Clock: n/a.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.service_executions.queued_at IS
'When the run was queued: default now(), the database clock of the insert by trigger_auto_services, equal to created_at on every row (2026-10-07). Range 2025-12-03 20:20Z .. 2026-04-14 06:45Z; by month: 2025-12 3,651, 2026-01 210,077, 2026-02 201,633, 2026-03 113,613, 2026-04 42,557. It is the time of the vehicle write that fired the trigger, not a request by anyone. Unit: timestamptz. Source: column default. Grain: one service run. Clock: ingest time of the queue insert.';
COMMENT ON COLUMN public.service_executions.started_at IS
'When the worker started the run, timestamptz, nullable. Filled on 91,006 rows (15.9%, 2026-10-07): 90,913 completed, 66 failed and the 27 stuck in executing; the precheck failures never start. Range 2025-12-04 23:27Z .. 2026-02-18 21:55Z. Unit: timestamptz. Source: service-orchestrator (its own clock, milliseconds). Grain: one service run. Clock: worker time.';
COMMENT ON COLUMN public.service_executions.completed_at IS
'When the worker finished the run, timestamptz, nullable. Filled on 90,992 rows (2026-10-07): the 90,925 completed runs, 66 failed ones and 1 of the stuck executing ones. Range 2025-12-04 23:27Z .. 2026-02-18 21:55Z; earlier than started_at on 1 row. Unit: timestamptz. Source: service-orchestrator (its own clock, milliseconds). Grain: one service run. Clock: worker time.';
COMMENT ON COLUMN public.service_executions.created_at IS
'When the row was inserted: default now(), equal to queued_at on all 571,531 rows (2026-10-07), never changed. Unit: timestamptz. Source: column default. Grain: one service run. Clock: ingest time of the queue insert.';
COMMENT ON COLUMN public.service_executions.updated_at IS
'When the row was last written, timestamptz, nullable, default now(). No trigger maintains it: it equals created_at on the 414,419 queued rows, and on the others the worker stamped its own clock with each status change (equal to completed_at on 90,162 completed rows, to started_at on 26 of the executing ones). Latest 2026-04-14 06:45Z (a queue insert); the latest worker stamp is 2026-02-18 21:55Z. Unit: timestamptz. Source: column default or service-orchestrator. Grain: one service run. Clock: writer time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.service_executions'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'service_executions: every column has a comment';
  ELSE
    RAISE NOTICE 'service_executions columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
