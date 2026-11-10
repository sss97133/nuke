-- Photo landing supersession: a newer classifier reading of a photo replaces what the fold landed for it, and the
-- rows it replaces are kept.
--
-- Contract: supabase/sql/test_photo_landing_supersession.sql (fixture: supabase/sql/fixtures/photo_landing_supersession_owners.sql).
-- Revert:   supabase/sql/revert_20261113150000_photo_landing_supersession.sql.
--
-- WHY
--   photo_land_classification() lands a reading with ON CONFLICT DO NOTHING / NOT EXISTS, so the first reading of a
--   photo keeps every key for good. A second reading (a newer contract, or another reader under the same contract)
--   only fills keys that were absent: core.image_type stays 'other' / 'legacy' beside v98 fields, text lines of two
--   readings interleave, and the description never changes. The stage ledger (20261113110000) re-reads photos whose
--   reading is missing or older than contract v98, and the reader on the owner's Mac posts those readings now.
--
-- WHAT CHANGES
--   1. One current row per key, as readers expect today, in the fold's three projection tables:
--        photo_extracted_fields (image_id, field_name, source 'classifier_v2')
--        photo_text_lines       (image_id, line_idx,   source 'classifier_v2')
--        image_descriptions     one row per image with description_type 'classifier_v2'
--      When the fold meets a reading different from the one landed, it copies every landed row of the image, whole
--      (to_jsonb(row)), into photo_land_superseded_rows, then rewrites in place the rows whose key the new reading
--      still has (same id; created_at becomes the new landing time), removes the rows whose key it no longer has, and
--      inserts new keys. The same reading again fills what is absent and changes nothing that is there.
--   2. image_angle_observations is testimony (scripts/guardrails/no-raw-testimony-insert.mjs; its creating migration
--      says to record observations over time and never replace). The fold never updates or deletes a row of it. A
--      reading with a mappable angle, on a filed photo, INSERTS a classifier_v2 row (observed_at = the clock at the
--      insert, the reading stamped in evidence.reading_id) unless the newest classifier_v2 row of the image already
--      records that angle for that reading. Older rows stay. A reader must therefore take the NEWEST classifier_v2
--      row; the one reader in the repo is nuke_frontend/src/utils/resolveAngle.ts and it changes in the same pull
--      request.
--   3. Reading identity. photo_classifier_reading_id(classification) = md5 of the text of
--      jsonb {prompt_version, reader (classifier_receipt.model), image_type, is_automotive, confidence, description, v2}.
--      Another reader under the same prompt version is another reading; vehicle_hints, classifier_ok and the rest of
--      the receipt are outside it. photo_classifier_landings holds one row per reading landed per image
--      (superseded_at IS NULL = current). Rows landed before this migration have no stored identity: on a photo's
--      first run afterwards they are compared with what its classification lands; no difference = adopted (nothing
--      rewritten), any difference = recorded as one reading of unknown identity (basis pre_ledger) and superseded.
--      A failed stand-in (classification.classifier_ok = false) is not a reading and never supersedes one.
--   4. Vehicle-level claims (field_evidence proposals, vehicle_identifiers) are NOT withdrawn. This migration only makes
--      stale ones findable, and decides at query time, not at landing time:
--        * the current landing row carries what its reading asserts for the vehicle the photo is filed under
--          (claims_vehicle_id, claimed_field_evidence ids, claimed_identifiers kind/value pairs, claimed_vin),
--          rewritten by every run of the fold, so a filing or a gate change (trigger a07) refreshes it;
--        * at a supersession the claim rows the photo's earlier readings left standing are copied to
--          photo_land_superseded_rows (disposition 'claim'), unchanged in their own tables;
--        * photo_land_outstanding() lists such a claim only while no current reading of ANY photo still filed under
--          that vehicle asserts it.
--      New field_evidence proposals carry raw_extraction_data.reading_id.
--   5. Failures. The fold still never raises (the vehicle_images UPDATE that fired it must not fail), and what it
--      wrote rolls back, but the failure is kept in photo_land_failures: one open row per (image, stage, SQLSTATE) with
--      a counter, closed (resolved_at) by the next run for that photo that goes through. The identifier hand-off, which
--      swallowed errors, is traced as stage 'identifiers'. photo_land_trigger() is redefined (same condition, same
--      call) so a failure that never reaches the fold's own handler is traced as stage 'trigger'.
--      photo_land_retry_failures(limit) runs the fold again for the photos with open failures. NOTHING SCHEDULES IT:
--      call it by hand, or from a drain that already exists. It reads vehicle_images by primary key only.
--   6. Locks. The fold's first read takes the photo row FOR NO KEY UPDATE. In a trigger run the UPDATE already holds
--      that lock. A hand call or a drain now serialises with writers of the photo row and with
--      land_identifier_claims(), which locks the same row FOR UPDATE (20261109200000 line 63): photo row first,
--      everywhere. An earlier draft used an advisory lock here and deadlocked against that row lock.
--      Consequence for anything that folds MANY photos in one transaction (photo_land_retry_failures(), and
--      photo_land_backfill_drain, which exists only in production and was not read): it holds every photo row it
--      landed until it commits, where it used to hold only the rows of photos with plate codes. Writers of those
--      photos wait for it. It can still deadlock with a trigger run through the VEHICLE row that
--      land_identifier_claims() locks after the photo row (as before this change); the fold catches that, records it
--      (40P01, stage landing or identifiers) and it can be run again.
--
-- NOT DONE HERE (see the note in the pull request)
--   * No claim is withdrawn; vehicle_identifier_observations candidates minted from replaced rows are not marked.
--   * A reading with no mappable angle leaves the older reading's angle row as the newest classifier row.
--   * No backfill, no scheduled job, nothing that scans vehicle_images. A photo changes on its next landing.
--
-- DEPLOY SAFETY
--   One transaction; lock_timeout 3 s. No DDL, lock, rewrite or scan on vehicle_images or on any landed table (no
--   relation lock at all on them: the bodies that read them are plpgsql, which CREATE FUNCTION does not resolve): three
--   new tables, five new functions, two function bodies replaced, two catalog comments. A replay of this file is
--   accepted.
--   Guards (the file changes nothing when one raises):
--     * md5(prosrc) of the three owners equals production's (or this file's, on a replay);
--     * all three are owned by the role running this file (the fold writes the new tables as its owner), and that
--       role may lock a vehicle_images row: it holds UPDATE on the table and row level security does not apply to it;
--     * the two unique keys the replace relies on exist, and the columns the new body reads exist;
--     * NO foreign key references photo_extracted_fields, photo_text_lines, image_descriptions or
--       image_angle_observations: a RESTRICT key would make a removal fail and a CASCADE key would delete its
--       children silently. A key added AFTER this migration is not caught at run time; check before adding one.
--
-- VERIFIED, AND NOT
--   Read from production by the lead on 2026-11-10 (17:23 and 19:49 UTC), not by this file's author: the three md5s
--   and their owner (postgres); the columns, defaults and unique keys of the five landing tables; that no foreign key
--   references the four landed tables; that no image holds two classifier_v2 descriptions, two classifier_v2 angle
--   rows, or fields under two prompt versions; that none of the five tables has a user trigger.
--   Executed on local PostgreSQL 16 only, against stand-ins with those columns and keys: the contract, and four
--   existing contracts re-run with this file applied after their own migrations.
--   NOT verified: anything on PostgreSQL 17 (CI) or in production; timings; the columns of field_evidence and
--   vehicle_identifiers (taken from their creating migrations); the default of photo_land_progress.landed_at (the fold
--   now writes the column itself); who owns vehicle_images and whether row level security applies to the fold's owner
--   there (the guard refuses if it does); what readers that exist only in production do with image_angle_observations;
--   how photo_land_backfill_drain batches and whether a job still runs it (see Locks above).
begin;
set local statement_timeout = '10s';
set local lock_timeout = '3s';

-- ------------------------------------------------------------------------------------------------ guard
do $guard$
declare
  c_fold_live    constant text := '7c95e1ac5d5832ca68b4690b92f365f0';   -- photo_land_classification(uuid, boolean), production
  c_fold_this    constant text := '1625d1e78b0bc5511d5f4dbfab4c28ef';   -- the body this file installs (replay)
  c_wrapper_live constant text := '6c8b7cddc606cca4dfeb557d7e6f5c1c';   -- photo_land_classification(uuid), not redefined
  c_trigger_live constant text := '307261071b2aa3fef7a83297d63a9638';   -- photo_land_trigger(), production
  c_trigger_this constant text := '550ba1336d544010215b221aace47748';   -- the body this file installs (replay)
  v_fold text; v_wrapper text; v_trigger text; v_found text;
