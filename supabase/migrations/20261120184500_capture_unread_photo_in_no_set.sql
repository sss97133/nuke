-- A photo nobody has read yet joins no capture set and is never stored on a clear set.
--
-- Why. Until now a photo waiting for its first read always carried the provider's stand-in answer: when the on-arrival
-- read fails the orchestrator writes image_type 'other' (classifier_ok false), and 20261115123000 keeps 'other' out of
-- every set. Migration 20261120183500 (first read queued at landing) stops sending such a photo to the provider, so it
-- waits for its reader holding no classification at all. An empty type is not 'other': the scorer would admit the photo
-- to a set, and plan_step could store it on a clear set and file it to a vehicle before anyone had looked at it, which
-- is the 2026-02-18 passport case again by another door. This migration states the rule the stand-in was standing in
-- for: no image type and status pending, processing or failed = not read = in no set. A failed photo with no type is
-- the same photo after its read gave up: until now it always carried the stand-in, and after 20261120183500 nothing
-- writes one for it (the orchestrator's catch-all and reset_stuck_photo_pipeline_images set failed without a type).
--
-- Measured on production 2026-11-20, owner's photos the scorer admits (capture_set_photo_admits, with a taken_at and
-- an image_url): 1,137 hold no image type; 979 of them are skipped and 158 completed; 0 are pending, processing or failed. So
-- no photo changes standing when this deploys. Skipped and completed photos without a type are not judged here.
--
-- capture_sets_score: the blocked line gains the rule, in the same place and with the same effect as 'other'.
-- capture_landing_plan_step: clearable_ids gains it too, so a set scored a moment earlier cannot clear such a photo.
--   A set made only of unread photos is not reachable through the scorer; its reason text is left as it was.
-- Each function is patched by replacing one snippet of its live text; if the snippet is not there exactly once the
-- migration refuses. Does not bump any epoch, does not call capture_landing_gate_check, does not re-arm days, does
-- not file, and does not make a read photo join a set later (the day is still planned once, on arrival).
-- Contract: supabase/sql/test_capture_unread_photo_in_no_set.sql
-- Revert: supabase/sql/revert_20261120184500_capture_unread_photo_in_no_set.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $do$
declare
  v_def text;
  v_n int;
  v_score_old text := $snip$             or coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') in ('other','receipt_document')  -- (20261115123000)
             blocked,$snip$;
  v_score_new text := $snip$             or coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') in ('other','receipt_document')  -- (20261115123000)
             or (coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') = ''
                 and coalesce(vi.ai_processing_status,'') in ('pending','processing','failed'))  -- (20261120184500) not read
             blocked,$snip$;
  v_plan_old text := $snip$                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')
                          and not exists (
                                select 1 from capture_set_review r$snip$;
  v_plan_new text := $snip$                          and coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','')
                                not in ('other','receipt_document')
                          and not (coalesce(vi.ai_scan_metadata#>>'{classification,image_type}','') = ''
                                   and coalesce(vi.ai_processing_status,'') in ('pending','processing','failed'))  -- (20261120184500) not read
                          and not exists (
                                select 1 from capture_set_review r$snip$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'capture_sets_score' and p.pronargs = 6 and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'capture_sets_score (6 args) is not live'; end if;
  if position('(20261120184500)' in v_def) > 0 then
    raise notice 'capture_sets_score already carries 20261120184500';
  else
    v_n := (length(v_def) - length(replace(v_def, v_score_old, ''))) / length(v_score_old);
    if v_n <> 1 then raise exception 'capture_sets_score blocked line drifted (n=%); refusing the unread patch', v_n; end if;
    execute replace(v_def, v_score_old, v_score_new);
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'capture_landing_plan_step' and p.pronargs = 2 and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'capture_landing_plan_step is not live'; end if;
  if position('(20261120184500)' in v_def) > 0 then
    raise notice 'capture_landing_plan_step already carries 20261120184500';
  else
    v_n := (length(v_def) - length(replace(v_def, v_plan_old, ''))) / length(v_plan_old);
    if v_n <> 1 then raise exception 'capture_landing_plan_step clearable_ids snippet drifted (n=%); refusing the unread patch', v_n; end if;
    execute replace(v_def, v_plan_old, v_plan_new);
  end if;

  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and ((p.proname = 'capture_sets_score' and p.pronargs = 6) or (p.proname = 'capture_landing_plan_step' and p.pronargs = 2))
         and position('(20261120184500)' in p.prosrc) > 0) <> 2 then
    raise exception 'the unread patch did not land on both functions';
  end if;
end
$do$;

commit;
