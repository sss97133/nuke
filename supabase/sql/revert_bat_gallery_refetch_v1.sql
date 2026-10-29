-- soft revert (no deletes): reject/supersede this run's images (found via its links), then retire the links
begin; set local statement_timeout='55s';
update public.vehicle_images vi set verification_status='rejected', is_superseded=true, superseded_at=now()
 from public.vehicle_image_listing_links l where l.run_id='bat_gallery_refetch_v1_20261025' and l.image_id=vi.id and vi.ai_scan_metadata->>'run_id'='bat_gallery_refetch_v1_20261025';
update public.vehicle_image_listing_links set retired_at=now(), retired_reason='revert bat_gallery_refetch_v1_20261025', retired_run_id='revert_bat_gallery_refetch_v1_20261025' where run_id='bat_gallery_refetch_v1_20261025' and retired_at is null;
commit;
