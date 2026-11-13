-- the snapshot scans ~25k photo rows through vehicle_image_gallery_eligible(); give it its own timeout (cron + manual).
alter function public.profile_quality_snapshot_v1(uuid,uuid,text,text,boolean) set statement_timeout = '900s';
