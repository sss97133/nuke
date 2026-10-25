-- releases (never deletes) the orphan auction_events quarantine rows of run auction_event_orphan_quarantine_v1_20261025
update public.record_quarantine set released_at = now(), released_run = 'revert_auction_event_orphan_quarantine_v1'
 where run_id = 'auction_event_orphan_quarantine_v1_20261025' and tbl = 'auction_events' and released_at is null;
