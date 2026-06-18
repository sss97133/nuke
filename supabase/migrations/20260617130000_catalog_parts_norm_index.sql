-- expression index so get_vehicle_parts_ledger's normalized part-number join is an index lookup
-- (was ~4s: regexp_replace computed on all 10.8K catalog rows per observed part). Makes the
-- documented-investment floor fast enough to surface.
create index if not exists idx_catalog_parts_pn_norm
  on catalog_parts (upper(regexp_replace(part_number,'[^A-Za-z0-9]','','g')))
  where price_current is not null;
