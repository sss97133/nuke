-- A current BaT lot can belong to a vehicle whose original source is another house.
-- Change only enrollment/reconciliation eligibility; keep source controls, slots,
-- cadence, terminal-receipt guards and the existing monitor writer unchanged.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE
 target regprocedure := 'public.bat_live_pull_run(integer,boolean)'::regprocedure;
 definition text := pg_get_functiondef(target);
 shared_gate text := $gate$(v.platform_source = 'bringatrailer' OR (
        /* canonical-bat-monitor-v1 */
        v.listing_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
        AND v.origin_metadata->>'platform'='bringatrailer'
        AND v.origin_metadata->>'source'='bat_auctions_page'
        AND v.origin_metadata->>'external_id' ~ '^[1-9][0-9]{3,}$'
        -- Native inventory identity, not a freshness clock: unchanged rows keep last_sync.
        AND CASE WHEN pg_input_is_valid(v.origin_metadata->>'last_sync','timestamp with time zone')
          THEN (v.origin_metadata->>'last_sync')::timestamptz<=now()+interval '1 minute'
          ELSE false END
        AND EXISTS (SELECT 1 FROM public.vehicle_events current_episode
          WHERE current_episode.vehicle_id=v.id AND current_episode.source_platform='bat'
            AND current_episode.event_type='auction' AND current_episode.event_status IN ('active','live')
            AND rtrim(current_episode.source_url,'/')=rtrim(v.listing_url,'/'))
        AND NOT EXISTS (SELECT 1 FROM public.auction_events terminal
          WHERE terminal.vehicle_id=v.id AND rtrim(terminal.source_url,'/')=rtrim(v.listing_url,'/')
            AND terminal.outcome IN ('sold','reserve_not_met','cancelled'))
      ))$gate$;
 before_authority jsonb;
 after_authority jsonb;
BEGIN
 IF position('canonical-bat-monitor-v1' IN definition)>0 THEN RETURN; END IF;
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=target) IS DISTINCT FROM '772b3e68fec7c4430f5e74d2519fa704'
   OR (length(definition)-length(replace(definition,'v.platform_source = ''bringatrailer''','')))/length('v.platform_source = ''bringatrailer''')<>1
   OR (length(definition)-length(replace(definition,'v.platform_source=''bringatrailer''','')))/length('v.platform_source=''bringatrailer''')<>1 THEN
   RAISE EXCEPTION 'BaT live pull drifted; review current enrollment and reconciliation before amending';
 END IF;
 SELECT jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig)
 INTO before_authority FROM pg_proc WHERE oid=target;
 definition:=replace(definition,'v.platform_source = ''bringatrailer''',shared_gate);
 definition:=replace(definition,'v.platform_source=''bringatrailer''',shared_gate);
 EXECUTE definition;
 SELECT jsonb_build_object('owner',proowner,'acl',proacl,'definer',prosecdef,'config',proconfig)
 INTO after_authority FROM pg_proc WHERE oid=target;
 IF before_authority IS DISTINCT FROM after_authority THEN RAISE EXCEPTION 'BaT monitor authority changed'; END IF;
END $patch$;
COMMIT;
