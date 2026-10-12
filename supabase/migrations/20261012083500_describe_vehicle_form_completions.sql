-- Describe vehicle_form_completions: all 20 columns, none had a COMMENT ON COLUMN (0 of 20 described before, atlas read
-- 2026-10-12 08:30Z), and a table comment (there was none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 90,921 rows on 2026-10-12 08:32Z by exact count (the
-- atlas estimate is 90,921), 0 inserts, 0 updates and 0 deletes since the statistics counters began; the newest row was
-- created 2026-02-18 21:55Z.
--
-- METHOD (read 2026-10-12 08:31-08:34Z UTC):
--   Columns, types, defaults, constraints, triggers, policies, the anon SELECT grant and existing comments from
--   pg_attribute, pg_attrdef, pg_constraint, pg_trigger, pg_policy and pg_description; null fractions and distinct counts
--   from pg_stats. Row counts per form_type, provider, status, source_type and completeness_pct, distinct vehicles, the
--   fields_extracted key sets, clock ranges and comparisons, rows whose vehicle_id has no vehicles row and rows whose
--   service_execution_id has no service_executions row are exact counts over the whole table. "Filled" means non-NULL.
--   Writers and readers from code at origin/main f581dbea8 (supabase/functions, supabase/migrations, nuke_frontend,
--   scripts; also git history): the creating migration 20251203_service_integration_framework.sql; the edge function
--   service-orchestrator as it stood before commit 43b72deae (2026-03-07) archived and deleted it (it upserted one row per
--   completed service run, onConflict vehicle_id,form_type); the trigger function track_spid_form_completion() (live
--   body from 20260927200000_p3_9_spid_and_labor_rate_trigger_bodies.sql, trigger spid_form_completion_tracker on
--   vehicle_spid_data, enabled); calculate_verification_score(), the only other live function whose body names the table;
--   20261008002000_describe_service_executions.sql for the upstream run rows and the Hagerty adapter's placeholder values.
-- LIMITS:
--   Why 5,324 rows name a vehicle_id with no vehicles row under a validated ON DELETE CASCADE foreign key is Unknown
--   (not established from the catalog or the repo). pg_stat_user_tables counters began at an unrecorded time. Quoted
--   values are form types, providers, key names, counts and clocks only; no vehicle id or value of one vehicle.
-- CHANGED EXISTING COMMENTS:
--   None; the table and its columns had no comment.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_form_completions IS
'Which external form or service result a vehicle has, as a completion record: one row per vehicle and form type (UNIQUE (vehicle_id, form_type)). It records that a source was run and which fields it returned, not the values. 90,921 rows (2026-10-12): 48,439 hagerty_instant_quote and 42,482 nhtsa_vin_decode, every one status complete at 100%, all created 2025-12-04 .. 2026-02-18 by the service-orchestrator edge function (archived and deleted 2026-03-07, commit 43b72deae), one per completed service_executions run. The Hagerty rows record the adapter''s placeholder estimates (model year times a constant, see service_executions.fields_populated), not Hagerty valuations. A second writer, trigger spid_form_completion_tracker on vehicle_spid_data, would add form_type spid rows; none exist. The values themselves are in vehicle_field_evidence (source_id = the run id). Event time = extracted_at (worker clock); ingest time = created_at.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.id IS
'Surrogate key of the completion record, uuid, gen_random_uuid() default, the PRIMARY KEY. 90,921 values (2026-10-12). Unit: none (uuid). Source: column default. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.vehicle_id IS
'The vehicle the form was completed for, uuid, nullable, FOREIGN KEY to vehicles ON DELETE CASCADE (validated). Filled on every row and distinct per form_type: 48,439 vehicles have a Hagerty row and 42,482 an NHTSA row (2026-10-12). 5,324 rows (3,339 Hagerty) name a vehicle_id with no vehicles row despite the validated key; why is Unknown. Unit: none (uuid). Source: service_executions.vehicle_id via service-orchestrator (equal on every row). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.form_type IS
'Which form or service the record is for, text, NOT NULL, unique together with vehicle_id. Written as the service_executions.service_key of the run: hagerty_instant_quote 48,439 and nhtsa_vin_decode 42,482 (2026-10-12). The creating migration lists spid, nhtsa, title, registration, gm_heritage, carfax, appraisal and inspection as intended values; the SPID trigger writes spid; none of those exist. No CHECK constrains it. Unit: none (code). Source: service-orchestrator. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.form_version IS
'Version of the form (creating migration: ''2024'', ''v1''), text, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: none. Source: none. Grain: one vehicle and form type. Clock: n/a.';

-- ── Completion ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.status IS
'Completion state, text, NOT NULL, CHECK in (not_started, partial, complete, commissioned, in_progress, failed). complete on all 90,921 rows (2026-10-12): both writers hard-code complete, so it says the run returned, not that every field was found. Unit: none (code). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.completeness_pct IS
'Share of the form completed, integer percent, nullable, CHECK 0..100. 100 on all 90,921 rows (2026-10-12): both writers hard-code 100 rather than computing it from fields_extracted against fields_required. calculate_verification_score() weights it. Unit: percent (0..100). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.fields_extracted IS
'Which fields the source returned, jsonb object of field name to boolean, nullable. service-orchestrator wrote every key of the result as true; one key set per form type (2026-10-12): hagerty_instant_quote {insurance_value, market_value_avg, market_value_high, market_value_low}; nhtsa_vin_decode {body_style, displacement, drivetrain, engine_type, fuel_type, make, manufacturer, model, plant_city, plant_state, series, trim, year}. true means the key was present in the response, not that the value is a real observation (the Hagerty values are adapter placeholders). The SPID trigger writes eight presence flags (vin, build_date, paint codes, engine, transmission, axle ratio, rpo_codes). Unit: none (jsonb booleans). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.fields_required IS
'Fields the form requires, jsonb object of field name to boolean (creating migration), nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it, so completeness_pct has no denominator. Unit: none (jsonb booleans). Source: none. Grain: one vehicle and form type. Clock: n/a.';

-- ── Source ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.source_id IS
'Id of the record the completion came from, uuid, nullable, no foreign key; its table is named by source_type. Equal to service_execution_id on all 90,921 rows (2026-10-12), every one of which has a service_executions row. The SPID trigger writes the vehicle_spid_data image_id here with source_type spid_image. Unit: none (uuid). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.source_type IS
'Kind of record source_id points to, text, nullable. service_execution on all 90,921 rows (2026-10-12); the SPID trigger writes spid_image. Unit: none (code). Source: service-orchestrator; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.source_url IS
'Link to the original document or response (creating migration), text, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: none (URL). Source: none. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.provider IS
'Who issued the form, text, nullable, copied from service_integrations.provider of the run: Hagerty on the 48,439 hagerty_instant_quote rows and NHTSA (US Government) on the 42,482 nhtsa_vin_decode rows (2026-10-12). The SPID trigger writes GM Factory. A label, not a key to organizations. Unit: none (name). Source: service-orchestrator via service_integrations; track_spid_form_completion(). Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.service_execution_id IS
'The service run that produced the record, uuid, nullable, FOREIGN KEY to service_executions. Filled on all 90,921 rows (2026-10-12), each matching an existing run with the same vehicle_id; equal to source_id. The reverse link service_executions.form_completion_id was never written. The SPID trigger leaves it NULL. Unit: none (uuid). Source: service-orchestrator. Grain: one vehicle and form type. Clock: n/a.';

-- ── Commissioned (paid) service tracking (never written) ────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.expires_at IS
'When a paid result stops being valid (creating migration: for paid services), timestamptz, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: timestamptz. Source: none. Grain: one vehicle and form type. Clock: intended validity end.';
COMMENT ON COLUMN public.vehicle_form_completions.commissioned_at IS
'When a paid service was commissioned for this form, timestamptz, nullable. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: timestamptz. Source: none. Grain: one vehicle and form type. Clock: intended order time.';
COMMENT ON COLUMN public.vehicle_form_completions.commission_price IS
'Price of a commissioned service, numeric, nullable, currency not recorded. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: Unknown (no currency column). Source: none. Grain: one vehicle and form type. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_form_completions.commission_status IS
'State of a commissioned service (creating migration: pending, in_progress, completed), text, nullable, no CHECK. NULL on all 90,921 rows (2026-10-12); no writer sets it. Unit: none (code). Source: none. Grain: one vehicle and form type. Clock: n/a.';

-- ── Clocks ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_form_completions.extracted_at IS
'When the writer recorded the extraction, timestamptz, nullable. Filled on all 90,921 rows (2026-10-12), range 2025-12-04 23:27Z .. 2026-02-18 21:55Z; service-orchestrator stamped its own clock (new Date()) just before the upsert: earlier than created_at on 90,459 rows (by at most 14.4 s) and later on 462 (worker and database clocks differ), never equal. The SPID trigger copies vehicle_spid_data.extracted_at. Unit: timestamptz. Source: service-orchestrator (worker clock); track_spid_form_completion(). Grain: one vehicle and form type. Clock: worker time of the extraction.';
COMMENT ON COLUMN public.vehicle_form_completions.created_at IS
'When the row was inserted, timestamptz, default now(). Range 2025-12-04 23:27Z .. 2026-02-18 21:55Z (2026-10-12). Unit: timestamptz. Source: column default. Grain: one vehicle and form type. Clock: ingest time.';
COMMENT ON COLUMN public.vehicle_form_completions.updated_at IS
'When the row was last written, timestamptz, default now(); no trigger maintains it. Equal to created_at on all 90,921 rows (2026-10-12): no row was upserted a second time. Unit: timestamptz. Source: column default. Grain: one vehicle and form type. Clock: writer time of the last write.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_form_completions'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_form_completions: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_form_completions columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
