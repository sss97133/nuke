-- First-class provenance-suspect flags on vehicle_events (instead of metadata conventions).
-- source_suspect: which provenance fields of the row are known wrong/unreliable.
-- duplicate_of_event_id: the canonical event this row duplicates (pair with sale_truth_role='duplicate').
alter table public.vehicle_events
  add column if not exists source_suspect text[],
  add column if not exists source_suspect_reason text,
  add column if not exists source_suspect_run_id text,
  add column if not exists source_suspect_at timestamptz,
  add column if not exists duplicate_of_event_id uuid references public.vehicle_events(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_events_source_suspect_chk') then
    alter table public.vehicle_events add constraint vehicle_events_source_suspect_chk
      check (source_suspect is null or source_suspect <@ array['source_platform','source_url','sold_at','final_price','vehicle_id']::text[]);
  end if;
end $$;

create index if not exists vehicle_events_source_suspect_idx
  on public.vehicle_events (source_suspect_run_id) where source_suspect is not null;
create index if not exists vehicle_events_duplicate_of_idx
  on public.vehicle_events (duplicate_of_event_id) where duplicate_of_event_id is not null;

comment on column public.vehicle_events.source_suspect is
  'Provenance fields of this row known to be wrong (source_platform, source_url, sold_at, final_price, vehicle_id). Readers must not trust flagged fields.';
comment on column public.vehicle_events.duplicate_of_event_id is
  'Canonical event this row duplicates; set together with sale_truth_role=duplicate.';
