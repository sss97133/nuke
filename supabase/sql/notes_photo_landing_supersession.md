# Photo landing supersession: final files (design A with the judge's must-fix list applied)

Executed on local PostgreSQL 16 only. Nothing was run against production; production facts are the lead's of 2026-11-10 (17:23 and 19:49 UTC).

| Goes to | File here |
|---|---|
| `supabase/migrations/` | `20261113150000_photo_landing_supersession.sql` |
| `supabase/sql/` | `revert_20261113150000_photo_landing_supersession.sql`, `test_photo_landing_supersession.sql` |
| `supabase/sql/fixtures/` | `photo_landing_supersession_owners.sql` |

The contract passes (101 checks, `psql exit=0`). Run against design A's original draft, the same contract passes 29 checks, fails 24 by assertion and errors on the other 48 because they use a column or function A does not have. Four existing contracts were re-run with the migration applied after their own; all pass.

## What changed from A's draft

1. **Lock.** The advisory lock is gone. The fold's first read takes the photo row `FOR NO KEY UPDATE`, which is the row `land_identifier_claims()` locks `FOR UPDATE`. A hand call and an `UPDATE` of the same photo now wait for each other; they no longer deadlock.
2. **Foreign-key guard.** The migration refuses to apply while any foreign key references one of the four landed tables.
3. **Deploy-role guard (added, not on the list).** It also refuses when the fold's owner lacks `UPDATE` on `vehicle_images` or row level security applies to it there. With the row lock, such a photo would read as "not completed" and nothing would land, without an error.
4. **Angles are append-only.** The fold never updates or deletes `image_angle_observations`. A reading with a mappable angle on a filed photo inserts a `classifier_v2` row stamped with `evidence.reading_id`, unless the newest classifier row already records that angle for that reading. `observed_at` is `clock_timestamp()`, not `now()`, so two landings in one transaction keep their order.
5. **Claims are judged at query time.** A's stored `claim_reasserted` / `claim_outstanding` are replaced by one disposition, `claim`. The current ledger row carries what its reading asserts (`claims_vehicle_id`, `claimed_field_evidence`, `claimed_identifiers`, `claimed_vin`) and is rewritten by every run, so a filing refreshes it. `photo_land_outstanding(vehicle, image, limit)` lists a prior claim only while no current reading of any photo still filed under the vehicle asserts it.
6. **Failures.** One open row per (image, stage, SQLSTATE); A also keyed on the message. `photo_land_trigger()` is redefined under its md5 guard and records a failure that never reaches the fold (stage `trigger`). `photo_land_retry_failures(limit, max_retries)` runs the open ones again; nothing schedules it.
7. **Reading identity is a function**, `photo_classifier_reading_id(classification)`, and the column is `reading_id` everywhere (A: `reading_key`). New `field_evidence` proposals carry `raw_extraction_data.reading_id`.
8. **Revert.** It puts the fold's catalog comment back exactly. The migration appends to whatever comment was there, behind a marker, so the revert can cut it off. Keep-history mode (`set photo_land.keep_history = 'on'`) restores the three bodies and the two comments and leaves every table and function.
9. **Smaller ones.** `superseded_at` can only be stamped with the time of the superseding transaction. The fold writes `photo_land_progress.landed_at` itself. The reader function is plpgsql so the deploy takes no lock on `vehicle_images`.

Two names differ from the must-fix wording. `node scripts/guardrails/check-capability-before-mint.mjs` answered STOP for `photo_classification_reading_key`, `photo_classifier_reading_key` and `photo_land_outstanding_claims` (it named the unrelated capability "Non-vehicle lots as asset entities") and CLEAR for the names used: `photo_classifier_reading_id` and `photo_land_outstanding`.

## Reading identity

A reading is identified by `photo_classifier_reading_id(classification)`: the md5 of the text of `{prompt_version, reader (classifier_receipt.model), image_type, is_automotive, confidence, description, v2}`. So another reader under the same prompt version, or any change in what was said, is a different reading, while `vehicle_hints`, `classifier_ok` and the rest of the receipt do not count.

## After deploy (read-only, `scripts/data/q.sh`)