begin
  select md5(prosrc) into v_fold    from pg_proc where oid = to_regprocedure('public.photo_land_classification(uuid,boolean)');
  select md5(prosrc) into v_wrapper from pg_proc where oid = to_regprocedure('public.photo_land_classification(uuid)');
  select md5(prosrc) into v_trigger from pg_proc where oid = to_regprocedure('public.photo_land_trigger()');
  if v_fold is null or v_fold not in (c_fold_live, c_fold_this)
     or v_wrapper is distinct from c_wrapper_live
     or v_trigger is null or v_trigger not in (c_trigger_live, c_trigger_this) then
    raise exception 'photo landing owner drifted (fold %, wrapper %, trigger %); review the live definitions before redefining them',
      coalesce(v_fold, 'missing'), coalesce(v_wrapper, 'missing'), coalesce(v_trigger, 'missing');
  end if;

  -- The fold and the trigger function are SECURITY DEFINER and write the tables created below as their owner, so that
  -- owner must be the role that creates them here (CREATE OR REPLACE keeps the owner a function already has).
  select string_agg(p.oid::regprocedure::text || ' owned by ' || p.proowner::regrole::text, '; ') into v_found
    from pg_proc p
   where p.oid in (to_regprocedure('public.photo_land_classification(uuid,boolean)'), to_regprocedure('public.photo_land_trigger()'))
     and p.proowner is distinct from (select r.oid from pg_roles r where r.rolname = current_user);
  if v_found is not null then
    raise exception 'this migration runs as % but %: run it as the owner, or the fold cannot write its ledger', current_user, v_found;
  end if;

  -- The fold's first read locks the photo row (SELECT ... FOR NO KEY UPDATE). That needs UPDATE on vehicle_images, and,
  -- where row level security applies to the fold's owner, every row would also have to pass the UPDATE policies: a row
  -- that does not would read as "not completed" and nothing would land, silently. So refuse unless the owner is
  -- exempt (superuser, BYPASSRLS, or the table's owner without FORCE ROW LEVEL SECURITY).
  if not has_table_privilege(current_user, 'public.vehicle_images', 'UPDATE') then
    raise exception '% lacks UPDATE on public.vehicle_images: the fold could not lock the photo row it lands', current_user;
  end if;
  if (select c.relrowsecurity and not (r.rolsuper or r.rolbypassrls or (pg_has_role(r.oid, c.relowner, 'USAGE') and not c.relforcerowsecurity))
        from pg_class c, pg_roles r where c.oid = 'public.vehicle_images'::regclass and r.rolname = current_user) then
    raise exception 'row level security on public.vehicle_images applies to %: the fold''s row lock would hide every photo its UPDATE policies do not pass, and nothing would land. Decide how the fold may lock the row before deploying this', current_user;
  end if;

  -- Replace-in-place relies on one current row per key. Production keys, read 2026-11-10:
  --   photo_extracted_fields UNIQUE (image_id, field_name, source); photo_text_lines UNIQUE (image_id, line_idx, source).
  select string_agg(k.tbl || ' (' || array_to_string(k.cols, ', ') || ')', '; ') into v_found
  from (values ('public.photo_extracted_fields', array['field_name', 'image_id', 'source']),
               ('public.photo_text_lines',       array['image_id', 'line_idx', 'source'])) k(tbl, cols)
  where not exists (
    select 1 from pg_index i
    where i.indrelid = to_regclass(k.tbl) and i.indisunique and i.indpred is null and i.indexprs is null and i.indnkeyatts = 3
      and (select array_agg(a.attname::text order by a.attname::text)
             from unnest(i.indkey::int2[]) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
            where u.ord <= i.indnkeyatts) = k.cols);
  if v_found is not null then
    raise exception 'photo landing keys differ from the ones this fold was written for; no unique index on: %', v_found;
  end if;

  -- Columns the new bodies read or write that the previous bodies did not.
  select string_agg(c.tbl || '.' || c.col, ', ') into v_found
  from (values ('public.photo_extracted_fields', 'id'), ('public.photo_extracted_fields', 'created_at'),
               ('public.photo_text_lines', 'id'), ('public.photo_text_lines', 'created_at'),
               ('public.image_descriptions', 'id'), ('public.image_descriptions', 'created_at'),
               ('public.image_angle_observations', 'id'), ('public.image_angle_observations', 'observed_at'),
               ('public.photo_land_progress', 'landed_at'),
               ('public.field_evidence', 'id'), ('public.field_evidence', 'status'),
               ('public.vehicle_identifiers', 'id'), ('public.vehicle_identifiers', 'extractor'),
               ('public.vehicle_identifiers', 'value'), ('public.vehicle_identifiers', 'superseded_at'),
               ('public.vehicle_images', 'vision_gate_status')) c(tbl, col)
  where not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(c.tbl) and a.attname = c.col and not a.attisdropped);
  if v_found is not null then
    raise exception 'photo landing fold needs columns that are missing: %', v_found;
  end if;

  -- The fold rewrites and removes rows of three of these tables by id. No foreign key may reference any of the four
  -- (none did in production on 2026-11-10 19:49 UTC): RESTRICT would fail every removal, CASCADE would delete the
  -- referencing rows without a before-image.
  select string_agg(format('%s (%s) -> %s', c.conrelid::regclass, c.conname, c.confrelid::regclass), '; ') into v_found
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid in (to_regclass('public.photo_extracted_fields'), to_regclass('public.photo_text_lines'),
                         to_regclass('public.image_descriptions'), to_regclass('public.image_angle_observations'));
  if v_found is not null then
    raise exception 'a foreign key references a photo landing table; decide what a superseded row means for it before this fold may replace rows: %', v_found;
  end if;
end $guard$;

-- ------------------------------------------------------------------------------------------------ the reading ledger
create table if not exists public.photo_classifier_landings (
  id                     bigint generated always as identity primary key,
  image_id               uuid not null,
  reading_id             text,
  prompt_version         text,
  reader                 text,
  image_type             text,
  basis                  text not null check (basis in ('landed', 'adopted', 'pre_ledger')),
  vehicle_id             uuid,
  yields                 jsonb not null default '{}'::jsonb,
  landed_at              timestamptz not null default now(),
  recorded_at            timestamptz not null default now(),
  supersedes             bigint references public.photo_classifier_landings(id),
  superseded_at          timestamptz,
  claims_vehicle_id      uuid,
  claimed_field_evidence uuid[] not null default '{}',
  claimed_identifiers    jsonb not null default '[]'::jsonb,
  claimed_vin            text,
  claims_refreshed_at    timestamptz,
  constraint photo_classifier_landings_identity check ((basis = 'pre_ledger') = (reading_id is null)),
  constraint photo_classifier_landings_pre_ledger_closed check (basis <> 'pre_ledger' or superseded_at is not null)
);
create unique index if not exists photo_classifier_landings_current on public.photo_classifier_landings (image_id) where superseded_at is null;
create unique index if not exists photo_classifier_landings_successor on public.photo_classifier_landings (supersedes) where supersedes is not null;
create index if not exists photo_classifier_landings_image on public.photo_classifier_landings (image_id, id);
create index if not exists photo_classifier_landings_claims on public.photo_classifier_landings (claims_vehicle_id)
  where superseded_at is null and claims_vehicle_id is not null;
comment on table public.photo_classifier_landings is
  'One row per classifier reading that photo_land_classification() landed for an image. The row with superseded_at NULL is the reading the landed tables hold now (at most one per image). Rows are never deleted. Two changes are ever made to a row: its claims_* / claimed_* columns are rewritten while it is current, and superseded_at is stamped once, when a different reading takes the image (the successor points back through supersedes). image_id is deliberately not a foreign key: the ledger and the before-images outlive an image row, and adding one would lock vehicle_images at deploy. Written only by photo_land_classification(); the service role can read it.';
comment on column public.photo_classifier_landings.reading_id is
  'Identity of the reading: photo_classifier_reading_id(vehicle_images.ai_scan_metadata -> ''classification''), the md5 of jsonb {prompt_version, reader, image_type, is_automotive, confidence, description, v2}. Not unique: a reading can return to an image later, and two images can carry the same classification. NULL only for basis pre_ledger.';
comment on column public.photo_classifier_landings.prompt_version is 'classification.v2.prompt_version, else classifier_receipt.prompt_version, else ''legacy''. For basis pre_ledger: the distinct versions found on the landed rows, comma separated.';
comment on column public.photo_classifier_landings.reader is 'classification.classifier_receipt.model: the provider model or the subscription reader that produced the reading.';
comment on column public.photo_classifier_landings.basis is
  'landed: this fold wrote the rows from this reading. adopted: rows landed before the ledger existed and none differed from this reading, so they were recorded as it without being rewritten. pre_ledger: rows landed before the ledger existed that differed from the reading present at their first run afterwards; identity unknown, recorded so their before-images have a reading to point at, always superseded.';
comment on column public.photo_classifier_landings.vehicle_id is 'The vehicle the rows were landed under when this row was written (NULL when the photo was unfiled or gate-rejected then). Not refreshed; claims_vehicle_id is.';
comment on column public.photo_classifier_landings.yields is 'What the reading produces for the landed tables: {fields, text_lines, description, angle}. For pre_ledger: the rows that were found.';
comment on column public.photo_classifier_landings.landed_at is 'Event time: when this reading''s rows were landed. For adopted / pre_ledger: the earliest created_at of the rows found (best evidence), else the recording time.';
comment on column public.photo_classifier_landings.recorded_at is 'Ingest time: when this ledger row was written.';
comment on column public.photo_classifier_landings.supersedes is 'The landing this one replaced (NULL for the first reading of an image).';
comment on column public.photo_classifier_landings.superseded_at is 'When a different reading took the image. NULL = current.';
comment on column public.photo_classifier_landings.claims_vehicle_id is
  'The vehicle the claimed_* columns are about: the vehicle the photo was filed under, and not gate-rejected, at the latest run of the fold for this reading. NULL = the reading asserted nothing about any vehicle at that run. A photo unfiled or moved without a run of the fold keeps the old value; photo_land_outstanding() therefore also checks vehicle_images.';
