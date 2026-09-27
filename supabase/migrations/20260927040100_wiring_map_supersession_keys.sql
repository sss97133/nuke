-- Wiring map follow-up: keys that allow supersession (20260927030100_wiring_map_typed_rows.sql).
--
-- WHY: loading the K5's current wire list (k5_registry v5) must SUPERSEDE the June rows, not overwrite them
-- (SCHEMA_LAW §4). Two constraints made that impossible:
--   * vehicle_custom_circuits_overlay_code_uniq: one row per (overlay, circuit_code) forever, so a replaced June row
--     and its successor can't both exist. Uniqueness now applies to LIVE rows only (is_superseded = false).
--   * wire_termination_specs.wire_number NOT NULL: an integer, which can't hold wire codes like 99G or INJ1_PWR;
--     wire ends are now keyed by circuit_id + endpoint_id + cavity (+ wire_code). wire_number stays for the April rows.
-- Relaxing only; no data changes. The old UNIQUE (vehicle_id, wire_number, endpoint_side) still holds for rows that
-- use wire_number (NULLs never collide).

drop index public.vehicle_custom_circuits_overlay_code_uniq;   -- a unique index (not a table constraint)
drop index public.vehicle_custom_circuits_live_by_overlay;   -- same columns + predicate as the unique index below (20260927030100)
create unique index vehicle_custom_circuits_overlay_code_live
  on public.vehicle_custom_circuits (overlay_id, circuit_code) where is_superseded = false;

alter table public.wire_termination_specs alter column wire_number drop not null;