```sql
-- 1. the bodies are the ones in the file
select oid::regprocedure, md5(prosrc) from pg_proc where proname in ('photo_land_classification', 'photo_land_trigger');
--    expect 1625d1e78b0bc5511d5f4dbfab4c28ef (uuid, boolean) and 550ba1336d544010215b221aace47748 (trigger)
-- 2. the ledger fills as the reader posts: landed = written by the new fold, adopted = landed before and unchanged,
--    pre_ledger = the unknown earlier reading of a photo that was re-read
select basis, count(*), count(*) filter (where superseded_at is null) as current, max(recorded_at) from photo_classifier_landings group by 1;
-- 3. nothing failed (expect no row)
select stage, sqlstate, left(message, 80), count(*), sum(occurrences), max(last_failed_at) from photo_land_failures where resolved_at is null group by 1, 2, 3;
-- 4. no stale mix on photos landed since the deploy (expect 0)
select count(*) from photo_classifier_landings g join photo_extracted_fields f on f.image_id = g.image_id and f.source = 'classifier_v2'
 where g.superseded_at is null and f.prompt_version is distinct from g.prompt_version;
-- 5. the last 200 classifier landings by the new fold: is the stored reading the landed one? (expect no row; vehicle_images by primary key)
select p.image_id from (select image_id from photo_land_progress where result ? 'landing' order by landed_at desc limit 200) p
  join vehicle_images v on v.id = p.image_id
  left join photo_classifier_landings g on g.image_id = p.image_id and g.superseded_at is null
 where photo_classifier_reading_id(v.ai_scan_metadata -> 'classification') is distinct from g.reading_id
   and coalesce(v.ai_scan_metadata #>> '{classification,classifier_ok}', '') <> 'false';
-- 6. once a re-read has happened: what was replaced, and the claims nothing asserts any more
select source_table, disposition, count(*) from photo_land_superseded_rows group by 1, 2;
select * from photo_land_outstanding(null, null, 50);
```

To land open failures by hand: `select photo_land_retry_failures(20);`.

## Worth reading from production before the deploy (not read by me)

```sql
-- a drain that folds many photos in one transaction now holds every photo row it landed until it commits
select jobid, jobname, schedule, active, left(command, 120) from cron.job where command ilike '%photo_land%';
select oid::regprocedure, pg_get_functiondef(oid) from pg_proc where proname = 'photo_land_backfill_drain';
-- the guard refuses the deploy unless the fold's owner may lock a vehicle_images row; this says in advance
select c.relowner::regrole, c.relrowsecurity, c.relforcerowsecurity, r.rolsuper, r.rolbypassrls,
       has_table_privilege('postgres', 'public.vehicle_images', 'UPDATE') as may_update
  from pg_class c, pg_roles r where c.oid = 'public.vehicle_images'::regclass and r.rolname = 'postgres';
-- the one-argument wrapper is SECURITY DEFINER and this change does not touch its grants: who may call it?
select has_function_privilege('anon', 'public.photo_land_classification(uuid)', 'execute') as anon,
       has_function_privilege('authenticated', 'public.photo_land_classification(uuid)', 'execute') as authenticated;
-- the resolveAngle.ts change selects two more columns: may the page's roles read them?
select grantee, privilege_type from information_schema.role_table_grants where table_name = 'image_angle_observations' and grantee in ('anon', 'authenticated');
select * from v_schema_atlas where table_name = 'image_angle_observations';   -- its size and writers; if it is small: select distinct source
```

## Still not done

- **No claim is withdrawn.** Stale `field_evidence` and `vehicle_identifiers` rows keep their status; they are only listed.
- **`vehicle_identifier_observations`** candidates minted from replaced rows are not marked.
- **A newer reading with no mappable angle** (or on an unfiled photo) adds no angle row, so the older reading's row stays the newest classifier row and the lightbox keeps showing it. The ledger knows (`yields.angle` is null) but the frontend cannot read the ledger.
- **`resolveAngle.ts` must change in the same PR** (exact edit in the structured result). Not compiled here: the frontend has no `node_modules` in this checkout.
- **Outstanding-claims limits.** A proposal the acceptor filed under an alias field name reads as outstanding. An identifier row citing one photo is not listed while another photo's current reading asserts the same code. A photo moved between vehicles without a gate change does not run the fold, so its reading counts for the new vehicle only after its next run.
- **Identity is md5 of text.** The same numbers written differently (0.93, 0.930) are different readings; jsonb calls them equal, so trigger a06 does not fire and the difference lands only on a later run.
- **Not caught at run time:** a foreign key added later onto a landed table; a failure while `photo_land_note_failure` itself is unavailable (a warning only); a statement timeout inside the fold (fails the `UPDATE`, as today).
- **A hand call or drain that keeps its transaction open** holds the photo rows it landed; a writer with a short `lock_timeout` fails rather than storing a reading. Such a transaction can still deadlock with a trigger run through the vehicle row `land_identifier_claims()` locks (as before this change); the fold now catches and records it (40P01) and it can be run again. `photo_land_backfill_drain` exists only in production and was not read.
- **Existing repo contracts** (`test_photo_field_source_roles.sql`, `test_reviewed_image_analysis.sql`) still key their stand-ins on `prompt_version` and do not load this migration. They pass as they are; the regress copies reshaped them.
- **Unchanged behaviour:** `vehicle_id` on rows landed while unfiled stays NULL after filing; the newest reading wins, including a weaker one.
- **Library entries** (`docs/library` dictionary and schematics for the three tables) are not written.

## How it was run

`tools/stage.sh` builds a tree shaped like `supabase/` (repo files as symlinks, these four as copies); `tools/run.sh` runs a contract from it as CI does. `tools/stamp.py` writes the md5 of the two bodies into both guards: run it after any edit of a body. `tools/regress.sh`, `tools/run_against_a.sh`, `tools/judge_probes.sh` and `tools/probe_owner_guard.sh` produced the other logs in `logs/`.