comment on column public.photo_classifier_landings.claimed_field_evidence is
  'field_evidence.id of every proposal this reading asserts for claims_vehicle_id: the rows it inserted and the rows that were already there with the same field and value (another photo, or an earlier reading, proposed them first). Rewritten at every run of the fold while the row is current; frozen once superseded.';
comment on column public.photo_classifier_landings.claimed_identifiers is
  'The plate-code identifier claims this reading hands to land_identifier_claims() for claims_vehicle_id, as [{kind, value}]. Recorded whether or not the hand-off went through.';
comment on column public.photo_classifier_landings.claimed_vin is
  'The VIN this reading reads (classification.v2.vin.value, A-Z0-9 only), when the photo is filed. The fold lands no VIN claim itself; photo-pipeline-orchestrator does, after the fold, and those claims are judged against this value.';
comment on column public.photo_classifier_landings.claims_refreshed_at is 'When the claims_* / claimed_* columns last changed (not every run: a run that finds them unchanged writes nothing).';

-- ------------------------------------------------------------------------------------------------ before-images
-- One generic table, not one per landed table: to_jsonb(row) keeps every column production has, including any added
-- later; a typed copy would drop or break on those. Restore of a row is
-- jsonb_populate_record(NULL::public.<source_table>, row_data).
create table if not exists public.photo_land_superseded_rows (
  id                       bigint generated always as identity primary key,
  image_id                 uuid not null,
  landing_id               bigint not null references public.photo_classifier_landings(id),
  superseded_by_landing_id bigint not null references public.photo_classifier_landings(id),
  prior_reading            text,
  superseding_reading      text not null,
  superseded_at            timestamptz not null default now(),
  source_table             text not null check (source_table in ('photo_extracted_fields', 'photo_text_lines', 'image_descriptions',
                                                                 'field_evidence', 'vehicle_identifiers')),
  row_id                   uuid not null,
  row_key                  text,
  disposition              text not null check (disposition in ('replaced', 'removed', 'claim')),
  row_data                 jsonb not null,
  constraint photo_land_superseded_rows_claim_kind check ((source_table in ('field_evidence', 'vehicle_identifiers')) = (disposition = 'claim')),
  constraint photo_land_superseded_rows_once unique (superseded_by_landing_id, source_table, row_id)
);
create index if not exists photo_land_superseded_rows_image on public.photo_land_superseded_rows (image_id, superseded_at desc);
create index if not exists photo_land_superseded_rows_row on public.photo_land_superseded_rows (source_table, row_id);
comment on table public.photo_land_superseded_rows is
  'Append-only history kept by photo_land_classification() when a different classifier reading takes an image. For photo_extracted_fields, photo_text_lines and image_descriptions: every row the prior reading had landed, whole, as it was (row_data = to_jsonb(row)), with disposition replaced (the live row with this id now carries the new reading) or removed (the new reading has no such key; the live row is gone). Restore one with jsonb_populate_record(NULL::public.<source_table>, row_data). For field_evidence and vehicle_identifiers (disposition claim): a copy, as it stood then, of each claim row this image''s earlier readings had left standing; the live claim row is not touched, and whether it is still outstanding is decided at query time by photo_land_outstanding(). image_angle_observations never appears here: the fold only inserts into it. UPDATE, DELETE and TRUNCATE are refused by trigger.';
comment on column public.photo_land_superseded_rows.landing_id is 'The landing (photo_classifier_landings.id) whose row this was.';
comment on column public.photo_land_superseded_rows.superseded_by_landing_id is 'The landing that superseded it.';
comment on column public.photo_land_superseded_rows.prior_reading is 'reading_id of the prior landing; NULL when the row was landed before the ledger existed (basis pre_ledger).';
comment on column public.photo_land_superseded_rows.superseding_reading is 'reading_id of the superseding landing.';
comment on column public.photo_land_superseded_rows.superseded_at is 'Event and ingest time of the supersession (one clock: the fold copies and replaces in one transaction).';
comment on column public.photo_land_superseded_rows.row_id is 'id of the row in source_table. A replaced row still exists there under this id; a removed row does not; a claim row is untouched.';
comment on column public.photo_land_superseded_rows.row_key is 'The row''s key inside the image: field_name, line_idx or description_type; for claims field_name=proposed_value or kind=value.';

-- ------------------------------------------------------------------------------------------------ failure trace
create table if not exists public.photo_land_failures (
  id                 bigint generated always as identity primary key,
  image_id           uuid not null,
  stage              text not null check (stage in ('landing', 'identifiers', 'trigger')),
  step               text,
  sqlstate           text not null,
  message            text not null,
  context            text,
  reading_id         text,
  include_classifier boolean,
  occurrences        integer not null default 1 check (occurrences >= 1),
  first_failed_at    timestamptz not null default clock_timestamp(),
  last_failed_at     timestamptz not null default clock_timestamp(),
  retries            integer not null default 0 check (retries >= 0),
  last_retry_at      timestamptz,
  resolved_at        timestamptz
);
create unique index if not exists photo_land_failures_open on public.photo_land_failures (image_id, stage, sqlstate) where resolved_at is null;
create index if not exists photo_land_failures_image on public.photo_land_failures (image_id, last_failed_at desc);
create index if not exists photo_land_failures_recent on public.photo_land_failures (last_failed_at desc);
comment on table public.photo_land_failures is
  'Photo landings that failed, so that a reading stored on vehicle_images but not landed can be found and landed again. The fold catches its own exceptions (the vehicle_images UPDATE that fired it never fails); this is where the failure goes instead of being discarded. stage landing: the whole landing rolled back. stage identifiers: the plate-code hand-off to land_identifier_claims() failed and the rest landed. stage trigger: photo_land_trigger() failed before or outside the fold. At most one OPEN row per (image_id, stage, sqlstate): a repeat raises occurrences and last_failed_at and overwrites step, message and context with the latest. resolved_at is stamped by the next run of the fold for the image that goes through. Open failures: WHERE resolved_at IS NULL. photo_land_retry_failures() runs them again; nothing schedules it.';
comment on column public.photo_land_failures.step is 'Where it stopped (the step label the fold had reached; ''call fold'' for stage trigger).';
comment on column public.photo_land_failures.reading_id is 'The reading being landed at the latest occurrence, when it could be identified.';
comment on column public.photo_land_failures.include_classifier is 'Whether a run that lands the classifier is needed to clear it: true, or NULL when unknown (stage trigger); false = a deep-result-only run failed and one such run can clear it.';
comment on column public.photo_land_failures.occurrences is 'How many times this open failure was seen (trigger runs, hand calls and retries alike).';
comment on column public.photo_land_failures.first_failed_at is 'Event time of the first occurrence (clock time, not transaction start).';
comment on column public.photo_land_failures.last_failed_at is 'Event time of the latest occurrence.';
comment on column public.photo_land_failures.retries is 'How many times photo_land_retry_failures() ran the fold for this open failure, whatever came of it. It stops picking a row at its p_max_retries.';
comment on column public.photo_land_failures.last_retry_at is 'When photo_land_retry_failures() last ran the fold for it.';

-- ------------------------------------------------------------------------------------------------ append-only guard
create or replace function public.photo_land_history_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $history_guard$
declare
  c_claims constant text[] := array['claims_vehicle_id', 'claimed_field_evidence', 'claimed_identifiers', 'claimed_vin', 'claims_refreshed_at'];
begin
  if tg_op = 'UPDATE' and tg_table_name = 'photo_classifier_landings' then
    if old.superseded_at is null then
      -- the supersession stamp, once, with the time of the transaction that supersedes (no back- or forward-dating)
      if new.superseded_at = now() and (to_jsonb(new) - 'superseded_at') = (to_jsonb(old) - 'superseded_at') then
        return new;
      end if;
      -- what the current reading asserts, rewritten while it is current
      if new.superseded_at is null and (to_jsonb(new) - c_claims) = (to_jsonb(old) - c_claims) then
        return new;
      end if;
    end if;
  end if;
  raise exception '% is append-only: % refused', tg_table_name, tg_op using errcode = '23001';
end $history_guard$;

drop trigger if exists photo_classifier_landings_append_only on public.photo_classifier_landings;
create trigger photo_classifier_landings_append_only before update or delete on public.photo_classifier_landings
  for each row execute function public.photo_land_history_guard();
drop trigger if exists photo_classifier_landings_no_truncate on public.photo_classifier_landings;
create trigger photo_classifier_landings_no_truncate before truncate on public.photo_classifier_landings
  for each statement execute function public.photo_land_history_guard();
drop trigger if exists photo_land_superseded_rows_append_only on public.photo_land_superseded_rows;
create trigger photo_land_superseded_rows_append_only before update or delete on public.photo_land_superseded_rows
  for each row execute function public.photo_land_history_guard();
drop trigger if exists photo_land_superseded_rows_no_truncate on public.photo_land_superseded_rows;
create trigger photo_land_superseded_rows_no_truncate before truncate on public.photo_land_superseded_rows
  for each statement execute function public.photo_land_history_guard();
alter table public.photo_classifier_landings enable always trigger photo_classifier_landings_append_only;
alter table public.photo_classifier_landings enable always trigger photo_classifier_landings_no_truncate;
alter table public.photo_land_superseded_rows enable always trigger photo_land_superseded_rows_append_only;
alter table public.photo_land_superseded_rows enable always trigger photo_land_superseded_rows_no_truncate;

