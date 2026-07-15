-- ALLOW_RAW_TESTIMONY_WRITE — corruption correction with provenance, via chokepoint.
--
-- THE WOUND (found 2026-07-11 via the iOS Explore surface): one classiccars-com
-- import batch (2026-03-26) stamped ALL 11,217 of its vehicles with the same
-- fabricated location — city='cadillac', state='MICHIGAN' (every make from
-- Chevrolet to VW; not even the 'City, ST' shape). That single bad stamp made
-- "cadillac, MICHIGAN" the #1 metro in marketplace_metro_pulse (11,217
-- listings, 0 active, 0.0% turnover) — the top row of the Explore landing was
-- a fabrication, violating the cardinal no-fabricated-data law.
--
-- THE FIX SHAPE: a correction chokepoint (precedent: sanitize_vehicle_make_guard,
-- flag_sale_date_ingest_stamp_gate, correct_image_provenance). The wrong value is
-- PRESERVED in origin_metadata.location_correction (supersede-never-erase: the
-- correction is reversible and auditable), then city/state/location are cleared
-- so the rows drop out of geo rollups (the pulse view filters city IS NOT NULL).
-- True locations are not recoverable from these rows (origin_metadata empty, no
-- discovery_url) — re-extraction from classiccars is the separate backfill path.
--
-- Batched (p_limit per call, callers loop until 0): vehicles carries 38 triggers,
-- so an unbounded UPDATE would blow the statement timeout (same lesson as the
-- vehicle_images hero trigger, 20260711210000).

create or replace function public.correct_fabricated_location_stamp(
  p_city text,
  p_state text,
  p_source text,
  p_reason text,
  p_limit int default 500
) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with batch as (
    select id, city, state, location from vehicles
    where city = p_city and state = p_state and source = p_source
    limit p_limit
  )
  update vehicles v
  set city = null,
      state = null,
      location = null,
      origin_metadata = coalesce(v.origin_metadata, '{}'::jsonb)
        || jsonb_build_object('location_correction', jsonb_build_object(
             'removed_city', b.city,
             'removed_state', b.state,
             'removed_location', b.location,
             'reason', p_reason,
             'corrected_at', now()))
  from batch b
  where v.id = b.id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.correct_fabricated_location_stamp(text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.correct_fabricated_location_stamp(text, text, text, text, int)
  to service_role;

comment on function public.correct_fabricated_location_stamp(text, text, text, text, int) is
  'Clears a known-fabricated bulk location stamp (one import batch, one bogus city/state on every row), preserving the removed values + reason in origin_metadata.location_correction. Batched — loop until 0 (38 triggers on vehicles). First use: classiccars-com ''cadillac, MICHIGAN'' ×11,217 (2026-03-26 batch) poisoning marketplace_metro_pulse.';
