-- 2026-10-23: vehicle_events rows could be written with no provenance. Measured: 411,183 rows have
-- extraction_method NULL across 22 platforms, and writers still produce them (ebay_motors 31k, mecum 14.5k,
-- craigslist 5.5k in the last 7 days). The 13 bad Barrett-Jackson rows found on 2026-10-23 came from
-- orphan-backfill-v1 or had no method, so a bad row could not be traced to the step that wrote it.
--
-- Change (additive):
--   1. vehicle_events.extraction_run_id text: the run that wrote the row.
--   2. BEFORE INSERT trigger fills provenance a writer omitted, so no new row lacks it and no writer breaks:
--        extraction_method <- app.writer setting, else 'unattributed:<db role>'
--        extraction_run_id <- app.run_id setting, else 'auto:<UTC date>:<txid>'
--      metadata.provenance_filled_by_trigger = true marks the filled rows so writers can be fixed one by one.
--   No CHECK constraint: a NOT VALID check still binds UPDATEs of the 411k legacy NULL rows (price-basis crons,
--   corrections) and would break them. The insert trigger is the guarantee for new rows.
-- Writers should set their own values: select set_config('app.writer','<fn>-vN',true), set_config('app.run_id','<id>',true)
-- or pass extraction_method / extraction_run_id in the row.
--
-- Revert:
--   drop trigger if exists vehicle_events_fill_provenance on vehicle_events;
--   drop function if exists vehicle_events_fill_provenance();
--   (extraction_run_id column can stay; it is nullable and unused by readers.)

alter table public.vehicle_events add column if not exists extraction_run_id text;
comment on column public.vehicle_events.extraction_run_id is
'Run that wrote the row (writer-supplied app.run_id or column value; else auto:<UTC date>:<txid> from the provenance trigger). Unit: none. Source: writer. Grain: one row write. Clock: insert.';

create or replace function public.vehicle_events_fill_provenance() returns trigger
language plpgsql as $$
declare filled boolean := false;
begin
  if new.extraction_method is null or btrim(new.extraction_method) = '' then
    new.extraction_method := coalesce(nullif(current_setting('app.writer', true), ''), 'unattributed:' || current_user);
    filled := true;
  end if;
  if new.extraction_run_id is null then
    new.extraction_run_id := coalesce(nullif(current_setting('app.run_id', true), ''),
                                      'auto:' || to_char(now() at time zone 'UTC', 'YYYYMMDD') || ':' || txid_current());
  end if;
  if filled then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('provenance_filled_by_trigger', true);
  end if;
  return new;
end $$;

drop trigger if exists vehicle_events_fill_provenance on public.vehicle_events;
create trigger vehicle_events_fill_provenance before insert on public.vehicle_events
  for each row execute function public.vehicle_events_fill_provenance();

