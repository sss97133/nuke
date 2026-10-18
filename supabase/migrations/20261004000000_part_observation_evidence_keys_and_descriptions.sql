-- part_observation_evidence: declare the two keys the data honors, and describe the table.
-- Exact check on all 1,077 rows (2026-10-03): vehicle_id 0 orphans, derived_from_image_id 0 orphans, neither null.
-- The table is small, so the keys are added already validated.
-- catalog_part_id is NOT keyed: it is polymorphic. catalog_match_kind says which catalog the id belongs to:
--   parts_catalog_name -> parts_catalog.id (86 rows), catalog_parts_sku -> catalog_parts.id (4 rows).
-- Neither fits one foreign key until the catalog fork (parts_catalog / catalog_parts / part_catalog /
-- intelligent_parts_catalog) is settled onto one table.
set lock_timeout = '5s';

alter table public.part_observation_evidence
  add constraint part_observation_evidence_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id);
alter table public.part_observation_evidence
  add constraint part_observation_evidence_derived_from_image_id_fkey
  foreign key (derived_from_image_id) references public.vehicle_images(id);

comment on table public.part_observation_evidence is
  'Per-photo part-visible atoms. One row = one part seen in one image (grain: image x part). Resolves the observed part to a catalog SKU when it can (matched = true) and lands matched = false to surface the catalog gap. Presence testimony, never a fabricated purchase; any price is supersedable price testimony and the owner signs value. 1,077 rows, all from photo_testimony_cascade_2026-06-18; 90 matched, 987 unmatched.';
comment on column public.part_observation_evidence.id is 'Row id.';
comment on column public.part_observation_evidence.catalog_part_id is 'Catalog row the part resolved to, when matched. POLYMORPHIC: catalog_match_kind names the table (parts_catalog_name -> parts_catalog.id, catalog_parts_sku -> catalog_parts.id). Null when unmatched. No foreign key until the catalog tables are consolidated.';
comment on column public.part_observation_evidence.catalog_match_kind is 'How the catalog match was made and which catalog table catalog_part_id points into: parts_catalog_name (name match into parts_catalog) or catalog_parts_sku (SKU match into catalog_parts). Null when unmatched.';
comment on column public.part_observation_evidence.observed_label is 'The part as the reader described it, in free text, e.g. Edelbrock Performer carb adapter plate (product image). Verbatim from the reader; not normalized.';
comment on column public.part_observation_evidence.part_number_guess is 'Part number read or guessed from the image, verbatim. A guess, not a verified SKU; null when none was read.';
comment on column public.part_observation_evidence.derived_from_image_id is 'The image the part was seen in. FK to vehicle_images.id.';
comment on column public.part_observation_evidence.vehicle_id is 'The vehicle the image was attributed to when the part was read. FK to vehicles.id.';
comment on column public.part_observation_evidence.observed_at is 'Event time: when the image was taken (the moment the part was present), not when it was read.';
comment on column public.part_observation_evidence.bbox is 'Where the part sits in the image as [x1, y1, x2, y2] on the 0-999 normalized box convention used by the image reader; null if not localized.';
comment on column public.part_observation_evidence.confidence is 'Reader confidence in the label, 0 to 1.';
comment on column public.part_observation_evidence.matched is 'True when catalog_part_id resolved to a catalog row. False rows are the catalog gap.';
comment on column public.part_observation_evidence.unit_price_usd is 'Catalog unit price in USD at match time, when matched. Supersedable price testimony, not a purchase price.';
comment on column public.part_observation_evidence.source_method is 'The run that produced the row, e.g. photo_testimony_cascade_2026-06-18.';
comment on column public.part_observation_evidence.created_at is 'Ingest time: when the row was written (UTC).';