-- ------------------------------------------------------------------------------------------------ grants on tables
alter table public.photo_classifier_landings enable row level security;
alter table public.photo_land_superseded_rows enable row level security;
alter table public.photo_land_failures enable row level security;
-- Default privileges in production give anon, authenticated and service_role ALL on new tables: take it back, then
-- grant reads to the service role only. No policy: the definer functions below are the only writers.
revoke all on public.photo_classifier_landings, public.photo_land_superseded_rows, public.photo_land_failures from public, anon, authenticated, service_role;
revoke all on sequence public.photo_classifier_landings_id_seq, public.photo_land_superseded_rows_id_seq, public.photo_land_failures_id_seq from public, anon, authenticated, service_role;
grant select on public.photo_classifier_landings, public.photo_land_superseded_rows, public.photo_land_failures to service_role;

-- ------------------------------------------------------------------------------------------------ reading identity
create or replace function public.photo_classifier_reading_id(p_classification jsonb)
returns text language sql stable set search_path = public, pg_temp as $reading_id$
  select case when jsonb_typeof(p_classification) = 'object' and p_classification->>'image_type' is not null then
    md5(jsonb_build_object(
      'prompt_version', coalesce(case when jsonb_typeof(p_classification->'v2') = 'object' then p_classification#>>'{v2,prompt_version}' end,
                                 p_classification#>>'{classifier_receipt,prompt_version}', 'legacy'),
      'reader', p_classification#>>'{classifier_receipt,model}',
      'image_type', p_classification->'image_type',
      'is_automotive', p_classification->'is_automotive',
      'confidence', p_classification->'confidence',
      'description', p_classification->'description',
      'v2', p_classification->'v2')::text)
  end
$reading_id$;
comment on function public.photo_classifier_reading_id(jsonb) is
  'Identity of one classifier reading, from vehicle_images.ai_scan_metadata -> ''classification'': md5 of the text of jsonb {prompt_version, reader (classifier_receipt.model), image_type, is_automotive, confidence, description, v2}. NULL when the value is not a classification the fold lands (not an object, or no image_type). photo_land_classification() stores it as photo_classifier_landings.reading_id; a photo whose stored classification gives another value than its current landing row has a reading that is not landed. It is the md5 of text, so the same numbers written differently (0.93, 0.930) are different readings.';

-- ------------------------------------------------------------------------------------------------ failure recorder
create or replace function public.photo_land_note_failure(
  p_image_id uuid, p_stage text, p_step text, p_sqlstate text, p_message text, p_context text, p_reading_id text, p_include_classifier boolean)
returns void language sql security definer set search_path = public, pg_temp as $note$
  insert into public.photo_land_failures as f (image_id, stage, step, sqlstate, message, context, reading_id, include_classifier)
  values (p_image_id, p_stage, p_step, coalesce(p_sqlstate, 'XX000'), left(coalesce(p_message, ''), 2000), left(p_context, 4000), p_reading_id, p_include_classifier)
  on conflict (image_id, stage, sqlstate) where resolved_at is null
  do update set occurrences = f.occurrences + 1, last_failed_at = clock_timestamp(),
                step = excluded.step, message = excluded.message, context = excluded.context, reading_id = excluded.reading_id,
                include_classifier = case when f.include_classifier is true or excluded.include_classifier is true then true
                                          when f.include_classifier is null or excluded.include_classifier is null then null
                                          else false end
$note$;
comment on function public.photo_land_note_failure(uuid, text, text, text, text, text, text, boolean) is
  'Records one failed photo landing in photo_land_failures: a new open row, or one more occurrence on the open row of the same image, stage and SQLSTATE. Called only from the exception handlers of photo_land_classification() and photo_land_trigger().';

-- ------------------------------------------------------------------------------------------------ the fold
-- Started from the live body (20261109213000, lines 20-166). Unchanged: the vehicle rule, prompt version, confidence
-- and description; every row-shaping expression; the field_evidence admission rules; the plate-code identifier
-- hand-off; the angle mapping; the camera position; the include-classifier flag; one progress row per image.
-- Changed: the image row is locked by the first read; the rows of a reading are shaped once (into jsonb) and then
-- written, so one list serves the comparison, the replace and the insert; the supersession steps; angle rows are only
-- ever inserted; the claims the reading asserts are recorded on its ledger row; the failure trace.
create or replace function public.photo_land_classification(p_image_id uuid, p_include_classifier boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  vi record; cls jsonb; x jsonb; pv text; conf numeric; descr text; vid uuid;
  n_desc int := 0; n_f int := 0; n_t int := 0; n_fe int := 0; n_ang int := 0; n_cam int := 0; rc int;
  ang_key text; ang_id uuid; pose jsonb; byok jsonb; dist numeric; az numeric; el numeric; res jsonb; dq text; pl jsonb;
  -- reading supersession
  v_key text; v_reader text; v_cur_id bigint; v_cur_key text; v_cur_vid uuid; v_cur_claim_vid uuid; v_cur_fe uuid[];
  v_prior_id bigint; v_prior_key text; v_new_id bigint;
  v_landing text; v_land boolean := false; v_supersede boolean := false; v_was_landed boolean := false; v_n_sup int := 0;
  v_nf jsonb; v_nl jsonb; v_nfe jsonb; v_desc_ev jsonb; v_ang_ev jsonb; v_ang_cf numeric; v_ang_last record; v_ang_same boolean;
  v_keep_desc uuid; v_vids uuid[]; v_prior_fe uuid[]; v_vin text;
  v_claim_fe uuid[] := '{}'; v_claim_ids jsonb := '[]'::jsonb; v_claim_vin text;
  -- failure trace
  v_step text := 'read image'; v_failed text[] := '{}'; v_state text; v_msg text; v_ctx text;
begin
  -- The first read locks the photo row. One landing at a time per image, and the same lock, taken first, that
  -- land_identifier_claims() takes (FOR UPDATE) further down: photo row before everything else, so a hand call or a
  -- drain cannot deadlock against an UPDATE of the photo. A trigger run already holds this lock through its UPDATE.
  -- A run that waits past lock_timeout is recorded as a failure and can be run again.
  select v.id, v.user_id, v.vehicle_id, v.vision_gate_status::text as gate, v.ai_scan_metadata as md
    into vi from public.vehicle_images v where v.id = p_image_id and v.ai_processing_status = 'completed'
    for no key update;
  if not found then return jsonb_build_object('skipped', 'not_completed'); end if;
  vid := case when vi.vehicle_id is not null and coalesce(vi.gate, '') not like 'rejected%' then vi.vehicle_id end;
  cls := vi.md->'classification';
  if p_include_classifier and cls is not null and jsonb_typeof(cls) = 'object' and cls->>'image_type' is not null then
    v_step := 'shape reading';
    -- Reading identity: who read (reader), under which contract (prompt version), and what they said (the parts of the
    -- classification this fold lands). Not the prompt version alone. Taken first, so a reading that cannot be shaped
    -- is still named in its failure row.
    v_key := public.photo_classifier_reading_id(cls);
    x := case when jsonb_typeof(cls->'v2') = 'object' then cls->'v2' else '{}'::jsonb end;
    pv := coalesce(x->>'prompt_version', cls#>>'{classifier_receipt,prompt_version}', 'legacy');
    conf := least(greatest(coalesce(nullif(cls->>'confidence','')::numeric, 0), 0), 1);
    descr := nullif(btrim(coalesce(cls->>'description', '')), '');
    v_reader := cls#>>'{classifier_receipt,model}';

    -- The rows this reading lands, shaped once. Same expressions as before; the reader's own fields (and vin) take a
    -- field name ahead of the core.* / doc.* rows, as the two former INSERTs did.
    select coalesce(jsonb_agg(jsonb_build_object('fn', r.fn, 'val', r.val, 'qt', r.qt, 'cf', r.cf, 'meta', r.meta)), '[]'::jsonb) into v_nf
    from (
      select distinct on (u.fn) u.fn, u.val, u.qt, u.cf, u.meta
      from (
        select s.fn, s.val, s.qt, s.cf, s.meta, 0 as ord
        from (
          select e->>'field_name' fn, nullif(btrim(e->>'value'), '') val, nullif(e->>'evidence','') qt,
                 least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf, jsonb_build_object('photo_id', p_image_id) meta
            from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
          union all
          select 'vin', nullif(btrim(x#>>'{vin,value}'), ''), nullif(x#>>'{vin,evidence}',''),
                 least(greatest(nullif(x#>>'{vin,confidence}','')::numeric, 0), 1),
                 jsonb_build_object('photo_id', p_image_id, 'checksum_ok', x#>'{vin,checksum_ok}')
            where jsonb_typeof(x->'vin') = 'object'
        ) s where s.fn is not null and s.val is not null
        union all
        select c.fn, c.val, c.qt, c.cf, jsonb_build_object('photo_id', p_image_id), 1
        from (values
          ('core.image_type', cls->>'image_type', left(descr, 300), conf),
          ('core.is_automotive', cls->>'is_automotive', left(descr, 300), conf),
          ('core.classifier_confidence', cls->>'confidence', null, conf),
          ('core.description', descr, descr, conf),
          ('doc.type', nullif(x->>'document_type', ''), left(descr, 300), conf),
          ('doc.kind', nullif(x->>'document_kind', ''), left(descr, 300), conf)
        ) c(fn, val, qt, cf) where c.val is not null
      ) u
      order by u.fn, u.ord, u.cf desc nulls last
    ) r;

    select coalesce(jsonb_agg(jsonb_build_object('idx', l.idx, 'txt', l.txt, 'cf', l.cf)
                              || case when l.has_region then jsonb_build_object('region', l.region) else '{}'::jsonb end), '[]'::jsonb) into v_nl
    from (
      select (t.ord - 1)::int idx, btrim(t.e->>'text') txt, t.e ? 'region' has_region, t.e->'region' region,
             least(greatest(nullif(t.e->>'confidence','')::numeric, 0), 1) cf
      from jsonb_array_elements(case when jsonb_typeof(x->'text_lines') = 'array' then x->'text_lines' else '[]'::jsonb end) with ordinality t(e, ord)
      where nullif(btrim(coalesce(t.e->>'text', '')), '') is not null
    ) l;

    v_desc_ev := jsonb_build_object('photo_id', p_image_id, 'image_type', cls->>'image_type', 'is_automotive', cls->'is_automotive', 'model', cls#>>'{classifier_receipt,model}');
    ang_key := case x#>>'{angle,value}'
      when 'exterior_front' then 'exterior.front.center'
      when 'exterior_rear' then 'exterior.rear.center'
      when 'interior_dashboard' then 'interior.dash.full'
      when 'engine_bay' then 'engine.bay'
      when 'undercarriage' then 'undercarriage.general'
      when 'detail_shot' then 'detail.general'
      else null end;
    if ang_key is not null then
      select a.angle_id into ang_id from public.angle_taxonomy a where a.canonical_key = ang_key and a.deprecated_at is null limit 1;
    end if;
    v_ang_cf := least(greatest(coalesce(nullif(x#>>'{angle,confidence}','')::numeric, conf), 0), 1);
    v_ang_ev := jsonb_build_object('photo_id', p_image_id, 'classifier_angle', x#>>'{angle,value}', 'quote', left(descr, 300));
    v_vin := regexp_replace(upper(coalesce(x#>>'{vin,value}', '')), '[^A-Z0-9]', '', 'g');

    -- Which reading is landed for this image now? (image_angle_observations takes no part in this: it is only ever
    -- appended to, so it never makes the three projection tables stale.)
    v_step := 'identify reading';
    select l.id, l.reading_id, l.vehicle_id, l.claims_vehicle_id, l.claimed_field_evidence
      into v_cur_id, v_cur_key, v_cur_vid, v_cur_claim_vid, v_cur_fe
      from public.photo_classifier_landings l where l.image_id = p_image_id and l.superseded_at is null;
    if v_cur_id is null then
      v_was_landed :=
           exists (select 1 from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2')
        or exists (select 1 from public.photo_text_lines t where t.image_id = p_image_id and t.source = 'classifier_v2')
        or exists (select 1 from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2');
    end if;

    if v_cur_id is not null and v_cur_key = v_key then
      -- the same reading again (filing change, drain, hand call, retry): fill what is absent, change nothing that is there
      v_landing := 'unchanged'; v_land := true;
    elsif coalesce(cls->>'classifier_ok', '') = 'false' and (v_cur_id is not null or v_was_landed) then
      -- a failed stand-in is not a reading; it never displaces one
      v_landing := 'held_not_a_reading';
    elsif v_cur_id is not null then
      v_landing := 'superseded'; v_land := true; v_supersede := true; v_prior_id := v_cur_id; v_prior_key := v_cur_key;
    elsif not v_was_landed then
      v_landing := 'first'; v_land := true;
    elsif not exists (
            select 1 from public.photo_extracted_fields f
            where f.image_id = p_image_id and f.source = 'classifier_v2'
              and not exists (select 1 from jsonb_array_elements(v_nf) e
                              where e->>'fn' = f.field_name and e->>'val' = f.value and (e->>'qt') is not distinct from f.quote
                                and coalesce(abs((e->>'cf')::numeric - f.confidence) <= 0.005, (e->>'cf') is null and f.confidence is null)
                                and f.prompt_version is not distinct from pv and e->'meta' = f.meta))
      and not exists (
            select 1 from public.photo_text_lines t
            where t.image_id = p_image_id and t.source = 'classifier_v2'
              and not exists (select 1 from jsonb_array_elements(v_nl) e
                              where (e->>'idx')::int = t.line_idx and e->>'txt' = t.text
                                and (case when e ? 'region' then e->'region' end) is not distinct from t.region
                                and coalesce(abs((e->>'cf')::numeric - t.confidence) <= 0.005, (e->>'cf') is null and t.confidence is null)
                                and t.prompt_version is not distinct from pv))
      and not exists (
            select 1 from public.image_descriptions d
            where d.image_id = p_image_id and d.description_type = 'classifier_v2'
              and not (descr is not null and d.description = descr and d.source_version is not distinct from pv
                       and coalesce(abs(d.confidence - conf) <= 0.005, false) and d.evidence is not distinct from v_desc_ev)) then
      -- rows landed before the ledger existed, and none of them differs from this reading: they are this reading.
      -- (Confidence is compared within 0.005: production's confidence columns are numeric without a scale, but a value
      -- an older body rounded to two decimals is still the same reading. Every other compared column is exact.)
      v_landing := 'adopted'; v_land := true;
    else
      -- rows landed before the ledger existed that are not this reading: one prior reading of unknown identity
      v_landing := 'superseded'; v_land := true; v_supersede := true;
    end if;

    if v_land and v_landing <> 'unchanged' then
      v_step := 'record reading';
      if v_supersede and v_prior_id is null then
        insert into public.photo_classifier_landings (image_id, reading_id, prompt_version, reader, image_type, basis, vehicle_id, yields, landed_at, superseded_at)
        select p_image_id, null,
               (select string_agg(q.ver, ',' order by q.ver) from (
                  select f.prompt_version ver from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2' and f.prompt_version is not null
                  union select t.prompt_version from public.photo_text_lines t where t.image_id = p_image_id and t.source = 'classifier_v2' and t.prompt_version is not null
                  union select d.source_version from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2' and d.source_version is not null) q),
               (select d.evidence->>'model' from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2' order by d.created_at desc nulls last, d.id limit 1),
               (select f.value from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2' and f.field_name = 'core.image_type'),
               'pre_ledger',
               (select f.vehicle_id from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2' and f.vehicle_id is not null limit 1),
               jsonb_build_object(
                 'fields', (select count(*) from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2'),
                 'text_lines', (select count(*) from public.photo_text_lines t where t.image_id = p_image_id and t.source = 'classifier_v2'),
                 'descriptions', (select count(*) from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2')),
               coalesce((select min(f.created_at) from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2'), now()),
               now()
        returning id into v_prior_id;
      elsif v_supersede then
        update public.photo_classifier_landings set superseded_at = now() where id = v_prior_id;
      end if;
      insert into public.photo_classifier_landings (image_id, reading_id, prompt_version, reader, image_type, basis, vehicle_id, yields, landed_at, supersedes)
      values (p_image_id, v_key, pv, v_reader, cls->>'image_type', case when v_landing = 'adopted' then 'adopted' else 'landed' end, vid,
              jsonb_build_object('fields', jsonb_array_length(v_nf), 'text_lines', jsonb_array_length(v_nl), 'description', descr is not null, 'angle', ang_key),
              case when v_landing = 'adopted'
                   then coalesce((select min(f.created_at) from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2'), now())
                   else now() end,
              v_prior_id)
      returning id into v_new_id;
    end if;

    if v_supersede then
      -- 1. Before-image: every classifier row the prior reading had landed in the three projection tables, whole.
      v_step := 'keep before-image';
      select d.id into v_keep_desc from public.image_descriptions d
       where d.image_id = p_image_id and d.description_type = 'classifier_v2' order by d.created_at desc nulls last, d.id limit 1;
      insert into public.photo_land_superseded_rows
        (image_id, landing_id, superseded_by_landing_id, prior_reading, superseding_reading, source_table, row_id, row_key, disposition, row_data)
      select p_image_id, v_prior_id, v_new_id, v_prior_key, v_key, 'photo_extracted_fields', f.id, f.field_name,
             case when exists (select 1 from jsonb_array_elements(v_nf) e where e->>'fn' = f.field_name) then 'replaced' else 'removed' end, to_jsonb(f)
        from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2'
      union all
      select p_image_id, v_prior_id, v_new_id, v_prior_key, v_key, 'photo_text_lines', t.id, t.line_idx::text,
             case when exists (select 1 from jsonb_array_elements(v_nl) e where (e->>'idx')::int = t.line_idx) then 'replaced' else 'removed' end, to_jsonb(t)
        from public.photo_text_lines t where t.image_id = p_image_id and t.source = 'classifier_v2'
      union all
      select p_image_id, v_prior_id, v_new_id, v_prior_key, v_key, 'image_descriptions', d.id, d.description_type,
             case when descr is not null and d.id = v_keep_desc then 'replaced' else 'removed' end, to_jsonb(d)
        from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2';
      get diagnostics v_n_sup = row_count;

      -- 2. The vehicle-level claims this image's earlier readings left standing, copied as they stand now. Nothing is
      --    decided here: photo_land_outstanding() tells, when asked, which of them no current reading asserts any more.
      --    They are the prior landing's own (by id), and the rows that cite this image: this fold's, and the ones
      --    photo-pipeline-orchestrator derives from the same reading (landCitedEvidence).
      v_step := 'copy prior claims';
      select array_agg(distinct u.v) into v_vids
        from (select vi.vehicle_id v union all select v_cur_vid union all select v_cur_claim_vid
              union all select f.vehicle_id from public.photo_extracted_fields f where f.image_id = p_image_id and f.source = 'classifier_v2'
              union all select o.vehicle_id from public.image_angle_observations o where o.image_id = p_image_id and o.source = 'classifier_v2') u
       where u.v is not null;
      select array_agg(distinct q.id) into v_prior_fe
        from (select fe.id from public.field_evidence fe
               where fe.vehicle_id = any (v_vids) and fe.source_type = 'ai_visual'
                 and fe.raw_extraction_data->>'image_id' = p_image_id::text
                 and (fe.raw_extraction_data->>'extractor' = 'photo_land_classification'
                      or fe.raw_extraction_data->>'extractor' like 'photo-pipeline-orchestrator%')
              union all
              select u.id from unnest(v_cur_fe) u(id)) q;
      insert into public.photo_land_superseded_rows
        (image_id, landing_id, superseded_by_landing_id, prior_reading, superseding_reading, source_table, row_id, row_key, disposition, row_data)
      select p_image_id, v_prior_id, v_new_id, v_prior_key, v_key, 'field_evidence', fe.id, fe.field_name || '=' || fe.proposed_value, 'claim', to_jsonb(fe)
        from public.field_evidence fe where fe.id = any (v_prior_fe)
      union all
      select p_image_id, v_prior_id, v_new_id, v_prior_key, v_key, 'vehicle_identifiers', i.id, i.kind || '=' || coalesce(i.value, ''), 'claim', to_jsonb(i)
        from public.vehicle_identifiers i
       where i.vehicle_id = any (v_vids) and i.source_image_id = p_image_id
         and (i.extractor = 'photo_land_classification' or i.extractor like 'photo-pipeline-orchestrator%');

      -- 3. Keys the new reading no longer has leave the current tables; keys it still has are rewritten in place
      --    (same row id), stamped with the new reading's landing time. image_angle_observations is not touched.
      v_step := 'replace landed rows';
      delete from public.photo_extracted_fields f
       where f.image_id = p_image_id and f.source = 'classifier_v2'
         and not exists (select 1 from jsonb_array_elements(v_nf) e where e->>'fn' = f.field_name);
      update public.photo_extracted_fields f
         set value = e->>'val', quote = e->>'qt', confidence = (e->>'cf')::numeric, prompt_version = pv, meta = e->'meta',
             vehicle_id = vid, user_id = vi.user_id, created_at = now()
        from jsonb_array_elements(v_nf) e
       where f.image_id = p_image_id and f.source = 'classifier_v2' and f.field_name = e->>'fn';
      get diagnostics rc = row_count; n_f := n_f + rc;

      delete from public.photo_text_lines t
       where t.image_id = p_image_id and t.source = 'classifier_v2'
         and not exists (select 1 from jsonb_array_elements(v_nl) e where (e->>'idx')::int = t.line_idx);
      update public.photo_text_lines t
         set text = e->>'txt', region = case when e ? 'region' then e->'region' end, confidence = (e->>'cf')::numeric,
             prompt_version = pv, vehicle_id = vid, user_id = vi.user_id, created_at = now()
        from jsonb_array_elements(v_nl) e
       where t.image_id = p_image_id and t.source = 'classifier_v2' and t.line_idx = (e->>'idx')::int;
      get diagnostics rc = row_count; n_t := n_t + rc;

      delete from public.image_descriptions d
       where d.image_id = p_image_id and d.description_type = 'classifier_v2' and (descr is null or d.id <> v_keep_desc);
      if descr is not null and v_keep_desc is not null then
        update public.image_descriptions d
           set vehicle_id = vid, description = descr, source = 'photo-pipeline-classifier', source_version = pv, confidence = conf,
               evidence = v_desc_ev, created_at = now()
         where d.id = v_keep_desc;
        n_desc := 1;
      end if;
    end if;

    if v_land then
      -- 4. Land what is absent (the whole reading on a first landing; nothing on a repeat).
      v_step := 'land description';
      if descr is not null and not exists (select 1 from public.image_descriptions d where d.image_id = p_image_id and d.description_type = 'classifier_v2') then
        insert into public.image_descriptions(image_id, vehicle_id, description, description_type, source, source_version, confidence, evidence)
        values (p_image_id, vid, descr, 'classifier_v2', 'photo-pipeline-classifier', pv, conf, v_desc_ev);
        n_desc := 1;
      end if;

      v_step := 'land fields';
      insert into public.photo_extracted_fields(image_id, user_id, vehicle_id, field_name, value, quote, confidence, source, prompt_version, meta)
      select p_image_id, vi.user_id, vid, e->>'fn', e->>'val', e->>'qt', (e->>'cf')::numeric, 'classifier_v2', pv, e->'meta'
        from jsonb_array_elements(v_nf) e
      on conflict do nothing;
      get diagnostics rc = row_count; n_f := n_f + rc;

      v_step := 'land text lines';
      insert into public.photo_text_lines(image_id, user_id, vehicle_id, line_idx, text, region, confidence, source, prompt_version)
      select p_image_id, vi.user_id, vid, (e->>'idx')::int, e->>'txt', case when e ? 'region' then e->'region' end,
             (e->>'cf')::numeric, 'classifier_v2', pv
        from jsonb_array_elements(v_nl) e
      on conflict do nothing;
      get diagnostics rc = row_count; n_t := n_t + rc;

      if vid is not null then
        v_step := 'land field evidence';
        select coalesce(jsonb_agg(jsonb_build_object('fn', s.fn, 'val', s.val, 'qt', s.qt, 'cf', s.cf)), '[]'::jsonb) into v_nfe
        from (
          select distinct on (fn, val) e->>'field_name' fn, btrim(e->>'value') val, e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
            from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e
           order by fn, val
        ) s
        where s.cf >= 0.6 and nullif(s.qt, '') is not null and nullif(s.val, '') is not null and s.fn is not null
          -- plate stamping codes are identifiers, not attributes; other-vehicle / non-body readings are not evidence about this car
          and not exists (select 1 from public.photo_plate_code_kind(s.qt))
          and public.photo_field_not_about_vehicle(s.fn, s.val, s.qt, descr) is null;
        insert into public.field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, extraction_context, raw_extraction_data)
        select vid, e->>'fn', e->>'val', 'ai_visual', round((e->>'cf')::numeric * 100)::int, left('photo-pipeline landing v1: ' || (e->>'qt'), 400),
               jsonb_build_object('photo_id', p_image_id, 'image_id', p_image_id, 'quote', e->>'qt', 'confidence', (e->>'cf')::numeric,
                                  'extractor', 'photo_land_classification', 'prompt_version', pv, 'reading_id', v_key)
          from jsonb_array_elements(v_nfe) e
        on conflict (vehicle_id, field_name, source_type, proposed_value) do nothing;
        get diagnostics rc = row_count; n_fe := rc;
        -- what this reading asserts: the proposals it just made and the ones that were already there
        select coalesce(array_agg(fe.id order by fe.id), '{}') into v_claim_fe
          from jsonb_array_elements(v_nfe) e
          join public.field_evidence fe
            on fe.vehicle_id = vid and fe.field_name = e->>'fn' and fe.source_type = 'ai_visual' and fe.proposed_value = e->>'val';

        v_step := 'land identifiers';
        begin
          select jsonb_agg(jsonb_build_object('kind', k.kind, 'value', k.code, 'quote', left(k.qt, 400), 'confidence', k.cf)) into pl
          from (select distinct on (pk.kind, pk.code) pk.kind, pk.code, s2.qt, s2.cf
                  from (select e->>'evidence' qt, least(greatest(nullif(e->>'confidence','')::numeric, 0), 1) cf
                          from jsonb_array_elements(case when jsonb_typeof(x->'vehicle_fields') = 'array' then x->'vehicle_fields' else '[]'::jsonb end) e) s2
                  cross join lateral public.photo_plate_code_kind(s2.qt) pk
                 where s2.cf >= 0.6
                 order by pk.kind, pk.code) k;
          if pl is not null then
            perform public.land_identifier_claims(vid, jsonb_build_object('identifiers', pl), null, 'photo_land_classification', 'photo', p_image_id, null);
            update public.vehicle_identifiers set evidence_class = 'plate_stamping'
             where vehicle_id = vid and source_image_id = p_image_id and kind like 'plate\_%' and evidence_class is null;
          end if;
        exception when others then
          -- as before, an identifier failure does not stop the landing; it now leaves a trace
          get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_ctx = pg_exception_context;
          v_failed := v_failed || 'identifiers'::text;
          begin
            perform public.photo_land_note_failure(p_image_id, 'identifiers', v_step, v_state, v_msg, v_ctx, v_key, p_include_classifier);
          exception when others then
            raise warning 'photo_land_classification: identifier failure for % not recorded (%): %', p_image_id, sqlerrm, v_msg;
          end;
        end;
        select coalesce(jsonb_agg(jsonb_build_object('kind', e->>'kind', 'value', e->>'value') order by e->>'kind', e->>'value'), '[]'::jsonb)
          into v_claim_ids from jsonb_array_elements(coalesce(pl, '[]'::jsonb)) e;
        v_claim_vin := nullif(v_vin, '');

        -- The angle is testimony: never updated, never deleted. A reading with a mappable angle adds a row unless the
        -- newest classifier row of the image already says so for this reading (its stamp, or, for a row written before
        -- readings were stamped, the very row this reading lands). observed_at is the clock, not the transaction start:
        -- landings of one image are serialised by the photo row lock, so the clock orders them as they happened even
        -- when a transaction that began earlier lands later, or lands two readings.
        v_step := 'land angle';
        if ang_id is not null then
          select o.angle_id, o.source_version, o.confidence, o.evidence into v_ang_last
            from public.image_angle_observations o
           where o.image_id = p_image_id and o.source = 'classifier_v2'
           order by o.observed_at desc, o.id desc limit 1;
          v_ang_same := found and v_ang_last.angle_id = ang_id
            and case when coalesce(v_ang_last.evidence ? 'reading_id', false)
                     then coalesce(v_ang_last.evidence->>'reading_id' = v_key, false)
                     else v_ang_last.source_version is not distinct from pv
                          and coalesce(abs(v_ang_last.confidence - v_ang_cf) <= 0.005, false)
                          and v_ang_last.evidence is not distinct from v_ang_ev end;
          if not v_ang_same then
            insert into public.image_angle_observations(image_id, vehicle_id, angle_id, confidence, source, source_version, evidence, observed_at)
            values (p_image_id, vid, ang_id, v_ang_cf, 'classifier_v2', pv, v_ang_ev || jsonb_build_object('reading_id', v_key), clock_timestamp());
            n_ang := 1;
          end if;
        end if;
      end if;

      -- 5. What the current reading asserts, on its ledger row. Rewritten only when it changed, so a run that changes
      --    nothing writes nothing. An unfiled or gate-rejected photo asserts nothing about any vehicle.
      v_step := 'record claims';
      update public.photo_classifier_landings l
         set claims_vehicle_id = vid, claimed_field_evidence = v_claim_fe, claimed_identifiers = v_claim_ids,
             claimed_vin = v_claim_vin, claims_refreshed_at = now()
       where l.id = coalesce(v_new_id, v_cur_id)
         and (l.claims_vehicle_id, l.claimed_field_evidence, l.claimed_identifiers, l.claimed_vin)
             is distinct from (vid, v_claim_fe, v_claim_ids, v_claim_vin);
    end if;
  end if;

  v_step := 'land camera position';
  byok := vi.md->'byok_deep_analysis';
  if byok is not null and jsonb_typeof(byok->'camera_pose') = 'object' then
    pose := byok->'camera_pose';
    az := case when (pose->>'azimuth_deg') ~ '^-?[0-9.]+$' then (pose->>'azimuth_deg')::numeric end;
    el := case when (pose->>'elevation_deg') ~ '^-?[0-9.]+$' then (pose->>'elevation_deg')::numeric end;
    dq := pose->>'distance_est';
    dist := case when dq ~* '^[~ ]*[0-9.]+ ?m$' then round((regexp_replace(dq, '[^0-9.]', '', 'g'))::numeric * 1000) end;
    if (az is not null or el is not null) then
      insert into public.image_camera_position(image_id, vehicle_id, subject_key, azimuth_deg, elevation_deg, distance_mm, confidence, source, source_version, evidence)
      values (p_image_id, vid, 'vehicle', az, el, dist,
              least(greatest(coalesce(nullif(byok->>'confidence','')::numeric, 0.5), 0), 1), 'byok_deep_analysis',
              coalesce('review:' || (byok->>'observation_id'), byok->>'prompt_version', 'unknown'),
              jsonb_strip_nulls(jsonb_build_object('photo_id', p_image_id, 'camera_pose', pose, 'run_id', byok->>'run_id',
                'observation_id', byok->>'observation_id', 'source_identifier', byok->>'source_identifier')))
      on conflict (image_id, subject_key, source, source_version) do nothing;
      get diagnostics rc = row_count; n_cam := rc;
    end if;
  end if;

  v_step := 'record progress';
  -- The six counts are the rows this run wrote (inserted or rewritten). landing / reading say what the run found:
  -- first | unchanged | adopted | superseded | held_not_a_reading, and the reading that is landed after it.
  res := jsonb_build_object('descriptions', n_desc, 'fields', n_f, 'text_lines', n_t, 'field_evidence', n_fe, 'angles', n_ang, 'camera', n_cam);
  if v_landing is not null then
    res := res || jsonb_build_object('landing', v_landing, 'reading', case when v_land then v_key else v_cur_key end, 'superseded_rows', v_n_sup);
  end if;
  insert into public.photo_land_progress(image_id, landed_at, result) values (p_image_id, now(), res)
    on conflict (image_id) do update set landed_at = now(), result = excluded.result;
  -- This run went through: close the image's open failures. Not those of a stage that failed again just now, and not
  -- a failure that needs the classifier landed when this run did not land it.
  update public.photo_land_failures f set resolved_at = clock_timestamp()
   where f.image_id = p_image_id and f.resolved_at is null
     and (p_include_classifier or f.include_classifier is false) and f.stage <> all (v_failed);
  return res;
exception when others then
  -- Everything this run wrote is rolled back (the before-images and the ledger rows with it), so the image keeps the
  -- reading it had. The failure itself is kept: the caller's UPDATE must not fail, and must not fail silently either.
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_ctx = pg_exception_context;
  begin
    perform public.photo_land_note_failure(p_image_id, 'landing', v_step, v_state, v_msg, v_ctx, v_key, p_include_classifier);
  exception when others then
    raise warning 'photo_land_classification: failure for % not recorded (%): %', p_image_id, sqlerrm, v_msg;
  end;
  return jsonb_build_object('error', v_msg, 'state', v_state, 'step', v_step);
end;
$function$;
revoke all on function public.photo_land_classification(uuid, boolean) from public, anon, authenticated;
grant execute on function public.photo_land_classification(uuid, boolean) to service_role;

-- ------------------------------------------------------------------------------------------------ the trigger function
-- Same condition and same call as the live body (20261109213000, lines 175-191). Its handler used to raise a warning
-- nobody reads; it now also records the failure, so a reading that never reached the fold can be found and landed.
create or replace function public.photo_land_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $trigger_function$
declare
  v_include boolean; v_state text; v_msg text; v_ctx text;
begin
  -- A deep-result-only update changes camera testimony, not the classifier.
  -- Keep classifier/filing transitions on the original full landing path.
  v_include := old.ai_processing_status is distinct from 'completed'
    or old.ai_scan_metadata->'classification' is distinct from new.ai_scan_metadata->'classification'
    or old.vehicle_id is distinct from new.vehicle_id
    or old.vision_gate_status is distinct from new.vision_gate_status;
  perform public.photo_land_classification(new.id, v_include);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_ctx = pg_exception_context;
  begin
    perform public.photo_land_note_failure(new.id, 'trigger', 'call fold', v_state, v_msg, v_ctx,
                                           public.photo_classifier_reading_id(new.ai_scan_metadata->'classification'), v_include);
  exception when others then
    raise warning 'photo_land_trigger: failure for % not recorded (%)', new.id, sqlerrm;
  end;
  raise warning 'photo_land_trigger failed for %: %', new.id, v_msg;
  return null;
end;
$trigger_function$;

-- ------------------------------------------------------------------------------------------------ run failures again
create or replace function public.photo_land_retry_failures(p_limit integer default 50, p_max_retries integer default 5)
returns jsonb language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '2s'
as $retry$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 0), 200);
  v_max   int := least(greatest(coalesce(p_max_retries, 5), 1), 100);
  r record; v_res jsonb; v_open int;
  n_picked int := 0; n_landed int := 0; n_failed int := 0; n_open int := 0; n_locked int := 0;
begin
  for r in
    select f.image_id
      from public.photo_land_failures f
     where f.resolved_at is null and f.retries < v_max
     group by f.image_id
     order by min(coalesce(f.last_retry_at, f.last_failed_at)), f.image_id
     limit v_limit
  loop
    n_picked := n_picked + 1;
    -- Never wait behind a writer of the photo row: leave it for the next call, untouched.
    perform 1 from public.vehicle_images v where v.id = r.image_id for no key update skip locked;
    if not found and exists (select 1 from public.vehicle_images v where v.id = r.image_id) then
      n_locked := n_locked + 1;
      continue;
    end if;
    v_res := public.photo_land_classification(r.image_id, true);
    update public.photo_land_failures f set retries = f.retries + 1, last_retry_at = clock_timestamp()
     where f.image_id = r.image_id and f.resolved_at is null;
    get diagnostics v_open = row_count;
    if v_res ? 'error' then n_failed := n_failed + 1;
    elsif v_open = 0 then n_landed := n_landed + 1;
    else n_open := n_open + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'picked', n_picked, 'landed', n_landed, 'failed_again', n_failed, 'still_open', n_open, 'skipped_locked', n_locked,
    'open_failures', (select count(*) from public.photo_land_failures f where f.resolved_at is null),
    'given_up', (select count(*) from public.photo_land_failures f where f.resolved_at is null and f.retries >= v_max));
end;
$retry$;
comment on function public.photo_land_retry_failures(integer, integer) is
  'Runs photo_land_classification(image, true) again for the photos that have open rows in photo_land_failures, longest-waiting first, at most p_limit photos (capped at 200) in one call and one transaction. Nothing schedules it: call it by hand, or from a drain that already runs. A photo whose row is locked by another session is skipped, not waited for; the photos it does run stay row-locked until the call returns, so keep p_limit small while the pipeline is writing. Every open failure of a photo it ran gets retries + 1 whatever came of it; a row that reached p_max_retries is no longer picked and needs a person. Returns {picked, landed (every failure of the photo closed), failed_again (the fold returned an error), still_open (it ran, an open failure remains: the hand-off failed again, or the photo is no longer completed or is gone), skipped_locked, open_failures, given_up}. Reads vehicle_images by primary key only.';

-- ------------------------------------------------------------------------------------------------ outstanding claims
create or replace function public.photo_land_outstanding(p_vehicle_id uuid default null, p_image_id uuid default null, p_limit integer default 200)
returns table (claim_table text, claim_id uuid, vehicle_id uuid, name text, value text, claim_status text,
               image_id uuid, superseded_at timestamptz, prior_reading text, history_id bigint)
language plpgsql stable security definer set search_path = public, pg_temp
as $outstanding$
#variable_conflict use_column
begin
  -- plpgsql, not SQL, on purpose: CREATE FUNCTION would validate a SQL body and take ACCESS SHARE on vehicle_images,
  -- field_evidence and vehicle_identifiers for the length of the deploy transaction. The guard checks the columns.
  return query
  select q.claim_table, q.claim_id, q.vehicle_id, q.name, q.value, q.claim_status, q.image_id, q.superseded_at, q.prior_reading, q.history_id
  from (
    select 'field_evidence'::text as claim_table, fe.id as claim_id, fe.vehicle_id, fe.field_name as name, fe.proposed_value as value,
           fe.status::text as claim_status, h.image_id, h.superseded_at, h.prior_reading, h.id as history_id
      from public.photo_land_superseded_rows h
      join public.field_evidence fe on fe.id = h.row_id
     where h.disposition = 'claim' and h.source_table = 'field_evidence'
       and (p_image_id is null or h.image_id = p_image_id)
       and (p_vehicle_id is null or fe.vehicle_id = p_vehicle_id)
       -- one line per claim row: its latest copy
       and not exists (select 1 from public.photo_land_superseded_rows h2
                        where h2.source_table = h.source_table and h2.row_id = h.row_id and h2.disposition = 'claim' and h2.id > h.id)
       -- no current reading of any photo still filed under the vehicle asserts it
       and not exists (select 1 from public.photo_classifier_landings c
                         join public.vehicle_images vi on vi.id = c.image_id
                        where c.superseded_at is null and c.claims_vehicle_id = fe.vehicle_id
                          and (c.claimed_field_evidence @> array[fe.id]
                               or (fe.field_name = 'vin' and c.claimed_vin = regexp_replace(upper(fe.proposed_value), '[^A-Z0-9]', '', 'g')))
                          and vi.vehicle_id = c.claims_vehicle_id and coalesce(vi.vision_gate_status::text, '') not like 'rejected%')
    union all
    select 'vehicle_identifiers', i.id, i.vehicle_id, i.kind, i.value, 'standing', h.image_id, h.superseded_at, h.prior_reading, h.id
      from public.photo_land_superseded_rows h
      join public.vehicle_identifiers i on i.id = h.row_id
     where h.disposition = 'claim' and h.source_table = 'vehicle_identifiers'
       and i.superseded_at is null
       and (p_image_id is null or h.image_id = p_image_id)
       and (p_vehicle_id is null or i.vehicle_id = p_vehicle_id)
       and not exists (select 1 from public.photo_land_superseded_rows h2
                        where h2.source_table = h.source_table and h2.row_id = h.row_id and h2.disposition = 'claim' and h2.id > h.id)
       and not exists (select 1 from public.photo_classifier_landings c
                         join public.vehicle_images vi on vi.id = c.image_id
                        where c.superseded_at is null and c.claims_vehicle_id = i.vehicle_id
                          and (c.claimed_identifiers @> jsonb_build_array(jsonb_build_object('kind', i.kind, 'value', i.value))
                               or (i.kind in ('vin', 'chassis') and c.claimed_vin = regexp_replace(upper(coalesce(i.value, '')), '[^A-Z0-9]', '', 'g')))
                          and vi.vehicle_id = c.claims_vehicle_id and coalesce(vi.vision_gate_status::text, '') not like 'rejected%')
  ) q
  order by q.history_id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$outstanding$;
comment on function public.photo_land_outstanding(uuid, uuid, integer) is
  'Vehicle-level claims (field_evidence proposals, vehicle_identifiers rows) that a superseded classifier reading of a photo left standing and that NO current reading asserts any more. Decided when asked, never stored: a claim is listed while its row still exists (an identifier: not superseded) and no current row of photo_classifier_landings, for any photo still filed under that vehicle and not gate-rejected, carries it (claimed_field_evidence holds the proposal''s id; claimed_identifiers holds the kind and value; claimed_vin equals a VIN claim). Arguments narrow it to one vehicle and / or one photo; newest supersession first, at most p_limit rows (capped at 1000). It withdraws nothing: withdrawal is a separate change. Not covered: a proposal the acceptor filed under another field name reads as outstanding; an identifier row citing one photo is not listed while another photo''s current reading asserts the same code for the vehicle. Reads vehicle_images by primary key only.';

-- ------------------------------------------------------------------------------------------------ grants on functions
-- Default privileges give anon, authenticated and service_role EXECUTE on new functions.
revoke all on function public.photo_land_note_failure(uuid, text, text, text, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.photo_land_history_guard() from public, anon, authenticated, service_role;
revoke all on function public.photo_classifier_reading_id(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.photo_land_retry_failures(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.photo_land_outstanding(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.photo_classifier_reading_id(jsonb) to service_role;
grant execute on function public.photo_land_retry_failures(integer, integer) to service_role;
grant execute on function public.photo_land_outstanding(uuid, uuid, integer) to service_role;

-- ------------------------------------------------------------------------------------------------ comments on the owners
-- The fold's comment is appended to whatever comment the function carries (none in the repo; production's was not
-- read), behind a marker, so the revert can put the previous comment back exactly.
do $fold_comment$
declare
  c_mark constant text := '[photo landing supersession 20261113150000]';
  c_text constant text := ' Lands the classifier reading in vehicle_images.ai_scan_metadata.classification: one current row per key in photo_extracted_fields, photo_text_lines and image_descriptions; a new image_angle_observations row per reading with a mappable angle (never updated or deleted: read the newest classifier_v2 row); cited vehicle fields to field_evidence and plate codes to land_identifier_claims() when the photo is filed; the deep camera pose. Locks the photo row. A reading different from the one landed (photo_classifier_landings.reading_id = photo_classifier_reading_id(classification)) supersedes it: the prior rows are copied to photo_land_superseded_rows, then rewritten in place or removed. The same reading again changes nothing. Never raises: a failure rolls the run back and is recorded in photo_land_failures (run again by photo_land_retry_failures()). p_include_classifier = false lands the camera pose only.';
  v_oid oid := 'public.photo_land_classification(uuid,boolean)'::regprocedure;
  v_prev text;
begin
  v_prev := obj_description(v_oid, 'pg_proc');
  if position(c_mark in coalesce(v_prev, '')) > 0 then   -- replay: keep what was there before the marker
    v_prev := nullif(rtrim(left(v_prev, position(c_mark in v_prev) - 1)), '');
  end if;
  execute format('comment on function public.photo_land_classification(uuid, boolean) is %L',
                 case when v_prev is null then '' else v_prev || ' ' end || c_mark || c_text);
end $fold_comment$;

-- One reader's wording. assay_photo_reading_flow(boolean) (20261113100000 / 20261113120000) reads the classifier_v2
-- description rows as "first readings". Its SQL stays right (still one row per image), but from here on a row carries
-- the version, model and landing time of the image's CURRENT reading, so its first_* keys count re-reads too. Its live
-- body was not read from production, so the function is not redefined; its catalog comment is extended, once, if it
-- exists. Never fails the deploy.
do $assay$
declare
  v_oid oid := to_regprocedure('public.assay_photo_reading_flow(boolean)');
  c_note constant text := ' [photo landing supersession] Since photo_land_classification() supersedes readings (photo_classifier_landings), a classifier_v2 description row carries the version, model and landing time of the image''s CURRENT reading: the first_* keys count re-reads as well as first readings.';
begin
  if v_oid is null or coalesce(obj_description(v_oid, 'pg_proc'), '') like '%[photo landing supersession]%' then return; end if;
  begin
    execute format('comment on function public.assay_photo_reading_flow(boolean) is %L', coalesce(obj_description(v_oid, 'pg_proc'), '') || c_note);
  exception when others then
    raise notice 'assay_photo_reading_flow comment not extended: %', sqlerrm;
  end;
end $assay$;

-- The file must install exactly the bodies its own guard accepts on a replay.
do $verify$
declare
  v_fold text := (select md5(prosrc) from pg_proc where oid = 'public.photo_land_classification(uuid,boolean)'::regprocedure);
  v_trigger text := (select md5(prosrc) from pg_proc where oid = 'public.photo_land_trigger()'::regprocedure);
begin
  if v_fold <> '1625d1e78b0bc5511d5f4dbfab4c28ef' or v_trigger <> '550ba1336d544010215b221aace47748' then
    raise exception 'the bodies in this file and the md5s in its guard disagree (fold %, trigger %): update c_fold_this / c_trigger_this here and in the revert',
      v_fold, v_trigger;
  end if;
end $verify$;
commit;
