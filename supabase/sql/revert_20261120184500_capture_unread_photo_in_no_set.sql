-- Revert of 20261120184500 (an unread photo joins no capture set): puts the one snippet back in each function.
-- A function that does not carry the marker is left alone; one that carries it but no longer holds the patched
-- snippet exactly once is refused. Apply as a migration through CI, never by hand.

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
  if v_def is null or position('(20261120184500)' in v_def) = 0 then
    raise notice 'capture_sets_score does not carry 20261120184500; nothing to revert';
  else
    v_n := (length(v_def) - length(replace(v_def, v_score_new, ''))) / length(v_score_new);
    if v_n <> 1 then raise exception 'capture_sets_score no longer holds the 20261120184500 snippet once (n=%); refusing', v_n; end if;
    execute replace(v_def, v_score_new, v_score_old);
  end if;

  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'capture_landing_plan_step' and p.pronargs = 2 and p.pronamespace = 'public'::regnamespace;
  if v_def is null or position('(20261120184500)' in v_def) = 0 then
    raise notice 'capture_landing_plan_step does not carry 20261120184500; nothing to revert';
  else
    v_n := (length(v_def) - length(replace(v_def, v_plan_new, ''))) / length(v_plan_new);
    if v_n <> 1 then raise exception 'capture_landing_plan_step no longer holds the 20261120184500 snippet once (n=%); refusing', v_n; end if;
    execute replace(v_def, v_plan_new, v_plan_old);
  end if;
end
$do$;

commit;
